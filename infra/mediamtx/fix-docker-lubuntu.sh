#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

export DEBIAN_FRONTEND=noninteractive

log() {
  echo "[fix-docker] $*"
}

log "Parando servicos docker/containerd (se ativos)..."
systemctl stop docker.service docker.socket containerd.service >/dev/null 2>&1 || true

log "Removendo pacotes conflitantes (docker-compose-v2 do Ubuntu)..."
apt-get remove -y docker-compose-v2 docker-compose >/dev/null 2>&1 || true

log "Limpando estado quebrado do dpkg/apt..."
dpkg --configure -a || true
apt-get -f install -y || true

log "Instalando pre-requisitos..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release apt-transport-https

log "Configurando repositorio oficial do Docker..."
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable
EOF

log "Instalando Docker Engine + Compose plugin..."
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if [[ -f /etc/docker/daemon.json ]]; then
  if ! python3 -m json.tool /etc/docker/daemon.json >/dev/null 2>&1; then
    TS="$(date +%Y%m%d-%H%M%S)"
    log "daemon.json invalido; backup em /etc/docker/daemon.json.bak.${TS}"
    cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.${TS}"
    echo '{}' >/etc/docker/daemon.json
  fi
fi

log "Habilitando servicos..."
systemctl daemon-reload
systemctl enable --now containerd docker

log "Validando instalacao..."
docker --version
docker compose version
systemctl --no-pager -l status docker.service | sed -n '1,25p'

log "OK: Docker corrigido com sucesso."
