// HTTP-сервер релея.
// Вход: OpenAI (/v1/chat/completions) и Anthropic passthrough (/v1/messages).
// Выход: zcode.z.ai, модельные пути anthropic-wire.
import http from "node:http";
import crypto from "node:crypto";
import { buildUpstreamBody, createOpenAiStreamer, loadPreamble } from "./transform.js";
import { MESSAGES_PATH, UPSTREAM_ORIGIN, BALANCE_PATH, requestHeaders, balanceHeaders } from "./upstream.js";

const MAX_BODY = 48 * 1024 * 1024;

export function createServer(cfg) {
  const preamble = loadPreamble(cfg.preamblePath || undefined);
  const state = { inflight: 0, queue: [] };
  const modelIds = Object.keys(cfg.models);

  const acquire = () =>
    state.inflight < cfg.maxInflight
      ? (state.inflight++, Promise.resolve())
      : new Promise((resolve) => state.queue.push(() => (state.inflight++, resolve())));
  const release = () => {
    state.inflight--;
    const next = state.queue.shift();
    if (next) next();
  };

  const json = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };
  const fail = (res, code, message, type = "upstream_error") => json(res, code, { error: { message, type, code } });
  const authOk = (req) => {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const a = Buffer.from(token);
    const b = Buffer.from(cfg.localKey || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const upstreamHeaders = () =>
    requestHeaders({
      jwt: cfg.jwt,
      appVersion: cfg.appVersion,
      osVersion: cfg.osVersion,
      deviceMid: cfg.deviceMid,
      sessionId: `session_${crypto.randomBytes(16).toString("hex")}`,
    });

  async function post(body, headers, signal) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(UPSTREAM_ORIGIN + MESSAGES_PATH, {
        method: "POST",
        headers,
        body,
        signal: signal || AbortSignal.timeout(cfg.timeoutMs || 600000),
      });
      if (res.ok) return res;
      // 401 — протух JWT: перечитываем из кредов и повторяем один раз
      if (res.status === 401 && attempt < 2) {
        await res.text().catch(() => {});
        try {
          const fresh = cfg.reloadCredentials?.();
          if (fresh) {
            headers.authorization = `Bearer ${fresh}`;
            headers["x-api-key"] = fresh;
          }
        } catch {}
        continue;
      }
      if (attempt < 1 && (res.status === 429 || res.status >= 500)) {
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return res;
    }
  }

  async function chat(req, res, raw) {
    let oai;
    try {
      oai = JSON.parse(raw);
    } catch {
      return fail(res, 400, "invalid JSON body", "invalid_request_error");
    }
    const model = oai.model || modelIds[0];
    const includeUsage = Boolean(oai.stream_options?.include_usage);
    let body;
    try {
      body = JSON.stringify(
        buildUpstreamBody(oai, {
          preamble,
          models: cfg.models,
          effort: cfg.effort,
          deviceMid: cfg.deviceMid,
          sessionId: `session_${crypto.randomBytes(16).toString("hex")}`,
        }),
      );
    } catch (e) {
      return fail(res, 400, `cannot build request: ${e.message}`, "invalid_request_error");
    }

    await acquire();
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      release();
    };
    try {
      const up = await post(body, upstreamHeaders());
      if (!up.ok) {
        const detail = (await up.text().catch(() => "")).slice(0, 800) || up.statusText;
        done();
        return fail(res, up.status, `zcode upstream ${up.status}: ${detail}`);
      }

      if (oai.stream === false) {
        const payload = await up.json();
        done();
        const text = (payload.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        const toolCalls = (payload.content || [])
          .filter((b) => b.type === "tool_use")
          .map((b, i) => ({ index: i, id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
        return json(res, 200, {
          id: "chatcmpl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
              finish_reason: toolCalls.length ? "tool_calls" : "stop",
            },
          ],
          usage: {
            prompt_tokens: payload.usage?.input_tokens ?? 0,
            completion_tokens: payload.usage?.output_tokens ?? 0,
            total_tokens: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0),
          },
        });
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.on("close", done);
      const streamer = createOpenAiStreamer(res, model, includeUsage);
      const decoder = new TextDecoder();
      const reader = up.body.getReader();
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        streamer.feed(decoder.decode(value, { stream: true }));
      }
      streamer.end();
      done();
    } catch (e) {
      done();
      if (!res.headersSent) fail(res, 502, String(e?.message || e));
      else {
        try {
          res.write(`data: ${JSON.stringify({ error: { message: String(e?.message || e) } })}\n\n`);
          res.end();
        } catch {}
      }
    }
  }

  async function messages(req, res, raw) {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(res, 400, "invalid JSON body", "invalid_request_error");
    }
    await acquire();
    try {
      const headers = upstreamHeaders();
      if (body.stream) headers.accept = "text/event-stream";
      const up = await post(JSON.stringify(body), headers);
      if (!up.ok) {
        const detail = (await up.text().catch(() => "")).slice(0, 800) || up.statusText;
        return fail(res, up.status, detail);
      }
      res.writeHead(200, { "content-type": up.headers.get("content-type") || "application/json", "cache-control": "no-cache" });
      const reader = up.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) fail(res, 502, String(e?.message || e));
    } finally {
      release();
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://local");

    if (url.pathname === "/health" || url.pathname === "/__health")
      return json(res, 200, { ok: true, inflight: state.inflight, queued: state.queue.length });

    if (url.pathname === "/status" || url.pathname === "/__status") {
      return void (async () => {
        try {
          const r = await fetch(UPSTREAM_ORIGIN + BALANCE_PATH + `?app_version=${cfg.appVersion}`, {
            headers: balanceHeaders({ jwt: cfg.jwt, appVersion: cfg.appVersion, osVersion: cfg.osVersion, deviceMid: cfg.deviceMid }),
            signal: AbortSignal.timeout(20000),
          });
          const data = await r.json();
          const buckets = (data?.data?.balances || []).map((b) => ({
            plan: b.plan_id,
            remaining: b.remaining_units,
            total: b.total_units,
            expires_at: b.expires_at,
          }));
          json(res, 200, { inflight: state.inflight, queued: state.queue.length, buckets });
        } catch (e) {
          json(res, 502, { error: String(e?.message || e) });
        }
      })();
    }

    if (url.pathname === "/v1/models")
      return json(res, 200, {
        object: "list",
        data: modelIds.map((id) => ({ id, object: "model", owned_by: "zcode", context_window: 1000000, max_output_tokens: 128000 })),
      });

    if (req.method !== "POST") return json(res, 405, { error: { message: "POST only" } });
    if (!authOk(req)) return fail(res, 401, "bad or missing local key", "auth_error");

    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      raw += c;
      if (raw.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      if (url.pathname === "/v1/chat/completions") return void chat(req, res, raw);
      if (url.pathname === "/v1/messages") return void messages(req, res, raw);
      fail(res, 404, `no route ${url.pathname}`);
    });
  });

  server.on("clientError", (_err, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {}
  });

  return server;
}
