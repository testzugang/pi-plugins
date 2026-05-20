#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

SECURITY_ENV_VARS = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "VAULT_TOKEN",
]

SCRIPT_DIR = Path(__file__).resolve().parent
TRIAGE_SCRIPT = SCRIPT_DIR / "npm_ts_static_triage.py"
DEFAULT_PACKAGES_FILE = SCRIPT_DIR / "pi-default-packages.txt"
DEFAULT_GIT_REPOS_FILE = SCRIPT_DIR / "pi-default-git-repos.txt"


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=check,
    )


def unset_security_env() -> None:
    for env_var in SECURITY_ENV_VARS:
        os.environ.pop(env_var, None)


def read_non_comment_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        out.append(value)
    return out


def npm_global_root() -> Path:
    override = os.environ.get("NPM_GLOBAL_ROOT", "").strip()
    if override:
        return Path(override)
    result = run(["npm", "root", "-g"])
    return Path(result.stdout.strip())


def current_global_version(global_root: Path, package: str) -> str | None:
    package_json = global_root / package / "package.json"
    if not package_json.exists():
        return None
    result = run(["node", "-p", f"require('{package_json}').version"], check=False)
    version = (result.stdout or "").strip()
    return version or None


def npm_latest_version(package: str) -> str | None:
    result = run(["npm", "view", package, "version"], check=False)
    version = (result.stdout or "").strip()
    return version or None


def npm_tarball_url(package: str, version: str) -> str:
    result = run(["npm", "view", f"{package}@{version}", "dist.tarball"])
    url = result.stdout.strip()
    if not url:
        raise RuntimeError(f"No dist.tarball returned for {package}@{version}")
    return url


def scan_with_triage(target: Path, mode: str, report_json: Path) -> dict[str, Any]:
    run(
        [
            "python3",
            str(TRIAGE_SCRIPT),
            str(target),
            "--mode",
            mode,
            "--json",
            str(report_json),
        ]
    )
    return json.loads(report_json.read_text(encoding="utf-8"))


def audit_npm_packages(workspace: Path, packages: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    global_root = npm_global_root()

    for package in packages:
        current = current_global_version(global_root, package)
        latest = npm_latest_version(package)

        if current is None:
            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "not_installed",
                    "current": None,
                    "latest": latest,
                    "decision": "SKIP_NOT_INSTALLED",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        if latest is None:
            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "registry_lookup_failed",
                    "current": current,
                    "latest": None,
                    "decision": "ERROR",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        if current == latest:
            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "up_to_date",
                    "current": current,
                    "latest": latest,
                    "decision": "PASS_UP_TO_DATE",
                    "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0},
                    "findings": [],
                }
            )
            continue

        try:
            tarball_url = npm_tarball_url(package, latest)
            tarball_path = workspace / f"{package.replace('/', '_')}@{latest}.tgz"
            urllib.request.urlretrieve(tarball_url, tarball_path)

            report_json = workspace / f"{package.replace('/', '_')}_{latest}_report.json"
            report_data = scan_with_triage(tarball_path, "package", report_json)

            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "update_available",
                    "current": current,
                    "latest": latest,
                    "decision": report_data.get("decision", "UNKNOWN"),
                    "counts": report_data.get("counts_by_severity", {}),
                    "findings": report_data.get("findings", []),
                }
            )
        except Exception as exc:  # noqa: BLE001
            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "error",
                    "current": current,
                    "latest": latest,
                    "decision": "ERROR",
                    "error": str(exc),
                }
            )

    return results


def repo_update_info(repo_path: Path) -> tuple[str, str, str] | None:
    if not repo_path.exists() or not (repo_path / ".git").exists():
        return None

    branch = run(["git", "-C", str(repo_path), "rev-parse", "--abbrev-ref", "HEAD"], check=False).stdout.strip() or "HEAD"
    current = run(["git", "-C", str(repo_path), "rev-parse", "HEAD"], check=False).stdout.strip() or "UNKNOWN"
    run(["git", "-C", str(repo_path), "fetch", "--quiet", "origin"], check=False)

    remote = "NO_REMOTE_BRANCH"
    if branch not in {"HEAD", "DETACHED"}:
        remote = run(["git", "-C", str(repo_path), "rev-parse", f"origin/{branch}"], check=False).stdout.strip() or "NO_REMOTE_BRANCH"
    return branch, current, remote


def audit_git_repos(workspace: Path, repos: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    for repo in repos:
        repo_path = Path(repo)
        info = repo_update_info(repo_path)
        if info is None:
            results.append(
                {
                    "name": repo,
                    "type": "git",
                    "status": "missing_or_not_git",
                    "decision": "SKIP_MISSING",
                }
            )
            continue

        branch, current, remote = info
        origin_url = run(["git", "-C", str(repo_path), "remote", "get-url", "origin"], check=False).stdout.strip()

        if remote in {"NO_REMOTE_BRANCH", ""}:
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "unknown",
                    "branch": branch,
                    "current": current,
                    "latest": None,
                    "decision": "SKIP_NO_REMOTE_BRANCH",
                }
            )
            continue

        if current == remote:
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "up_to_date",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "decision": "PASS_UP_TO_DATE",
                    "counts": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0},
                    "findings": [],
                }
            )
            continue

        try:
            clone_target = workspace / f"{repo_path.name}_latest"
            if clone_target.exists():
                shutil.rmtree(clone_target)

            run(["git", "clone", "--no-checkout", origin_url, str(clone_target)])
            run(["git", "-C", str(clone_target), "checkout", "--detach", remote])

            report_json = workspace / f"{repo_path.name}_{remote[:8]}_report.json"
            report_data = scan_with_triage(clone_target, "repo", report_json)

            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "update_available",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "decision": report_data.get("decision", "UNKNOWN"),
                    "counts": report_data.get("counts_by_severity", {}),
                    "findings": report_data.get("findings", []),
                }
            )
        except Exception as exc:  # noqa: BLE001
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "error",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "decision": "ERROR",
                    "error": str(exc),
                }
            )

    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Static audit for global pi dependency updates.")
    parser.add_argument("--packages-file", default=str(DEFAULT_PACKAGES_FILE), help="Path to newline-separated npm package list")
    parser.add_argument("--repos-file", default=str(DEFAULT_GIT_REPOS_FILE), help="Path to newline-separated git repo path list")
    parser.add_argument("--workspace", default="", help="Workspace dir (default: temporary directory)")
    parser.add_argument("--output", default="/tmp/pi_audit_aggregated.json", help="Aggregated JSON output path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    unset_security_env()

    if not TRIAGE_SCRIPT.exists():
        print(f"Missing triage script: {TRIAGE_SCRIPT}", file=sys.stderr)
        return 2

    packages = read_non_comment_lines(Path(args.packages_file))
    repos = read_non_comment_lines(Path(args.repos_file))

    workspace = Path(args.workspace) if args.workspace else Path(tempfile.mkdtemp(prefix="pi-audit-"))
    workspace.mkdir(parents=True, exist_ok=True)

    print(f"Workspace: {workspace}")

    results: list[dict[str, Any]] = []
    results.extend(audit_npm_packages(workspace, packages))
    results.extend(audit_git_repos(workspace, repos))

    output = Path(args.output)
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote aggregated report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
