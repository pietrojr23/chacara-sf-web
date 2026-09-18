#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

echo "[bootstrap] Corrigindo/instalando Docker..."
bash "${SCRIPT_DIR}/fix-docker-lubuntu.sh"

echo "[bootstrap] Subindo stack MediaMTX..."
cd "${SCRIPT_DIR}"

if [[ ! -e "${SCRIPT_DIR}/mediamtx.yml" ]]; then
  echo "[bootstrap] ERRO: ${SCRIPT_DIR}/mediamtx.yml nao existe."
  echo "[bootstrap] Verifique se os arquivos da pasta foram copiados corretamente."
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/mediamtx.yml" ]]; then
  echo "[bootstrap] ERRO: ${SCRIPT_DIR}/mediamtx.yml existe, mas nao e um arquivo."
  echo "[bootstrap] Provavelmente virou diretorio por copia/mount incorreto."
  exit 1
fi

docker compose pull || true
# Tenta derrubar sobras do projeto atual.
docker compose down --remove-orphans >/dev/null 2>&1 || true

# Evita conflito quando existem containers legados com nomes fixos.
LEGACY_CONTAINERS=(
  mediamtx
  ffmpeg-cam-casa-01-frente-low
  ffmpeg-cam-portao-low
  ffmpeg-cam-portao-canal-7-low
  caddy-mediamtx
  cloudflared-mediamtx
  cloudflared-quick-mediamtx
  gcp-vps-tunnel
)

for cname in "${LEGACY_CONTAINERS[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "${cname}"; then
    echo "[bootstrap] Removendo container legado: ${cname}"
    docker rm -f "${cname}" >/dev/null 2>&1 || true
  fi
done

docker compose up -d mediamtx
docker compose ps

echo "[bootstrap] Pronto."
echo "[bootstrap] Para logs: docker compose logs -f mediamtx"
