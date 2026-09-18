#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_NAME="${CAM3_NAME:-cam3}"
PORT="${CAM3_PORT:-5062}"
RTSP_URL="${CAM3_RTSP_URL:-rtsp://pietrojr2:guglielmi007310899@192.168.1.28:554/stream1}"
VERIFY_RTSP_URL="${CAM3_VERIFY_RTSP_URL:-}"

"${SCRIPT_DIR}/add-camera-instance.sh" "${INSTANCE_NAME}" "${PORT}" "${RTSP_URL}" "${VERIFY_RTSP_URL}"
"${SCRIPT_DIR}/apply-efficient-profile.sh" "${INSTANCE_NAME}"
