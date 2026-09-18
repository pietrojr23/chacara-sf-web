#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:-}"
PORT="${2:-}"
RTSP_URL="${3:-}"
VERIFY_RTSP_URL="${4:-}"

INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-ai-detector}"
SOURCE_APP_DIR="${SOURCE_APP_DIR:-${INSTALL_ROOT}/rtsp-detector}"
APP_DIR="${APP_DIR:-${INSTALL_ROOT}/${INSTANCE_NAME}}"
SERVICE_NAME="${SERVICE_NAME:-chacara-${INSTANCE_NAME}.service}"
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

validate_name() {
  [[ -n "$INSTANCE_NAME" ]] || fail "uso: ./add-camera-instance.sh <nome> <porta> <rtsp_url> [verify_rtsp_url]"
  [[ "$INSTANCE_NAME" =~ ^[a-z0-9-]+$ ]] || fail "nome invalido. Use apenas [a-z0-9-], ex: cam2"
}

validate_port() {
  [[ -n "$PORT" ]] || fail "porta obrigatoria"
  [[ "$PORT" =~ ^[0-9]+$ ]] || fail "porta invalida: $PORT"
  (( PORT >= 1024 && PORT <= 65535 )) || fail "porta fora da faixa recomendada: $PORT"
}

validate_urls() {
  [[ -n "$RTSP_URL" ]] || fail "rtsp_url obrigatoria"
  [[ "$RTSP_URL" == rtsp://* ]] || fail "rtsp_url deve comecar com rtsp://"
  if [[ -n "$VERIFY_RTSP_URL" && "$VERIFY_RTSP_URL" != rtsp://* ]]; then
    fail "verify_rtsp_url deve comecar com rtsp://"
  fi
}

write_env_file() {
  run_sudo tee "${APP_DIR}/.env" >/dev/null <<EOF
PORT=${PORT}
CAMERA_NAME=${INSTANCE_NAME}
RTSP_URL=${RTSP_URL}
RTSP_TRANSPORT=tcp
EVENT_IMAGES_DIR=${SOURCE_APP_DIR}/events
VERIFY_RTSP_URL=${VERIFY_RTSP_URL}
MODEL_PATH=yolo11n.pt
VERIFY_MODEL_PATH=yolo11s.pt
MIN_CONF=0.35
DEFAULT_ALLOWED_MIN_CONF=0.60
PERSON_SAVE_MIN_CONF=0.50
CAR_SAVE_MIN_CONF=0.55
MOTORCYCLE_SAVE_MIN_CONF=0.55
BUS_SAVE_MIN_CONF=0.55
TRUCK_SAVE_MIN_CONF=0.55
DOG_SAVE_MIN_CONF=0.60
CAT_SAVE_MIN_CONF=0.60
HORSE_SAVE_MIN_CONF=0.60
SHEEP_SAVE_MIN_CONF=0.60
COW_SAVE_MIN_CONF=0.60
VERIFY_MIN_CONF=0.40
TARGET_LABELS=person,car,motorcycle,bus,truck,dog,cat,horse,sheep,cow
PRIMARY_IMGSZ=640
VERIFY_IMGSZ=960
DETECT_INTERVAL_S=2.0
EVENT_COOLDOWN_S=15
MOTION_DIFF_THRESHOLD=25
MOTION_MIN_RATIO=0.03
MIN_BBOX_AREA_RATIO=0.012
MAX_INFER_WIDTH=640
RECONNECT_DELAY_S=5
JPEG_QUALITY=80
VERIFY_FRAME_SKIP=3
SIMPLE_DETECTION_MODE=true
SUBSTREAM_ONLY=true
SEMANTIC_FILTERS_ENABLED=false
VERIFY_REQUIRED=$( [[ -n "$VERIFY_RTSP_URL" ]] && echo true || echo false )
REQUIRE_VERIFY_FOR_PERSON=false
API_KEY=
EOF
}

write_service() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}"

  run_sudo tee "$service_file" >/dev/null <<EOF
[Unit]
Description=Chacara RTSP Detector (${INSTANCE_NAME})
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
  validate_name
  validate_port
  validate_urls
  need_cmd rsync
  need_cmd systemctl

  [[ -d "$SOURCE_APP_DIR" ]] || fail "instancia base nao encontrada: $SOURCE_APP_DIR"
  [[ -x "${SOURCE_APP_DIR}/.venv/bin/python" ]] || fail "venv base nao encontrada em ${SOURCE_APP_DIR}/.venv"

  log "Criando instancia ${INSTANCE_NAME} em ${APP_DIR}..."
  run_sudo mkdir -p "$APP_DIR"
  run_sudo rsync -a --delete \
    --exclude .env \
    --exclude .venv \
    --exclude events \
    --exclude __pycache__ \
    "${SOURCE_APP_DIR}/" "${APP_DIR}/"

  run_sudo ln -sfn "${SOURCE_APP_DIR}/.venv" "${APP_DIR}/.venv"
  run_sudo mkdir -p "${APP_DIR}/events"
  write_env_file
  run_sudo chown -R "${TARGET_USER}:${TARGET_GROUP}" "$APP_DIR"

  log "Instalando servico ${SERVICE_NAME}..."
  write_service
  run_sudo systemctl daemon-reload
  run_sudo systemctl enable "${SERVICE_NAME}"
  run_sudo systemctl restart "${SERVICE_NAME}"
  run_sudo systemctl --no-pager --full status "${SERVICE_NAME}" | sed -n '1,18p'

  log "Instancia criada com sucesso."
  log "Painel local: http://127.0.0.1:${PORT}/"
}

main "$@"
