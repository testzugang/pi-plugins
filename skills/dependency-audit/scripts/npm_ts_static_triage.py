#!/usr/bin/env python3
"""
Static-first npm/TypeScript package and dependency triage.

This tool intentionally does not run npm, node, package scripts, tests, builds,
or code from the target. It inspects source trees and npm tarballs (.tgz) for
malware and quality risk indicators that are common in supply-chain attacks.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tarfile
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

SEVERITY_ORDER = {"INFO": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
SEVERITIES = tuple(SEVERITY_ORDER.keys())

LIFECYCLE_SCRIPTS = {
    "preinstall", "install", "postinstall",
    "prepublish", "prepublishOnly",
    "preprepare", "prepare", "postprepare",
    "prepack", "postpack", "publish", "postpublish",
    "dependencies",
}

INSTALL_PHASE_SCRIPTS = {
    "preinstall", "install", "postinstall", "prepublish",
    "preprepare", "prepare", "postprepare", "dependencies",
}

DEP_FIELDS = (
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "bundleDependencies",
    "bundledDependencies",
    "overrides",
    "resolutions",
)

TEXT_EXTENSIONS = {
    ".js", ".jsx", ".mjs", ".cjs",
    ".ts", ".tsx", ".mts", ".cts",
    ".json", ".jsonc", ".yaml", ".yml", ".toml",
    ".sh", ".bash", ".zsh", ".fish",
    ".ps1", ".cmd", ".bat",
    ".md", ".txt", ".env", ".npmrc", ".yarnrc", ".pnpmrc",
    ".html", ".css",
}

CODE_EXTENSIONS = {
    ".js", ".jsx", ".mjs", ".cjs",
    ".ts", ".tsx", ".mts", ".cts",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".cmd", ".bat",
}

BINARY_EXEC_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".node", ".wasm",
    ".bin", ".elf", ".msi", ".pkg", ".appimage",
}

ARCHIVE_EXTENSIONS = {".zip", ".tgz", ".tar", ".gz", ".xz", ".7z", ".rar", ".br"}

DEFAULT_SKIP_DIRS = {
    ".git", ".hg", ".svn",
    ".cache", ".turbo", ".parcel-cache", ".next", ".nuxt",
    "coverage", ".nyc_output", ".vitest", ".jest",
    ".idea", ".DS_Store",
}

NODE_MODULES_DIRS = {"node_modules"}

IOC_STRINGS = [
    "filev2.getsession.org/file",
    "getsession.org",
    "169.254.169.254/latest/meta-data/iam/security-credentials",
    "metadata.google.internal",
    "127.0.0.1:8200",
    "oven-sh/bun/releases/download/bun-v1.3.13",
    "github.com/oven-sh/bun/releases/download/bun-v1.3.13",
    "git-tanstack.com",
    "transformers.pyz",
    "tanstack_runner.js",
    "router_init.js",
    "router_runtime.js",
    "createCommitOnBranch",
    ".claude/settings.json",
    ".claude/setup.mjs",
    ".vscode/tasks.json",
    ".vscode/setup.mjs",
    "tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c",
    "@tanstack/setup",
]

SECRET_PATTERNS = [
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_\-.]{20,}"),
    re.compile(r"\bghs_[A-Za-z0-9_\-.]{20,}"),
    re.compile(r"\bnpm_[A-Za-z0-9_\-.]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bASIA[0-9A-Z]{16}\b"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"),
]

TOKEN_NAME_PATTERN = re.compile(
    r"\b(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|"
    r"GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|ACTIONS_ID_TOKEN|"
    r"ACTIONS_ID_TOKEN_REQUEST_URL|ACTIONS_ID_TOKEN_REQUEST_TOKEN|"
    r"VAULT_TOKEN|VAULT_AUTH_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|"
    r"AZURE_CLIENT_SECRET|DOCKER_CONFIG)\b"
)

NETWORK_PATTERNS = [
    (re.compile(r"\b(fetch|XMLHttpRequest)\s*\("), "browser/node fetch"),
    (re.compile(r"\b(require\(['\"]https?['\"]\)|from ['\"]https?['\"]|https?\.(request|get)\s*\()"), "node http/https API"),
    (re.compile(r"\b(axios|got|request|superagent|undici)\b"), "HTTP client library"),
    (re.compile(r"\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b", re.I), "download command"),
    (re.compile(r"https?://", re.I), "URL literal"),
]

EXEC_PATTERNS = [
    (re.compile(r"\brequire\(['\"]child_process['\"]\)|from ['\"]child_process['\"]"), "child_process import"),
    (re.compile(r"\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\("), "process execution call"),
    (re.compile(r"\b(child_process\.)?(exec|execSync|execFile|spawn|spawnSync)\s*\("), "child_process execution"),
    (re.compile(r"\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\("), "dynamic JS evaluation"),
    (re.compile(r"\bvm\.(runInNewContext|runInThisContext|runInContext|compileFunction)\s*\("), "Node vm execution"),
    (re.compile(r"\bWebAssembly\.(instantiate|compile)\s*\("), "WebAssembly runtime load"),
    (re.compile(r"\b(node|bun|deno|python|python3|bash|sh|zsh|fish|powershell|pwsh|cmd)\b", re.I), "interpreter invocation"),
]

STEALTH_PATTERNS = [
    (re.compile(r"&&\s*exit\s+1\b"), "forced failure after execution"),
    (re.compile(r"(?:>|1>)\s*/dev/null|2>&1|--silent|--quiet|-sS?\b|\bNO_COLOR\b"), "output suppression"),
    (re.compile(r"\bchmod\s+\+x\b|\bicacls\b|\bSet-ExecutionPolicy\b", re.I), "permission change"),
    (re.compile(r"\|\s*(bash|sh|zsh|powershell|pwsh|cmd)\b", re.I), "download piped to shell"),
]

SECRET_PATH_PATTERNS = [
    (re.compile(r"\.npmrc|\.yarnrc|\.pnpmrc"), "package-manager credentials file"),
    (re.compile(r"\.aws/(credentials|config)|aws/credentials"), "AWS credentials path"),
    (re.compile(r"\.config/gh/hosts\.yml|\.git-credentials|\.netrc"), "GitHub/git credentials path"),
    (re.compile(r"\.ssh/(id_rsa|id_ed25519|config|known_hosts)"), "SSH credential path"),
    (re.compile(r"\.docker/config\.json"), "Docker credential path"),
]

OBFUSCATION_PATTERNS = [
    (re.compile(r"_0x[a-fA-F0-9]{3,}"), "hex-style obfuscated identifiers"),
    (re.compile(r"\b(atob|btoa)\s*\(|Buffer\.from\s*\([^)]{0,120}['\"]base64['\"]"), "base64 decode"),
    (re.compile(r"\b(zlib|gunzipSync|inflateSync|brotliDecompressSync)\b"), "compressed payload decode"),
    (re.compile(r"\b(createDecipheriv|createCipheriv|crypto\.subtle|AES|RC4|xor)\b", re.I), "crypto/decryption layer"),
    (re.compile(r"\bString\.fromCharCode\s*\(|\bunescape\s*\("), "string decoder"),
]

IDE_AGENT_PATTERNS = [
    (re.compile(r"\.claude/(settings\.json|setup\.mjs|router_runtime\.js)"), "Claude Code/agent config path"),
    (re.compile(r"\.vscode/(tasks\.json|settings\.json|setup\.mjs|extensions\.json)"), "VS Code config path"),
    (re.compile(r"\.cursor/|\.devcontainer/"), "AI/IDE/devcontainer config path"),
]

GITHUB_API_PATTERNS = [
    (re.compile(r"createCommitOnBranch|createRef|updateRef|repos/[^\s]+/contents|git/refs", re.I), "GitHub write API"),
    (re.compile(r"graphql\s*\(|api\.github\.com/graphql", re.I), "GitHub GraphQL API"),
    (re.compile(r"octokit|@actions/github", re.I), "GitHub API client"),
]

FULL_SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
SEMVER_EXACT_RE = re.compile(r"^(?:v)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


@dataclass
class Finding:
    severity: str
    category: str
    path: str
    line: int | None
    title: str
    evidence: str
    recommendation: str
    confidence: str = "medium"
    tags: list[str] = field(default_factory=list)




def normalize_ioc(value: str) -> list[str]:
    raw = value.strip()
    if not raw or raw.startswith("#"):
        return []
    normalized = raw.replace("hxxps://", "https://").replace("hxxp://", "http://")
    normalized = normalized.replace("[.]", ".").replace("(.)", ".")
    return list(dict.fromkeys([raw, normalized]))


def load_ioc_files(paths: Iterable[Path]):
    existing = {x.lower() for x in IOC_STRINGS}
    for path in paths:
        if not path or not path.exists():
            continue
        try:
            for line in path.read_text("utf-8", errors="replace").splitlines():
                for ioc in normalize_ioc(line):
                    if ioc.lower() not in existing:
                        IOC_STRINGS.append(ioc)
                        existing.add(ioc.lower())
        except OSError:
            continue


@dataclass
class TargetSummary:
    target: str
    root: str
    mode: str
    is_tarball: bool
    started_at: str
    file_count: int = 0
    package_json_count: int = 0
    lockfile_count: int = 0
    tsconfig_count: int = 0
    workflow_count: int = 0
    total_bytes: int = 0
    sha256: str | None = None


@dataclass
class ScanReport:
    tool: str
    generated_at: str
    summaries: list[TargetSummary]
    findings: list[Finding]
    counts_by_severity: dict[str, int]
    decision: str
    strict_exit_code: int


class ScanContext:
    def __init__(self, root: Path, target_label: str, mode: str, is_tarball: bool, include_node_modules: bool, max_file_bytes: int, max_findings: int):
        self.root = root.resolve()
        self.target_label = target_label
        self.mode = mode
        self.is_tarball = is_tarball
        self.include_node_modules = include_node_modules
        self.max_file_bytes = max_file_bytes
        self.max_findings = max_findings
        self.findings: list[Finding] = []
        self._dedupe: set[tuple[str, str, str, int | None, str]] = set()
        self.lifecycle_entrypoints: set[str] = set()
        self.package_roots: set[Path] = set()
        self.summary = TargetSummary(
            target=target_label,
            root=str(self.root),
            mode=mode,
            is_tarball=is_tarball,
            started_at=_dt.datetime.now(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        )

    def rel(self, path: Path | str) -> str:
        p = Path(path)
        try:
            return p.resolve().relative_to(self.root).as_posix()
        except Exception:
            return str(path)

    def add(self, severity: str, category: str, path: Path | str, line: int | None, title: str, evidence: str, recommendation: str, confidence: str = "medium", tags: Iterable[str] = ()):  # noqa: E501
        if len(self.findings) >= self.max_findings:
            if len(self.findings) == self.max_findings:
                self.findings.append(Finding(
                    severity="INFO",
                    category="scan-limit",
                    path=".",
                    line=None,
                    title="Finding limit reached",
                    evidence=f"The scanner stopped adding findings after {self.max_findings} findings.",
                    recommendation="Increase --max-findings for a complete report or triage the highest severity findings first.",
                    confidence="high",
                    tags=["limit"],
                ))
            return
        severity = severity.upper()
        if severity not in SEVERITY_ORDER:
            severity = "INFO"
        rel_path = self.rel(path) if isinstance(path, Path) else str(path)
        evidence = mask_secrets(one_line(evidence))[:900]
        title = one_line(title)[:220]
        recommendation = one_line(recommendation)[:500]
        key = (severity, category, rel_path, line, title)
        if key in self._dedupe:
            return
        self._dedupe.add(key)
        self.findings.append(Finding(
            severity=severity,
            category=category,
            path=rel_path,
            line=line,
            title=title,
            evidence=evidence,
            recommendation=recommendation,
            confidence=confidence,
            tags=list(tags),
        ))


def one_line(value: Any) -> str:
    s = str(value).replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return re.sub(r"\s+", " ", s).strip()


def mask_secrets(text: str) -> str:
    out = text
    for pat in SECRET_PATTERNS:
        def repl(m: re.Match[str]) -> str:
            token = m.group(0)
            if len(token) <= 12:
                return "[MASKED]"
            return token[:6] + "...[MASKED]..." + token[-4:]
        out = pat.sub(repl, out)
    # Mask common assignment values while preserving variable names.
    out = re.sub(r"((?:NPM_TOKEN|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|NODE_AUTH_TOKEN)\s*[=:]\s*)['\"]?[^'\"\s]+", r"\1[MASKED]", out)
    return out


def sha256_file(path: Path, limit: int | None = None) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        remaining = limit
        while True:
            if remaining is not None:
                if remaining <= 0:
                    break
                chunk = f.read(min(1024 * 1024, remaining))
                remaining -= len(chunk)
            else:
                chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def safe_read_bytes(path: Path, max_bytes: int) -> tuple[bytes, bool]:
    size = path.stat().st_size
    with path.open("rb") as f:
        data = f.read(max_bytes)
    return data, size > max_bytes


def decode_text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def is_probably_binary(data: bytes) -> bool:
    if not data:
        return False
    if b"\x00" in data[:4096]:
        return True
    sample = data[:4096]
    nontext = sum(1 for b in sample if b < 9 or (13 < b < 32) or b > 126)
    return nontext / max(1, len(sample)) > 0.35


def line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def first_match_line(text: str, pattern: re.Pattern[str]) -> tuple[int | None, str | None]:
    m = pattern.search(text)
    if not m:
        return None, None
    line = line_for_offset(text, m.start())
    snippet = text[m.start(): min(len(text), m.end() + 180)]
    return line, one_line(snippet)


def key_line(text: str, key: str) -> int | None:
    pat = re.compile(r"[\"']" + re.escape(key) + r"[\"']\s*:")
    m = pat.search(text)
    if not m:
        return None
    return line_for_offset(text, m.start())


def should_skip_dir(path: Path, include_node_modules: bool, is_tarball: bool) -> bool:
    name = path.name
    if name in DEFAULT_SKIP_DIRS:
        return True
    if name in NODE_MODULES_DIRS and not include_node_modules and not is_tarball:
        return True
    return False


def iter_files(ctx: ScanContext) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ctx.root):
        dpath = Path(dirpath)
        dirnames[:] = [d for d in dirnames if not should_skip_dir(dpath / d, ctx.include_node_modules, ctx.is_tarball)]
        for name in filenames:
            p = dpath / name
            try:
                st = p.stat()
            except OSError:
                continue
            ctx.summary.file_count += 1
            ctx.summary.total_bytes += st.st_size
            files.append(p)
    return files


def load_json_file(path: Path) -> tuple[Any | None, str]:
    try:
        text = path.read_text("utf-8", errors="replace")
        return json.loads(text), text
    except Exception as exc:
        return None, f"JSON parse error: {exc}"


def classify_dep_spec(spec: str) -> tuple[str, str, str]:
    s = str(spec).strip()
    low = s.lower()
    if low.startswith("npm:"):
        return "alias", "MEDIUM", "npm alias can hide the actual package identity"
    if low.startswith(("git+", "git://", "github:", "gitlab:", "bitbucket:")) or "github.com" in low or "gitlab.com" in low or "bitbucket.org" in low:
        if "#" not in s:
            return "git-unpinned", "HIGH", "git dependency has no commit pin"
        frag = s.rsplit("#", 1)[-1]
        if not FULL_SHA_RE.match(frag):
            return "git-not-full-sha", "HIGH", "git dependency is not pinned to a full 40-character commit SHA"
        return "git", "HIGH", "git dependency can execute prepare scripts during install"
    if re.match(r"https?://", low):
        sev = "HIGH" if low.startswith("http://") else "MEDIUM"
        reason = "remote tarball/URL dependency bypasses normal registry trust controls"
        if low.startswith("http://"):
            reason += " and uses plaintext HTTP"
        return "url", sev, reason
    if low.startswith("file:") or low.startswith("link:"):
        return "local-file", "MEDIUM", "local file/link dependency depends on local filesystem state"
    if low.startswith("workspace:"):
        return "workspace", "INFO", "workspace dependency; inspect workspace package.json separately"
    if low in {"*", "x", "latest", "next", "canary", "beta", "alpha"}:
        return "floating", "MEDIUM", "floating dependency spec can resolve to newly published versions"
    if any(ch in s for ch in ["^", "~", "*", "x", "X", ">", "<", "|"]):
        return "range", "LOW", "version range permits dependency drift unless a lockfile is enforced"
    if SEMVER_EXACT_RE.match(s):
        return "exact", "INFO", "exact semver dependency"
    if s == "":
        return "empty", "MEDIUM", "empty dependency spec"
    return "other", "LOW", "non-standard dependency spec; review manually"


def flatten_dep_like(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, str):
                found.append((key, v))
            elif isinstance(v, dict):
                found.extend(flatten_dep_like(v, key))
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    found.extend(flatten_dep_like(item, f"{key}[{i}]"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if isinstance(item, str):
                found.append((f"{prefix}[{i}]", item))
            else:
                found.extend(flatten_dep_like(item, f"{prefix}[{i}]"))
    return found


def extract_script_entrypoints(cmd: str) -> list[str]:
    paths: list[str] = []
    # Capture common script file references without trying to fully parse a shell command.
    for m in re.finditer(r"(?:node|bun|deno|tsx?|ts-node|python3?|bash|sh|pwsh|powershell)?\s*([A-Za-z0-9_./\\-]+\.(?:mjs|cjs|js|jsx|ts|tsx|sh|ps1|cmd|bat))", cmd):
        raw = m.group(1).strip("'\"")
        if raw and not raw.startswith("http"):
            paths.append(raw.replace("\\", "/"))
    return paths


def script_risk_labels(cmd: str) -> list[str]:
    labels: list[str] = []
    for rules in (NETWORK_PATTERNS, EXEC_PATTERNS, STEALTH_PATTERNS, OBFUSCATION_PATTERNS, SECRET_PATH_PATTERNS, IDE_AGENT_PATTERNS, GITHUB_API_PATTERNS):
        for pat, label in rules:
            if pat.search(cmd):
                labels.append(label)
    if TOKEN_NAME_PATTERN.search(cmd):
        labels.append("credential environment variable")
    for ioc in IOC_STRINGS:
        if ioc.lower() in cmd.lower():
            labels.append(f"known IOC: {ioc}")
    return sorted(set(labels))


def analyze_package_json(ctx: ScanContext, path: Path):
    data, text_or_err = load_json_file(path)
    ctx.summary.package_json_count += 1
    ctx.package_roots.add(path.parent.resolve())
    if data is None:
        ctx.add("MEDIUM", "manifest", path, None, "Invalid package.json", text_or_err, "Fix JSON syntax before trusting this package.", "high", ["package-json"])
        return
    text = text_or_err
    if not isinstance(data, dict):
        ctx.add("HIGH", "manifest", path, 1, "package.json is not an object", str(type(data)), "Treat as suspicious and validate the package contents manually.", "high", ["package-json"])
        return

    name = data.get("name", "<unnamed>")
    version = data.get("version", "<no-version>")

    # Scripts and lifecycle hooks.
    scripts = data.get("scripts", {})
    if isinstance(scripts, dict):
        for script_name, cmd in scripts.items():
            if not isinstance(cmd, str):
                continue
            labels = script_risk_labels(cmd)
            line = key_line(text, script_name)
            is_lifecycle = script_name in LIFECYCLE_SCRIPTS or script_name.startswith(("pre", "post")) and script_name[3:] in scripts
            is_install_phase = script_name in INSTALL_PHASE_SCRIPTS
            for ref in extract_script_entrypoints(cmd):
                candidate = (path.parent / ref).resolve()
                try:
                    ctx.lifecycle_entrypoints.add(candidate.relative_to(ctx.root).as_posix())
                except Exception:
                    ctx.lifecycle_entrypoints.add(ref)

            if is_lifecycle:
                sev = "HIGH" if is_install_phase else "MEDIUM"
                if labels:
                    if any("known IOC" in x for x in labels) or (any("download" in x or "URL" in x or "fetch" in x for x in labels) and any("execution" in x or "interpreter" in x or "dynamic" in x for x in labels)):
                        sev = "CRITICAL"
                    else:
                        sev = max_severity(sev, "HIGH")
                ctx.add(
                    sev,
                    "npm-lifecycle-script",
                    path,
                    line,
                    f"npm lifecycle script '{script_name}' in {name}@{version}",
                    f"{script_name}: {cmd}; signals={', '.join(labels) if labels else 'none'}",
                    "Do not install with scripts enabled. Review the referenced files and require a documented, minimal, reproducible reason for this lifecycle hook.",
                    "high" if is_install_phase else "medium",
                    ["npm", "script", script_name, "install-phase" if is_install_phase else "lifecycle"],
                )
            elif labels:
                sev = "MEDIUM"
                if any("download piped" in x for x in labels) or (any("download" in x or "URL" in x for x in labels) and any("dynamic" in x or "execution" in x for x in labels)):
                    sev = "HIGH"
                ctx.add(
                    sev,
                    "npm-script",
                    path,
                    line,
                    f"Risky npm script '{script_name}' in {name}@{version}",
                    f"{script_name}: {cmd}; signals={', '.join(labels)}",
                    "Review before running npm scripts. Prefer explicit allowlisted scripts in CI and never run these with developer or publish tokens present.",
                    "medium",
                    ["npm", "script", script_name],
                )
    elif scripts is not None:
        ctx.add("MEDIUM", "manifest", path, key_line(text, "scripts"), "scripts field is not an object", str(scripts), "Normalize package.json and review manually.", "medium", ["package-json", "scripts"])

    # Dependencies and unusual spec types.
    for field_name in DEP_FIELDS:
        value = data.get(field_name)
        if value is None:
            continue
        line = key_line(text, field_name)
        if field_name in {"bundleDependencies", "bundledDependencies"}:
            if value is True:
                ctx.add("HIGH", "dependency", path, line, f"{field_name}=true bundles all dependencies", f"{field_name}: true", "Avoid bundled dependencies unless every bundled artifact is audited; inspect packed tarball contents.", "medium", ["npm", "bundled-deps"])
            elif isinstance(value, list) and value:
                ctx.add("MEDIUM", "dependency", path, line, f"Package bundles dependencies", f"{field_name}: {value[:10]}", "Audit bundled packages inside the tarball; bundled code bypasses normal dependency review visibility.", "medium", ["npm", "bundled-deps"])
            continue
        if field_name == "peerDependenciesMeta":
            continue
        if not isinstance(value, dict):
            continue
        for dep_name, spec in flatten_dep_like(value):
            if not isinstance(spec, str):
                continue
            kind, sev, reason = classify_dep_spec(spec)
            tags = ["npm", "dependency", field_name, kind]
            if field_name == "optionalDependencies" and kind in {"git", "git-unpinned", "git-not-full-sha", "url", "local-file", "alias"}:
                sev = max_severity(sev, "HIGH")
                reason += "; optionalDependencies are easy to overlook and install failures may be ignored"
            if field_name in {"overrides", "resolutions"} and kind not in {"exact", "range", "workspace"}:
                sev = max_severity(sev, "HIGH")
                reason += "; override/resolution can redirect a transitive package"
            elif field_name in {"overrides", "resolutions"}:
                sev = max_severity(sev, "MEDIUM")
            if kind in {"exact", "workspace"}:
                continue
            if kind == "range" and ctx.mode == "library":
                sev = "INFO"
            dep_line = key_line(text, dep_name.split(".")[-1]) or line
            ctx.add(
                sev,
                "dependency-spec",
                path,
                dep_line,
                f"Dependency spec review needed: {field_name}.{dep_name}",
                f"{dep_name}: {spec}; {reason}",
                "Prefer registry packages pinned by lockfile and integrity. Avoid git/URL/file specs unless explicitly allowlisted and pinned to immutable commits/artifacts.",
                "medium",
                tags,
            )
            if any(ioc.lower() in f"{dep_name} {spec}".lower() for ioc in IOC_STRINGS):
                ctx.add(
                    "CRITICAL",
                    "ioc",
                    path,
                    dep_line,
                    "Known supply-chain campaign IOC in dependency spec",
                    f"{field_name}.{dep_name}: {spec}",
                    "Quarantine this dependency/package, rotate any exposed credentials, and verify package versions against trusted upstream advisories.",
                    "high",
                    ["ioc", "npm", "dependency"],
                )

    # npm package metadata quality/security.
    if data.get("private") is not True and ctx.mode in {"application", "repo"} and path.parent == ctx.root:
        # For applications, accidental publish is a real quality/security issue.
        ctx.add("LOW", "quality", path, key_line(text, "private"), "Root project is not marked private", f"name={name}, version={version}", "For non-published applications, set private=true to prevent accidental npm publication.", "medium", ["npm", "quality"])

    if "license" not in data:
        ctx.add("LOW", "quality", path, None, "Missing license field", f"{name}@{version} has no license field", "Add an SPDX license expression or UNLICENSED for private packages.", "medium", ["npm", "quality"])
    if "repository" not in data:
        ctx.add("LOW", "quality", path, None, "Missing repository metadata", f"{name}@{version} has no repository field", "Add repository metadata so consumers can verify provenance and source.", "medium", ["npm", "quality"])
    if "engines" not in data:
        ctx.add("LOW", "quality", path, None, "Missing engines.node constraint", f"{name}@{version} has no engines field", "Declare supported Node.js versions to reduce ambiguous runtime behavior.", "low", ["node", "quality"])

    has_ts_files = any(path.parent.rglob("*.ts")) or any(path.parent.rglob("*.tsx"))
    if has_ts_files and not any(k in data for k in ("types", "typings")) and not (path.parent / "index.d.ts").exists():
        ctx.add("LOW", "quality", path, None, "TypeScript package lacks types metadata", f"{name}@{version} has TS files but no types/typings field", "Publish declaration files and declare the types entrypoint for consumers.", "low", ["typescript", "quality"])

    for entry_field in ("main", "module", "types", "typings"):
        val = data.get(entry_field)
        if isinstance(val, str) and val and not val.startswith(("http://", "https://")):
            if not (path.parent / val).exists():
                ctx.add("LOW", "quality", path, key_line(text, entry_field), f"Declared {entry_field} file is missing", f"{entry_field}: {val}", "Ensure package metadata points to files present in the repo/tarball.", "medium", ["npm", "entrypoint"])

    bin_field = data.get("bin")
    if isinstance(bin_field, str):
        check_bin_entry(ctx, path, name, bin_field, text)
    elif isinstance(bin_field, dict):
        for bin_name, bin_path in bin_field.items():
            if isinstance(bin_path, str):
                check_bin_entry(ctx, path, str(bin_name), bin_path, text)

    # Workspaces: make sure nested packages are scanned.
    workspaces = data.get("workspaces")
    if workspaces:
        ctx.add("INFO", "workspace", path, key_line(text, "workspaces"), "npm workspaces detected", one_line(workspaces), "Scan all workspace package.json files and compare dependency changes per workspace.", "high", ["npm", "workspace"])

    # Lockfile expectations.
    direct_dep_count = 0
    for dep_field in ("dependencies", "devDependencies", "optionalDependencies"):
        if isinstance(data.get(dep_field), dict):
            direct_dep_count += len(data[dep_field])
    if direct_dep_count and path.parent == ctx.root:
        lockfiles = [path.parent / "package-lock.json", path.parent / "npm-shrinkwrap.json", path.parent / "pnpm-lock.yaml", path.parent / "yarn.lock"]
        if not any(p.exists() for p in lockfiles) and ctx.mode in {"application", "repo"}:
            ctx.add("MEDIUM", "lockfile", path, None, "Root project has dependencies but no lockfile", f"{direct_dep_count} direct dependencies", "Use a committed lockfile for applications and CI to avoid surprise transitive updates.", "medium", ["npm", "lockfile"])


def check_bin_entry(ctx: ScanContext, package_json: Path, bin_name: str, bin_path: str, manifest_text: str):
    p = (package_json.parent / bin_path).resolve()
    line = key_line(manifest_text, "bin")
    try:
        rel = p.relative_to(ctx.root).as_posix()
        ctx.lifecycle_entrypoints.add(rel)
    except Exception:
        pass
    if not p.exists():
        ctx.add("MEDIUM", "bin-entrypoint", package_json, line, "bin entrypoint file is missing", f"{bin_name}: {bin_path}", "Verify the package tarball/source tree is complete and not relying on generated files from install scripts.", "medium", ["npm", "bin"])
        return
    try:
        first = p.read_bytes()[:80]
    except Exception:
        return
    if p.suffix in {".js", ".mjs", ".cjs"} and not first.startswith(b"#!"):
        ctx.add("LOW", "quality", p, 1, "CLI bin entrypoint has no shebang", f"bin {bin_name} -> {bin_path}", "Add a Node.js shebang if the file is intended as an executable CLI.", "low", ["npm", "bin", "quality"])


def max_severity(a: str, b: str) -> str:
    return a if SEVERITY_ORDER.get(a, 0) >= SEVERITY_ORDER.get(b, 0) else b


def analyze_npmrc(ctx: ScanContext, path: Path):
    data, truncated = safe_read_bytes(path, min(ctx.max_file_bytes, 1024 * 1024))
    text = decode_text(data)
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith(";"):
            continue
        low = stripped.lower()
        if "_authtoken" in low or re.search(r"\b_auth\s*=", low):
            ctx.add("CRITICAL", "npmrc", path, i, "npm authentication token in .npmrc", stripped, "Remove tokens from repository/package. Rotate the token immediately if it was committed or shipped.", "high", ["secret", "npmrc"])
        if low.startswith("ignore-scripts=false"):
            ctx.add("HIGH", "npmrc", path, i, "ignore-scripts is explicitly disabled", stripped, "Set ignore-scripts=true by default and run any required scripts only after manual approval.", "high", ["npmrc", "scripts"])
        if low.startswith("strict-ssl=false"):
            ctx.add("HIGH", "npmrc", path, i, "strict-ssl is disabled", stripped, "Require TLS validation for registry traffic.", "high", ["npmrc", "tls"])
        if low.startswith("audit=false"):
            ctx.add("MEDIUM", "npmrc", path, i, "npm audit disabled", stripped, "Enable audit in CI unless a documented alternative vulnerability scanner is enforced.", "medium", ["npmrc", "audit"])
        if low.startswith("registry=http://") or re.match(r"@[^:]+:registry=http://", low):
            ctx.add("HIGH", "npmrc", path, i, "Plain HTTP npm registry configured", stripped, "Use HTTPS registry URLs only.", "high", ["npmrc", "registry"])
        if low.startswith("unsafe-perm=true"):
            ctx.add("MEDIUM", "npmrc", path, i, "unsafe-perm enabled", stripped, "Avoid elevated script execution privileges; use least-privilege build users.", "medium", ["npmrc", "scripts"])
        if low.startswith(("allow-git=all", "allow-remote=all", "allow-file=all", "allow-directory=all")):
            ctx.add("MEDIUM", "npmrc", path, i, "npm allows non-registry dependency sources", stripped, "Prefer allow-git=none, allow-remote=none and allow-file=none unless specifically required.", "medium", ["npmrc", "dependency-source"])


def analyze_package_lock(ctx: ScanContext, path: Path):
    data, text_or_err = load_json_file(path)
    ctx.summary.lockfile_count += 1
    if data is None:
        ctx.add("MEDIUM", "lockfile", path, None, "Invalid npm lockfile JSON", text_or_err, "Regenerate lockfile from a trusted environment and review the diff.", "medium", ["npm", "lockfile"])
        return
    text = text_or_err
    lockfile_version = data.get("lockfileVersion") if isinstance(data, dict) else None
    ctx.add("INFO", "lockfile", path, key_line(text, "lockfileVersion"), "npm lockfile detected", f"lockfileVersion={lockfile_version}", "Use this lockfile for dependency diff review; do not update it implicitly during audit.", "high", ["npm", "lockfile"])

    packages = data.get("packages", {}) if isinstance(data, dict) else {}
    if isinstance(packages, dict):
        for loc, meta in packages.items():
            if not isinstance(meta, dict):
                continue
            loc_str = loc or "."
            pseudo_path = f"{ctx.rel(path)}:{loc_str}"
            resolved = str(meta.get("resolved", ""))
            integrity = meta.get("integrity")
            optional = bool(meta.get("optional"))
            dev = bool(meta.get("dev"))
            in_bundle = bool(meta.get("inBundle") or meta.get("bundled"))
            if meta.get("hasInstallScript"):
                sev = "HIGH" if not dev else "MEDIUM"
                if optional:
                    sev = max_severity(sev, "HIGH")
                ctx.add(sev, "lockfile-install-script", pseudo_path, None, "Dependency has install/lifecycle script", f"{loc_str}; optional={optional}; dev={dev}; resolved={resolved}", "Inspect this package tarball before installing with scripts enabled. Prefer --ignore-scripts and allowlist required native build packages.", "high", ["npm", "lockfile", "install-script"])
            if resolved:
                analyze_resolved_url(ctx, path, pseudo_path, resolved, integrity, optional, dev)
            if resolved and not integrity and not resolved.startswith(("file:", "link:")) and loc_str != ".":
                ctx.add("MEDIUM", "lockfile-integrity", pseudo_path, None, "Lockfile entry lacks integrity", f"{loc_str}; resolved={resolved}", "Require Subresource Integrity for registry tarballs; regenerate lockfile from a trusted registry if missing.", "medium", ["npm", "lockfile", "integrity"])
            if in_bundle:
                ctx.add("MEDIUM", "bundled-dependency", pseudo_path, None, "Bundled dependency in lockfile", f"{loc_str}; resolved={resolved}", "Review bundled code inside the package tarball; bundled code is less visible in normal dependency review.", "medium", ["npm", "bundle"])
            joined = f"{loc_str} {resolved} {json.dumps(meta, sort_keys=True)[:500]}"
            if any(ioc.lower() in joined.lower() for ioc in IOC_STRINGS):
                ctx.add("CRITICAL", "ioc", pseudo_path, None, "Known supply-chain IOC in lockfile", joined[:500], "Quarantine dependency tree, verify affected package versions, and rotate potentially exposed credentials.", "high", ["ioc", "npm", "lockfile"])

    deps = data.get("dependencies", {}) if isinstance(data, dict) else {}
    if isinstance(deps, dict):
        walk_lock_deps(ctx, path, deps, prefix="dependencies")


def walk_lock_deps(ctx: ScanContext, path: Path, deps: dict[str, Any], prefix: str):
    for name, meta in deps.items():
        if not isinstance(meta, dict):
            continue
        pseudo_path = f"{ctx.rel(path)}:{prefix}.{name}"
        resolved = str(meta.get("resolved", ""))
        integrity = meta.get("integrity")
        optional = bool(meta.get("optional"))
        dev = bool(meta.get("dev"))
        if resolved:
            analyze_resolved_url(ctx, path, pseudo_path, resolved, integrity, optional, dev)
        if resolved and not integrity and not resolved.startswith(("file:", "link:")):
            ctx.add("MEDIUM", "lockfile-integrity", pseudo_path, None, "Legacy lockfile entry lacks integrity", f"{name}; resolved={resolved}", "Require integrity-pinned lockfiles for registry tarballs.", "medium", ["npm", "lockfile", "integrity"])
        if any(ioc.lower() in f"{name} {resolved}".lower() for ioc in IOC_STRINGS):
            ctx.add("CRITICAL", "ioc", pseudo_path, None, "Known supply-chain IOC in legacy lock dependency", f"{name}; resolved={resolved}", "Quarantine dependency tree and validate affected versions.", "high", ["ioc", "npm", "lockfile"])
        nested = meta.get("dependencies")
        if isinstance(nested, dict):
            walk_lock_deps(ctx, path, nested, f"{prefix}.{name}.dependencies")


def analyze_resolved_url(ctx: ScanContext, path: Path, pseudo_path: str, resolved: str, integrity: Any, optional: bool, dev: bool):
    low = resolved.lower()
    sev = "INFO"
    reason = ""
    if low.startswith("git+") or "github.com" in low or low.startswith("github:"):
        sev = "HIGH"
        reason = "git/GitHub dependency source can run prepare scripts and bypass registry tarball review"
    elif low.startswith("http://"):
        sev = "HIGH"
        reason = "plaintext HTTP tarball source"
    elif low.startswith("https://") and "registry.npmjs.org" not in low and "registry.npmjs.com" not in low:
        sev = "MEDIUM"
        reason = "non-default remote tarball source"
    elif low.startswith(("file:", "link:")):
        sev = "MEDIUM"
        reason = "local file/link source depends on local filesystem state"
    if optional and sev != "INFO":
        sev = max_severity(sev, "HIGH")
        reason += "; optional dependency source is easy to overlook"
    if sev != "INFO":
        ctx.add(sev, "lockfile-source", pseudo_path, None, "Non-standard dependency source in lockfile", f"resolved={resolved}; integrity={bool(integrity)}; optional={optional}; dev={dev}; {reason}", "Review and allowlist this source explicitly, or replace it with a registry package pinned by integrity.", "medium", ["npm", "lockfile", "source"])


def analyze_text_lockfile(ctx: ScanContext, path: Path):
    ctx.summary.lockfile_count += 1
    data, truncated = safe_read_bytes(path, ctx.max_file_bytes)
    text = decode_text(data)
    lines = text.splitlines()
    for i, line in enumerate(lines, 1):
        low = line.lower()
        if any(x in low for x in ("git+", "github:", "gitlab:", "bitbucket:", "github.com")):
            ctx.add("HIGH", "lockfile-source", path, i, "Git dependency in text lockfile", line, "Review git dependencies manually and require immutable full-SHA pins; avoid scripts during install.", "medium", ["npm", "lockfile", "git"])
        elif "http://" in low:
            ctx.add("HIGH", "lockfile-source", path, i, "Plain HTTP source in lockfile", line, "Use HTTPS and integrity-pinned registry artifacts only.", "high", ["npm", "lockfile", "http"])
        elif "https://" in low and "registry.npmjs.org" not in low and "registry.yarnpkg.com" not in low:
            ctx.add("MEDIUM", "lockfile-source", path, i, "Non-default URL source in lockfile", line, "Review and allowlist non-default registries/tarball sources.", "medium", ["npm", "lockfile", "url"])
        if "requiresbuild: true" in low or "requiresbuild=true" in low:
            ctx.add("MEDIUM", "lockfile-install-script", path, i, "Dependency requires build/install scripts", line, "Identify package, inspect tarball, and install with scripts disabled unless allowlisted.", "medium", ["npm", "pnpm", "install-script"])
        if any(ioc.lower() in low for ioc in IOC_STRINGS):
            ctx.add("CRITICAL", "ioc", path, i, "Known supply-chain IOC in lockfile", line, "Quarantine dependency tree and verify affected versions.", "high", ["ioc", "npm", "lockfile"])
    if truncated:
        ctx.add("INFO", "scan-limit", path, None, "Lockfile scan truncated", f"Scanned first {ctx.max_file_bytes} bytes", "Increase --max-file-bytes if suspicious entries may be later in the file.", "medium", ["limit"])


def analyze_tsconfig(ctx: ScanContext, path: Path):
    data, text_or_err = load_json_file(path)
    ctx.summary.tsconfig_count += 1
    if data is None:
        # tsconfig often has JSONC; do a lightweight text pass.
        text = path.read_text("utf-8", errors="replace")[:ctx.max_file_bytes]
        if re.search(r"\"strict\"\s*:\s*false", text):
            line, ev = first_match_line(text, re.compile(r"\"strict\"\s*:\s*false"))
            ctx.add("LOW", "typescript-quality", path, line, "TypeScript strict mode disabled", ev or "strict=false", "Enable strict mode or document why the package cannot use it.", "medium", ["typescript", "quality"])
        return
    if not isinstance(data, dict):
        return
    opts = data.get("compilerOptions", {})
    if isinstance(opts, dict):
        for opt in ("strict", "noImplicitAny", "strictNullChecks", "noUncheckedIndexedAccess"):
            if opts.get(opt) is False:
                ctx.add("LOW", "typescript-quality", path, key_line(text_or_err, opt), f"TypeScript compiler option {opt}=false", f"{opt}=false", "Tighten TypeScript compiler checks for library-quality code.", "medium", ["typescript", "quality"])
        if opts.get("allowJs") is True:
            ctx.add("LOW", "typescript-quality", path, key_line(text_or_err, "allowJs"), "allowJs enabled", "allowJs=true", "Ensure JavaScript sources are covered by linting and malware scan; mixed JS/TS increases review surface.", "low", ["typescript", "quality"])
        if opts.get("declaration") is not True and ctx.mode in {"package", "library"}:
            ctx.add("LOW", "typescript-quality", path, key_line(text_or_err, "declaration"), "Declaration output not enabled", "compilerOptions.declaration is not true", "Published TypeScript packages should produce .d.ts declaration files or document generated types.", "low", ["typescript", "quality"])


def analyze_workflow(ctx: ScanContext, path: Path):
    ctx.summary.workflow_count += 1
    data, truncated = safe_read_bytes(path, ctx.max_file_bytes)
    text = decode_text(data)
    low = text.lower()
    if re.search(r"^\s*pull_request_target\s*:", text, flags=re.M):
        sev = "HIGH" if re.search(r"uses:\s*actions/checkout|run:\s*(npm|pnpm|yarn|bun|node|bash|sh)", text, flags=re.I) else "MEDIUM"
        ctx.add(sev, "github-actions", path, None, "Workflow uses pull_request_target", "pull_request_target with checkout/run risk if untrusted PR code is executed", "Do not checkout or execute untrusted PR code in pull_request_target workflows; use read-only permissions and explicit validation.", "high", ["github-actions", "pr"])
    if re.search(r"^\s*workflow_run\s*:", text, flags=re.M):
        ctx.add("MEDIUM", "github-actions", path, None, "Workflow triggered by workflow_run", "workflow_run can bridge artifacts and trust boundaries", "Verify artifacts are trusted before execution and keep token permissions minimal.", "medium", ["github-actions"])
    if "permissions: write-all" in low:
        ctx.add("HIGH", "github-actions-permissions", path, None, "Workflow grants write-all permissions", "permissions: write-all", "Use permissions: {} by default and grant only minimal scopes per job.", "high", ["github-actions", "permissions"])
    for perm in ("contents: write", "packages: write", "actions: write", "id-token: write", "pull-requests: write"):
        if perm in low:
            ctx.add("MEDIUM", "github-actions-permissions", path, None, f"Workflow grants {perm}", perm, "Verify this permission is required and isolated to trusted branches/environments.", "medium", ["github-actions", "permissions"])
    # Unpinned actions.
    for m in re.finditer(r"uses:\s*([^\s#]+)", text):
        ref = m.group(1).strip().strip("'\"")
        line = line_for_offset(text, m.start())
        if ref.startswith("./") or ref.startswith("docker://"):
            continue
        if "@" not in ref:
            ctx.add("MEDIUM", "github-actions-pinning", path, line, "GitHub Action without explicit ref", ref, "Pin third-party actions to full-length commit SHAs and maintain them with Dependabot/Renovate.", "medium", ["github-actions", "pinning"])
            continue
        action_ref = ref.rsplit("@", 1)[-1]
        if not FULL_SHA_RE.match(action_ref):
            ctx.add("MEDIUM", "github-actions-pinning", path, line, "GitHub Action not pinned to full commit SHA", ref, "Pin third-party actions to full-length commit SHAs to make workflow dependencies immutable.", "medium", ["github-actions", "pinning"])
    # Install commands without script suppression.
    for m in re.finditer(r"run:\s*(.+)", text):
        cmd = m.group(1).strip()
        if re.search(r"\b(npm\s+(install|i|ci)|pnpm\s+install|yarn\s+install|bun\s+install)\b", cmd) and "ignore-scripts" not in cmd:
            ctx.add("HIGH", "github-actions-install", path, line_for_offset(text, m.start()), "CI install command does not disable lifecycle scripts", cmd, "For dependency-review jobs, use --ignore-scripts and omit optional dependencies before any build/test step.", "medium", ["github-actions", "npm", "install-scripts"])
        if re.search(r"\bnpm\s+publish\b", cmd) and re.search(r"(NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.)", text):
            ctx.add("HIGH", "github-actions-publish", path, line_for_offset(text, m.start()), "npm publish workflow uses registry token", cmd, "Ensure publish only runs from protected tags/branches with trusted source and minimal token scope; consider trusted publishing/OIDC.", "medium", ["github-actions", "npm", "publish"])
    if truncated:
        ctx.add("INFO", "scan-limit", path, None, "Workflow scan truncated", f"Scanned first {ctx.max_file_bytes} bytes", "Increase --max-file-bytes for complete workflow review.", "medium", ["limit"])


def analyze_json_config(ctx: ScanContext, path: Path):
    # Focus on IDE/agent execution configs that may run commands after clone/open.
    rel = ctx.rel(path)
    data, text_or_err = load_json_file(path)
    text = text_or_err if data is not None else path.read_text("utf-8", errors="replace")[:ctx.max_file_bytes]
    interesting = any(part in rel for part in [".vscode/", ".claude/", ".cursor/", ".devcontainer/"])
    if not interesting:
        return
    labels = script_risk_labels(text)
    if "tasks.json" in rel or "settings.json" in rel or ".claude/" in rel:
        sev = "HIGH" if labels else "MEDIUM"
        if any("known IOC" in x for x in labels) or (any("download" in x or "URL" in x for x in labels) and any("execution" in x or "interpreter" in x for x in labels)):
            sev = "CRITICAL"
        ctx.add(sev, "ide-agent-config", path, None, "IDE/AI-agent execution configuration present", f"signals={', '.join(labels) if labels else 'manual review required'}", "Do not auto-run IDE tasks or AI-agent hooks from untrusted repos/packages. Review and remove unexpected commands.", "medium", ["ide", "agent", "persistence"])


def entropy(s: str) -> float:
    if not s:
        return 0.0
    counts: dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())


def scan_source_file(ctx: ScanContext, path: Path):
    try:
        st = path.stat()
    except OSError:
        return
    ext = path.suffix.lower()
    rel = ctx.rel(path)
    is_lifecycle_ref = rel in ctx.lifecycle_entrypoints or path.name.lower() in {"setup.mjs", "setup.js", "install.js", "postinstall.js", "preinstall.js", "prepare.js"}

    if ext in BINARY_EXEC_EXTENSIONS:
        sev = "HIGH" if ctx.is_tarball or is_lifecycle_ref else "MEDIUM"
        ctx.add(sev, "binary-artifact", path, None, "Native/binary artifact present", f"{path.name}; size={st.st_size}; sha256={sha256_file(path, limit=min(st.st_size, 50 * 1024 * 1024))}", "Verify binary provenance, rebuildability and platform necessity. Avoid binaries downloaded or executed by install scripts.", "medium", ["binary", "npm-package"])
        return
    if ext in ARCHIVE_EXTENSIONS and path.name != Path(ctx.target_label).name:
        ctx.add("MEDIUM", "embedded-archive", path, None, "Embedded archive present", f"{path.name}; size={st.st_size}; sha256={sha256_file(path, limit=min(st.st_size, 50 * 1024 * 1024))}", "Extract and scan embedded archives only in a safe offline sandbox; verify why they are shipped.", "medium", ["archive", "payload"])
        return

    if ext not in TEXT_EXTENSIONS and path.name not in {"Makefile", "Dockerfile", ".npmrc", ".yarnrc", ".pnpmrc"}:
        return

    try:
        data, truncated = safe_read_bytes(path, ctx.max_file_bytes)
    except OSError:
        return
    if is_probably_binary(data):
        if ext in CODE_EXTENSIONS:
            ctx.add("HIGH", "obfuscation", path, None, "Code file appears binary or packed", f"{path.name}; size={st.st_size}", "Treat as suspicious until unpacked or explained by a reproducible build process.", "medium", ["packed", "obfuscation"])
        return

    text = decode_text(data)
    lower_text = text.lower()

    # Known IOCs first.
    for ioc in IOC_STRINGS:
        if ioc.lower() in lower_text:
            line = lower_text.find(ioc.lower())
            ctx.add("CRITICAL", "ioc", path, line_for_offset(lower_text, line) if line >= 0 else None, "Known supply-chain campaign IOC found", ioc, "Quarantine the package/repo, verify affected versions from advisories, and rotate potentially exposed credentials.", "high", ["ioc", "npm", "malware"])

    # Secret literals should never be in packages; mask output.
    for pat in SECRET_PATTERNS:
        m = pat.search(text)
        if m:
            ctx.add("CRITICAL", "secret", path, line_for_offset(text, m.start()), "Possible live secret/token committed or shipped", m.group(0), "Remove the secret and rotate it immediately. Treat package as compromised if token was published.", "high", ["secret"])
            break

    network_hits = collect_hits(text, NETWORK_PATTERNS)
    exec_hits = collect_hits(text, EXEC_PATTERNS)
    stealth_hits = collect_hits(text, STEALTH_PATTERNS)
    secret_path_hits = collect_hits(text, SECRET_PATH_PATTERNS)
    obf_hits = collect_hits(text, OBFUSCATION_PATTERNS)
    ide_hits = collect_hits(text, IDE_AGENT_PATTERNS)
    gh_hits = collect_hits(text, GITHUB_API_PATTERNS)
    token_name_hit = TOKEN_NAME_PATTERN.search(text)

    if network_hits and exec_hits:
        line = min([h[0] for h in network_hits + exec_hits if h[0] is not None] or [None])
        ctx.add("CRITICAL", "payload-behavior", path, line, "Network plus code/process execution behavior", f"network={labels_only(network_hits)}; execution={labels_only(exec_hits)}", "Do not execute. Manually trace data flow and verify there is no downloader/dropper/exfiltration path.", "medium", ["network", "exec", "malware-pattern"])
    elif exec_hits and is_lifecycle_ref:
        ctx.add("HIGH", "payload-behavior", path, exec_hits[0][0], "Lifecycle-referenced file can execute commands/code", f"execution={labels_only(exec_hits)}", "Review lifecycle entrypoint manually. Avoid install scripts unless required and allowlisted.", "medium", ["exec", "lifecycle"])
    elif network_hits and is_lifecycle_ref:
        ctx.add("HIGH", "payload-behavior", path, network_hits[0][0], "Lifecycle-referenced file performs network access", f"network={labels_only(network_hits)}", "Install scripts should not download code/binaries without transparent integrity checks and provenance.", "medium", ["network", "lifecycle"])

    if (secret_path_hits or token_name_hit) and (network_hits or exec_hits or gh_hits):
        labels = labels_only(secret_path_hits)
        if token_name_hit:
            labels.append("credential environment variable")
        ctx.add("CRITICAL", "credential-access", path, token_name_hit and line_for_offset(text, token_name_hit.start()) or (secret_path_hits[0][0] if secret_path_hits else None), "Credential access combined with network/execution", f"credentials={labels}; network={labels_only(network_hits)}; execution={labels_only(exec_hits)}; github_api={labels_only(gh_hits)}", "Assume credential theft is possible. Do not run; inspect for exfiltration and rotate any credentials exposed to this code.", "medium", ["credential", "exfiltration"])
    elif secret_path_hits or token_name_hit:
        labels = labels_only(secret_path_hits)
        if token_name_hit:
            labels.append("credential environment variable")
        ctx.add("MEDIUM", "credential-access", path, token_name_hit and line_for_offset(text, token_name_hit.start()) or (secret_path_hits[0][0] if secret_path_hits else None), "Credential-related names or paths referenced", f"credentials={labels}", "Verify this is legitimate configuration handling and not token harvesting.", "medium", ["credential"])

    if ide_hits and (network_hits or exec_hits or gh_hits):
        ctx.add("CRITICAL", "ide-agent-persistence", path, ide_hits[0][0], "IDE/AI-agent config path combined with execution/network/GitHub write behavior", f"ide={labels_only(ide_hits)}; exec={labels_only(exec_hits)}; network={labels_only(network_hits)}; github_api={labels_only(gh_hits)}", "Treat as potential repo-poisoning/persistence. Remove configs and audit GitHub token exposure.", "medium", ["ide", "agent", "persistence"])
    elif ide_hits:
        ctx.add("HIGH", "ide-agent-config", path, ide_hits[0][0], "IDE/AI-agent configuration path referenced", f"ide={labels_only(ide_hits)}", "Review whether the package/repo writes or ships IDE/agent configs unexpectedly.", "medium", ["ide", "agent"])

    if gh_hits and token_name_hit:
        ctx.add("HIGH", "github-api", path, gh_hits[0][0], "GitHub API usage with token-related code", f"github_api={labels_only(gh_hits)}", "Ensure GitHub token use is limited to documented operations and cannot modify repo config or workflows unexpectedly.", "medium", ["github", "token"])

    if stealth_hits and (is_lifecycle_ref or network_hits or exec_hits):
        ctx.add("HIGH", "stealth", path, stealth_hits[0][0], "Stealthy script behavior", f"stealth={labels_only(stealth_hits)}", "Review why output is suppressed, permissions changed, or failures forced after execution.", "medium", ["stealth"])

    # Obfuscation heuristics.
    lines = text.splitlines()
    max_line_len = max((len(line) for line in lines), default=0)
    long_lines = [i + 1 for i, line in enumerate(lines) if len(line) > 2000]
    huge_single_line = st.st_size > 500_000 and len(lines) <= 3
    hex_id_count = len(re.findall(r"_0x[a-fA-F0-9]{3,}", text[:ctx.max_file_bytes]))
    base64_like = re.findall(r"['\"]([A-Za-z0-9+/]{160,}={0,2})['\"]", text[:ctx.max_file_bytes])
    high_entropy_strings = [s for s in base64_like[:10] if entropy(s) > 4.5]
    if obf_hits or long_lines or huge_single_line or hex_id_count > 20 or high_entropy_strings:
        sev = "HIGH" if (network_hits or exec_hits or is_lifecycle_ref or huge_single_line) else "MEDIUM"
        if huge_single_line and (network_hits or exec_hits or is_lifecycle_ref):
            sev = "CRITICAL"
        ctx.add(sev, "obfuscation", path, obf_hits[0][0] if obf_hits else (long_lines[0] if long_lines else 1), "Obfuscation or packed payload indicators", f"obf={labels_only(obf_hits)}; max_line_len={max_line_len}; huge_single_line={huge_single_line}; hex_ids={hex_id_count}; high_entropy_strings={len(high_entropy_strings)}; truncated={truncated}", "Demand unobfuscated source, reproducible build provenance, and manual reverse engineering before use.", "medium", ["obfuscation", "packed"])

    if truncated:
        ctx.add("INFO", "scan-limit", path, None, "File scan truncated", f"size={st.st_size}; scanned_first_bytes={ctx.max_file_bytes}", "Increase --max-file-bytes for full-file scanning if this file is relevant.", "medium", ["limit"])


def collect_hits(text: str, patterns: list[tuple[re.Pattern[str], str]]) -> list[tuple[int | None, str, str]]:
    hits: list[tuple[int | None, str, str]] = []
    for pat, label in patterns:
        m = pat.search(text)
        if m:
            hits.append((line_for_offset(text, m.start()), label, one_line(m.group(0))[:120]))
    return hits


def labels_only(hits: list[tuple[int | None, str, str]]) -> list[str]:
    return sorted(set(h[1] for h in hits))


def analyze_package_artifact_hygiene(ctx: ScanContext, files: list[Path]):
    # For npm tarballs, unexpected config files are especially risky.
    for p in files:
        rel = ctx.rel(p)
        if rel.startswith("package/"):
            inside = rel[len("package/"):]
        else:
            inside = rel
        if inside in {".vscode/tasks.json", ".vscode/settings.json", ".claude/settings.json", ".cursor/rules", ".npmrc"} or inside.startswith((".claude/", ".cursor/", ".vscode/")):
            sev = "HIGH"
            if ctx.is_tarball:
                sev = "CRITICAL" if inside.startswith((".claude/", ".vscode/")) else "HIGH"
            ctx.add(sev, "package-artifact", p, None, "Sensitive IDE/agent/npm config present in package/repo contents", inside, "Remove unexpected config/persistence files from npm package or repo contents and audit how they were introduced.", "medium", ["npm-package", "artifact", "ide"])
    if ctx.is_tarball:
        package_jsons = [p for p in files if p.name == "package.json"]
        if not package_jsons:
            ctx.add("HIGH", "package-artifact", ctx.root, None, "npm tarball has no package.json", "No package.json found after extraction", "Reject this artifact as malformed or suspicious.", "high", ["npm-package"])


def safe_extract_tgz(tgz_path: Path, destination: Path) -> list[Finding]:
    findings: list[Finding] = []
    try:
        tf = tarfile.open(tgz_path, "r:*")
    except Exception as exc:
        findings.append(Finding("CRITICAL", "tarball", str(tgz_path), None, "Unable to open tarball", str(exc), "Reject malformed package artifact.", "high", ["tarball"]))
        return findings
    dest_resolved = destination.resolve()
    with tf:
        for member in tf.getmembers():
            name = member.name
            try:
                pure = PurePosixPath(name)
                if pure.is_absolute() or ".." in pure.parts:
                    findings.append(Finding("CRITICAL", "tarball", name, None, "Unsafe tarball path traversal entry", name, "Reject artifact and report to registry/upstream.", "high", ["tarball", "path-traversal"]))
                    continue
                target = (destination / Path(*pure.parts)).resolve()
                if not str(target).startswith(str(dest_resolved) + os.sep) and target != dest_resolved:
                    findings.append(Finding("CRITICAL", "tarball", name, None, "Unsafe tarball extraction target", str(target), "Reject artifact and report to registry/upstream.", "high", ["tarball", "path-traversal"]))
                    continue
                if member.issym() or member.islnk():
                    findings.append(Finding("MEDIUM", "tarball", name, None, "Symlink/hardlink entry in tarball", f"linkname={member.linkname}", "Review links manually; scanner does not follow package symlinks.", "medium", ["tarball", "link"]))
                    continue
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    src = tf.extractfile(member)
                    if src is None:
                        continue
                    with target.open("wb") as out:
                        shutil.copyfileobj(src, out)
                    try:
                        os.chmod(target, member.mode & 0o777)
                    except Exception:
                        pass
            except Exception as exc:
                findings.append(Finding("HIGH", "tarball", name, None, "Error extracting tarball member", str(exc), "Reject or manually inspect artifact extraction behavior.", "medium", ["tarball"]))
    return findings


def scan_root(ctx: ScanContext) -> ScanContext:
    files = iter_files(ctx)
    analyze_package_artifact_hygiene(ctx, files)

    # First pass: manifests and lock/config files that establish context.
    for p in files:
        name = p.name
        rel = ctx.rel(p)
        if name == "package.json":
            analyze_package_json(ctx, p)
        elif name in {"package-lock.json", "npm-shrinkwrap.json"}:
            analyze_package_lock(ctx, p)
        elif name in {"pnpm-lock.yaml", "yarn.lock"}:
            analyze_text_lockfile(ctx, p)
        elif name in {".npmrc", ".yarnrc", ".pnpmrc"}:
            analyze_npmrc(ctx, p)
        elif name == "tsconfig.json" or name.startswith("tsconfig.") and name.endswith(".json"):
            analyze_tsconfig(ctx, p)
        elif rel.startswith(".github/workflows/") and p.suffix.lower() in {".yml", ".yaml"}:
            analyze_workflow(ctx, p)
        elif rel.startswith((".vscode/", ".claude/", ".cursor/", ".devcontainer/")) and p.suffix.lower() in {".json", ".jsonc", ".yml", ".yaml"}:
            analyze_json_config(ctx, p)

    # Second pass: source and config content scan.
    for p in files:
        scan_source_file(ctx, p)

    # Basic repo/package quality checks.
    root = ctx.root
    if not any((root / name).exists() for name in ("README.md", "readme.md", "README", "package/README.md")):
        ctx.add("LOW", "quality", root, None, "Missing README", "No README found at target root", "Add README with install, build, security and provenance guidance.", "low", ["quality"])
    if not any((root / name).exists() for name in ("SECURITY.md", "security.md", ".github/SECURITY.md", "package/SECURITY.md")):
        ctx.add("LOW", "quality", root, None, "Missing SECURITY.md", "No SECURITY.md found", "Add a security policy with vulnerability reporting instructions.", "low", ["quality", "security-policy"])
    if not any((root / name).exists() for name in ("LICENSE", "LICENSE.md", "license", "package/LICENSE", "package/LICENSE.md")):
        ctx.add("LOW", "quality", root, None, "Missing license file", "No LICENSE file found", "Include a license file matching package.json license metadata.", "low", ["quality", "license"])
    return ctx


def scan_target(path: Path, args: argparse.Namespace) -> ScanContext:
    label = str(path)
    if path.is_file() and path.suffix.lower() in {".tgz", ".gz", ".tar"}:
        tmp = Path(tempfile.mkdtemp(prefix="npm-ts-audit-"))
        ctx = ScanContext(tmp, label, args.mode, True, args.include_node_modules, args.max_file_bytes, args.max_findings)
        ctx.summary.sha256 = sha256_file(path)
        extraction_findings = safe_extract_tgz(path, tmp)
        for f in extraction_findings:
            ctx.findings.append(f)
        scan_root(ctx)
        # Preserve tmp path in JSON for traceability but delete contents after scan.
        if not args.keep_extracted:
            shutil.rmtree(tmp, ignore_errors=True)
        return ctx
    if path.is_file() and path.name == "package.json":
        root = path.parent
    else:
        root = path
    ctx = ScanContext(root, label, args.mode, False, args.include_node_modules, args.max_file_bytes, args.max_findings)
    if path.is_file():
        ctx.summary.sha256 = sha256_file(path)
    scan_root(ctx)
    return ctx


def build_report(contexts: list[ScanContext]) -> ScanReport:
    findings: list[Finding] = []
    summaries: list[TargetSummary] = []
    for ctx in contexts:
        findings.extend(ctx.findings)
        summaries.append(ctx.summary)
    findings.sort(key=lambda f: (-SEVERITY_ORDER.get(f.severity, 0), f.category, f.path, f.line or 0, f.title))
    counts = {sev: 0 for sev in SEVERITIES}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    if counts.get("CRITICAL", 0):
        decision = "QUARANTINE"
        strict_exit = 2
    elif counts.get("HIGH", 0):
        decision = "BLOCK_UNTIL_REVIEW"
        strict_exit = 2
    elif counts.get("MEDIUM", 0):
        decision = "REVIEW_BEFORE_USE"
        strict_exit = 1
    else:
        decision = "PASS_WITH_CAUTION"
        strict_exit = 0
    return ScanReport(
        tool="npm_ts_static_triage.py",
        generated_at=_dt.datetime.now(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        summaries=summaries,
        findings=findings,
        counts_by_severity=counts,
        decision=decision,
        strict_exit_code=strict_exit,
    )


def markdown_report(report: ScanReport) -> str:
    lines: list[str] = []
    lines.append("# npm/TypeScript Dependency & Package Static Audit")
    lines.append("")
    lines.append(f"Generated: `{report.generated_at}`")
    lines.append(f"Decision: **{report.decision}**")
    lines.append("")
    lines.append("## Scope")
    lines.append("")
    for s in report.summaries:
        lines.append(f"- Target: `{s.target}`")
        lines.append(f"  - Mode: `{s.mode}`; tarball: `{s.is_tarball}`; files: `{s.file_count}`; bytes: `{s.total_bytes}`")
        if s.sha256:
            lines.append(f"  - SHA-256: `{s.sha256}`")
        lines.append(f"  - package.json: `{s.package_json_count}`; lockfiles: `{s.lockfile_count}`; tsconfig: `{s.tsconfig_count}`; workflows: `{s.workflow_count}`")
    lines.append("")
    lines.append("## Severity counts")
    lines.append("")
    lines.append("| Severity | Count |")
    lines.append("|---|---:|")
    for sev in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]:
        lines.append(f"| {sev} | {report.counts_by_severity.get(sev, 0)} |")
    lines.append("")
    lines.append("## Findings")
    lines.append("")
    if not report.findings:
        lines.append("No findings. This is not a proof of safety; it only means these static checks did not trigger.")
    else:
        for idx, f in enumerate(report.findings, 1):
            loc = f"{f.path}:{f.line}" if f.line else f.path
            lines.append(f"### {idx}. [{f.severity}] {f.title}")
            lines.append("")
            lines.append(f"- Category: `{f.category}`")
            lines.append(f"- Location: `{loc}`")
            lines.append(f"- Confidence: `{f.confidence}`")
            if f.tags:
                lines.append(f"- Tags: `{', '.join(f.tags)}`")
            lines.append(f"- Evidence: `{f.evidence}`")
            lines.append(f"- Recommendation: {f.recommendation}")
            lines.append("")
    lines.append("## Suggested next steps")
    lines.append("")
    if report.decision == "QUARANTINE":
        lines.append("- Do not install, build, import or run this package/repo. Quarantine the artifact and rotate any credentials that may have been exposed to it.")
    elif report.decision == "BLOCK_UNTIL_REVIEW":
        lines.append("- Block use until each HIGH finding is manually explained, removed, or allowlisted with evidence.")
    elif report.decision == "REVIEW_BEFORE_USE":
        lines.append("- Review MEDIUM findings before use, especially non-standard dependency sources and CI install behavior.")
    else:
        lines.append("- Proceed only with normal supply-chain controls: lockfile review, script suppression, signature/provenance checks and sandboxed install/build.")
    lines.append("- Use `npm ci --ignore-scripts` for review installs and avoid optional dependencies unless explicitly needed.")
    lines.append("- Run vulnerability/signature tooling in a secret-free environment after static review.")
    lines.append("")
    return "\n".join(lines)


def sarif_report(report: ScanReport) -> dict[str, Any]:
    rules: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []
    for f in report.findings:
        rule_id = f.category
        rules.setdefault(rule_id, {
            "id": rule_id,
            "name": rule_id,
            "shortDescription": {"text": rule_id},
            "fullDescription": {"text": "Static npm/TypeScript supply-chain audit finding"},
            "defaultConfiguration": {"level": sarif_level(f.severity)},
        })
        result: dict[str, Any] = {
            "ruleId": rule_id,
            "level": sarif_level(f.severity),
            "message": {"text": f"[{f.severity}] {f.title}: {f.evidence}"},
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {"uri": f.path},
                    "region": {"startLine": f.line or 1},
                }
            }],
        }
        results.append(result)
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "npm_ts_static_triage.py",
                    "informationUri": "https://docs.npmjs.com/",
                    "rules": list(rules.values()),
                }
            },
            "results": results,
        }],
    }


def sarif_level(sev: str) -> str:
    if sev in {"CRITICAL", "HIGH"}:
        return "error"
    if sev == "MEDIUM":
        return "warning"
    return "note"


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Static npm/TypeScript dependency and package malware/quality triage. Does not execute target code.")
    p.add_argument("targets", nargs="+", help="Repo/package directory, package.json, or npm package tarball (.tgz) to scan")
    p.add_argument("--mode", choices=["package", "library", "application", "repo"], default="package", help="Review mode; affects quality/lockfile expectations")
    p.add_argument("--json", dest="json_out", help="Write JSON report to this path")
    p.add_argument("--markdown", "--out", dest="markdown_out", help="Write Markdown report to this path")
    p.add_argument("--sarif", dest="sarif_out", help="Write SARIF report to this path")
    p.add_argument("--strict-exit", action="store_true", help="Exit non-zero for MEDIUM/HIGH/CRITICAL findings; HIGH/CRITICAL return 2")
    p.add_argument("--include-node-modules", action="store_true", help="Include node_modules in repo scans. Tarball scans include all extracted contents by default.")
    p.add_argument("--max-file-bytes", type=int, default=5_000_000, help="Max bytes to read per text file")
    p.add_argument("--max-findings", type=int, default=1000, help="Maximum findings to record")
    p.add_argument("--ioc-file", action="append", default=[], help="Additional IOC text file; one indicator per line. hxxp and [.] are normalized.")
    p.add_argument("--keep-extracted", action="store_true", help="Keep extracted tarball temp directories for manual review")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    default_ioc = Path(__file__).resolve().parents[1] / "rules" / "iocs.txt"
    load_ioc_files([default_ioc] + [Path(x) for x in args.ioc_file])
    contexts: list[ScanContext] = []
    for target in args.targets:
        path = Path(target)
        if not path.exists():
            sys.stderr.write(f"Target not found: {target}\n")
            return 3
        contexts.append(scan_target(path, args))
    report = build_report(contexts)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False), encoding="utf-8")
    if args.markdown_out:
        Path(args.markdown_out).write_text(markdown_report(report), encoding="utf-8")
    if args.sarif_out:
        Path(args.sarif_out).write_text(json.dumps(sarif_report(report), indent=2), encoding="utf-8")
    if not args.json_out and not args.markdown_out and not args.sarif_out:
        print(markdown_report(report))
    if args.strict_exit:
        return report.strict_exit_code
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
