#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CAM_PATH="${1:-cam-casa-01-frente}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Erro: Docker nao encontrado. Instale Docker Desktop e tente novamente."
  exit 1
fi

echo "Subindo MediaMTX..."
docker compose up -d mediamtx

echo "Recriando tunnel rapido (trycloudflare)..."
docker compose --profile quick rm -sf cloudflared-quick >/dev/null 2>&1 || true
docker compose --profile quick up -d cloudflared-quick

URL=""
for _ in {1..40}; do
  URL="$(docker compose --profile quick logs --no-color --tail=200 cloudflared-quick 2>/dev/null \
    | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -n1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "Erro: nao consegui obter URL trycloudflare nos logs."
  echo "Veja logs com: docker compose --profile quick logs -f cloudflared-quick"
  exit 1
fi

STREAM_URL="${URL}/${CAM_PATH}/index.m3u8"

HOST_ONLY="$(echo "$URL" | sed -E 's#^https?://##')"
for _ in {1..30}; do
  if command -v nslookup >/dev/null 2>&1 && nslookup "$HOST_ONLY" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "URL externa instantanea (funciona fora da rede):"
echo "  $STREAM_URL"
echo ""
echo "Teste automatico:"
./check-external-stream.sh "$STREAM_URL" || true
echo ""
echo "Use esta URL no app em: URL de reproducao externa"
