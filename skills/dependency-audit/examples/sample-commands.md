# Safe npm/TypeScript audit commands

## 1. Scan a local repository without installing dependencies

```bash
python3 scripts/npm_ts_static_triage.py /path/to/repo \
  --mode repo \
  --markdown repo-audit.md \
  --json repo-audit.json \
  --sarif repo-audit.sarif \
  --strict-exit
```

## 2. Scan a published npm tarball

```bash
npm view @scope/package@1.2.3 name version dist.tarball dist.integrity dist.shasum time maintainers repository license --json > package-metadata.json
jq -r '.dist.tarball' package-metadata.json
curl -fL -o package-under-review.tgz "$(jq -r '.dist.tarball' package-metadata.json)"
sha256sum package-under-review.tgz
python3 scripts/npm_ts_static_triage.py package-under-review.tgz --mode package --markdown package-audit.md --json package-audit.json --strict-exit
```

## 3. Compare two package tarballs without running npm scripts

```bash
mkdir -p old new
python3 - <<'PY'
import tarfile, pathlib
for src, dst in [('old.tgz', 'old'), ('new.tgz', 'new')]:
    with tarfile.open(src, 'r:*') as tf:
        tf.extractall(dst, filter='data')
PY
diff -ruN old/package new/package > package-diff.patch || true
```

Review the diff for new `scripts`, `optionalDependencies`, `setup.mjs`, generated JS, hidden config and native binaries.

## 4. Safe review install after static approval

```bash
npm ci --ignore-scripts --omit=optional
npm audit --audit-level=high
npm audit signatures
```

Only run required lifecycle scripts later in a sandbox without secrets, after the exact package and script have been allowlisted.

## 5. Harden npm defaults for a review environment

```bash
npm config set ignore-scripts true
npm config set audit true
npm config set fund false
npm config set save-exact true
npm config set strict-ssl true
```

If your npm version supports source restrictions, use them for review jobs:

```bash
npm ci --ignore-scripts --omit=optional --allow-git=none --allow-remote=none --allow-file=none
```

## 6. Common manual grep commands

```bash
grep -RInE 'preinstall|postinstall|prepare|prepack|bundleDependencies|optionalDependencies' package.json package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null || true
grep -RInE 'child_process|execSync|spawn\(|eval\(|new Function|fetch\(|https?://|curl|wget|169\.254\.169\.254|GITHUB_TOKEN|NPM_TOKEN|VAULT_TOKEN|\.npmrc|\.aws/credentials|createCommitOnBranch|\.claude|\.vscode/tasks\.json' . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null || true
find . -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' \) -size +500k -print
```

## 7. Reusable helpers for global pi dependency checks

```bash
# current installed versions
bash scripts/pi-check-current-global-versions.sh

# latest npm versions
bash scripts/pi-check-latest-npm-versions.sh

# git-based source updates for local checkouts
bash scripts/pi-check-git-source-updates.sh

# all checks in one call
bash scripts/pi-check-all-updates.sh
```

Each helper accepts optional package/repo arguments to override defaults.

## 8. End-to-end global pi update audit (static only)

```bash
python3 scripts/run_pi_dependency_audit.py --output /tmp/pi_audit_aggregated.json
python3 scripts/summarize_pi_dependency_audit.py \
  --input /tmp/pi_audit_aggregated.json \
  --output /tmp/pi_audit_report.md
```

## 9. Review outcome policy example

- CRITICAL: quarantine, do not install, rotate any exposed credentials.
- HIGH: block until a human reviewer approves a documented fix or allowlist.
- MEDIUM: review before use; may pass with documented rationale.
- LOW/INFO: track as hygiene improvements.
