#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/chacara-kiosk}"
BRIDGE_SOURCE_DIR="${BRIDGE_SOURCE_DIR:-$SCRIPT_DIR}"
CAMERA_SCRIPT_SOURCE="${1:-${CAMERA_SCRIPT_SOURCE:-}}"
TARGET_USER="${TARGET_USER:-${SUDO_USER:-$USER}}"
TARGET_HOME="${TARGET_HOME:-$(getent passwd "$TARGET_USER" | cut -d: -f6)}"
AUTOSTART_DIR="${TARGET_HOME}/.config/autostart"
AUTOSTART_FILE="${AUTOSTART_DIR}/chacara-camera-wall.desktop"
BRIDGE_SERVICE_NAME="chacara-tuya-bridge.service"
BRIDGE_INSTALL_DIR="${INSTALL_ROOT}/ms111-tuya-bridge"
CAMERA_SCRIPT_TARGET="${INSTALL_ROOT}/camera_system.sh"
LAUNCHER_TARGET="${INSTALL_ROOT}/launch-camera-wall.sh"

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

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

find_existing_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -n "${candidate:-}" && -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_camera_script_source() {
  local media_usb="/media/${TARGET_USER}/NO NAME/camera_system.sh"
  local run_usb="/run/media/${TARGET_USER}/NO NAME/camera_system.sh"
  find_existing_file \
    "$CAMERA_SCRIPT_SOURCE" \
    "$PWD/camera_system.sh" \
    "$SCRIPT_DIR/camera_system.sh" \
    "$media_usb" \
    "$run_usb" \
    || fail "nao encontrei camera_system.sh. Passe o caminho como parametro: ./install-lubuntu-kiosk.sh /caminho/camera_system.sh"
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

  command_exists apt-get || fail "apt-get nao encontrado para instalar: ${missing[*]}"
  log "Instalando dependencias: ${missing[*]}"
  run_sudo apt-get update
  run_sudo apt-get install -y "${missing[@]}"
}

write_bridge_service() {
  local service_file="/etc/systemd/system/${BRIDGE_SERVICE_NAME}"

  run_sudo tee "$service_file" >/dev/null <<EOF
[Unit]
Description=Chacara Tuya Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${BRIDGE_INSTALL_DIR}
Environment=PORT=8787
ExecStart=/usr/bin/env node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

write_autostart_file() {
  mkdir -p "$AUTOSTART_DIR"

  cat > "$AUTOSTART_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Chacara Camera Wall
Comment=Abre cameras e painel da chacara automaticamente
Exec=${LAUNCHER_TARGET}
Terminal=false
X-GNOME-Autostart-enabled=true
OnlyShowIn=LXQt;XFCE;GNOME;KDE;
EOF

  chown "${TARGET_USER}:${TARGET_USER}" "$AUTOSTART_FILE"
}

main() {
  [[ -d "$BRIDGE_SOURCE_DIR" ]] || fail "pasta da bridge nao encontrada: $BRIDGE_SOURCE_DIR"
  [[ -n "$TARGET_HOME" && -d "$TARGET_HOME" ]] || fail "home do usuario alvo nao encontrada: $TARGET_USER"

  CAMERA_SCRIPT_SOURCE="$(resolve_camera_script_source)"

  ensure_apt_packages rsync curl mpv wmctrl x11-xserver-utils nodejs npm chromium-browser

  log "Copiando arquivos para ${INSTALL_ROOT}..."
  run_sudo mkdir -p "$INSTALL_ROOT"
  run_sudo rsync -a --delete --exclude node_modules --exclude .git "$BRIDGE_SOURCE_DIR/" "$BRIDGE_INSTALL_DIR/"
  run_sudo install -m 644 "$CAMERA_SCRIPT_SOURCE" "$CAMERA_SCRIPT_TARGET"
  run_sudo install -m 755 "${BRIDGE_SOURCE_DIR}/launch-camera-wall.sh" "$LAUNCHER_TARGET"

  log "Instalando dependencias Node da bridge..."
  (
    cd "$BRIDGE_INSTALL_DIR"
    if [[ -f package-lock.json ]]; then
      run_sudo npm ci
    else
      run_sudo npm install
    fi
  )

  log "Configurando servico da bridge..."
  write_bridge_service
  run_sudo systemctl daemon-reload
  run_sudo systemctl enable --now "$BRIDGE_SERVICE_NAME"

  log "Configurando abertura automatica da parede de cameras..."
  write_autostart_file

  log "Instalacao concluida."
  log "Bridge: sudo systemctl status ${BRIDGE_SERVICE_NAME} --no-pager"
  log "Launcher: ${LAUNCHER_TARGET}"
  log "Autostart: ${AUTOSTART_FILE}"
  log "Depois do proximo login grafico do usuario ${TARGET_USER}, cameras + painel abrirao automaticamente."
}

main "$@"
