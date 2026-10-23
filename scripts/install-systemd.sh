#!/usr/bin/env bash
# Устанавливает релей как systemd-юнит (по умолчанию пользовательский).
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-zcode-proxy}"
UNIT_DIR="${UNIT_DIR:-$HOME/.config/systemd/user}"
WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
CONFIG_PATH="${CONFIG_PATH:-$WORKDIR/config.json}"
SYSTEM=0

usage() {
  cat <<'EOF'
usage: install-systemd.sh [--system] [--node PATH] [--config PATH] [--name NAME]

  --system        системный юнит (/etc/systemd/system, нужен root)
  --node PATH     явный путь к node
  --config PATH   путь к config.json
  --name NAME     имя юнита (по умолчанию zcode-proxy)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system) SYSTEM=1; shift ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --config) CONFIG_PATH="$2"; shift 2 ;;
    --name) SERVICE_NAME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -x "$NODE_BIN" ]] || { echo "node not found - pass --node /path/to/node" >&2; exit 1; }
[[ -f "$CONFIG_PATH" ]] || { echo "config not found: $CONFIG_PATH (run: zcode-proxy setup)" >&2; exit 1; }

if [[ $SYSTEM -eq 1 ]]; then
  [[ $EUID -eq 0 ]] || { echo "run as root for --system" >&2; exit 1; }
  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  cat > "$UNIT_PATH" <<EOF
[Unit]
Description=zcode-proxy (ZCode start-plan relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SUDO_USER:-root}
WorkingDirectory=${WORKDIR}
ExecStart=${NODE_BIN} ${WORKDIR}/src/cli.js run
Environment=HOME=/home/${SUDO_USER:-root}
Environment=ZCODE_PROXY_CONFIG=${CONFIG_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  echo "installed $UNIT_PATH"
  echo "logs:   journalctl -u ${SERVICE_NAME} -f"
else
  mkdir -p "$UNIT_DIR"
  UNIT_PATH="$UNIT_DIR/${SERVICE_NAME}.service"
  cat > "$UNIT_PATH" <<EOF
[Unit]
Description=zcode-proxy (ZCode start-plan relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${WORKDIR}
ExecStart=${NODE_BIN} ${WORKDIR}/src/cli.js run
Environment=ZCODE_PROXY_CONFIG=${CONFIG_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  echo "installed $UNIT_PATH"
  echo "logs:   journalctl --user -u ${SERVICE_NAME} -f"
fi

echo "health: curl -sS http://127.0.0.1:18960/health"
