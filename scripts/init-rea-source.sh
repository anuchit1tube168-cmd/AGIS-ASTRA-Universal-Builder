#!/usr/bin/env bash
set -euo pipefail

EXPECTED="d864ad54717d92fe4b512ce1170717d9904c1f00"
EXPECTED_URL="https://github.com/morluto/rea.git"

CONFIGURED_URL="$(git config -f .gitmodules --get submodule.vendor/rea.url)"
if [[ "$CONFIGURED_URL" != "$EXPECTED_URL" ]]; then
  echo "REA upstream mismatch: expected $EXPECTED_URL, got $CONFIGURED_URL" >&2
  exit 1
fi

# Intentionally non-recursive: fetch only the pinned REA repository, not any nested submodules.
git submodule update --init vendor/rea

ACTUAL="$(git -C vendor/rea rev-parse HEAD)"
ORIGIN="$(git -C vendor/rea remote get-url origin)"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "REA commit mismatch: expected $EXPECTED, got $ACTUAL" >&2
  exit 1
fi
if [[ "$ORIGIN" != "$EXPECTED_URL" ]]; then
  echo "REA origin mismatch: expected $EXPECTED_URL, got $ORIGIN" >&2
  exit 1
fi

echo "REA source initialized at locked commit $ACTUAL"
echo "Origin verified: $ORIGIN"
echo "No nested submodules, dependencies, or REA setup were executed."
