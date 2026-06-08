#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
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
SKILL_DIR = SCRIPT_DIR.parent
TRIAGE_SCRIPT = SCRIPT_DIR / "npm_ts_static_triage.py"
SUMMARIZE_SCRIPT = SCRIPT_DIR / "summarize_pi_dependency_audit.py"
DEFAULT_PACKAGES_FILE = SCRIPT_DIR / "pi-default-packages.txt"
DEFAULT_GIT_REPOS_FILE = SCRIPT_DIR / "pi-default-git-repos.txt"
REPO_CONFIG_PATH = SKILL_DIR / "config.json"
HOME_CONFIG_PATH = Path.home() / ".pi" / "dependency-audit.json"
DEFAULT_CONFIG = {
    "min_update_age_hours": 24,
}


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


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_iso_datetime(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def age_hours(since: dt.datetime | None) -> float | None:
    if since is None:
        return None
    delta = utcnow() - since
    return max(0.0, delta.total_seconds() / 3600.0)


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


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON config at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Config at {path} must be a JSON object")
    return data


def normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(raw)

    value = cfg.get("min_update_age_hours", DEFAULT_CONFIG["min_update_age_hours"])
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(DEFAULT_CONFIG["min_update_age_hours"])
    cfg["min_update_age_hours"] = max(0.0, number)
    return cfg


def load_config(config_override: str) -> tuple[dict[str, Any], list[str]]:
    merged: dict[str, Any] = {}
    sources: list[str] = []

    for path in [REPO_CONFIG_PATH, HOME_CONFIG_PATH]:
        if path.exists():
            merged.update(read_json_file(path))
            sources.append(str(path))

    if config_override:
        override_path = Path(config_override)
        merged.update(read_json_file(override_path))
        sources.append(str(override_path))

    return normalize_config(merged), sources


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


def npm_version_published_at(package: str, version: str) -> dt.datetime | None:
    result = run(["npm", "view", package, "time", "--json"], check=False)
    if result.returncode != 0:
        return None
    try:
        data = json.loads((result.stdout or "").strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get(version)
    return parse_iso_datetime(raw if isinstance(raw, str) else None)


def npm_tarball_url(package: str, version: str) -> str:
    result = run(["npm", "view", f"{package}@{version}", "dist.tarball"])
    url = result.stdout.strip()
    if not url:
        raise RuntimeError(f"No dist.tarball returned for {package}@{version}")
    return url


def scan_with_triage(target: Path, mode: str, report_json: Path, config_path: str = "") -> dict[str, Any]:
    cmd = [
        "python3",
        str(TRIAGE_SCRIPT),
        str(target),
        "--mode",
        mode,
        "--json",
        str(report_json),
    ]
    if config_path:
        cmd.extend(["--config", config_path])
    run(cmd)
    return json.loads(report_json.read_text(encoding="utf-8"))


def audit_npm_packages(workspace: Path, packages: list[str], min_age_hours: float, config_path: str = "") -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    global_root = npm_global_root()

    print(f"[npm] Checking {len(packages)} package(s)…")
    for idx, package in enumerate(packages, start=1):
        print(f"[npm {idx}/{len(packages)}] {package}")
        current = current_global_version(global_root, package)
        latest = npm_latest_version(package)

        if current is None:
            print("  - not installed")
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
            print(f"  - registry lookup failed (current={current})")
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
            print(f"  - up to date ({current})")
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

        published_at = npm_version_published_at(package, latest)
        update_age = age_hours(published_at)
        if update_age is not None and update_age < min_age_hours:
            print(f"  - too fresh: {current} -> {latest} ({update_age:.1f}h < {min_age_hours:.1f}h)")
            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "too_fresh",
                    "current": current,
                    "latest": latest,
                    "published_at": published_at.isoformat() if published_at else None,
                    "update_age_hours": round(update_age, 3) if update_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": "SKIP_TOO_FRESH",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        try:
            print(f"  - update found: {current} -> {latest}")
            tarball_url = npm_tarball_url(package, latest)
            tarball_path = workspace / f"{package.replace('/', '_')}@{latest}.tgz"
            urllib.request.urlretrieve(tarball_url, tarball_path)

            report_json = workspace / f"{package.replace('/', '_')}_{latest}_report.json"
            report_data = scan_with_triage(tarball_path, "package", report_json, config_path)
            decision = report_data.get("decision", "UNKNOWN")
            print(f"  - triage decision: {decision}")

            results.append(
                {
                    "name": package,
                    "type": "npm",
                    "status": "update_available",
                    "current": current,
                    "latest": latest,
                    "published_at": published_at.isoformat() if published_at else None,
                    "update_age_hours": round(update_age, 3) if update_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": decision,
                    "counts": report_data.get("counts_by_severity", {}),
                    "findings": report_data.get("findings", []),
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  - error: {exc}")
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


def repo_update_info(repo_path: Path) -> tuple[str, str, str, dt.datetime | None] | None:
    if not repo_path.exists() or not (repo_path / ".git").exists():
        return None

    branch = run(["git", "-C", str(repo_path), "rev-parse", "--abbrev-ref", "HEAD"], check=False).stdout.strip() or "HEAD"
    current = run(["git", "-C", str(repo_path), "rev-parse", "HEAD"], check=False).stdout.strip() or "UNKNOWN"
    run(["git", "-C", str(repo_path), "fetch", "--quiet", "origin"], check=False)

    remote = "NO_REMOTE_BRANCH"
    remote_time: dt.datetime | None = None
    if branch not in {"HEAD", "DETACHED"}:
        remote_ref = f"origin/{branch}"
        remote = run(["git", "-C", str(repo_path), "rev-parse", remote_ref], check=False).stdout.strip() or "NO_REMOTE_BRANCH"
        if remote not in {"NO_REMOTE_BRANCH", ""}:
            time_out = run(["git", "-C", str(repo_path), "show", "-s", "--format=%cI", remote_ref], check=False).stdout.strip()
            remote_time = parse_iso_datetime(time_out)
    return branch, current, remote, remote_time


def audit_git_repos(workspace: Path, repos: list[str], min_age_hours: float, config_path: str = "") -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    print(f"[git] Checking {len(repos)} repo(s)…")
    for idx, repo in enumerate(repos, start=1):
        repo_path = Path(repo).expanduser()
        print(f"[git {idx}/{len(repos)}] {repo_path}")
        info = repo_update_info(repo_path)
        if info is None:
            print("  - missing or not a git repo")
            results.append(
                {
                    "name": repo,
                    "type": "git",
                    "status": "missing_or_not_git",
                    "decision": "SKIP_MISSING",
                }
            )
            continue

        branch, current, remote, remote_time = info
        origin_url = run(["git", "-C", str(repo_path), "remote", "get-url", "origin"], check=False).stdout.strip()

        if remote in {"NO_REMOTE_BRANCH", ""}:
            print(f"  - no remote branch for {branch}")
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
            print(f"  - up to date on {branch}")
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

        remote_age = age_hours(remote_time)
        if remote_age is not None and remote_age < min_age_hours:
            print(f"  - too fresh: {current[:8]} -> {remote[:8]} ({remote_age:.1f}h < {min_age_hours:.1f}h)")
            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "too_fresh",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "published_at": remote_time.isoformat() if remote_time else None,
                    "update_age_hours": round(remote_age, 3) if remote_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": "SKIP_TOO_FRESH",
                    "counts": {},
                    "findings": [],
                }
            )
            continue

        try:
            print(f"  - update found: {current[:8]} -> {remote[:8]}")
            clone_target = workspace / f"{repo_path.name}_latest"
            if clone_target.exists():
                shutil.rmtree(clone_target)

            run(["git", "clone", "--no-checkout", origin_url, str(clone_target)])
            run(["git", "-C", str(clone_target), "checkout", "--detach", remote])

            report_json = workspace / f"{repo_path.name}_{remote[:8]}_report.json"
            report_data = scan_with_triage(clone_target, "repo", report_json, config_path)
            decision = report_data.get("decision", "UNKNOWN")
            print(f"  - triage decision: {decision}")

            results.append(
                {
                    "name": repo_path.name,
                    "type": "git",
                    "status": "update_available",
                    "branch": branch,
                    "current": current,
                    "latest": remote,
                    "published_at": remote_time.isoformat() if remote_time else None,
                    "update_age_hours": round(remote_age, 3) if remote_age is not None else None,
                    "min_update_age_hours": min_age_hours,
                    "decision": decision,
                    "counts": report_data.get("counts_by_severity", {}),
                    "findings": report_data.get("findings", []),
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  - error: {exc}")
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


def summarize_results(results: list[dict[str, Any]]) -> None:
    status_counts: dict[str, int] = {}
    decision_counts: dict[str, int] = {}
    for item in results:
        status = str(item.get("status", "unknown"))
        decision = str(item.get("decision", "UNKNOWN"))
        status_counts[status] = status_counts.get(status, 0) + 1
        decision_counts[decision] = decision_counts.get(decision, 0) + 1

    print("\nSummary by status:")
    for key in sorted(status_counts):
        print(f"  - {key}: {status_counts[key]}")

    print("Summary by decision:")
    for key in sorted(decision_counts):
        print(f"  - {key}: {decision_counts[key]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Static audit for global pi dependency updates.")
    parser.add_argument("--packages-file", default=str(DEFAULT_PACKAGES_FILE), help="Path to newline-separated npm package list")
    parser.add_argument("--repos-file", default=str(DEFAULT_GIT_REPOS_FILE), help="Path to newline-separated git repo path list")
    parser.add_argument("--workspace", default="", help="Workspace dir (default: temporary directory)")
    parser.add_argument("--output", default="/tmp/pi_audit_aggregated.json", help="Aggregated JSON output path")
    parser.add_argument("--markdown-output", default="/tmp/pi_audit_report.md", help="Markdown summary output path")
    parser.add_argument("--config", default="", help="Optional config JSON path (highest precedence)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    unset_security_env()

    if not TRIAGE_SCRIPT.exists():
        print(f"Missing triage script: {TRIAGE_SCRIPT}", file=sys.stderr)
        return 2

    config, config_sources = load_config(args.config)
    min_age_hours = float(config.get("min_update_age_hours", DEFAULT_CONFIG["min_update_age_hours"]))

    print(f"Config: min_update_age_hours={min_age_hours:.1f}")
    if config_sources:
        print("Config sources:")
        for source in config_sources:
            print(f"  - {source}")
    else:
        print("Config sources: defaults only")

    packages = read_non_comment_lines(Path(args.packages_file))
    repos = read_non_comment_lines(Path(args.repos_file))

    workspace = Path(args.workspace) if args.workspace else Path(tempfile.mkdtemp(prefix="pi-audit-"))
    workspace.mkdir(parents=True, exist_ok=True)

    print(f"Workspace: {workspace}")

    results: list[dict[str, Any]] = []
    results.extend(audit_npm_packages(workspace, packages, min_age_hours, args.config))
    results.extend(audit_git_repos(workspace, repos, min_age_hours, args.config))

    output = Path(args.output)
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote aggregated report: {output}")

    markdown_output = Path(args.markdown_output)
    if SUMMARIZE_SCRIPT.exists():
        run(["python3", str(SUMMARIZE_SCRIPT), "--input", str(output), "--output", str(markdown_output)])
        print(f"Wrote markdown report: {markdown_output}")
    else:
        print(f"Markdown summarizer not found: {SUMMARIZE_SCRIPT}", file=sys.stderr)

    summarize_results(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
