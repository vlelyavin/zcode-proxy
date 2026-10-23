// Конфиг: файл + env-override. В конфиге нет секретов, кроме локального ключа;
// сам JWT читается из кредов ZCode при старте и перечитывается на 401.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { readJwt, readDeviceMid, expandHome } from "./credentials.js";

export const DEFAULTS = {
  bind: "127.0.0.1",
  port: 18960,
  localKey: "",
  credentialsPath: "~/.zcode/v2/credentials.json",
  telemetryPath: "~/.zcode/v2/telemetry-state.json",
  appVersion: "3.16.3",
  osVersion: os.release(),
  maxInflight: 2,
  effort: "high",
  timeoutMs: 600000,
  models: { "glm-5.3-flash": "GLM-5.3-Flash", "glm-5.3": "GLM-5.3" },
  // старые id: жили до переименования, оставлены чтобы чужие конфиги не отвалились
  aliases: { zcode: "glm-5.3-flash", "zcode-5.3": "glm-5.3" },
};

export function loadConfig(file) {
  let fileCfg = {};
  if (file) {
    const p = expandHome(file);
    if (!fs.existsSync(p)) throw new Error(`config not found: ${p}`);
    fileCfg = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const cfg = { ...DEFAULTS, ...fileCfg, models: { ...DEFAULTS.models, ...(fileCfg.models || {}) }, aliases: { ...DEFAULTS.aliases, ...(fileCfg.aliases || {}) } };
  for (const [env, key] of [
    ["ZCODE_PROXY_BIND", "bind"],
    ["ZCODE_PROXY_PORT", "port"],
    ["ZCODE_PROXY_KEY", "localKey"],
    ["ZCODE_PROXY_EFFORT", "effort"],
  ]) {
    if (process.env[env]) cfg[key] = process.env[env];
  }
  if (process.env.ZCODE_PROXY_MAX_INFLIGHT) cfg.maxInflight = Number(process.env.ZCODE_PROXY_MAX_INFLIGHT);
  cfg.port = Number(cfg.port);
  cfg.maxInflight = Math.max(1, Number(cfg.maxInflight) || 1);
  if (!cfg.localKey) cfg.localKey = "sk-zcode-" + crypto.randomBytes(12).toString("hex");

  cfg.reloadCredentials = () => {
    cfg.jwt = readJwt({ credentialsPath: cfg.credentialsPath });
    const fromClient = readDeviceMid({ telemetryPath: cfg.telemetryPath });
    if (fromClient) cfg.deviceMid = fromClient;
    else {
      const baseDir = file ? path.dirname(expandHome(file)) : path.join(os.homedir(), ".config", "zcode-proxy");
      cfg.deviceMid = cfg.deviceMid || persistentDeviceId(baseDir);
    }
    return cfg.jwt;
  };
  return cfg;
}

// Клиентский device-mid появляется только после запуска приложения. Апстрим
// принимает любой стабильный UUID, поэтому генерируем свой и держим рядом с конфигом.
export function persistentDeviceId(dir) {
  const file = path.join(dir, "device-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {}
  const fresh = crypto.randomUUID();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, fresh + "\n", { mode: 0o600 });
  } catch {}
  return fresh;
}
