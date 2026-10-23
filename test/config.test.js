import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, persistentDeviceId, DEFAULTS } from "../src/config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("device id is generated once and reused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zc-cfg-"));
  const first = persistentDeviceId(dir);
  const second = persistentDeviceId(dir);
  assert.match(first, UUID);
  assert.equal(first, second);
  assert.equal(fs.readFileSync(path.join(dir, "device-id"), "utf8").trim(), first);
});

test("default config carries both model aliases", () => {
  assert.equal(DEFAULTS.models.zcode, "GLM-5.3-Flash");
  assert.equal(DEFAULTS.models["zcode-5.3"], "GLM-5.3");
});

test("a local key is minted when the config has none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zc-cfg-"));
  const cfg = loadConfig(null);
  assert.match(cfg.localKey, /^sk-zcode-[a-f0-9]{24}$/);
  assert.equal(cfg.port, 18960);
  assert.equal(fs.existsSync(dir) || true, true);
});

test("file values win over defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zc-cfg-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ port: 19001, models: { custom: "GLM-5.3" } }));
  const cfg = loadConfig(file);
  assert.equal(cfg.port, 19001);
  assert.equal(cfg.models.custom, "GLM-5.3");
  assert.equal(cfg.models.zcode, "GLM-5.3-Flash");
});
