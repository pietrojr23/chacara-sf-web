#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/esp32cam-detector.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "Detector não está rodando (sem PID file)."
  exit 0
fi

PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
if [[ -n "${PID}" ]] && kill -0 "${PID}" >/dev/null 2>&1; then
  kill "${PID}" || true
  echo "Detector parado (PID ${PID})."
else
  echo "Processo anterior não estava ativo."
fi

rm -f "${PID_FILE}"
