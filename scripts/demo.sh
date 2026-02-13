#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== 1) Test suite =="
npm test

echo
echo "== 2) Analisi standard (warnings non bloccanti) =="
node ./src/index.mjs ./sample.md

echo
echo "== 3) Strict mode (warnings bloccanti) =="
set +e
node ./src/index.mjs ./sample.md --strict
STRICT_EXIT=$?
set -e

echo "Exit strict: ${STRICT_EXIT}"

echo
echo "== 4) Override linea max =="
node ./src/index.mjs ./sample.md --max-line-length 100

echo
echo "Demo completa (30-45s)."
