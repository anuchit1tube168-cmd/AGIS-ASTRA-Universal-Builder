#!/usr/bin/env bash
set -euo pipefail

EXPECTED="d864ad54717d92fe4b512ce1170717d9904c1f00"

git submodule update --init --recursive vendor/rea
ACTUAL="$(git -C vendor/rea rev-parse HEAD)"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "REA commit mismatch: expected $EXPECTED, got $ACTUAL" >&2
  exit 1
fi

echo "REA source initialized at locked commit $ACTUAL"
echo "No dependencies installed and no REA setup executed."
