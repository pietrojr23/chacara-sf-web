#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-kiosk}"
CAMERA_SCRIPT_PATH="${CAMERA_SCRIPT_PATH:-$INSTALL_ROOT/camera_system.sh}"
BRIDGE_DIR="${BRIDGE_DIR:-$INSTALL_ROOT/ms111-tuya-bridge}"
BRIDGE_ENV_FILE="${BRIDGE_ENV_FILE:-$BRIDGE_DIR/.env}"
BRIDGE_PORT="${BRIDGE_PORT:-8787}"
MPV_BIN="${MPV_BIN:-mpv}"
MPV_RTSP_TRANSPORT="${MPV_RTSP_TRANSPORT:-udp}"
LEFT_RATIO_PERCENT="${LEFT_RATIO_PERCENT:-72}"
PANEL_WINDOW_MATCH="${PANEL_WINDOW_MATCH:-Painel da Ch}"
BROWSER_BIN="${BROWSER_BIN:-}"
BROWSER_PROFILE_DIR="${BROWSER_PROFILE_DIR:-/tmp/chacara-control-panel-profile}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "arquivo nao encontrado: $path"
}

ensure_browser() {
  if [[ -n "$BROWSER_BIN" ]] && command_exists "$BROWSER_BIN"; then
    return
  fi

  local candidate
  for candidate in chromium-browser chromium google-chrome-stable google-chrome; do
    if command_exists "$candidate"; then
      BROWSER_BIN="$candidate"
      return
    fi
  done

  fail "nenhum navegador Chromium/Chrome encontrado"
}

