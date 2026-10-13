#!/usr/bin/env bash
set -euo pipefail

EXPECTED="d16c0a1400078a9c6f49eea68155e214bdf51b3f"
EXPECTED_ORIGIN="https://github.com/qufei1993/skills-hub.git"

git submodule update --init vendor/skills-hub
ACTUAL="$(git -C vendor/skills-hub rev-parse HEAD)"
ORIGIN="$(git -C vendor/skills-hub remote get-url origin)"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "Skills Hub commit mismatch: expected $EXPECTED, got $ACTUAL" >&2
  exit 1
fi
if [[ "$ORIGIN" != "$EXPECTED_ORIGIN" ]]; then
  echo "Skills Hub origin mismatch: expected $EXPECTED_ORIGIN, got $ORIGIN" >&2
  exit 1
fi

echo "Skills Hub source initialized at locked commit $ACTUAL"
echo "No npm/cargo dependencies installed and no sync executed."
