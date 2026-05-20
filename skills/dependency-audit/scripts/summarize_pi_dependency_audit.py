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
        "SKIP_TOO_FRESH": "⏱️ TOO FRESH",
    }
    return labels.get(decision, decision)


def short_rev(value: Any) -> str:
    text = str(value or "-")
    return text[:8] if len(text) > 8 and all(c in "0123456789abcdef" for c in text.lower()) else text


def sev(counts: dict[str, Any], key: str) -> int:
    raw = counts.get(key, 0)
    return raw if isinstance(raw, int) else 0


def is_transitive_node_modules_finding(finding: dict[str, Any]) -> bool:
    path = str(finding.get("path", ""))
    return "node_modules/" in path


def significant_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [f for f in findings if str(f.get("severity")) in {"CRITICAL", "HIGH", "MEDIUM"}]


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
    deferred: list[dict[str, Any]] = []

    for item in results:
        status = str(item.get("status", "unknown"))
        decision = str(item.get("decision", "UNKNOWN"))
        counts = item.get("counts", {}) if isinstance(item.get("counts"), dict) else {}

        if status == "error":
            errors.append(item)

        if status == "update_available":
            updates.append(item)
        if status == "too_fresh":
            deferred.append(item)

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
            significant = significant_findings(findings)
            transitive_significant = [f for f in significant if is_transitive_node_modules_finding(f)]
            first_party_significant = [f for f in significant if not is_transitive_node_modules_finding(f)]

            if not findings:
                md.append("- No findings.")
            elif not significant:
                md.append(f"- Only LOW/INFO findings ({len(findings)} total).")
            else:
                md.append(
                    f"- Significant findings: {len(significant)} total (first-party: {len(first_party_significant)}, transitive node_modules: {len(transitive_significant)})."
                )

                if first_party_significant:
                    md.append("- First-party findings:")
                    for finding in first_party_significant[:12]:
                        line = finding.get("line")
                        line_suffix = f":{line}" if line else ""
                        md.append(
                            f"  - [{finding.get('severity','?')}] {finding.get('title','?')} — `{finding.get('path','?')}{line_suffix}`"
                        )
                        recommendation = finding.get("recommendation")
                        if recommendation:
                            md.append(f"    - Recommendation: {recommendation}")
                    if len(first_party_significant) > 12:
                        md.append(f"  - … {len(first_party_significant) - 12} more first-party significant finding(s)")

                if transitive_significant:
                    md.append("- Transitive node_modules findings (summarized):")
                    by_severity: dict[str, int] = {}
                    by_category: dict[str, int] = {}
                    for finding in transitive_significant:
                        sev_key = str(finding.get("severity", "?"))
                        cat_key = str(finding.get("category", "?"))
                        by_severity[sev_key] = by_severity.get(sev_key, 0) + 1
                        by_category[cat_key] = by_category.get(cat_key, 0) + 1
                    sev_summary = ", ".join(f"{k}: {by_severity[k]}" for k in sorted(by_severity))
                    cat_summary = ", ".join(
                        f"{k}: {v}" for k, v in sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
                    )
                    md.append(f"  - Severity breakdown: {sev_summary}")
                    md.append(f"  - Top categories: {cat_summary}")
            md.append("")

    safe = [i for i in updates if str(i.get("decision")) in {"PASS_WITH_CAUTION", "PASS_UP_TO_DATE"}]
    review = [i for i in updates if str(i.get("decision")) == "REVIEW_BEFORE_USE"]
    blocked = [i for i in updates if str(i.get("decision")) in {"BLOCK_UNTIL_REVIEW", "QUARANTINE"}]

    if deferred:
        md.append("## ⏱️ Deferred by Minimum Update Age")
        md.append("")
        for item in deferred:
            age = item.get("update_age_hours")
            threshold = item.get("min_update_age_hours")
            age_str = f"{age:.1f}h" if isinstance(age, (int, float)) else "unknown"
            threshold_str = f"{threshold:.1f}h" if isinstance(threshold, (int, float)) else "unknown"
            md.append(
                f"- `{item.get('name','?')}` ({short_rev(item.get('current'))} ➜ {short_rev(item.get('latest'))}) — {age_str} < {threshold_str}"
            )
        md.append("")

    md.append("## 💡 Recommendation")
    md.append("")
    md.append(f"- Safe to update now: **{len(safe)}**")
    md.append(f"- Needs manual review: **{len(review)}**")
    md.append(f"- Blocked/quarantine: **{len(blocked)}**")
    md.append(f"- Deferred by age gate: **{len(deferred)}**")

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
