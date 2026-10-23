# zcode-proxy

[README на русском](README.ru.md)

If you have ZCode trial credits (start-plan) and tools that expect a standard API key, this proxy bridges the gap. It is a local relay that routes OpenAI and Anthropic requests through the ZCode model endpoint on your account, letting tools like Hermes, OpenCode, or curl consume your trial quota instead of billing you per token.

## What it does

- Exposes an OpenAI-compatible API (`/v1/chat/completions` with streaming and tool calling) and an Anthropic passthrough (`/v1/messages`).
- Forwards requests to `zcode.z.ai` using the Anthropic wire format of the official client.
- Loads your local ZCode credentials on startup and reloads them on `401` errors — no tokens are stored in the repository.
- Streams tool calls and reasoning/thinking tokens back as standard OpenAI deltas.
- Automatically retries `429` and `5xx` responses once, and refreshes tokens on `401`.
- Zero npm dependencies — built entirely on the Node.js standard library.

## What it is not

- Not an official z.ai product and not affiliated with z.ai.
- Not a hosted service — it runs locally on your machine with your credentials.
- Not a credential distributor — no private tokens or secrets are shipped here.

## Straight talk

This proxy accesses the trial endpoint outside of the official desktop client. Upstream gateway checks ensure that incoming requests mimic the official test harness; requests that fail fingerprinting are rejected with `405 code 3012 unusual activity`. To pass these checks, this proxy injects the harness system preamble and merges your system prompt into its final block. 

Keep in mind that z.ai can change these rules at any time. Sending too many concurrent requests from a single account increases the risk of being flagged, so the relay limits concurrency to 2 in-flight requests by default. Blocked requests consume no credits, but retrying with a flagged account will not bypass the block.

Trial quotas expire over time. Check your remaining balance and expiration date with:
```bash
curl -sS http://127.0.0.1:18960/status -H "authorization: Bearer <localKey>"
```

## Requirements

- Node.js 22.5+ (the login runtime relies on `node:sqlite`).
- Linux or macOS (Windows works through WSL, the login helper is bash).
- An active ZCode session on this machine: `~/.zcode/v2/credentials.json` must be present.
- Trial credits on the account. (Paid open-platform API keys do not need this proxy.)

## Install

```bash
git clone https://github.com/vlelyavin/zcode-proxy.git
cd zcode-proxy
npm i -g zcode-app-cli     # official client runtime, used only for login
./bin/zcode-login          # prints a link; open it on any device logged into chat.z.ai
node src/cli.js setup      # writes config.json with a random local key
node src/cli.js check      # verifies credentials, endpoint access, and remaining credits
node src/cli.js run
```

There is no `npm install` step for the repository itself. The server listens on `127.0.0.1:18960` by default.

```bash
curl -sS http://127.0.0.1:18960/health
```

## Use

```bash
# openai-compatible client
curl -sS http://127.0.0.1:18960/v1/chat/completions \
  -H "authorization: Bearer $(jq -r .localKey config.json)" \
  -H "content-type: application/json" \
  -d '{"model":"zcode","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```

Supported models: `zcode` (GLM-5.3-Flash) and `zcode-5.3` (GLM-5.3). The aliases `glm-5.3-flash` and `glm-5.3` are also supported.

For Hermes: configure a custom provider pointing to `http://127.0.0.1:18960/v1` with your `localKey`, and set the model to `zcode` or `zcode-5.3`.

## Config

Configuration is optional. See `config.example.json` for the schema.

```bash
ZCODE_PROXY_CONFIG=./config.json node src/cli.js run
```

| Key | Description |
| --- | --- |
| `bind` / `port` | Listen address and port (default: `127.0.0.1:18960`) |
| `localKey` | Shared bearer token for incoming requests; returns `401` if missing or invalid |
| `models` | Map of alias names to upstream model IDs |
| `maxInflight` | Maximum concurrent upstream requests (default: `2`) |
| `effort` | Default `output_config.effort` when the client omits `reasoning_effort` |
| `credentialsPath` / `telemetryPath` | Paths to the client token store and device telemetry ID |
| `appVersion` | Client version sent in fingerprinting headers |

Environment variables take precedence over `config.json`: `ZCODE_PROXY_BIND`, `ZCODE_PROXY_PORT`, `ZCODE_PROXY_KEY`, `ZCODE_PROXY_EFFORT`, `ZCODE_PROXY_MAX_INFLIGHT`, and `ZCODE_PROXY_CONFIG`.

## Running it in the background

Linux - a user systemd unit with lingering enabled:

```bash
./scripts/install-systemd.sh
```

See [docs/systemd.md](docs/systemd.md) for details.

macOS - a user LaunchAgent:

```bash
./scripts/install-launchd.sh
```

See [docs/macos.md](docs/macos.md) for details.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `405 {"code":3012}` | Request failed harness fingerprinting. Ensure all 3 system blocks remain intact, with custom text merged into the third (see [docs/architecture.md](docs/architecture.md)). |
| `502 Bad Gateway` | Temporary upstream gateway glitch on a valid request. It is retried once automatically and usually succeeds. |
| `401 VERIFY_*` | Expired JWT. Run `./bin/zcode-login` and restart the proxy. |
| `cannot read ZCode credentials` | You are not logged in, or the file is encrypted under a different user or secret. |
| Empty responses | `max_tokens` is set too low. The model exhausts the token budget on reasoning before generating the final answer. |

A `401` returned directly by the proxy means the incoming request's Bearer token did not match `localKey`.

## Docs

- [Architecture](docs/architecture.md) — protocol wire format, auth flow, system-block rules, and metering
- [Systemd setup](docs/systemd.md)
- [LaunchAgent setup on macOS](docs/macos.md)

## License

MIT
