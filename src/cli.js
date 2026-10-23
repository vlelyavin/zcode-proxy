#!/usr/bin/env node
// CLI релея: run | setup | login | check | models
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, DEFAULTS } from "./config.js";
import { createServer } from "./server.js";
import { readJwt, readDeviceMid, expandHome } from "./credentials.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = () => process.env.ZCODE_PROXY_CONFIG || path.join(root, "config.json");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function cmdSetup() {
  const target = configPath();
  if (!fs.existsSync(target)) {
    const example = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
    example.localKey = "sk-zcode-" + crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(target, JSON.stringify(example, null, 2) + "\n", { mode: 0o600 });
    console.log(`wrote ${target}`);
  } else {
    console.log(`${target} already exists, left untouched`);
  }

  const cfg = JSON.parse(fs.readFileSync(target, "utf8"));
  let jwt = "";
  try {
    jwt = readJwt({ credentialsPath: cfg.credentialsPath });
    console.log(`credentials OK: jwt ${jwt.length} chars`);
  } catch (e) {
    console.log(`credentials NOT ready: ${e.message}`);
    console.log("run the login first:  zcode-proxy login");
  }
  const mid = readDeviceMid({ telemetryPath: cfg.telemetryPath });
  console.log(mid ? `device id: ${mid}` : "device id: not found (relay still works)");
  console.log(`\nlocal key: ${cfg.localKey}`);
  console.log(`next: zcode-proxy run`);
}

function cmdLogin() {
  const runtime = path.join(os.homedir(), ".local/lib/node_modules/zcode-app-cli/vendor/zcode.cjs");
  const fallback = ["/usr/local/lib/node_modules/zcode-app-cli/vendor/zcode.cjs", "/usr/lib/node_modules/zcode-app-cli/vendor/zcode.cjs"];
  const found = [runtime, ...fallback].find((p) => fs.existsSync(p));
  if (!found) die("zcode-app-cli not installed. run: npm i -g zcode-app-cli");
  console.log("open the printed link in any browser where you are logged into chat.z.ai.");
  console.log("the flow lives ~12 minutes, polling is automatic.\n");
  const child = spawnSync(process.execPath, [found, "login", "--no-browser"], { stdio: "inherit" });
  process.exit(child.status ?? 1);
}

async function cmdCheck() {
  const cfg = loadConfig(configPath());
  let jwt;
  try {
    jwt = readJwt({ credentialsPath: cfg.credentialsPath });
  } catch (e) {
    return die(`credentials: ${e.message}`);
  }
  console.log(`credentials: jwt ${jwt.length} chars`);
  console.log(`endpoint: http://${cfg.bind}:${cfg.port}`);
  const headers = { authorization: `Bearer ${cfg.localKey}` };
  const base = `http://${cfg.bind === "0.0.0.0" ? "127.0.0.1" : cfg.bind}:${cfg.port}`;
  try {
    const health = await fetch(`${base}/health`);
    console.log(`health: ${health.status} ${await health.text()}`);
    const status = await fetch(`${base}/status`, { headers });
    const data = await status.json();
    for (const b of data.buckets || []) {
      console.log(`bucket ${b.plan}: ${b.remaining}/${b.total}, expires ${new Date(b.expires_at * 1000).toISOString()}`);
    }
  } catch (e) {
    console.log(`relay not reachable: ${e.message}`);
  }
}

async function cmdRun() {
  const cfg = loadConfig(configPath());
  try {
    cfg.reloadCredentials();
    console.log(`credentials loaded, device ${cfg.deviceMid || "n/a"}`);
  } catch (e) {
    die(`cannot read ZCode credentials: ${e.message}\nrun: zcode-proxy login && zcode-proxy setup`);
  }
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.bind, () => {
    console.log(`zcode-proxy on ${cfg.bind}:${cfg.port} -> ${Object.entries(cfg.models).map(([a, b]) => `${a}=>${b}`).join(", ")}`);
    console.log(`local key: ${cfg.localKey}`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
}

const cmd = process.argv[2] || "run";
if (cmd === "setup") cmdSetup();
else if (cmd === "login") cmdLogin();
else if (cmd === "check") await cmdCheck();
else if (cmd === "models") console.log(Object.keys({ ...DEFAULTS.models }).join("\n"));
else if (cmd === "run") await cmdRun();
else {
  console.log("usage: zcode-proxy [run|setup|login|check|models]");
  process.exit(1);
}
