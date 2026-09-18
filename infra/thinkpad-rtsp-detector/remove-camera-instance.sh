#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:-}"

INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-ai-detector}"
APP_DIR="${APP_DIR:-${INSTALL_ROOT}/${INSTANCE_NAME}}"
SERVICE_NAME="${SERVICE_NAME:-chacara-${INSTANCE_NAME}.service}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

main() {
  [[ -n "$INSTANCE_NAME" ]] || fail "uso: ./remove-camera-instance.sh <nome>"
  [[ "$INSTANCE_NAME" =~ ^[a-z0-9-]+$ ]] || fail "nome invalido: $INSTANCE_NAME"
  [[ "$INSTANCE_NAME" != "rtsp-detector" ]] || fail "nao remova a instancia base por este script"

  log "Parando servico ${SERVICE_NAME}..."
  run_sudo systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true

  log "Removendo unit file..."
  run_sudo rm -f "/etc/systemd/system/${SERVICE_NAME}"
  run_sudo systemctl daemon-reload

  if [[ -d "$APP_DIR" ]]; then
    log "Removendo pasta ${APP_DIR}..."
    run_sudo rm -rf "$APP_DIR"
  fi

  log "Instancia ${INSTANCE_NAME} removida."
}

main "$@"
