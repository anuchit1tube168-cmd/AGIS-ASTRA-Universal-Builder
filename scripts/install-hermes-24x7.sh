#!/usr/bin/env bash
set -euo pipefail

echo "Verify Hermes:"
hermes --help >/dev/null

echo "Install Telegram gateway as boot service:"
sudo hermes gateway install --system
sudo hermes gateway start --system
sudo hermes gateway status --system

echo
echo "AGIS bridge is separate. Copy bridge/agis-bridge.service to /etc/systemd/system/"
echo "after replacing REPLACE_WITH_* values and creating bridge/bridge.env."
