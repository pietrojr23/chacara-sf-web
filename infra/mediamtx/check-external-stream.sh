#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: ./check-external-stream.sh https://SEU_HOST/cam-xxx/index.m3u8"
  exit 1
fi

URL="$1"

if ! command -v curl >/dev/null 2>&1; then
  echo "Erro: curl nao encontrado."
  exit 1
fi

echo "== Teste HEAD da URL externa =="
HTTP_CODE="$(curl -sS -L -o /dev/null -w '%{http_code}' "$URL" || true)"
echo "HTTP $HTTP_CODE"
if [[ "$HTTP_CODE" == "000" ]]; then
  echo "ERRO: nao foi possivel conectar na URL."
  exit 1
fi

echo ""
echo "== Baixando playlist (primeiras linhas) =="
PLAYLIST="$(curl -sS "$URL" || true)"
echo "$PLAYLIST" | sed -n '1,20p'

if echo "$PLAYLIST" | grep -qi "<html"; then
  echo ""
  echo "ERRO: retorno HTML detectado (provavel pagina Cloudflare Access/WAF), nao e playlist m3u8."
  echo "No Tunnel, deixe a rota publica sem login obrigatorio para este hostname."
  exit 2
fi

if ! echo "$PLAYLIST" | grep -q "#EXTM3U"; then
  echo ""
  echo "ERRO: resposta nao parece playlist HLS (#EXTM3U ausente)."
  exit 3
fi

SEGMENT="$(echo "$PLAYLIST" | awk 'NF && $1 !~ /^#/ {print $1; exit}')"

if [[ -z "${SEGMENT:-}" ]]; then
  echo ""
  echo "Aviso: playlist valida, mas sem segmento ainda (camera pode estar offline ou sourceOnDemand em aquecimento)."
  exit 0
fi

if [[ "$SEGMENT" =~ ^https?:// ]]; then
  SEGMENT_URL="$SEGMENT"
else
  BASE_URL="${URL%/*}"
  SEGMENT_URL="$BASE_URL/$SEGMENT"
fi

echo ""
echo "== Teste do primeiro segmento =="
SEG_CODE="$(curl -sS -L -o /dev/null -w '%{http_code}' "$SEGMENT_URL" || true)"
echo "HTTP $SEG_CODE"
if [[ "$SEG_CODE" == "000" ]]; then
  echo "ERRO: nao foi possivel baixar segmento."
  exit 4
fi

echo ""
echo "OK: playlist e segmento externos responderam."
