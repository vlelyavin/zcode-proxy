// Заголовки апстрима: отпечаток реального клиента ZCode.
// Модельные пути не подписываются (X-Client-Sig нужен только бизнес-вызовам).
import crypto from "node:crypto";

export const UPSTREAM_ORIGIN = "https://zcode.z.ai";
export const MESSAGES_PATH = "/api/v1/zcode-plan/anthropic/v1/messages";
export const BALANCE_PATH = "/api/v1/zcode-plan/billing/balance";

export const UA = (v) => `ZCode/${v} ai/6.0.193 ai-sdk/provider-utils/4.0.27 runtime/node.js/24`;

export function baseHeaders({ jwt, appVersion, osVersion, deviceMid }) {
  return {
    "content-type": "application/json",
    "http-referer": UPSTREAM_ORIGIN,
    "user-agent": UA(appVersion),
    "x-client-language": "en-US",
    "x-client-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "x-os-category": "linux",
    "x-os-version": osVersion || "unknown",
    "x-platform": "linux-x64",
    "x-release-channel": "production",
    "x-title": "Z Code@electron",
    "x-zcode-app-version": appVersion,
    "x-zcode-agent": "glm",
    "x-zcode-session-type": "main",
    "x-zcode-query-source": "main_turn",
    "anthropic-beta": "mid-conversation-system-2026-04-07",
    "anthropic-version": "2023-06-01",
    authorization: `Bearer ${jwt}`,
    "x-api-key": jwt,
    ...(deviceMid ? { "x-device-mid": deviceMid } : {}),
  };
}

export function requestHeaders(opts) {
  const h = baseHeaders(opts);
  h["x-request-id"] = crypto.randomUUID();
  h["x-query-id"] = crypto.randomUUID();
  h["x-zcode-trace-id"] = crypto.randomUUID();
  h["x-session-id"] = opts.sessionId;
  return h;
}

export function balanceHeaders(opts) {
  const h = baseHeaders(opts);
  delete h["content-type"];
  delete h["anthropic-version"];
  delete h["anthropic-beta"];
  h.accept = "*/*";
  return h;
}
