// Преобразование OpenAI Chat Completions <-> Anthropic Messages.
// Внутренний wire апстрима — anthropic; наружу отдаём openai, чтобы релеем
// могли пользоваться hermes/opencode/что угодно с OpenAI-клиентом.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PREAMBLE = new URL("../assets/harness-system.json", import.meta.url);

// Сервер валидирует форму system: ровно преамбула харнесса (3 блока).
// Чужой системный текст допустим только внутри последнего блока — иначе 3012/502.
export function loadPreamble(file = DEFAULT_PREAMBLE, home = os.homedir()) {
  const p = file instanceof URL ? file : new URL(`file://${path.resolve(file)}`);
  // преамбула снята с живой машины и ссылается на конкретный домашний каталог;
  // подменяем после разбора, иначе windows-путь (C:\Users\...) ломает JSON-escape.
  return swapHome(JSON.parse(fs.readFileSync(p, "utf8")), home);
}

function swapHome(value, home) {
  if (typeof value === "string") return value.replaceAll("/home/vlelyavin", home);
  if (Array.isArray(value)) return value.map((v) => swapHome(v, home));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapHome(v, home)]));
  }
  return value;
}

export function mergeSystem(preamble, extra) {
  const out = preamble.map((b) => ({ ...b }));
  if (!out.length) return extra.length ? extra : [{ type: "text", text: "You are ZCode." }];
  const text = extra.map((b) => b.text).filter(Boolean).join("\n\n");
  if (text) out[out.length - 1].text += "\n\n" + text;
  return out;
}

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function toAnthropicParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: "" }];
  const out = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === "text") out.push({ type: "text", text: part.text ?? "" });
    else if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!url) continue;
      const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (dataUrl) out.push({ type: "image", source: { type: "base64", media_type: dataUrl[1], data: dataUrl[2] } });
      else out.push({ type: "image", source: { type: "url", url } });
    }
  }
  return out.length ? out : [{ type: "text", text: "" }];
}

// Принимает и канонические id, и старые (zcode, zcode-5.3), и уже готовое
// upstream-имя - клиент может закэшировать любое из них.
export function mapModel(id, models) {
  if (!id) return models["glm-5.3-flash"] || "GLM-5.3-Flash";
  if (models[id]) return models[id];
  const low = String(id).toLowerCase();
  if (Object.values(models).some((v) => String(v).toLowerCase() === low)) return String(id);
  if (low.includes("flash") || low === "zcode") return models["glm-5.3-flash"] || "GLM-5.3-Flash";
  if (low.includes("5.3")) return models["glm-5.3"] || "GLM-5.3";
  return String(id);
}

const STOP_REASONS = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "stop",
};

export function buildUpstreamBody(oai, { preamble, models, effort, sessionId, deviceMid }) {
  const system = [];
  const messages = [];
  for (const m of oai.messages || []) {
    if (m.role === "system" || m.role === "developer") {
      const t = textOf(m.content);
      if (t) system.push({ type: "text", text: t });
      continue;
    }
    if (m.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: textOf(m.content).slice(0, 200000) || "(no output)",
      };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && last._toolResults) last.content.push(block);
      else messages.push({ role: "user", content: [block], _toolResults: true });
      continue;
    }
    if (m.role === "assistant") {
      const blocks = [];
      const t = textOf(m.content);
      if (t) blocks.push({ type: "text", text: t });
      for (const tc of m.tool_calls || []) {
        let input = {};
        try {
          input =
            typeof tc.function?.arguments === "string" && tc.function.arguments.trim()
              ? JSON.parse(tc.function.arguments)
              : {};
        } catch {
          input = { _raw: tc.function?.arguments };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
      }
      if (blocks.length) messages.push({ role: "assistant", content: blocks });
      continue;
    }
    messages.push({ role: "user", content: toAnthropicParts(m.content) });
  }
  for (const m of messages) delete m._toolResults;

  const body = {
    model: mapModel(oai.model, models),
    max_tokens: Math.min(Number(oai.max_tokens) || 32000, 128000),
    messages,
    stream: true,
    thinking: { type: "enabled" },
    system: mergeSystem(preamble, system),
    metadata: { user_id: JSON.stringify({ device_id: deviceMid, account_uuid: "", session_id: sessionId }) },
  };

  const tools = (oai.tools || []).filter((t) => t && t.type === "function" && t.function?.name);
  if (tools.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: (t.function.description || "").slice(0, 24000),
      input_schema: t.function.parameters || { type: "object", properties: {} },
      ...(t.function.strict ? { strict: true } : {}),
    }));
    const tc = oai.tool_choice;
    if (tc === "required") body.tool_choice = { type: "any" };
    else if (tc && typeof tc === "object" && tc.function?.name) body.tool_choice = { type: "tool", name: tc.function.name };
    else body.tool_choice = { type: "auto" };
  }

  const chosen = oai.reasoning_effort || effort;
  if (chosen) body.output_config = { effort: ["low", "medium", "high", "max"].includes(chosen) ? chosen : "high" };
  if (oai.temperature != null) body.temperature = oai.temperature;
  return body;
}

// Anthropic SSE -> OpenAI SSE
export function createOpenAiStreamer(res, model, includeUsage) {
  const id = "chatcmpl-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null, extra = {}) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
    ...extra,
  });
  const tools = new Map();
  let nextTool = 0;
  let finish = null;
  let usage = null;
  let buf = "";

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send(chunk({ role: "assistant", content: "" }));

  return {
    feed(text) {
      buf += text;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }
        this.event(ev);
      }
    },
    event(ev) {
      if (ev.type === "content_block_start") {
        const b = ev.content_block || {};
        if (b.type === "tool_use") {
          const index = nextTool++;
          tools.set(ev.index, index);
          send(chunk({ tool_calls: [{ index, id: b.id, type: "function", function: { name: b.name, arguments: "" } }] }));
          if (b.input && Object.keys(b.input).length)
            send(chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(b.input) } }] }));
        }
        return;
      }
      if (ev.type === "content_block_delta") {
        const d = ev.delta || {};
        if (d.type === "text_delta" && d.text) send(chunk({ content: d.text }));
        else if (d.type === "thinking_delta" && d.thinking) send(chunk({ reasoning_content: d.thinking }));
        else if (d.type === "input_json_delta" && d.partial_json) {
          const index = tools.get(ev.index);
          if (index !== undefined) send(chunk({ tool_calls: [{ index, function: { arguments: d.partial_json } }] }));
        }
        return;
      }
      if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) finish = STOP_REASONS[ev.delta.stop_reason] || "stop";
        if (ev.usage) usage = ev.usage;
        return;
      }
      if (ev.type === "error") {
        send(chunk({ content: `\n[upstream error: ${ev.error?.message || "unknown"}]` }, "stop"));
        finish = "stop";
      }
    },
    end() {
      send(chunk({}, finish || (tools.size ? "tool_calls" : "stop")));
      if (includeUsage) {
        const u = usage || {};
        send(
          chunk({}, null, {
            usage: {
              prompt_tokens: u.input_tokens ?? 0,
              completion_tokens: u.output_tokens ?? 0,
              total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0 },
            },
          }),
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
    },
  };
}
