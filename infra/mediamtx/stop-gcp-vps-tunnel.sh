#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${SCRIPT_DIR}/.gcp-vps-tunnel.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Nao ha tunel registrado em ${PID_FILE}."
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [ -z "$PID" ]; then
  rm -f "$PID_FILE"
  echo "PID vazio. Arquivo removido."
  exit 0
fi

if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" || true
  sleep 1
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill -9 "$PID" || true
  fi
  echo "Tunel encerrado (PID ${PID})."
else
  echo "Processo ${PID} nao estava ativo."
fi

rm -f "$PID_FILE"
