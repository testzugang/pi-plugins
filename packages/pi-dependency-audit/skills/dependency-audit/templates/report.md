# npm/TypeScript Dependency & Package Review

## Summary

- Package / repo:
- Version / commit:
- Reviewer:
- Date:
- Mode: package | library | application | repo
- Network metadata used: yes | no
- Decision: PASS_WITH_CAUTION | REVIEW_BEFORE_USE | BLOCK_UNTIL_REVIEW | QUARANTINE

## Artifact identity

- npm package:
- npm version:
- Tarball URL:
- Tarball SHA-256:
- npm `dist.integrity`:
- Git repo:
- Git commit SHA:
- Lockfile hash:

## Automated scanner output

- Markdown report:
- JSON report:
- SARIF report:
- Strict exit code:
- Counts:
  - CRITICAL:
  - HIGH:
  - MEDIUM:
  - LOW:
  - INFO:

## Manual review checklist

### package.json

- [ ] No unexpected install-phase lifecycle scripts.
- [ ] All lifecycle scripts have a documented legitimate purpose.
- [ ] No download+execute patterns in scripts.
- [ ] No Git/URL/File dependency in production or optional dependencies unless allowlisted.
- [ ] No suspicious `overrides` or `resolutions`.
- [ ] No unexpected `bundleDependencies`.
- [ ] CLI `bin` entrypoints are readable and reviewed.

### Lockfile

- [ ] All registry tarballs have integrity.
- [ ] No unexpected Git/URL/File `resolved` entries.
- [ ] `hasInstallScript` entries are reviewed and allowlisted.
- [ ] Optional dependencies are reviewed or omitted.
- [ ] Dependency diff is understood.

### Tarball contents

- [ ] Tarball matches expected repo/build output.
- [ ] No unexpected `setup.mjs`, `install.js`, `postinstall.js`, large one-line JS, hidden configs or native binaries.
- [ ] `.vscode`, `.claude`, `.cursor`, `.devcontainer`, `.npmrc` are absent unless explicitly expected.

### Code behavior

- [ ] No network+exec chain.
- [ ] No credential access+network chain.
- [ ] No GitHub API write behavior except documented release tooling.
- [ ] No obfuscated payload or unexplained minified large file.
- [ ] No cloud metadata, Vault or local token harvesting.

### CI/CD

- [ ] No unsafe `pull_request_target` or `workflow_run` path.
- [ ] Actions are pinned to full-length commit SHA or otherwise controlled by org policy.
- [ ] Token permissions are minimal.
- [ ] Publish workflows run only from protected refs.
- [ ] Dependency review installs use `--ignore-scripts`.

### TypeScript quality

- [ ] `tsconfig` uses strict settings or exceptions are documented.
- [ ] Declarations/types are published for libraries.
- [ ] Tests, lint and typecheck exist.
- [ ] README, LICENSE, SECURITY.md, repository metadata and engines are present.

## Findings

| Severity | File:line | Finding | Evidence | Recommendation | Status             |
| -------- | --------- | ------- | -------- | -------------- | ------------------ |
|          |           |         |          |                | needs-human-review |

## Decision rationale

Explain why the package is accepted, blocked or quarantined.

## Follow-up actions

- [ ] Upstream issue opened:
- [ ] Dependency pinned/reverted:
- [ ] Token rotation needed:
- [ ] Allowlist entry created:
- [ ] CI policy updated:
