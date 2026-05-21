#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PACKAGES_FILE="$SCRIPT_DIR/pi-default-packages.txt"

read_packages() {
  if (( $# > 0 )); then
    printf '%s\n' "$@"
    return
  fi

  if [[ ! -f "$DEFAULT_PACKAGES_FILE" ]]; then
    echo "Missing package list: $DEFAULT_PACKAGES_FILE" >&2
    exit 2
  fi

  grep -vE '^\s*(#|$)' "$DEFAULT_PACKAGES_FILE"
}

while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  latest="$(npm view "$pkg" version 2>/dev/null || echo NOT_IN_REGISTRY)"
  echo "$pkg: latest=$latest"
done < <(read_packages "$@")
