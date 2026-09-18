#!/usr/bin/env bash
set -euo pipefail

INSTANCE_NAME="${1:-}"

INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-ai-detector}"
BASE_INSTANCE_NAME="${BASE_INSTANCE_NAME:-rtsp-detector}"
BASE_SERVICE_NAME="${BASE_SERVICE_NAME:-chacara-rtsp-detector.service}"
BASE_DETECT_INTERVAL_S="${BASE_DETECT_INTERVAL_S:-1.5}"
EXTRA_DETECT_INTERVAL_S="${EXTRA_DETECT_INTERVAL_S:-2.0}"

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

resolve_instance() {
  case "$INSTANCE_NAME" in
    "" )
      fail "uso: ./apply-efficient-profile.sh <cam1|rtsp-detector|cam2|cam3|...>"
      ;;
    cam1|rtsp-detector)
      APP_DIR="${INSTALL_ROOT}/${BASE_INSTANCE_NAME}"
      SERVICE_NAME="${BASE_SERVICE_NAME}"
      DETECT_INTERVAL_S="${BASE_DETECT_INTERVAL_S}"
      ;;
    *)
      APP_DIR="${INSTALL_ROOT}/${INSTANCE_NAME}"
      SERVICE_NAME="chacara-${INSTANCE_NAME}.service"
      DETECT_INTERVAL_S="${EXTRA_DETECT_INTERVAL_S}"
      ;;
  esac

  ENV_FILE="${APP_DIR}/.env"
  [[ -f "$ENV_FILE" ]] || fail "arquivo nao encontrado: $ENV_FILE"
}

set_env() {
  local key="$1"
  local value="$2"
  if run_sudo grep -q "^${key}=" "$ENV_FILE"; then
    run_sudo sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" | run_sudo tee -a "$ENV_FILE" >/dev/null
  fi
}

main() {
  resolve_instance

  log "Aplicando perfil leve em ${INSTANCE_NAME}..."
  set_env RTSP_TRANSPORT tcp
  set_env MODEL_PATH yolo11n.pt
  set_env SIMPLE_DETECTION_MODE true
  set_env SUBSTREAM_ONLY true
  set_env SEMANTIC_FILTERS_ENABLED false
  set_env VERIFY_REQUIRED false
  set_env REQUIRE_VERIFY_FOR_PERSON false
  set_env MIN_CONF 0.35
  set_env DEFAULT_ALLOWED_MIN_CONF 0.60
  set_env TARGET_LABELS person,car,motorcycle,bus,truck,dog,cat,horse,sheep,cow
  set_env PERSON_SAVE_MIN_CONF 0.50
  set_env CAR_SAVE_MIN_CONF 0.55
  set_env MOTORCYCLE_SAVE_MIN_CONF 0.55
  set_env BUS_SAVE_MIN_CONF 0.55
  set_env TRUCK_SAVE_MIN_CONF 0.55
  set_env DOG_SAVE_MIN_CONF 0.60
  set_env CAT_SAVE_MIN_CONF 0.60
  set_env HORSE_SAVE_MIN_CONF 0.60
  set_env SHEEP_SAVE_MIN_CONF 0.60
  set_env COW_SAVE_MIN_CONF 0.60
  set_env PRIMARY_IMGSZ 640
  set_env MAX_INFER_WIDTH 640
  set_env DETECT_INTERVAL_S "${DETECT_INTERVAL_S}"
  set_env EVENT_COOLDOWN_S 15
  set_env MOTION_MIN_RATIO 0.03
  set_env MIN_BBOX_AREA_RATIO 0.012
  set_env JPEG_QUALITY 80
  set_env SNAPSHOT_INTERVAL_S 0.0
  set_env SAVE_ALL_DETECTIONS true
  set_env SAVE_BEST_ONLY false

  run_sudo systemctl restart "${SERVICE_NAME}"
  log "Perfil leve aplicado em ${INSTANCE_NAME}. Intervalo de deteccao: ${DETECT_INTERVAL_S}s"
}

main "$@"
