# npm/TypeScript Package Audit Skill

Static-first Skill for reviewing TypeScript dependencies, npm packages and npm-based repositories before install or use.

## What it does

- Scans `package.json`, npm/pnpm/yarn lockfiles, `.npmrc`, TypeScript config, GitHub Actions and TS/JS source files.
- Detects risky npm lifecycle scripts, Git/URL/File dependencies, optional dependency traps, bundled dependencies, non-default tarball sources and missing integrity.
- Scans npm `.tgz` tarballs without executing package code.
- Flags malware patterns such as download+execute, credential access+network, obfuscation, cloud metadata probes, GitHub API write behavior and IDE/AI-agent persistence.
- Produces Markdown, JSON and SARIF output.

## Quick start

```bash
python3 scripts/npm_ts_static_triage.py /path/to/repo-or-package.tgz \
  --mode package \
  --markdown npm-ts-audit.md \
  --json npm-ts-audit.json \
  --sarif npm-ts-audit.sarif \
  --strict-exit
```

`--strict-exit` exits with code `2` for HIGH/CRITICAL findings and `1` for MEDIUM-only findings.

## Safe package acquisition

```bash
npm view <package>@<version> name version dist.tarball dist.integrity dist.shasum time maintainers repository license --json
curl -fL -o package-under-review.tgz '<dist.tarball-url>'
sha256sum package-under-review.tgz
python3 scripts/npm_ts_static_triage.py package-under-review.tgz --markdown report.md --json report.json --strict-exit
```

Do not run `npm install`, `npm ci`, `npm pack`, `npm test`, `npm run build`, `npx`, `node`, `tsx` or `ts-node` against untrusted code before static review.

## Files

- `SKILL.md`: full German skill instructions and policy.
- `scripts/npm_ts_static_triage.py`: standalone stdlib-only scanner.
- `rules/iocs.txt`: editable IOC seed list.
- `templates/report.md`: manual review template.
- `examples/sample-commands.md`: safe commands and review playbooks.
- `examples/github-actions-static-audit.yml`: example CI workflow for static-only scanning.

## Important limitation

A clean static report is not proof of safety. Use it as a pre-installation gate and combine it with registry metadata review, version cooldown, script suppression, provenance/signature checks, sandboxing and human review.
