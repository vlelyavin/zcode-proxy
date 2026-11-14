import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { decryptValue, credentialSecret, readJwt, readDeviceMid, openSealed, parseV2 } from "../src/credentials.js";

const key = crypto.createHash("sha256").update("test-secret").digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

// снято с клиента ZCode 3.18.2 (2026-11-14): enc:v2:os:<fp24>:<iv>.<tag>.<data>
function encryptV2(value, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  const fp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `enc:v2:os:${fp}:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln";

function tmpRecord(record) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zc-")), "credentials.json");
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}

test("ciphertext round-trips", () => {
  assert.equal(decryptValue(encrypt("hello"), key), "hello");
});

test("v2 envelope names its key and uses the same cipher", () => {
  const { fingerprint, payload } = parseV2(encryptV2(jwt, key));
  assert.equal(fingerprint, crypto.createHash("sha256").update(key).digest("hex").slice(0, 24));
  assert.equal(openSealed(payload, key), jwt);
});

test("v2 with a non-OS key source is refused", () => {
  assert.throws(() => parseV2(`enc:v2:env:${"a".repeat(24)}:x.y.z`), /unsupported credential key source/);
});

test("decryptValue never passes an enc:v2 blob through as plaintext", () => {
  assert.throws(() => decryptValue(encryptV2(jwt, key), key), /enc:v2/);
});

test("plain values pass through", () => {
  assert.equal(decryptValue("plain", key), "plain");
});

test("readJwt decrypts the token", () => {
  const file = tmpRecord({ zcodejwttoken: encrypt(jwt) });
  assert.equal(readJwt({ credentialsPath: file, secret: "test-secret" }), jwt);
});

test("readJwt rejects a missing token", () => {
  const file = tmpRecord({ other: encrypt("x") });
  assert.throws(() => readJwt({ credentialsPath: file, secret: "test-secret" }), /no zcodejwttoken/);
});

test("readJwt rejects a non-JWT payload", () => {
  const file = tmpRecord({ zcodejwttoken: encrypt("not-a-token") });
  assert.throws(() => readJwt({ credentialsPath: file, secret: "test-secret" }), /not a JWT/);
});

test("wrong secret fails the auth tag", () => {
  const file = tmpRecord({ zcodejwttoken: encrypt(jwt) });
  assert.throws(() => readJwt({ credentialsPath: file, secret: "other" }), /key mismatch|bad ciphertext/);
});

test("device mid comes out of the telemetry file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zc-"));
  const file = path.join(dir, "telemetry-state.json");
  fs.writeFileSync(file, JSON.stringify({ deviceMid: "ef8b115c-6566-4f2e-97e4-20a20de6ea36" }));
  assert.equal(readDeviceMid({ telemetryPath: file }), "ef8b115c-6566-4f2e-97e4-20a20de6ea36");
});

test("missing telemetry yields null", () => {
  assert.equal(readDeviceMid({ telemetryPath: "/nonexistent/x.json" }), null);
});

test("fallback secret is stable and platform-scoped", () => {
  assert.equal(credentialSecret({}), `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`);
  assert.equal(credentialSecret({ ZCODE_CREDENTIAL_SECRET: "  custom  " }), "custom");
});
