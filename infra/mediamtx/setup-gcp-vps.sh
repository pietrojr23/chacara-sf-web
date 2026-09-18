#!/usr/bin/env bash
set -euo pipefail

# Configura um proxy HTTPS no VPS (Google Cloud) usando Caddy.
# O proxy publica https://SEU_DOMINIO/* e encaminha para 127.0.0.1:18888 no VPS.
# Esse 18888 deve ser alimentado pelo tunel reverso iniciado no servidor local.

if [ "${1:-}" = "" ] || [ "${2:-}" = "" ]; then
  cat <<'USAGE'
Uso:
  ./setup-gcp-vps.sh <usuario@ip-ou-host-vps> <dominio-publico> [porta_remota]

Variaveis opcionais:
  SSH_KEY_PATH=/caminho/chave_privada
  SSH_PORT=22

Exemplos:
  ./setup-gcp-vps.sh ubuntu@34.12.34.56 cam.chacarasf.com.br
  SSH_KEY_PATH=~/.ssh/gcp_tunnel_key ./setup-gcp-vps.sh pietrojr2@34.151.223.146 34.151.223.146.nip.io
  ./setup-gcp-vps.sh ubuntu@34.12.34.56 34.12.34.56.nip.io 18888
USAGE
  exit 1
fi

SSH_TARGET="$1"
PUBLIC_HOST="$2"
REMOTE_PORT="${3:-18888}"
SSH_KEY_PATH="${SSH_KEY_PATH:-}"
SSH_PORT="${SSH_PORT:-22}"

SSH_ARGS=(
  -p "${SSH_PORT}"
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)

if [ -n "${SSH_KEY_PATH}" ]; then
  if [ ! -f "${SSH_KEY_PATH}" ]; then
    echo "ERRO: SSH_KEY_PATH nao encontrado: ${SSH_KEY_PATH}"
    exit 1
  fi
  SSH_ARGS+=(-i "${SSH_KEY_PATH}")
fi

echo "Configurando VPS em: ${SSH_TARGET}"
echo "Dominio publico: ${PUBLIC_HOST}"
echo "Porta interna do tunel no VPS: ${REMOTE_PORT}"

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "bash -s" <<EOF
set -euo pipefail

WORKDIR="/opt/cam-vps-proxy"
if ! mkdir -p "\$WORKDIR" >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "\$WORKDIR"
    sudo chown "\$USER:\$USER" "\$WORKDIR"
  else
    echo "ERRO: sem permissao para criar \$WORKDIR (e sem sudo)."
    exit 1
  fi
fi
cd "\$WORKDIR"

if ! command -v docker >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    sudo sh -c 'curl -fsSL https://get.docker.com | sh'
  else
    sh -c 'curl -fsSL https://get.docker.com | sh'
  fi
fi

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
  else
    echo "ERRO: docker instalado, mas sem permissao para executar."
    echo "Adicione seu usuario ao grupo docker e reconecte na VPS."
    exit 1
  fi
fi

cat > docker-compose.yml <<'COMPOSE'
services:
  caddy:
    image: caddy:2
    container_name: caddy-cam-vps
    restart: unless-stopped
    # Necessario para acessar o tunel SSH em 127.0.0.1 do host da VPS.
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
COMPOSE

cat > Caddyfile <<CADDY
${PUBLIC_HOST} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${REMOTE_PORT}
}
CADDY

\$DOCKER_CMD compose up -d
\$DOCKER_CMD compose ps

echo
echo "Proxy HTTPS ativo no VPS."
echo "Agora no servidor LOCAL rode:"
echo "  ./start-gcp-vps-tunnel.sh ${SSH_TARGET} ${REMOTE_PORT} 8888 ${PUBLIC_HOST}"
EOF

echo
echo "Setup concluido."
echo "Importante no Google Cloud Firewall: liberar TCP 22, 80 e 443 na VM."
