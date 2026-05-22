#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PACKAGES_FILE="$SCRIPT_DIR/pi-default-packages.txt"
GLOBAL_ROOT="${NPM_GLOBAL_ROOT:-$(npm root -g 2>/dev/null || true)}"

if [[ -z "$GLOBAL_ROOT" ]]; then
  echo "Could not determine npm global root. Set NPM_GLOBAL_ROOT or ensure npm is available." >&2
  exit 2
fi

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
  pkg_json="$GLOBAL_ROOT/$pkg/package.json"

  if [[ -f "$pkg_json" ]]; then
    version="$(node -p "require('$pkg_json').version" 2>/dev/null || echo UNKNOWN)"
    echo "$pkg: current=$version"
  else
    echo "$pkg: NOT FOUND at $pkg_json"
  fi
done < <(read_packages "$@")
