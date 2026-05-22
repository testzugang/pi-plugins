#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPOS_FILE="$SCRIPT_DIR/pi-default-git-repos.txt"

read_repos() {
  if (( $# > 0 )); then
    printf '%s\n' "$@"
    return
  fi

  if [[ ! -f "$DEFAULT_REPOS_FILE" ]]; then
    echo "Missing repo list: $DEFAULT_REPOS_FILE" >&2
    exit 2
  fi

  grep -vE '^\s*(#|$)' "$DEFAULT_REPOS_FILE"
}

while IFS= read -r repo; do
  [[ -z "$repo" ]] && continue

  if [[ ! -d "$repo" ]]; then
    echo "Directory $repo NOT FOUND"
    continue
  fi

  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "Directory $repo is not a git repository"
    continue
  fi

  echo "--- $repo ---"

  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)"
  current_commit="$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo UNKNOWN)"

  git -C "$repo" fetch --quiet origin 2>/dev/null || true

  remote_commit="NO_REMOTE_BRANCH"
  if [[ "$branch" != "HEAD" && "$branch" != "DETACHED" ]]; then
    remote_commit="$(git -C "$repo" rev-parse "origin/$branch" 2>/dev/null || echo NO_REMOTE_BRANCH)"
  fi

  echo "Branch: $branch"
  echo "Current Commit: $current_commit"
  echo "Remote Commit:  $remote_commit"

  if [[ "$remote_commit" == "NO_REMOTE_BRANCH" ]]; then
    echo "Status: UNKNOWN"
  elif [[ "$current_commit" != "$remote_commit" ]]; then
    echo "Status: UPDATE_AVAILABLE"
  else
    echo "Status: UP_TO_DATE"
  fi
done < <(read_repos "$@")
