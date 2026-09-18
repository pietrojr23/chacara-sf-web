#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "${PYTHON_BIN}" ]]; then
  for candidate in python3.11 python3.12 python3.10 python3; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      PYTHON_BIN="${candidate}"
      break
    fi
  done
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "ERRO: nenhum Python encontrado."
  exit 1
fi

echo "Usando Python: ${PYTHON_BIN}"
if [[ ! -d .venv ]]; then
  "${PYTHON_BIN}" -m venv .venv
fi
source .venv/bin/activate

python -m pip install --upgrade pip

REQ_HASH="$(shasum requirements.txt | awk '{print $1}')"
INSTALLED_HASH="$(cat .venv/.requirements.sha 2>/dev/null || true)"
if [[ "${REQ_HASH}" != "${INSTALLED_HASH}" ]]; then
  python -m pip install -r requirements.txt
  echo "${REQ_HASH}" > .venv/.requirements.sha
fi

python detector_server.py
