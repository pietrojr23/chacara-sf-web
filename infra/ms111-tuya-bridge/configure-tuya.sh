#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Uso: $0 <TUYA_ACCESS_KEY> <TUYA_SECRET_KEY> <TUYA_DEVICE_ID> [tuyaus|tuyaeu|tuyacn|tuyain]"
  exit 1
fi

ACCESS_KEY="$1"
SECRET_KEY="$2"
DEVICE_ID="$3"
REGION="${4:-tuyaus}"

case "$REGION" in
  tuyaus) BASE_URL="https://openapi.tuyaus.com" ;;
  tuyaeu) BASE_URL="https://openapi.tuyaeu.com" ;;
  tuyacn) BASE_URL="https://openapi.tuyacn.com" ;;
  tuyain) BASE_URL="https://openapi.tuyain.com" ;;
  *)
    echo "Região inválida: $REGION"
    exit 1
    ;;
esac

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

sed -i.bak "s|^TUYA_BASE_URL=.*$|TUYA_BASE_URL=$BASE_URL|" .env
sed -i.bak "s|^TUYA_ACCESS_KEY=.*$|TUYA_ACCESS_KEY=$ACCESS_KEY|" .env
sed -i.bak "s|^TUYA_SECRET_KEY=.*$|TUYA_SECRET_KEY=$SECRET_KEY|" .env
sed -i.bak "s|^TUYA_DEVICE_ID=.*$|TUYA_DEVICE_ID=$DEVICE_ID|" .env
rm -f .env.bak

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
BRIDGE_KEY=$(awk -F= '/^BRIDGE_API_KEY=/{print $2}' .env)

cat <<OUT

Configuração salva em: $(pwd)/.env

Webhooks para usar no app (Configurações do proprietário):
- Abrir:  http://${LOCAL_IP}:8787/gate/open?k=${BRIDGE_KEY}
- Fechar: http://${LOCAL_IP}:8787/gate/close?k=${BRIDGE_KEY}

Próximo passo:
1) npm start
2) Testar: http://${LOCAL_IP}:8787/health
3) Testar funções Tuya: http://${LOCAL_IP}:8787/tuya/device/functions?k=${BRIDGE_KEY}
OUT
