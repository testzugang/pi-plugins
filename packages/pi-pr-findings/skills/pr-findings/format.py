#!/usr/bin/env python3
"""Read fetch.sh JSON on stdin, emit a Markdown findings report on stdout."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone

DROP_AUTHORS = {"sonarqubecloud[bot]", "sonarcloud[bot]", "dependabot[bot]", "github-actions[bot]"}

SEVERITY_PATTERNS = [
    ("blocker", [r"🔴", r"\bblocker\b", r"\bmust fix\b", r"\bcritical\b", r"\bbreaks\b"]),
    ("warning", [r"🟡", r"\bwarning\b", r"\bshould\b", r"\bleak\b", r"\brace\b", r"\bmissing\b"]),
    ("nit",     [r"🔵", r"\bnit\b", r"\bsuggestion\b", r"\bconsider\b", r"\bcould be\b", r"\bminor\b"]),
    ("info",    [r"\bapproved\b", r"\blgtm\b", r"\bstrength\b", r"\blooks good\b"]),
]

SECTION_HEADER_RE = re.compile(
    r"^#{1,6}\s*(?:🔴|🟡|🔵|✅)?\s*(blockers?|warnings?|nits?|approvals?|strengths?|suggestions?).*$",
    re.IGNORECASE | re.MULTILINE,
)
NUMBERED_ITEM_RE = re.compile(r"^\s*\d+\.\s+", re.MULTILINE)


def classify(body: str) -> str:
    text = body.lower()
    for sev, patterns in SEVERITY_PATTERNS:
        for p in patterns:
            if re.search(p, text):
                return sev
    return "warning"


def section_to_severity(section: str) -> str:
    s = section.lower()
    if "blocker" in s:
        return "blocker"
    if "warning" in s:
        return "warning"
    if "nit" in s or "suggestion" in s:
        return "nit"
    if "approval" in s or "strength" in s:
        return "info"
    return "warning"


def split_bot_summary(body: str) -> list[tuple[str, str]] | None:
    """If the comment has section headers like '### 🟡 Warnings', split into (severity, item) tuples."""
    matches = list(SECTION_HEADER_RE.finditer(body))
    if not matches:
        return None
    out: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        sev = section_to_severity(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        section_body = body[start:end].strip()
        items = NUMBERED_ITEM_RE.split(section_body)
        items = [it.strip() for it in items if it.strip()]
        if not items:
            if section_body:
                out.append((sev, section_body))
            continue
        for item in items:
            out.append((sev, item))
    return out or None


def humanize_age(iso: str) -> str:
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    delta = datetime.now(timezone.utc) - dt
    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


def excerpt(body: str, limit: int = 200) -> str:
    text = " ".join(body.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def check_icon(conclusion: str) -> str:
    c = (conclusion or "").upper()
    return {
        "SUCCESS": "✅",
        "FAILURE": "❌",
        "ERROR": "❌",
        "CANCELLED": "⚪",
        "SKIPPED": "⚪",
        "PENDING": "⏳",
        "IN_PROGRESS": "⏳",
        "NEUTRAL": "➖",
    }.get(c, "❓")


def state_badge(state: str) -> str:
    s = (state or "").upper()
    if s == "OPEN":
        return ""
    return f"_(PR is {s})_"


def render(data: dict, args: argparse.Namespace) -> str:
    pr = data.get("pr", {})
    viewer = data.get("viewerLogin", "")
    checks = data.get("checks", []) or []
    summary_comments = data.get("summaryComments", []) or []
    inline_comments = data.get("inlineComments", []) or []

    findings: dict[str, list[str]] = {"blocker": [], "warning": [], "nit": [], "info": []}
    stale_dropped = 0

    def keep(c: dict) -> bool:
        author = (c.get("author") or "").lower()
        if author in DROP_AUTHORS:
            return False
        if args.mine and author != (viewer or "").lower():
            return False
        if args.unresolved and c.get("isResolved"):
            return False
        return True

    # Inline comments
    for c in inline_comments:
        if not keep(c):
            continue
        if c.get("isOutdated") and not args.include_stale:
            stale_dropped += 1
            continue
        sev = classify(c.get("body", ""))
        loc = f"`{c.get('path','?')}:{c.get('line','?')}`"
        line = f"- {loc} — {excerpt(c.get('body',''))} ([link]({c.get('url','')}))"
        findings[sev].append(line)

    # Summary/review comments — bots may pack multiple findings into one
    for c in summary_comments:
        if not keep(c):
            continue
        body = c.get("body", "")
        author = c.get("author", "?")
        url = c.get("url", "")
        split = split_bot_summary(body)
        if split:
            for sev, item in split:
                line = f"- _{author}_: {excerpt(item)} ([link]({url}))"
                findings[sev].append(line)
        else:
            sev = classify(body)
            line = f"- _{author}_ ({humanize_age(c.get('createdAt',''))}): {excerpt(body)} ([link]({url}))"
            findings[sev].append(line)

    # Severity filter
    if args.severity != "all":
        for sev in list(findings.keys()):
            if sev != args.severity:
                findings[sev] = []

    # Header
    short_sha = (pr.get("headSha") or "")[:7]
    parts: list[str] = []
    parts.append(f"## PR #{pr.get('number','?')} findings — revision `{short_sha}` {state_badge(pr.get('state',''))}".rstrip())

    if checks:
        rendered_checks = " · ".join(
            f"{check_icon(ch.get('conclusion',''))} {ch.get('name','?')}"
            + (f" ([details]({ch['url']}))" if ch.get("conclusion","").upper() in {"FAILURE","ERROR"} and ch.get("url") else "")
            for ch in checks
        )
        parts.append(f"\n**Status checks:** {rendered_checks}")

    section_headers = [
        ("blocker", "### 🔴 Blockers"),
        ("warning", "### 🟡 Warnings"),
        ("nit",     "### 🔵 Nits"),
        ("info",    "### ✅ Approvals / strengths"),
    ]
    for key, header in section_headers:
        items = findings[key]
        if not items:
            continue
        parts.append(f"\n{header} ({len(items)})\n")
        parts.extend(items)

    if stale_dropped and not args.include_stale:
        parts.append(f"\n---\n<small>{stale_dropped} stale finding(s) on older commits skipped (use `--include-stale` to show).</small>")

    total = sum(len(v) for v in findings.values())
    if total == 0:
        parts.append("\n_No findings._")

    return "\n".join(parts) + "\n"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--severity", choices=["blocker", "warning", "nit", "all"], default="all")
    p.add_argument("--unresolved", action="store_true")
    p.add_argument("--include-stale", action="store_true")
    p.add_argument("--mine", action="store_true")
    args = p.parse_args()

    raw = sys.stdin.read()
    if not raw.strip():
        print("format.py: empty input on stdin", file=sys.stderr)
        return 2
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"format.py: invalid JSON on stdin: {e}", file=sys.stderr)
        return 2

    sys.stdout.write(render(data, args))
    return 0


if __name__ == "__main__":
    sys.exit(main())
