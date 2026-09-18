#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Erro: Docker nao encontrado. Instale Docker Desktop e tente novamente."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Arquivo .env criado. Preencha CLOUDFLARE_TUNNEL_TOKEN e rode novamente."
  exit 1
fi

TUNNEL_TOKEN="$(grep -E '^CLOUDFLARE_TUNNEL_TOKEN=' .env | cut -d'=' -f2- | tr -d '[:space:]')"
PUBLIC_HOST="$(grep -E '^PUBLIC_CAMERA_HOST=' .env | cut -d'=' -f2- | tr -d '[:space:]')"

if [[ -z "$TUNNEL_TOKEN" ]]; then
  echo "Erro: CLOUDFLARE_TUNNEL_TOKEN vazio no arquivo .env."
  exit 1
fi

echo "Subindo MediaMTX..."
docker compose up -d mediamtx

echo "Subindo Cloudflare Tunnel..."
docker compose --profile tunnel up -d cloudflared

echo ""
echo "Status dos containers:"
docker compose ps

echo ""
echo "Ultimos logs do tunnel:"
docker compose logs --tail=30 cloudflared || true

echo ""
echo "Pronto. Agora configure no Cloudflare Tunnel o Public Hostname:"
echo "  Hostname: ${PUBLIC_HOST:-cam.seudominio.com}"
echo "  Service:  http://mediamtx:8888"
echo ""
echo "URL externa final no app:"
echo "  https://${PUBLIC_HOST:-cam.seudominio.com}/cam-casa-01-frente/index.m3u8"
