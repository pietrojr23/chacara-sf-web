#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${HOME}/esp32cam_motion_runtime"
PLIST_ID="com.chacara.esp32cam.detector"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_ID}.plist"
LOG_FILE="/tmp/esp32cam-detector.log"

mkdir -p "${HOME}/Library/LaunchAgents"
mkdir -p "${RUNTIME_DIR}"

cp -f "${SCRIPT_DIR}/detector_server.py" "${RUNTIME_DIR}/detector_server.py"
cp -f "${SCRIPT_DIR}/requirements.txt" "${RUNTIME_DIR}/requirements.txt"
cp -f "${SCRIPT_DIR}/start-detector.sh" "${RUNTIME_DIR}/start-detector.sh"
chmod +x "${RUNTIME_DIR}/start-detector.sh"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${PLIST_ID}</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd "${RUNTIME_DIR}" &amp;&amp; ./start-detector.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <key>WorkingDirectory</key>
    <string>${RUNTIME_DIR}</string>

    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
  </dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_ID}" >/dev/null 2>&1 || true
launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_ID}"

echo "LaunchAgent instalado: ${PLIST_ID}"
echo "Plist: ${PLIST_PATH}"
echo "Runtime: ${RUNTIME_DIR}"
echo "Log: ${LOG_FILE}"
