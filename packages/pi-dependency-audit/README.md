# @testzugang/pi-dependency-audit

Static dependency and supply-chain malware auditing skill for Pi. Global Pi audits write JSON plus Markdown reports, and default config treats `@earendil-works/*` as trusted peer dependency scope only.

## Install

```bash
pi install npm:@testzugang/pi-dependency-audit
```

## Usage

```text
/skill:dependency-audit
```

## Reports and configuration

- End-to-end audits write `/tmp/pi_audit_aggregated.json` and `/tmp/pi_audit_report.md` by default.
- Markdown reports include held-back/rejected update details for blocked, quarantined, errored, or too-fresh updates.
- Config lives in [`skills/dependency-audit/config.json`](skills/dependency-audit/config.json) or `~/.pi/dependency-audit.json`.
- Trusted peer dependency allowlists apply only to `peerDependencies`; normal dependency fields stay strict.

## Interactive Terminal Integration (Wrapper)

See [SKILL.md](skills/dependency-audit/SKILL.md) for full instructions on setting up automated shell interception for security checks on `pi update`.
