#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.1.20:8878/infra/ms111-tuya-bridge}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-kiosk}"
BRIDGE_DIR="${BRIDGE_DIR:-$INSTALL_ROOT/ms111-tuya-bridge}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERRO: comando nao encontrado: $1" >&2; exit 1; }
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

need_cmd curl
need_cmd install
need_cmd systemctl

log "Baixando arquivos atualizados da bridge..."
curl -fsSL "$BASE_URL/index.js" -o "$TMP_DIR/index.js"
curl -fsSL "$BASE_URL/public/control-panel.html" -o "$TMP_DIR/control-panel.html"
curl -fsSL "$BASE_URL/public/control-panel.css" -o "$TMP_DIR/control-panel.css"
curl -fsSL "$BASE_URL/public/control-panel.js" -o "$TMP_DIR/control-panel.js"

log "Instalando atualizacao em $BRIDGE_DIR..."
run_sudo install -m 644 "$TMP_DIR/index.js" "$BRIDGE_DIR/index.js"
run_sudo install -m 644 "$TMP_DIR/control-panel.html" "$BRIDGE_DIR/public/control-panel.html"
run_sudo install -m 644 "$TMP_DIR/control-panel.css" "$BRIDGE_DIR/public/control-panel.css"
run_sudo install -m 644 "$TMP_DIR/control-panel.js" "$BRIDGE_DIR/public/control-panel.js"

log "Reiniciando a bridge local..."
run_sudo systemctl restart chacara-tuya-bridge.service
run_sudo systemctl --no-pager --full status chacara-tuya-bridge.service | sed -n '1,12p'

log "Atualizacao concluida."
log "Abra: http://127.0.0.1:8787/control-panel"
