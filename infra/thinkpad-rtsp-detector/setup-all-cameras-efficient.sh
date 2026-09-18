#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

log "Aplicando perfil leve na cam1..."
"${SCRIPT_DIR}/apply-efficient-profile.sh" cam1

log "Recriando cam2 com perfil leve..."
"${SCRIPT_DIR}/setup-cam2.sh"

log "Recriando cam3 com perfil leve..."
"${SCRIPT_DIR}/setup-cam3.sh"

log "Tudo pronto."
log "cam1: http://127.0.0.1:5060/"
log "cam2: http://127.0.0.1:5061/"
log "cam3: http://127.0.0.1:5062/"
