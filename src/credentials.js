// Чтение локальных кредов ZCode: JWT старт-плана и device-mid.
// Значения в credentials.json лежат как "enc:v1:<iv>.<tag>.<data>"
// (AES-256-GCM, ключ = sha256(secret)). Секрет берётся из ZCODE_CREDENTIAL_SECRET,
// иначе повторяется детерминированный фолбэк рантайма клиента.
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const PREFIX = "enc:v1:";
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

export function decryptValue(value, key) {
  if (!value.startsWith(PREFIX)) return value;
  const [iv, tag, data] = value.slice(PREFIX.length).split(".");
  if (!iv || !tag || !data) throw new Error("credential decrypt failed: bad ciphertext");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf-8");
  } catch (e) {
    throw new Error("credential decrypt failed: key mismatch or corrupted ciphertext");
  }
}

export function readCredentialRecord(file) {
  return JSON.parse(fs.readFileSync(expandHome(file), "utf8"));
}

export function readJwt({ credentialsPath, secret } = {}) {
  const record = readCredentialRecord(credentialsPath);
  const raw = record[JWT_KEY];
  if (!raw) throw new Error(`no ${JWT_KEY} in ${credentialsPath} — run the login first`);
  const jwt = decryptValue(raw, deriveKey(secret || credentialSecret())).trim();
  if (jwt.split(".").length !== 3) throw new Error("decrypted token is not a JWT");
  return jwt;
}

export function readDeviceMid({ telemetryPath } = {}) {
  const candidates = [telemetryPath, "~/.zcode/v2/telemetry-state.json", "~/.zcode/v2/setting.json"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const m = fs.readFileSync(expandHome(c), "utf8").match(UUID_RE);
      if (m) return m[0];
    } catch {}
  }
  return null;
}
