#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="$(grep -E '^PUBLIC_CAMERA_HOST=' .env | cut -d'=' -f2- | tr -d '[:space:]')"
CAM_PATH="${1:-cam-casa-01-frente}"

if [[ -z "$HOST" ]]; then
  echo "Erro: PUBLIC_CAMERA_HOST vazio no .env"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Erro: Docker nao encontrado."
  exit 1
fi

echo "Subindo MediaMTX + Caddy HTTPS..."
docker compose up -d mediamtx caddy

echo ""
echo "Status:"
docker compose ps

echo ""
echo "Teste local (HTTP interno):"
curl -sS "http://127.0.0.1:8888/${CAM_PATH}/index.m3u8" | sed -n '1,8p'

echo ""
echo "URL externa configurada:"
echo "  https://${HOST}/${CAM_PATH}/index.m3u8"
echo ""
echo "Teste externo:"
if ./check-external-stream.sh "https://${HOST}/${CAM_PATH}/index.m3u8"; then
  echo ""
  echo "OK: DuckDNS + HTTPS funcionando."
  exit 0
fi

echo ""
echo "DuckDNS/HTTPS nao respondeu externamente."
echo "Tentando fallback automatico sem abrir portas (Cloudflare quick tunnel)..."
echo ""
./start-quick-link.sh "${CAM_PATH}"
