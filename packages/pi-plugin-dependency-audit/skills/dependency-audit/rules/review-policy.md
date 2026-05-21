# npm/TypeScript review policy

## Block by default

Block use until human review when any of these are present:

- Install-phase lifecycle script: `preinstall`, `install`, `postinstall`, `prepublish`, `prepare`, `dependencies`.
- Git/URL/File/Alias dependency in `optionalDependencies`.
- Git dependency not pinned to a full 40-character commit SHA.
- Lockfile entry with `hasInstallScript: true` that is not on an explicit allowlist.
- Remote tarball URL outside the approved registry list.
- Missing integrity for registry tarballs.
- Obfuscated JS/TS in lifecycle-referenced files or package root.
- Native binary artifacts without provenance and reproducible-build documentation.
- GitHub Actions workflow with untrusted PR code plus write/publish/OIDC permissions.

## Quarantine

Quarantine and do not install when any of these are present:

- Known IOC from `rules/iocs.txt`.
- Download+execute chain.
- Credential access plus network or GitHub write API.
- Cloud metadata / Vault / local token harvesting.
- IDE/AI-agent config persistence in package tarball.
- Live token or private credential in published package/repo.
- Tarball path traversal.

## Allowlist evidence required

For each allowlisted exception, record:

- Package name/version or repo commit.
- Exact file and line.
- Why the behavior is required.
- Owner approving the exception.
- Expiration/review date.
- Safer alternative considered.
