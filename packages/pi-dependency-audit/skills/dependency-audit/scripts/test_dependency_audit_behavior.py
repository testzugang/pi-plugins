#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TRIAGE_SCRIPT = SCRIPT_DIR / "npm_ts_static_triage.py"
RUN_AUDIT_SCRIPT = SCRIPT_DIR / "run_pi_dependency_audit.py"


def run_cmd(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)


class DependencyAuditBehaviorTest(unittest.TestCase):
    def test_trusted_peer_dependency_scope_downgrades_floating_range_to_info(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package_json = root / "package.json"
            report_json = root / "report.json"
            config_json = root / "config.json"

            package_json.write_text(
                json.dumps(
                    {
                        "name": "sample-plugin",
                        "version": "1.0.0",
                        "license": "MIT",
                        "peerDependencies": {"@earendil-works/pi-coding-agent": "*"},
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            config_json.write_text(
                json.dumps({"trusted_peer_dependency_scopes": ["@earendil-works"]}),
                encoding="utf-8",
            )

            result = run_cmd(
                [
                    "python3",
                    str(TRIAGE_SCRIPT),
                    str(package_json),
                    "--mode",
                    "package",
                    "--config",
                    str(config_json),
                    "--json",
                    str(report_json),
                ]
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            report = json.loads(report_json.read_text(encoding="utf-8"))
            peer_findings = [
                finding
                for finding in report["findings"]
                if finding["category"] == "dependency-spec" and "@earendil-works/pi-coding-agent" in finding["evidence"]
            ]
            self.assertEqual(len(peer_findings), 1)
            self.assertEqual(peer_findings[0]["severity"], "INFO")
            self.assertIn("trusted-peer", peer_findings[0]["tags"])
            self.assertEqual(report["decision"], "PASS_WITH_CAUTION")

    def test_run_pi_dependency_audit_writes_markdown_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packages_file = root / "packages.txt"
            repos_file = root / "repos.txt"
            output_json = root / "audit.json"
            output_md = root / "audit.md"
            packages_file.write_text("", encoding="utf-8")
            repos_file.write_text("", encoding="utf-8")

            result = run_cmd(
                [
                    "python3",
                    str(RUN_AUDIT_SCRIPT),
                    "--packages-file",
                    str(packages_file),
                    "--repos-file",
                    str(repos_file),
                    "--workspace",
                    str(root / "workspace"),
                    "--output",
                    str(output_json),
                    "--markdown-output",
                    str(output_md),
                ]
            )

            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(output_json.exists())
            self.assertTrue(output_md.exists())
            self.assertIn("Global Pi Dependency Security Audit Report", output_md.read_text(encoding="utf-8"))
            self.assertIn(f"Wrote markdown report: {output_md}", result.stdout)


if __name__ == "__main__":
    unittest.main()
