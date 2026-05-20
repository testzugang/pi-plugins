#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize aggregated pi dependency audit JSON as Markdown.")
    parser.add_argument("--input", default="/tmp/pi_audit_aggregated.json", help="Input JSON from run_pi_dependency_audit.py")
    parser.add_argument("--output", default="/tmp/pi_audit_report.md", help="Output markdown report path")
    return parser.parse_args()


def decision_label(decision: str) -> str:
    labels = {
        "QUARANTINE": "❌ QUARANTINE",
        "BLOCK_UNTIL_REVIEW": "⚠️ BLOCK UNTIL REVIEW",
        "REVIEW_BEFORE_USE": "🟡 REVIEW BEFORE USE",
        "PASS_WITH_CAUTION": "✅ PASS WITH CAUTION",
        "PASS_UP_TO_DATE": "✅ UP TO DATE",
        "SKIP_NOT_INSTALLED": "➖ NOT INSTALLED",
        "SKIP_MISSING": "➖ MISSING",
        "SKIP_NO_REMOTE_BRANCH": "➖ NO REMOTE BRANCH",
    }
    return labels.get(decision, decision)


def short_rev(value: Any) -> str:
    text = str(value or "-")
    return text[:8] if len(text) > 8 and all(c in "0123456789abcdef" for c in text.lower()) else text


def sev(counts: dict[str, Any], key: str) -> int:
    raw = counts.get(key, 0)
    return raw if isinstance(raw, int) else 0


def render_markdown(results: list[dict[str, Any]]) -> str:
    md: list[str] = []
    md.append("# 🛡️ Global Pi Dependency Security Audit Report")
    md.append("")
    md.append("## 📊 Executive Summary")
    md.append("")
    md.append("| Target | Type | Current | Latest | Status | Decision | C | H | M | L | I |")
    md.append("| :--- | :---: | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |")

    updates: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for item in results:
        status = str(item.get("status", "unknown"))
        decision = str(item.get("decision", "UNKNOWN"))
        counts = item.get("counts", {}) if isinstance(item.get("counts"), dict) else {}

        if status == "error":
            errors.append(item)

        if status == "update_available":
            updates.append(item)

        md.append(
            "| `{name}` | {typ} | `{current}` | `{latest}` | {status} | {decision} | {c} | {h} | {m} | {l} | {i} |".format(
                name=item.get("name", "?"),
                typ=item.get("type", "?"),
                current=short_rev(item.get("current")),
                latest=short_rev(item.get("latest")),
                status=status,
                decision=decision_label(decision),
                c=sev(counts, "CRITICAL"),
                h=sev(counts, "HIGH"),
                m=sev(counts, "MEDIUM"),
                l=sev(counts, "LOW"),
                i=sev(counts, "INFO"),
            )
        )

    if errors:
        md.append("")
        md.append("## ⚠️ Errors")
        md.append("")
        for item in errors:
            md.append(f"- **{item.get('name', '?')}**: {item.get('error', 'unknown error')}")

    md.append("")
    md.append("## 🔍 Findings for Pending Updates")
    md.append("")
    if not updates:
        md.append("No pending updates were detected.")
    else:
        for item in updates:
            md.append(
                f"### `{item.get('name','?')}` ({short_rev(item.get('current'))} ➜ {short_rev(item.get('latest'))})"
            )
            md.append(f"- **Decision:** {decision_label(str(item.get('decision', 'UNKNOWN')))}")

            findings = item.get("findings", []) if isinstance(item.get("findings"), list) else []
            significant = [f for f in findings if str(f.get("severity")) in {"CRITICAL", "HIGH", "MEDIUM"}]
            if not findings:
                md.append("- No findings.")
            elif not significant:
                md.append(f"- Only LOW/INFO findings ({len(findings)} total).")
            else:
                md.append(f"- Significant findings ({len(significant)}):")
                for finding in significant:
                    line = finding.get("line")
                    line_suffix = f":{line}" if line else ""
                    md.append(
                        f"  - [{finding.get('severity','?')}] {finding.get('title','?')} — `{finding.get('path','?')}{line_suffix}`"
                    )
                    recommendation = finding.get("recommendation")
                    if recommendation:
                        md.append(f"    - Recommendation: {recommendation}")
            md.append("")

    safe = [i for i in updates if str(i.get("decision")) in {"PASS_WITH_CAUTION", "PASS_UP_TO_DATE"}]
    review = [i for i in updates if str(i.get("decision")) == "REVIEW_BEFORE_USE"]
    blocked = [i for i in updates if str(i.get("decision")) in {"BLOCK_UNTIL_REVIEW", "QUARANTINE"}]

    md.append("## 💡 Recommendation")
    md.append("")
    md.append(f"- Safe to update now: **{len(safe)}**")
    md.append(f"- Needs manual review: **{len(review)}**")
    md.append(f"- Blocked/quarantine: **{len(blocked)}**")

    if safe:
        safe_npm = [i["name"] for i in safe if i.get("type") == "npm"]
        if safe_npm:
            md.append("")
            md.append("### Suggested npm update command")
            md.append("```bash")
            md.append("npm install -g " + " ".join(safe_npm))
            md.append("```")

    return "\n".join(md) + "\n"


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    results = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(results, list):
        raise SystemExit("Input JSON must be an array")

    output_path.write_text(render_markdown(results), encoding="utf-8")
    print(f"Wrote markdown report: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
