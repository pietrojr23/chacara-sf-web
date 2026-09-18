#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/esp32cam-detector.log"
PID_FILE="/tmp/esp32cam-detector.pid"

cd "${SCRIPT_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" >/dev/null 2>&1; then
    echo "Detector já está rodando (PID ${OLD_PID})."
    echo "Health: http://127.0.0.1:5055/health"
    exit 0
  fi
fi

nohup ./start-detector.sh > "${LOG_FILE}" 2>&1 &
NEW_PID=$!
echo "${NEW_PID}" > "${PID_FILE}"

echo "Detector iniciado em background (PID ${NEW_PID})."
echo "Log: ${LOG_FILE}"
echo "Health: http://127.0.0.1:5055/health"
