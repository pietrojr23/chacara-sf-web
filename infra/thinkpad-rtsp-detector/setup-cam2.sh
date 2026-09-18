#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_NAME="${CAM2_NAME:-cam2}"
PORT="${CAM2_PORT:-5061}"
RTSP_URL="${CAM2_RTSP_URL:-rtsp://pietrojr2:guglielmi007310899@192.168.1.26:554/stream2}"
VERIFY_RTSP_URL="${CAM2_VERIFY_RTSP_URL:-}"

"${SCRIPT_DIR}/add-camera-instance.sh" "${INSTANCE_NAME}" "${PORT}" "${RTSP_URL}" "${VERIFY_RTSP_URL}"
"${SCRIPT_DIR}/apply-efficient-profile.sh" "${INSTANCE_NAME}"
