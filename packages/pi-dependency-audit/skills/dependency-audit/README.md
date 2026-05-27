# npm/TypeScript Package Audit Skill

Static-first Skill for reviewing TypeScript dependencies, npm packages and npm-based repositories before install or use.

## What it does

- Scans `package.json`, npm/pnpm/yarn lockfiles, `.npmrc`, TypeScript config, GitHub Actions and TS/JS source files.
- Detects risky npm lifecycle scripts, Git/URL/File dependencies, optional dependency traps, bundled dependencies, non-default tarball sources and missing integrity.
- Scans npm `.tgz` tarballs without executing package code.
- Flags malware patterns such as download+execute, credential access+network, obfuscation, cloud metadata probes, GitHub API write behavior and IDE/AI-agent persistence.
- Produces Markdown, JSON and SARIF output.
- Allows narrow trusted peer dependency rules. Default config treats `@earendil-works/*` peer dependency ranges as INFO-only, while normal dependencies and optional dependencies remain strict.
- Global Pi audits automatically write a Markdown report with held-back/rejected update details.

## Quick start

```bash
python3 scripts/npm_ts_static_triage.py /path/to/repo-or-package.tgz \
  --mode package \
  --markdown npm-ts-audit.md \
  --json npm-ts-audit.json \
  --sarif npm-ts-audit.sarif \
  --strict-exit
```

For global pi dependency checks without on-the-fly shell loops:

```bash
bash scripts/pi-check-current-global-versions.sh
bash scripts/pi-check-latest-npm-versions.sh
bash scripts/pi-check-git-source-updates.sh
# or everything in one run
bash scripts/pi-check-all-updates.sh

# full static update audit; writes JSON and Markdown summary
python3 scripts/run_pi_dependency_audit.py \
  --output /tmp/pi_audit_aggregated.json \
  --markdown-output /tmp/pi_audit_report.md
```

Age-gate configuration (default: 24h):

- repo default: `skills/dependency-audit/config.json`
- user override: `~/.pi/dependency-audit.json`
- highest priority override: `--config /path/to/config.json`

Example config:

```json
{
  "min_update_age_hours": 24,
  "trusted_peer_dependency_scopes": ["@earendil-works"],
  "trusted_peer_dependency_packages": []
}
```

Trusted peer dependency rules apply only to `peerDependencies`; `dependencies`, `devDependencies`, `optionalDependencies`, `overrides` and `resolutions` stay strict.

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
- `scripts/pi-check-current-global-versions.sh`: reads installed versions for default/global pi packages.
- `scripts/pi-check-latest-npm-versions.sh`: reads latest npm registry versions for default/global pi packages.
- `scripts/pi-check-git-source-updates.sh`: compares local git checkouts with origin branch heads.
- `scripts/pi-check-all-updates.sh`: runs all three checks in sequence.
- `scripts/pi-default-packages.txt`: default package target list for the helper scripts.
- `scripts/pi-default-git-repos.txt`: default git repo target list for update checks.
- `scripts/run_pi_dependency_audit.py`: end-to-end static audit workflow for global pi dependency updates; writes JSON and Markdown reports.
- `scripts/summarize_pi_dependency_audit.py`: creates a markdown summary from aggregated JSON results, including held-back/rejected update details.
- `scripts/pi-interactive-update.py`: interactive CLI wrapper and menu selector for native `pi update` integration.
- `config.json`: default config (`min_update_age_hours`, trusted peer dependency scopes/packages).
- `rules/iocs.txt`: editable IOC seed list.
- `templates/report.md`: manual review template.
- `examples/sample-commands.md`: safe commands and review playbooks.
- `examples/github-actions-static-audit.yml`: example CI workflow for static-only scanning.

## Interactive Shell Wrapper (`pi update` integration)

To intercept the native `pi update` command in your terminal so it automatically runs this security audit first and prompts you with a selection menu of verified-safe updates, add the following wrapper function to your shell configuration (e.g., `~/.zshrc` or `~/.bashrc`):

```bash
# Wrapper for pi update to prepend dependency-audit and trigger interactive CLI selection
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/agent/git/github.com/testzugang/pi-plugins/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```

After reloading your shell (`source ~/.zshrc`), typing `pi update` or `pi update --extensions` will launch the interactive audit menu before running any updates.

## Important limitation

A clean static report is not proof of safety. Use it as a pre-installation gate and combine it with registry metadata review, version cooldown, script suppression, provenance/signature checks, sandboxing and human review.
