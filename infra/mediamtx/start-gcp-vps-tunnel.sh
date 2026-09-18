#!/usr/bin/env bash
set -euo pipefail

# Inicia tunel reverso SSH do servidor local -> VPS.
# Mapeia no VPS: 127.0.0.1:REMOTE_PORT -> LOCALHOST:LOCAL_PORT (MediaMTX HLS).

if [ "${1:-}" = "" ]; then
  cat <<'USAGE'
Uso:
  ./start-gcp-vps-tunnel.sh <usuario@ip-ou-host-vps> [porta_remota] [porta_local] [dominio_publico]

Variaveis opcionais:
  SSH_KEY_PATH=/caminho/chave_privada
  SSH_PORT=22

Exemplos:
  ./start-gcp-vps-tunnel.sh ubuntu@34.12.34.56
  SSH_KEY_PATH=~/.ssh/gcp_tunnel_key ./start-gcp-vps-tunnel.sh pietrojr2@34.151.223.146
  ./start-gcp-vps-tunnel.sh ubuntu@34.12.34.56 18888 8888 cam.chacarasf.com.br
USAGE
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${SCRIPT_DIR}/.gcp-vps-tunnel.pid"
LOG_FILE="${SCRIPT_DIR}/.gcp-vps-tunnel.log"

SSH_TARGET="$1"
REMOTE_PORT="${2:-18888}"
LOCAL_PORT="${3:-8888}"
PUBLIC_HOST="${4:-}"
SSH_KEY_PATH="${SSH_KEY_PATH:-}"
SSH_PORT="${SSH_PORT:-22}"

SSH_BASE_ARGS=(
  -n
  -T
  -N
  -p "${SSH_PORT}"
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)

if [ -n "${SSH_KEY_PATH}" ]; then
  if [ ! -f "${SSH_KEY_PATH}" ]; then
    echo "ERRO: SSH_KEY_PATH nao encontrado: ${SSH_KEY_PATH}"
    exit 1
  fi
  SSH_BASE_ARGS+=(-i "${SSH_KEY_PATH}")
fi

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [ -n "${OLD_PID}" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "Tunel ja esta ativo (PID ${OLD_PID})."
    echo "Para reiniciar, rode: ./stop-gcp-vps-tunnel.sh"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if command -v autossh >/dev/null 2>&1; then
  SSH_BIN="autossh"
  SSH_ARGS=(
    -M 0
    "${SSH_BASE_ARGS[@]}"
    -R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}"
    "$SSH_TARGET"
  )
else
  SSH_BIN="ssh"
  SSH_ARGS=(
    "${SSH_BASE_ARGS[@]}"
    -R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}"
    "$SSH_TARGET"
  )
fi

echo "Iniciando tunel com ${SSH_BIN}..."
nohup "$SSH_BIN" "${SSH_ARGS[@]}" >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

sleep 1
if ! kill -0 "$NEW_PID" >/dev/null 2>&1; then
  echo "ERRO: falha ao iniciar tunel."
  echo "Log:"
  tail -n 80 "$LOG_FILE" || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "Tunel ativo (PID ${NEW_PID})."
echo "VPS 127.0.0.1:${REMOTE_PORT} -> LOCAL 127.0.0.1:${LOCAL_PORT}"
echo "Logs: ${LOG_FILE}"

if [ -n "$PUBLIC_HOST" ]; then
  echo
  echo "URL externa esperada (exemplo de stream):"
  echo "  https://${PUBLIC_HOST}/cam-casa-01-frente/index.m3u8"
fi
