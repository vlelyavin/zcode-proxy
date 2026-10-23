#!/usr/bin/env bash
# Ставит релей как пользовательский LaunchAgent (macOS).
# launchd не умеет systemd-юниты, поэтому здесь отдельный установщик.
set -euo pipefail

LABEL="${LABEL:-com.github.vlelyavin.zcode-proxy}"
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
CONFIG_PATH="${CONFIG_PATH:-$WORKDIR/config.json}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

usage() {
  cat <<'EOF'
usage: install-launchd.sh [--node PATH] [--config PATH] [--label NAME]

  --node PATH     явный путь к node
  --config PATH   путь к config.json
  --label NAME    метка LaunchAgent (по умолчанию com.github.vlelyavin.zcode-proxy)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node) NODE_BIN="$2"; shift 2 ;;
    --config) CONFIG_PATH="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -x "$NODE_BIN" ]] || { echo "node not found - pass --node /path/to/node" >&2; exit 1; }
[[ -f "$CONFIG_PATH" ]] || { echo "config not found: $CONFIG_PATH (run: node src/cli.js setup)" >&2; exit 1; }
[[ "$(uname -s)" == "Darwin" ]] || { echo "this installer is for macOS; use scripts/install-systemd.sh on linux" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$WORKDIR/src/cli.js</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$WORKDIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ZCODE_PROXY_CONFIG</key><string>$CONFIG_PATH</string>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/zcode-proxy.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/zcode-proxy.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
echo "installed $PLIST"
echo "logs:   tail -f ~/Library/Logs/zcode-proxy.log"
echo "health: curl -sS http://127.0.0.1:18960/health"
echo "stop:   launchctl unload $PLIST"
