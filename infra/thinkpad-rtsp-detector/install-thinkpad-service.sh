#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-ai-detector}"
APP_DIR="${APP_DIR:-${INSTALL_ROOT}/rtsp-detector}"
SERVICE_NAME="${SERVICE_NAME:-chacara-rtsp-detector.service}"
TARGET_USER="${TARGET_USER:-${SUDO_USER:-$USER}}"
TARGET_GROUP="${TARGET_GROUP:-${TARGET_USER}}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "comando nao encontrado: $1"
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_target() {
  if [[ "$(id -u)" -eq 0 ]]; then
    sudo -u "$TARGET_USER" "$@"
  else
    "$@"
  fi
}

ensure_apt_packages() {
  local missing=()
  local package

  for package in "$@"; do
    dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
  done

  if (( ${#missing[@]} == 0 )); then
    return
  fi

  need_cmd apt-get
  log "Instalando dependencias: ${missing[*]}"
  run_sudo apt-get update
  run_sudo apt-get install -y "${missing[@]}"
}

write_service() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}"

  run_sudo tee "$service_file" >/dev/null <<EOF
[Unit]
Description=Chacara RTSP Detector (ThinkPad)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${TARGET_USER}
Group=${TARGET_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
ExecStart=${APP_DIR}/.venv/bin/python ${APP_DIR}/rtsp_detector.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

main() {
  need_cmd rsync
  need_cmd curl
  need_cmd python3

  ensure_apt_packages python3 python3-venv python3-pip ffmpeg rsync curl

  log "Copiando arquivos para ${APP_DIR}..."
  run_sudo mkdir -p "$APP_DIR"
  run_sudo rsync -a --delete \
    --exclude .venv \
    --exclude __pycache__ \
    --exclude events \
    "$SCRIPT_DIR/" "$APP_DIR/"

  if [[ ! -f "${APP_DIR}/.env" ]]; then
    log "Criando .env inicial..."
    run_sudo install -m 644 "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  fi

  run_sudo chown -R "${TARGET_USER}:${TARGET_GROUP}" "$APP_DIR"

  if [[ ! -d "${APP_DIR}/.venv" ]]; then
    log "Criando virtualenv..."
    run_as_target python3 -m venv "${APP_DIR}/.venv"
  fi

  log "Instalando dependencias Python..."
  run_as_target "${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
  run_as_target "${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/requirements.txt"

  log "Instalando servico systemd..."
  write_service
  run_sudo systemctl daemon-reload
  run_sudo systemctl enable --now "$SERVICE_NAME"
  run_sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'

  log "Instalacao concluida."
  log "Edite o .env em: ${APP_DIR}/.env"
  log "Status: sudo systemctl status ${SERVICE_NAME} --no-pager"
  log "Painel local: http://127.0.0.1:5060/"
  log "Nova camera: ${APP_DIR}/add-camera-instance.sh <nome> <porta> <rtsp_url> [verify_rtsp_url]"
  log "Remover camera: ${APP_DIR}/remove-camera-instance.sh <nome>"
}

main "$@"
