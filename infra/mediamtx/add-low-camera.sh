#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ] || [ "${2:-}" = "" ]; then
  cat <<'USAGE'
Uso:
  ./add-low-camera.sh <path_camera> <rtsp_url> [perfil]

Exemplo:
  ./add-low-camera.sh cam-casa-02-fundos "rtsp://user:pass@192.168.1.29:554/stream2"
  ./add-low-camera.sh cam-portao "rtsp://admin:pass@192.168.1.5:554/cam/realmonitor?channel=1&subtype=1" dahua

Perfis:
  generic (padrao)
  dahua   (usa correcoes de timestamp para H264DVR/Dahua)
USAGE
  exit 1
fi

CAM_PATH="$1"
RTSP_URL="$2"
PROFILE="${3:-generic}"

if [[ ! "$CAM_PATH" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERRO: path invalida. Use apenas [a-z0-9-], ex: cam-casa-02-fundos"
  exit 1
fi

if [[ "$CAM_PATH" != cam-* ]]; then
  echo "ERRO: para manter padrao do app, a path deve comecar com 'cam-'"
  exit 1
fi

if [[ "$RTSP_URL" == *"'"* ]]; then
  echo "ERRO: RTSP URL com aspas simples nao suportada por este script."
  exit 1
fi

if [[ "$PROFILE" != "generic" && "$PROFILE" != "dahua" ]]; then
  echo "ERRO: perfil invalido. Use 'generic' ou 'dahua'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MEDIA_FILE="$SCRIPT_DIR/mediamtx.yml"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if command -v rg >/dev/null 2>&1; then
  HAS_PATTERN() {
    rg -q "$1" "$2"
  }
else
  HAS_PATTERN() {
    grep -Eq "$1" "$2"
  }
fi

if [ ! -f "$MEDIA_FILE" ] || [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERRO: arquivos mediamtx.yml/docker-compose.yml nao encontrados em $SCRIPT_DIR"
  exit 1
fi

RAW_PATH="${CAM_PATH}-raw"
SERVICE_NAME="ffmpeg-${CAM_PATH}-low"

if HAS_PATTERN "^  ${CAM_PATH}:" "$MEDIA_FILE"; then
  echo "ERRO: path '${CAM_PATH}' ja existe em mediamtx.yml"
  exit 1
fi

if HAS_PATTERN "^  ${RAW_PATH}:" "$MEDIA_FILE"; then
  echo "ERRO: path '${RAW_PATH}' ja existe em mediamtx.yml"
  exit 1
fi

if HAS_PATTERN "^  ${SERVICE_NAME}:" "$COMPOSE_FILE"; then
  echo "ERRO: service '${SERVICE_NAME}' ja existe em docker-compose.yml"
  exit 1
fi

# Garante publisher para todas as cameras cam-*.
sed -i '' 's/path: "cam-casa-01-frente"/path: "~^cam-.*$"/' "$MEDIA_FILE" 2>/dev/null || true

cat >> "$MEDIA_FILE" <<EOF2

  ${CAM_PATH}:
    source: publisher
  ${RAW_PATH}:
    source: '${RTSP_URL}'
    sourceOnDemand: yes
    rtspTransport: tcp
EOF2

BLOCK=$(cat <<EOF2
  ${SERVICE_NAME}:
    image: lscr.io/linuxserver/ffmpeg:latest
    container_name: ${SERVICE_NAME}
    restart: unless-stopped
    depends_on:
      - mediamtx
    entrypoint: /bin/sh
    command:
      - -c
      - |
        while true; do
          ffmpeg -hide_banner -loglevel warning \\
            $(if [[ "$PROFILE" == "dahua" ]]; then
                echo "-fflags nobuffer+genpts+discardcorrupt -flags low_delay \\"
                echo "            -analyzeduration 500000 -probesize 32768 \\"
                echo "            -timeout 15000000 \\"
                echo "            -use_wallclock_as_timestamps 1 \\"
              else
                echo "-fflags nobuffer+genpts -flags low_delay \\"
                echo "            -analyzeduration 500000 -probesize 32768 \\"
              fi)
            -rtsp_transport tcp \\
            -i '${RTSP_URL}' \\
            -an \\
            -c:v libx264 -preset veryfast -tune zerolatency \\
            -vf "$(if [[ "$PROFILE" == "dahua" ]]; then echo "scale=426:240,fps=7,setpts=N/(7*TB)"; else echo "scale=426:240,fps=7"; fi)" \\
            -g 7 -keyint_min 7 -sc_threshold 0 -bf 0 \\
            -b:v 120k -maxrate 150k -bufsize 180k \\
            -pix_fmt yuv420p \\
            -f rtsp -rtsp_transport tcp \\
            rtsp://publisher:publisher123@mediamtx:8554/${CAM_PATH}
          sleep 2
        done

EOF2
)

BLOCK_FILE="$(mktemp)"
TMP_FILE="$(mktemp)"
printf "%s" "$BLOCK" > "$BLOCK_FILE"

awk -v blockfile="$BLOCK_FILE" '
  BEGIN { inserted = 0 }
  /^  caddy:/ && inserted == 0 {
    while ((getline line < blockfile) > 0) print line
    close(blockfile)
    inserted = 1
  }
  { print }
  END {
    if (inserted == 0) {
      while ((getline line < blockfile) > 0) print line
      close(blockfile)
    }
  }
' "$COMPOSE_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$COMPOSE_FILE"
rm -f "$BLOCK_FILE"

echo "Subindo servicos..."
(
  cd "$SCRIPT_DIR"
  docker compose up -d mediamtx "$SERVICE_NAME"
)

echo
echo "Camera adicionada com sucesso: ${CAM_PATH}"
echo "URL local:   http://SEU_IP_LOCAL:8888/${CAM_PATH}/index.m3u8"
echo "URL externa: https://SEU_HOST_PUBLICO/${CAM_PATH}/index.m3u8"
