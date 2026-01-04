#!/usr/bin/env bash
set -euo pipefail

DESTINATION="${1:-resources/pokeapi-data}"

echo "Syncing PokeAPI/api-data into ${DESTINATION} ..."

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required to sync PokeAPI data." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t pokeapi-api-data)"
cleanup() {
  rm -rf "${TMP_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git clone --depth 1 https://github.com/PokeAPI/api-data.git "${TMP_DIR}" >/dev/null

TARGET_V2="${DESTINATION}/v2"
rm -rf "${TARGET_V2}"
mkdir -p "${DESTINATION}"

cp -R "${TMP_DIR}/data/v2" "${TARGET_V2}"

echo "Done. Expected index: ${TARGET_V2}/pokemon/index.json"
