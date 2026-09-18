#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.1.20:8878/infra/ms111-tuya-bridge}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-kiosk}"
BRIDGE_DIR="${BRIDGE_DIR:-$INSTALL_ROOT/ms111-tuya-bridge}"
LAUNCHER_TARGET="${LAUNCHER_TARGET:-$INSTALL_ROOT/launch-camera-wall.sh}"
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

[[ -d "$BRIDGE_DIR" ]] || { echo "ERRO: diretorio da bridge nao encontrado: $BRIDGE_DIR" >&2; exit 1; }

log "Baixando arquivos atualizados do kiosk..."
curl -fsSL "$BASE_URL/index.js" -o "$TMP_DIR/index.js"
curl -fsSL "$BASE_URL/public/control-panel.html" -o "$TMP_DIR/control-panel.html"
curl -fsSL "$BASE_URL/public/control-panel.css" -o "$TMP_DIR/control-panel.css"
curl -fsSL "$BASE_URL/public/control-panel.js" -o "$TMP_DIR/control-panel.js"
curl -fsSL "$BASE_URL/launch-camera-wall.sh" -o "$TMP_DIR/launch-camera-wall.sh"
curl -fsSL "$BASE_URL/update-lubuntu-bridge.sh" -o "$TMP_DIR/update-lubuntu-bridge.sh"
curl -fsSL "$BASE_URL/update-lubuntu-kiosk.sh" -o "$TMP_DIR/update-lubuntu-kiosk.sh"

log "Instalando bridge em $BRIDGE_DIR..."
run_sudo install -m 644 "$TMP_DIR/index.js" "$BRIDGE_DIR/index.js"
run_sudo install -m 644 "$TMP_DIR/control-panel.html" "$BRIDGE_DIR/public/control-panel.html"
run_sudo install -m 644 "$TMP_DIR/control-panel.css" "$BRIDGE_DIR/public/control-panel.css"
run_sudo install -m 644 "$TMP_DIR/control-panel.js" "$BRIDGE_DIR/public/control-panel.js"
run_sudo install -m 755 "$TMP_DIR/update-lubuntu-bridge.sh" "$BRIDGE_DIR/update-lubuntu-bridge.sh"

log "Instalando launcher em $LAUNCHER_TARGET..."
run_sudo install -m 755 "$TMP_DIR/launch-camera-wall.sh" "$LAUNCHER_TARGET"
run_sudo install -m 755 "$TMP_DIR/update-lubuntu-kiosk.sh" "$INSTALL_ROOT/update-lubuntu-kiosk.sh"

log "Reiniciando a bridge local..."
run_sudo systemctl restart chacara-tuya-bridge.service
run_sudo systemctl --no-pager --full status chacara-tuya-bridge.service | sed -n '1,12p'

log "Atualizacao do kiosk concluida."
log "Painel: http://127.0.0.1:8787/control-panel"
log "Launcher atualizado: $LAUNCHER_TARGET"
log "Script salvo em: $INSTALL_ROOT/update-lubuntu-kiosk.sh"
