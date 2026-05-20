#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Current global versions =="
bash "$SCRIPT_DIR/pi-check-current-global-versions.sh" "$@"

echo
echo "== Latest npm versions =="
bash "$SCRIPT_DIR/pi-check-latest-npm-versions.sh" "$@"

echo
echo "== Git source update status =="
bash "$SCRIPT_DIR/pi-check-git-source-updates.sh"