extract_camera_rows() {
  awk '
    /^CAMERAS=\(/ { inside=1; next }
    inside && /^\)/ { inside=0; exit }
    inside && /"/ {
      line=$0
      sub(/^[[:space:]]*"/, "", line)
      sub(/"[[:space:]]*$/, "", line)
      print line
    }
  ' "$CAMERA_SCRIPT_PATH" | head -n 2
}

get_bridge_api_key() {
  awk -F= '$1=="BRIDGE_API_KEY"{print substr($0, index($0, "=")+1)}' "$BRIDGE_ENV_FILE" | tail -n1
}

get_screen_bounds() {
  xrandr --current | awk '
    / connected primary / {
      if (match($0, /[0-9]+x[0-9]+\+[0-9]+\+[0-9]+/)) {
        split(substr($0, RSTART, RLENGTH), a, /[x+]/)
        print a[3], a[4], a[1], a[2]
        exit
      }
    }
    / connected / {
      if (match($0, /[0-9]+x[0-9]+\+[0-9]+\+[0-9]+/)) {
        split(substr($0, RSTART, RLENGTH), a, /[x+]/)
        print a[3], a[4], a[1], a[2]
        exit
      }
    }
  '
}

wait_for_bridge() {
  local attempt
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  fail "bridge local nao respondeu em http://127.0.0.1:${BRIDGE_PORT}/health"
}

close_old_mpv_windows() {
  pkill -f 'CHACARA_MONITOR_CAM_' >/dev/null 2>&1 || true
}

close_old_panel_windows() {
  local ids
  ids="$(wmctrl -l 2>/dev/null | awk -v needle="$PANEL_WINDOW_MATCH" 'index($0, needle) {print $1}')"
  if [[ -n "$ids" ]]; then
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      wmctrl -ic "$id" >/dev/null 2>&1 || true
    done <<< "$ids"
  fi
}

wait_for_window_id() {
  local needle="$1"
  local attempt
  for attempt in {1..30}; do
    local id
    id="$(wmctrl -l 2>/dev/null | awk -v needle="$needle" 'index($0, needle) {print $1; exit}')"
    if [[ -n "$id" ]]; then
      echo "$id"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

place_window() {
  local id="$1"
  local x="$2"
  local y="$3"
  local width="$4"
  local height="$5"

  wmctrl -ir "$id" -b remove,maximized_vert,maximized_horz >/dev/null 2>&1 || true
  wmctrl -ir "$id" -e "0,${x},${y},${width},${height}" >/dev/null 2>&1 || true
}

launch_camera_window() {
  local title="$1"
  local url="$2"
  local width="$3"
  local height="$4"
  local x="$5"
  local y="$6"

  "$MPV_BIN" "$url" \
    --no-config \
    --profile=low-latency \
    --title="$title" \
    --geometry="${width}x${height}+${x}+${y}" \
    --rtsp-transport="$MPV_RTSP_TRANSPORT" \
    --network-timeout=8 \
    --cache=no \
    --cache-secs=0 \
    --demuxer-readahead-secs=0 \
    --demuxer-lavf-o=fflags=+nobuffer+discardcorrupt \
    --demuxer-lavf-o=analyzeduration=0 \
    --demuxer-lavf-o=probesize=32768 \
    --audio=no \
    --no-sub \
    --no-osc \
    --no-input-default-bindings \
    --really-quiet \
    --hwdec=auto-safe \
    >/dev/null 2>&1 &

  local win_id
  win_id="$(wait_for_window_id "$title" || true)"
  if [[ -n "$win_id" ]]; then
    place_window "$win_id" "$x" "$y" "$width" "$height"
  fi
}

open_control_panel() {
  local url="$1"
  local x="$2"
  local y="$3"
  local width="$4"
  local height="$5"

  close_old_panel_windows
  mkdir -p "$BROWSER_PROFILE_DIR"

  "$BROWSER_BIN" \
    --new-window \
    --app="$url" \
    --window-position="$x,$y" \
    --window-size="$width,$height" \
    --user-data-dir="$BROWSER_PROFILE_DIR" \
    >/dev/null 2>&1 &

  local panel_id
  panel_id="$(wait_for_window_id "$PANEL_WINDOW_MATCH" || true)"
  if [[ -n "$panel_id" ]]; then
    place_window "$panel_id" "$x" "$y" "$width" "$height"
  fi
}

main() {
  [[ -n "${DISPLAY:-}" ]] || fail "DISPLAY nao definido. Rode dentro da sessao grafica do Lubuntu"

  require_file "$CAMERA_SCRIPT_PATH"
  require_file "$BRIDGE_ENV_FILE"
  command_exists xrandr || fail "xrandr nao encontrado"
  command_exists wmctrl || fail "wmctrl nao encontrado"
  command_exists curl || fail "curl nao encontrado"
  command_exists "$MPV_BIN" || fail "mpv nao encontrado"
  ensure_browser
  wait_for_bridge

  local bridge_api_key
  bridge_api_key="$(get_bridge_api_key)"
  [[ -n "$bridge_api_key" ]] || fail "BRIDGE_API_KEY nao encontrada em $BRIDGE_ENV_FILE"

  local panel_url="http://127.0.0.1:${BRIDGE_PORT}/control-panel?k=${bridge_api_key}"

  local screen_x screen_y screen_w screen_h
  read -r screen_x screen_y screen_w screen_h < <(get_screen_bounds)
  [[ -n "${screen_w:-}" ]] || fail "nao consegui detectar o monitor com xrandr"

  local left_w right_w cam_h
  left_w=$((screen_w * LEFT_RATIO_PERCENT / 100))
  right_w=$((screen_w - left_w))
  cam_h=$((screen_h / 2))

  local rows=()
  while IFS= read -r line; do
    rows+=("$line")
  done < <(extract_camera_rows)

  (( ${#rows[@]} >= 2 )) || fail "nao consegui extrair duas cameras de $CAMERA_SCRIPT_PATH"

  local cam1_name cam1_url cam2_name cam2_url
  IFS='|' read -r cam1_name cam1_url _ <<< "${rows[0]}"
  IFS='|' read -r cam2_name cam2_url _ <<< "${rows[1]}"

  close_old_mpv_windows

  log "Abrindo ${cam1_name} no quadrante superior esquerdo..."
  launch_camera_window "CHACARA_MONITOR_CAM_1" "$cam1_url" "$left_w" "$cam_h" "$screen_x" "$screen_y"

  log "Abrindo ${cam2_name} no quadrante inferior esquerdo..."
  launch_camera_window "CHACARA_MONITOR_CAM_2" "$cam2_url" "$left_w" "$cam_h" "$screen_x" "$((screen_y + cam_h))"

  log "Abrindo painel web no lado direito..."
  open_control_panel "$panel_url" "$((screen_x + left_w))" "$screen_y" "$right_w" "$screen_h"

  log "Painel pronto."
  log "Cameras: ${cam1_name}, ${cam2_name}"
  log "Controle: ${panel_url}"
}

main "$@"
