#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DOMAIN="${1:-}"
CAM_PATH="${2:-cam-casa-01-frente}"

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
if [[ -z "$TUNNEL_TOKEN" ]]; then
  echo "Erro: CLOUDFLARE_TUNNEL_TOKEN vazio no arquivo .env."
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  DOMAIN="$(grep -E '^PUBLIC_CAMERA_HOST=' .env | cut -d'=' -f2- | tr -d '[:space:]')"
fi

if [[ -z "$DOMAIN" ]]; then
  echo "Uso: ./start-cloudflare-fixed-domain.sh <dominio-proprio> [nome_da_camera_path]"
  echo "Exemplo: ./start-cloudflare-fixed-domain.sh cam.seudominio.com cam-casa-01-frente"
  exit 1
fi

if [[ "$DOMAIN" == *"trycloudflare.com" ]]; then
  echo "Erro: use dominio proprio (ex: cam.seudominio.com), nao URL temporaria trycloudflare."
  exit 1
fi

TMP_FILE="$(mktemp)"
awk -v domain="$DOMAIN" '
BEGIN { updated = 0 }
/^PUBLIC_CAMERA_HOST=/ {
  print "PUBLIC_CAMERA_HOST=" domain
  updated = 1
  next
}
{ print }
END {
  if (!updated) {
    print "PUBLIC_CAMERA_HOST=" domain
  }
}
' .env > "$TMP_FILE"
mv "$TMP_FILE" .env

echo "Dominio fixo configurado no .env: $DOMAIN"

echo "Desligando tunnel temporario (trycloudflare), se existir..."
docker compose --profile quick down >/dev/null 2>&1 || true

echo "Subindo MediaMTX..."
docker compose up -d mediamtx

echo "Subindo Cloudflare Tunnel (dominio fixo)..."
docker compose --profile tunnel up -d cloudflared

echo ""
echo "Status dos containers:"
docker compose ps

echo ""
echo "Ultimos logs do tunnel:"
docker compose logs --tail=40 cloudflared || true

FINAL_URL="https://${DOMAIN}/${CAM_PATH}/index.m3u8"

echo ""
echo "No painel do Cloudflare Tunnel, confirme a rota publica:"
echo "  Hostname: ${DOMAIN}"
echo "  Service:  http://mediamtx:8888"
echo "  Sem Cloudflare Access nessa rota."

echo ""
echo "Testando URL fixa:"
if ./check-external-stream.sh "$FINAL_URL"; then
  echo ""
  echo "OK: dominio fixo ativo."
else
  echo ""
  echo "Falha no teste externo."
  echo "Revise o Public Hostname no Tunnel e o DNS do dominio."
fi

echo ""
echo "Use no app em URL de reproducao externa:"
echo "  $FINAL_URL"
