# zcode-proxy

[README на русском](README.ru.md)

you have ZCode trial credits (start-plan). your tools want an api key. this sits in the middle: a local relay that pushes OpenAI/Anthropic calls through ZCode's own model endpoint on your account, so hermes / opencode / curl ride the trial bucket instead of a per-token bill.

## what it does

- speaks OpenAI on the front (`/v1/chat/completions`, streaming, tools) and Anthropic passthrough (`/v1/messages`)
- forwards to `zcode.z.ai` over the anthropic wire the official client uses
- reads your local ZCode credentials on start and again on `401` — no token in the repo
- streams tool calls and thinking back as OpenAI deltas
- retries `429`/`5xx` once, refreshes the token on `401`
- zero npm dependencies. node stdlib, nothing else.

## what it is not

- not a z.ai product, not affiliated with them
- not a hosted service — runs on your machine, your creds
- not a credential bundle — nothing private ships in this repo

## straight talk

it uses the trial relay outside the official client. the gateway checks that requests look like the real harness and answers `405 code 3012 unusual activity` otherwise. this repo carries the harness system preamble and merges your system prompt into its last block so that check passes. z.ai can change the rules any day. heavy parallel hammering on one account raises the flag odds — the relay queues at 2 in flight by default. blocked calls cost nothing, but retrying a flagged account does not help.

promo buckets expire. check before the deadline. `curl -sS http://127.0.0.1:18960/status -H "authorization: Bearer <localKey>"`.

## requirements

- node 20+ (24+ recommended)
- a logged-in ZCode client on this machine: `~/.zcode/v2/credentials.json` must exist. no file, no relay.
- trial credits on the account. paid open-platform keys do not need this relay.

## install

```bash
git clone https://github.com/vlelyavin/zcode-proxy.git
cd zcode-proxy
npm i -g zcode-app-cli     # official client runtime, used only for login
./bin/zcode-login          # prints a link, open it on any device logged into chat.z.ai
node src/cli.js setup      # writes config.json with a random local key
node src/cli.js check      # credentials + endpoint + remaining credits
node src/cli.js run
```

no `npm install` in the repo itself. listens on `127.0.0.1:18960`.

```bash
curl -sS http://127.0.0.1:18960/health
```

## use

```bash
# openai-compatible client
curl -sS http://127.0.0.1:18960/v1/chat/completions \
  -H "authorization: Bearer $(jq -r .localKey config.json)" \
  -H "content-type: application/json" \
  -d '{"model":"zcode","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```

models: `zcode` (GLM-5.3-Flash) and `zcode-5.3` (GLM-5.3). aliases `glm-5.3-flash` / `glm-5.3` work too.

hermes: point a custom provider at `http://127.0.0.1:18960/v1` with the `localKey` and call the model `zcode` or `zcode-5.3`.

## config

optional. `config.example.json` shows the shape.

```bash
ZCODE_PROXY_CONFIG=./config.json node src/cli.js run
```

| key | meaning |
| --- | --- |
| `bind` / `port` | listen address, default `127.0.0.1:18960` |
| `localKey` | shared secret for inbound requests; wrong or missing → 401 |
| `models` | alias → upstream model id |
| `maxInflight` | concurrent upstream calls (default 2) |
| `effort` | default `output_config.effort` when the caller sends no `reasoning_effort` |
| `credentialsPath` / `telemetryPath` | where the client keeps tokens / device id |
| `appVersion` | version string reported in the fingerprint headers |

env overrides: `ZCODE_PROXY_BIND`, `ZCODE_PROXY_PORT`, `ZCODE_PROXY_KEY`, `ZCODE_PROXY_EFFORT`, `ZCODE_PROXY_MAX_INFLIGHT`, `ZCODE_PROXY_CONFIG`.

## systemd

```bash
./scripts/install-systemd.sh     # user unit, linger on
```

details in [docs/systemd.md](docs/systemd.md).

## when it breaks

| symptom | cause |
| --- | --- |
| `405 {"code":3012}` | request does not look like the harness. keep the 3 system blocks intact, merge extra text into the third (see `docs/architecture.md`) |
| `502 Bad Gateway` | gateway hiccup on a valid request; retried once, usually fine |
| `401 VERIFY_*` | JWT dead — `./bin/zcode-login`, restart |
| `cannot read ZCode credentials` | not logged in, or the file is encrypted under another user/secret |
| empty answers | `max_tokens` too small for thinking; the model spends it on reasoning first |

`401` from the proxy itself means the `localKey` does not match.

## docs

- [architecture](docs/architecture.md) — wire, auth, the system-block rule, metering
- [systemd](docs/systemd.md)

## license

MIT.
