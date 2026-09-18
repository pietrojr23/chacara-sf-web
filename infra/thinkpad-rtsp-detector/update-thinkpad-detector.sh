#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.1.20:8878/infra/thinkpad-rtsp-detector}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-ai-detector}"
APP_DIR="${APP_DIR:-${INSTALL_ROOT}/rtsp-detector}"
SERVICE_NAME="${SERVICE_NAME:-chacara-rtsp-detector.service}"
TARGET_USER="${TARGET_USER:-${SUDO_USER:-$USER}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

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

main() {
  need_cmd curl
  need_cmd install
  need_cmd systemctl

  [[ -d "$APP_DIR" ]] || fail "diretorio nao encontrado: $APP_DIR. Rode primeiro o install-thinkpad-service.sh"

  log "Baixando atualizacao de $BASE_URL ..."
  curl -fsSL "$BASE_URL/rtsp_detector.py" -o "$TMP_DIR/rtsp_detector.py"
  curl -fsSL "$BASE_URL/requirements.txt" -o "$TMP_DIR/requirements.txt"
  curl -fsSL "$BASE_URL/start-detector.sh" -o "$TMP_DIR/start-detector.sh"
  curl -fsSL "$BASE_URL/install-thinkpad-service.sh" -o "$TMP_DIR/install-thinkpad-service.sh"
  curl -fsSL "$BASE_URL/update-thinkpad-detector.sh" -o "$TMP_DIR/update-thinkpad-detector.sh"
  curl -fsSL "$BASE_URL/add-camera-instance.sh" -o "$TMP_DIR/add-camera-instance.sh"
  curl -fsSL "$BASE_URL/remove-camera-instance.sh" -o "$TMP_DIR/remove-camera-instance.sh"
  curl -fsSL "$BASE_URL/apply-efficient-profile.sh" -o "$TMP_DIR/apply-efficient-profile.sh"
  curl -fsSL "$BASE_URL/setup-cam2.sh" -o "$TMP_DIR/setup-cam2.sh"
  curl -fsSL "$BASE_URL/setup-cam3.sh" -o "$TMP_DIR/setup-cam3.sh"
  curl -fsSL "$BASE_URL/setup-all-cameras-efficient.sh" -o "$TMP_DIR/setup-all-cameras-efficient.sh"
  curl -fsSL "$BASE_URL/.env.example" -o "$TMP_DIR/.env.example"
  curl -fsSL "$BASE_URL/README.md" -o "$TMP_DIR/README.md"

  log "Instalando arquivos em $APP_DIR ..."
  run_sudo install -m 644 "$TMP_DIR/rtsp_detector.py" "$APP_DIR/rtsp_detector.py"
  run_sudo install -m 644 "$TMP_DIR/requirements.txt" "$APP_DIR/requirements.txt"
  run_sudo install -m 644 "$TMP_DIR/.env.example" "$APP_DIR/.env.example"
  run_sudo install -m 644 "$TMP_DIR/README.md" "$APP_DIR/README.md"
  run_sudo install -m 755 "$TMP_DIR/start-detector.sh" "$APP_DIR/start-detector.sh"
  run_sudo install -m 755 "$TMP_DIR/install-thinkpad-service.sh" "$APP_DIR/install-thinkpad-service.sh"
  run_sudo install -m 755 "$TMP_DIR/update-thinkpad-detector.sh" "$APP_DIR/update-thinkpad-detector.sh"
  run_sudo install -m 755 "$TMP_DIR/add-camera-instance.sh" "$APP_DIR/add-camera-instance.sh"
  run_sudo install -m 755 "$TMP_DIR/remove-camera-instance.sh" "$APP_DIR/remove-camera-instance.sh"
  run_sudo install -m 755 "$TMP_DIR/apply-efficient-profile.sh" "$APP_DIR/apply-efficient-profile.sh"
  run_sudo install -m 755 "$TMP_DIR/setup-cam2.sh" "$APP_DIR/setup-cam2.sh"
  run_sudo install -m 755 "$TMP_DIR/setup-cam3.sh" "$APP_DIR/setup-cam3.sh"
  run_sudo install -m 755 "$TMP_DIR/setup-all-cameras-efficient.sh" "$APP_DIR/setup-all-cameras-efficient.sh"

  if [[ ! -f "$APP_DIR/.env" ]]; then
    run_sudo install -m 644 "$APP_DIR/.env.example" "$APP_DIR/.env"
  fi

  log "Atualizando dependencias Python ..."
  run_as_target "${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
  run_as_target "${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/requirements.txt"

  log "Reiniciando servico ..."
  run_sudo systemctl restart "$SERVICE_NAME"
  run_sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'

  log "Atualizacao concluida."
  log "Painel local: http://127.0.0.1:5060/"
  log "Perfil leve: ${APP_DIR}/apply-efficient-profile.sh <cam1|cam2|cam3>"
  log "Preset cam2: ${APP_DIR}/setup-cam2.sh"
  log "Preset cam3: ${APP_DIR}/setup-cam3.sh"
  log "Subir tudo leve: ${APP_DIR}/setup-all-cameras-efficient.sh"
  log "Nova camera: ${APP_DIR}/add-camera-instance.sh <nome> <porta> <rtsp_url> [verify_rtsp_url]"
  log "Remover camera: ${APP_DIR}/remove-camera-instance.sh <nome>"
}

main "$@"
