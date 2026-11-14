// Чтение локальных кредов ZCode: JWT старт-плана и device-mid.
// v1: "enc:v1:<iv>.<tag>.<data>", AES-256-GCM, ключ = sha256(secret) —
// секрет из ZCODE_CREDENTIAL_SECRET, иначе детерминированный фолбэк клиента.
// v2 (клиент >= 3.18): "enc:v2:os:<fingerprint>:<iv>.<tag>.<data>", тот же шифр,
// а ключ лежит в системном хранилище секретов под service/account клиента.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const PREFIX = "enc:v1:";
const V2 = "enc:v2:";
const KEYRING_SERVICE = "ZCode Credential Encryption";
const JWT_KEY = "zcodejwttoken";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return os.homedir() + p.slice(1);
  return p;
}

export function credentialSecret(env = process.env) {
  const explicit = (env.ZCODE_CREDENTIAL_SECRET || "").trim();
  if (explicit) return explicit;
  let user = "unknown";
  try {
    user = os.userInfo().username;
  } catch {}
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${user}`;
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

export function openSealed(payload, key) {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("credential decrypt failed: bad ciphertext");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf-8");
  } catch (e) {
    throw new Error("credential decrypt failed: key mismatch or corrupted ciphertext");
  }
}

export function decryptValue(value, key) {
  if (value.startsWith(V2)) throw new Error("enc:v2 needs readJwt, it carries its own key source");
  if (!value.startsWith(PREFIX)) return value;
  return openSealed(value.slice(PREFIX.length), key);
}

export function readCredentialRecord(file) {
  return JSON.parse(fs.readFileSync(expandHome(file), "utf8"));
}

// Ключ v2: service/account ровно те, что пишет клиент (sha256 абсолютного пути к кредам).
// shortcut: путь к нативному модулю по умолчанию только для win32 — на других ОС задайте ZCODE_KEYRING_MODULE.
function keyringKey(credentialsPath, fingerprint) {
  const modulePath =
    process.env.ZCODE_KEYRING_MODULE ||
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs/ZCode/resources/app.asar.unpacked/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node",
    );
  const { Entry } = createRequire(import.meta.url)(modulePath);
  const account = crypto.createHash("sha256").update(path.resolve(expandHome(credentialsPath))).digest("hex");
  const stored = new Entry(KEYRING_SERVICE, account).getPassword();
  const key = stored ? Buffer.from(stored, "base64url") : null;
  if (!key || key.length !== 32) {
    throw new Error("no OS keyring entry for these credentials — unlock the credential store or start the ZCode app once");
  }
  const fp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
  if (fingerprint && fp !== fingerprint) throw new Error("OS keyring key does not match the credentials file");
  return key;
}

// Форма снята с клиента ZCode 3.18.2 (2026-11-14): os:<24 hex отпечатка>:<iv>.<tag>.<data>.
export function parseV2(value) {
  const [source, fingerprint, payload] = value.slice(V2.length).split(":");
  if (source !== "os") throw new Error(`unsupported credential key source: ${source}`);
  if (!fingerprint || !payload) throw new Error("credential decrypt failed: bad ciphertext");
  return { fingerprint, payload };
}

export function readJwt({ credentialsPath, secret } = {}) {
  const record = readCredentialRecord(credentialsPath);
  const raw = record[JWT_KEY];
  if (!raw) throw new Error(`no ${JWT_KEY} in ${credentialsPath} — run the login first`);
  let jwt;
  if (raw.startsWith(V2)) {
    const { fingerprint, payload } = parseV2(raw);
    jwt = openSealed(payload, keyringKey(credentialsPath, fingerprint));
  } else {
    jwt = decryptValue(raw, deriveKey(secret || credentialSecret()));
  }
  jwt = jwt.trim();
  if (jwt.split(".").length !== 3) throw new Error("decrypted token is not a JWT");
  return jwt;
}

export function readDeviceMid({ telemetryPath } = {}) {
  const candidates = telemetryPath
    ? [telemetryPath]
    : ["~/.zcode/v2/telemetry-state.json", "~/.zcode/v2/setting.json"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const m = fs.readFileSync(expandHome(c), "utf8").match(UUID_RE);
      if (m) return m[0];
    } catch {}
  }
  return null;
}
