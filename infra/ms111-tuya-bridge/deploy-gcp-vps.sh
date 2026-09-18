#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 4 ]]; then
  cat <<'USAGE'
Uso:
  ./deploy-gcp-vps.sh <usuario@ip-ou-host-vps> [host-publico] [porta] [caminho-chave-ssh]

Exemplos:
  ./deploy-gcp-vps.sh pietrojr2@34.151.223.146
  ./deploy-gcp-vps.sh pietrojr2@34.151.223.146 34.151.223.146 8787
  ./deploy-gcp-vps.sh pietrojr2@34.151.223.146 34.151.223.146 8787 ~/.ssh/google_compute_engine
USAGE
  exit 1
fi

SSH_TARGET="$1"
PUBLIC_HOST="${2:-${SSH_TARGET#*@}}"
PORT="${3:-8787}"
SSH_KEY_PATH="${4:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
REMOTE_DIR="/opt/ms111-tuya-bridge"
TMP_ARCHIVE="/tmp/ms111-tuya-bridge-src.tar.gz"

SSH_ARGS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "$SSH_KEY_PATH" ]]; then
  SSH_ARGS+=(-i "$SSH_KEY_PATH")
elif [[ -f "$HOME/.ssh/google_compute_engine" ]]; then
  SSH_ARGS+=(-i "$HOME/.ssh/google_compute_engine")
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: arquivo .env não encontrado em ${SCRIPT_DIR}"
  echo "Copie .env.example para .env e preencha as chaves Tuya."
  exit 1
fi

REQUIRED_KEYS=(TUYA_ACCESS_KEY TUYA_SECRET_KEY TUYA_DEVICE_ID BRIDGE_API_KEY)
for key in "${REQUIRED_KEYS[@]}"; do
  value="$(awk -F= -v k="$key" '$1==k{print substr($0, index($0, "=")+1)}' "$ENV_FILE" | tail -n1)"
  if [[ -z "${value// /}" ]]; then
    echo "ERRO: ${key} está vazio no .env"
    exit 1
  fi
done

BRIDGE_API_KEY="$(awk -F= '$1=="BRIDGE_API_KEY"{print substr($0, index($0, "=")+1)}' "$ENV_FILE" | tail -n1)"

echo "Empacotando bridge..."
tar \
  --exclude node_modules \
  --exclude .git \
  --exclude ".env" \
  -czf "$TMP_ARCHIVE" \
  -C "$SCRIPT_DIR" \
  .

echo "Enviando arquivos para VPS (${SSH_TARGET})..."
scp "${SSH_ARGS[@]}" "$TMP_ARCHIVE" "$SSH_TARGET:/tmp/ms111-tuya-bridge-src.tar.gz"
scp "${SSH_ARGS[@]}" "$ENV_FILE" "$SSH_TARGET:/tmp/ms111-tuya-bridge.env"

echo "Instalando dependências e subindo container na VPS..."
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "REMOTE_DIR='${REMOTE_DIR}' PORT='${PORT}' bash -s" <<'EOF'
set -euo pipefail

SUDO=""
if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[vps] Instalando Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[vps] Instalando docker compose plugin..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-compose-plugin
fi

$SUDO mkdir -p "$REMOTE_DIR"
$SUDO tar xzf /tmp/ms111-tuya-bridge-src.tar.gz -C "$REMOTE_DIR"
$SUDO cp /tmp/ms111-tuya-bridge.env "$REMOTE_DIR/.env"

$SUDO chmod +x "$REMOTE_DIR/deploy-gcp-vps.sh" "$REMOTE_DIR/configure-tuya.sh" || true

cd "$REMOTE_DIR"
$SUDO docker compose down || true
$SUDO docker compose up -d --build

echo "[vps] Status do container:"
$SUDO docker compose ps

echo "[vps] Health local:"
for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${PORT}/health"; then
    echo
    break
  fi
  sleep 1
done

if command -v ufw >/dev/null 2>&1; then
  if $SUDO ufw status | grep -qi 'Status: active'; then
    echo "[vps] Liberando porta ${PORT} no UFW..."
    $SUDO ufw allow "${PORT}/tcp" || true
  fi
fi
EOF

rm -f "$TMP_ARCHIVE"

cat <<OUT

Deploy concluído.

Use estas URLs no app (Configurações > Webhooks do Portão):
- Abrir:  http://${PUBLIC_HOST}:${PORT}/gate/open?k=${BRIDGE_API_KEY}
- Fechar: http://${PUBLIC_HOST}:${PORT}/gate/close?k=${BRIDGE_API_KEY}

Teste externo:
- Health:  http://${PUBLIC_HOST}:${PORT}/health

Se não abrir fora da VPS, libere TCP ${PORT} no firewall da VPC do Google Cloud.
OUT
