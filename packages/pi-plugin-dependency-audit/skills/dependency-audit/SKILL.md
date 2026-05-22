---
name: dependency-audit
description: Use when you need to audit an npm package, a GitHub repository, or pending dependency updates for supply-chain malware and risky lifecycle scripts before installation. Default action without parameters is to audit all pending updates.
---

# npm/TypeScript Package & Dependency Audit Skill

## Ziel

Nutze diesen Skill, wenn TypeScript-/JavaScript-Code, ein npm-Paket, ein GitHub-Repository, ein Dependency-Update oder ein npm-Lockfile vor der Nutzung geprüft werden soll. Der Fokus liegt auf Malware- und Supply-Chain-Erkennung vor `npm install`, `npm ci`, Build, Test, Import oder IDE-/CI-Ausführung.

### Automatischer Workflow (ohne Parameter)

Wenn der Skill ohne weitere Parameter aufgerufen wird (z.B. `/skill:dependency-audit`), muss **immer zuerst** eine explizite Modus-Auswahl über `user_select` erfolgen.

Pflichtfrage (immer, als erster Schritt):

- **"Pi-Dependencies prüfen"**
- **"Projekt-Dependencies (aktuelles Verzeichnis) prüfen"**
- **"Beides prüfen"**

Regeln:

1. Diese Auswahl darf nicht übersprungen werden, auch nicht bei fehlender `package.json`.
2. Existiert bei Auswahl "Projekt-Dependencies" keine `package.json`, gib eine klare Rückfrage: Pfad angeben oder auf Pi-Dependencies wechseln.
3. Starte keine Prüfung, bevor der Nutzer einen der drei Modi bestätigt hat.

Führe dann je nach Auswahl die entsprechenden Szenarien aus:

**Szenario A: Lokale npm-Abhängigkeiten**

1. Führe `npm outdated --json` (oder ein äquivalentes Tool) aus, um die Liste verfügbarer Updates zu ermitteln.
2. Iteriere durch die ermittelten Pakete.
3. Führe für jedes Paket die in diesem Skill beschriebenen statischen Prüfungen durch.
4. Generiere einen aggregierten Report.

**Szenario B: Globale Pi-Erweiterungen**

1. Nutze bevorzugt die mitgelieferten Hilfsskripte statt ad-hoc Bash-Loops:
   - `scripts/pi-check-current-global-versions.sh`
   - `scripts/pi-check-latest-npm-versions.sh`
   - `scripts/pi-check-git-source-updates.sh`
   - optional End-to-End: `scripts/run_pi_dependency_audit.py`
2. Nutze die Config-Resolution für Sicherheitsrichtlinien (Priorität):
   - `--config /path/to/config.json`
   - `~/.pi/dependency-audit.json`
   - `skills/dependency-audit/config.json`
   - Fallback auf Defaults
3. `min_update_age_hours` steuert die Mindest-Altersschwelle für Updates. Default ist `24`.
4. Ermittle für jedes Paket, ob auf der Remote-Quelle (z. B. auf GitHub) neue Commits oder Versionen verfügbar sind.
5. Wenn ein Update jünger als `min_update_age_hours` ist, markiere es als `too_fresh` mit `SKIP_TOO_FRESH`.
6. Klone/lade die übrigen Updates temporär herunter, **ohne sie zu installieren oder Scripte auszuführen**.
7. Führe die in diesem Skill beschriebenen statischen Prüfungen auf dem neuen Code durch.
8. Generiere einen Report, der angibt, welche Pi-Erweiterungen sicher aktualisiert werden können. **Präsentiere am Ende des Berichts immer einen maßgeschneiderten nativen `pi update`-Vorschlag (siehe Abschnitt "Natives Pi-Paketmanagement (`pi update`)"), der blockierte/quarantänisierte oder zu frische Pakete explizit auslässt.**

### Spezifischer Workflow (mit Parametern)

Wenn der Skill mit einem Paketnamen oder einer Repository-URL aufgerufen wird, fokussiere die Prüfung ausschließlich auf dieses Ziel. Lade den Code in ein temporäres Verzeichnis herunter und wende die Prüfphasen statisch an.

Der Skill ist bewusst auf npm und TypeScript zugeschnitten. Er prüft insbesondere:

- `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `.npmrc`.
- npm-Lifecycle-Scripts wie `preinstall`, `install`, `postinstall`, `prepare`, `prepack`, `prepublish`.
- `optionalDependencies`, Git-/URL-/File-Dependencies, Aliase, Overrides und Resolutions.
- npm-Tarballs (`.tgz`) ohne Installation oder Script-Ausführung.
- TypeScript-/JavaScript-Quellen, `dist/`, `lib/`, CLI-`bin`-Entrypoints und minifizierte/obfuskierte Dateien.
- GitHub Actions und Publish-/Release-Workflows.
- IDE-/AI-Agent-Poisoning über `.vscode`, `.claude`, `.cursor`, `.devcontainer`.
- Qualität: Typisierung, `tsconfig`, Tests, Linting, Metadaten, Lockfile-Disziplin, Reproduzierbarkeit.

## Threat Model

Behandle jedes unbekannte npm-Paket und jede neue Dependency-Version als potenziell feindlich. Typische npm-/TS-Angriffe sind:

1. **Install-Time Malware**: `preinstall`, `postinstall` oder `prepare` startet einen Downloader, Bootstrapper oder Token-Stealer.
2. **Git-Dependency-Falle**: Eine scheinbar harmlose Dependency zeigt auf GitHub. Beim Installieren kann npm ein `prepare`-Script dieser Git-Dependency ausführen.
3. **Optional-Dependency-Versteck**: Bösartiger Code liegt in `optionalDependencies`, wird leicht übersehen und kann bei Fehlern weniger auffallen.
4. **Tarball-Poisoning**: Der veröffentlichte npm-Tarball enthält zusätzliche Dateien, die nicht im GitHub-Repo sichtbar sind.
5. **Compiled JS Payload**: TypeScript-Repo wirkt sauber, aber `dist/`, `lib/` oder `setup.mjs` enthält obfuskierten JavaScript-Code.
6. **Credential Harvesting**: Code sucht nach `GITHUB_TOKEN`, `NPM_TOKEN`, AWS-/Vault-/GitHub-Actions-OIDC-Secrets oder lokalen Dateien wie `.npmrc`, `.aws/credentials`, `.config/gh/hosts.yml`.
7. **Repo-/IDE-Persistence**: Malware schreibt `.vscode/tasks.json`, `.claude/settings.json` oder ähnliche Konfigurationen, damit andere Entwickler oder AI-Coding-Agents später Code ausführen.
8. **CI/CD-Missbrauch**: Workflows führen untrusted Code mit Write-Rechten, npm-Publish-Token oder OIDC-Rechten aus.

## Sicherheitsvertrag

Diese Regeln sind verbindlich:

1. **Kein untrusted Code wird ausgeführt.** Kein `npm install`, `npm ci`, `npm test`, `npm run build`, `npx`, `pnpm install`, `yarn install`, `bun install`, `node setup.mjs`, `tsx`, `ts-node`, `docker build` oder ähnliches vor statischer Prüfung.
2. **Kein `npm pack` aus einem untrusted Repo.** `npm pack` gehört zu den npm-Pack-Lifecycle-Abläufen und kann `prepack`, `prepare` und `postpack` betreffen. Für veröffentlichte Pakete lieber Registry-Metadaten lesen und den bereits veröffentlichten Tarball herunterladen.
3. **Keine echten Secrets in der Analyseumgebung.** Vor der Prüfung keine GitHub-, npm-, AWS-, Azure-, GCP-, Vault- oder CI-Tokens exportieren.
4. **Netzwerk ist standardmäßig aus.** Registry-/GitHub-Metadaten nur verwenden, wenn der Nutzer es erlaubt oder es zur Aktualitätsprüfung notwendig ist.
5. **Artefakte immutable festhalten.** Repository immer auf exakten Commit-SHA; npm-Paket immer auf exakte Version und Tarball-Hash.
6. **Script-Ausführung bleibt deaktiviert.** Review-Installationen nur mit `--ignore-scripts`, möglichst zusätzlich ohne optionale Dependencies.
7. **Gefundene Secrets werden maskiert.** Nie komplette Tokens in Report, Chat, Logs oder Tickets ausgeben.
8. **Jedes `CRITICAL` oder `HIGH` Finding blockiert Nutzung**, bis es manuell verifiziert, entfernt oder bewusst allowlisted wurde.

## Eingaben

Erfrage oder bestimme:

- Paketname und Version, z. B. `@scope/pkg@1.2.3`, oder lokaler Repo-/Tarball-Pfad.
- Exakter Git-Commit oder Release-Tag.
- Nutzungsziel: Library, CLI, Frontend-App, Backend-Service, CI-Build, Production.
- Package Manager: npm, pnpm, yarn oder bun. Dieser Skill bewertet primär npm-Semantik; pnpm/yarn-Lockfiles werden statisch mitgeprüft.
- Ob Netzwerkzugriff für Registry-/GitHub-Metadaten erlaubt ist.
- Ob es ein Dependency-Update ist; falls ja: alte Version, neue Version und Diff-Kontext.

Wenn Angaben fehlen, führe eine konservative Best-Effort-Prüfung aus und dokumentiere Annahmen.

## Ablauf

### Phase 0: Secret-freie Analyseumgebung

Nutze ein separates Verzeichnis oder eine Sandbox. Entferne Tokens aus der Shell:

```bash
unset GITHUB_TOKEN GH_TOKEN NPM_TOKEN NODE_AUTH_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN VAULT_TOKEN
```

Optional: Netzwerk in der Sandbox blockieren, sobald Artefakte vorliegen.

### Phase 1: Artefakt beschaffen, ohne Code auszuführen

#### GitHub-Repo

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone --no-checkout <repo-url> repo-under-review
cd repo-under-review
git checkout --detach <exact-commit-sha-or-tag>
git submodule status --recursive || true
```

Prüfe sofort `.gitmodules`, Workspaces, `package.json`, Lockfiles und `.github/workflows`.

#### Veröffentlichtes npm-Paket

Metadaten lesen, ohne Installation:

```bash
npm view <package>@<version> name version dist.tarball dist.integrity dist.shasum time maintainers repository license --json
```

Tarball herunterladen und Hash festhalten. Beispiel:

```bash
curl -fL -o package-under-review.tgz '<dist.tarball-url>'
sha256sum package-under-review.tgz
```

Dann den Tarball mit dem mitgelieferten Scanner prüfen. Nicht installieren.

### Phase 2: Automatisierte statische Triage

```bash
python3 scripts/npm_ts_static_triage.py /path/to/repo-or-package.tgz \
  --mode package \
  --markdown npm-ts-audit.md \
  --json npm-ts-audit.json \
  --sarif npm-ts-audit.sarif \
  --strict-exit
```

Modi:

- `package`: Standard für npm-Paket/Tarball.
- `library`: TypeScript-Library; Version-Ranges sind weniger stark gewichtet, weil Libraries häufig Ranges nutzen.
- `application`: App/Service; fehlende Lockfiles und Floating Ranges sind stärker relevant.
- `repo`: allgemeines Repository-/Monorepo-Review.

Der Scanner führt keinen Zielcode aus. Er extrahiert `.tgz`-Dateien sicher, folgt keinen Symlinks, scannt `package.json`, Lockfiles, npmrc, TS/JS-Dateien, Workflows und bekannte IoCs.

### Phase 3: `package.json` manuell prüfen

Blockiere oder eskaliere bei:

- Install-Phase-Scripts: `preinstall`, `install`, `postinstall`, `prepublish`, `prepare`, `preprepare`, `postprepare`, `dependencies`.
- Pack-/Publish-Scripts: `prepack`, `postpack`, `prepublishOnly`, `publish`, `postpublish`, wenn sie nicht trivial und dokumentiert sind.
- Script-Inhalte mit `curl`, `wget`, `fetch`, `axios`, `got`, `node -e`, `eval`, `new Function`, `child_process`, `execSync`, `spawn`, `bun`, `python`, `bash`, `powershell`, `chmod +x`, Base64-/zlib-/AES-Decodern.
- Kombinationen wie Download plus Execute, Secret-Zugriff plus Netzwerk oder `&& exit 1` nach Ausführung.
- `optionalDependencies` mit `github:`, `git+`, `http(s)://`, `file:`, `link:` oder `npm:` Alias.
- `overrides` oder `resolutions`, die transitive Dependencies auf Git-/URL-/File-Quellen umbiegen.
- `bundleDependencies`/`bundledDependencies`, besonders `true`.
- `bin`-Entrypoints, die auf obfuskierte oder fehlende Dateien zeigen.
- `publishConfig.registry`, `.npmrc` oder Package-Metadaten, die auf nicht erwartete Registries zeigen.

### Phase 4: Lockfile- und Dependency-Prüfung

Prüfe:

- `package-lock.json`-Einträge mit `hasInstallScript: true`.
- `resolved`-Werte mit `git+`, `github:`, `http://`, nicht erwarteten Registries oder lokalen `file:`-Quellen.
- Fehlende `integrity`-Werte bei Registry-Tarballs.
- `optional: true` plus Install-Script oder Git-/URL-Quelle.
- Neue oder stark geänderte transitive Dependencies im PR-Diff.
- Lockfile fehlt bei Application-/CI-Projekten.

Für pnpm/yarn-Lockfiles statisch nach `requiresBuild: true`, Git-/URL-Quellen und nicht erwarteten Registries suchen.

### Phase 5: npm-Tarball-Inhalt prüfen

Bei veröffentlichten Paketen ist der Tarball maßgeblich, nicht nur das GitHub-Repo. Prüfe im extrahierten Tarball:

- Zusätzliche Dateien: `setup.mjs`, `install.js`, `postinstall.js`, `preinstall.js`, `router_init.js`, große `*.js`-Einzeiler.
- Unterschiede zwischen Repo und Tarball.
- Unerwartete `.npmrc`, `.vscode`, `.claude`, `.cursor`, `.devcontainer`, Git-Hooks oder Shell-Scripts.
- Native Dateien: `.node`, `.so`, `.dll`, `.dylib`, `.exe`, `.wasm`.
- Große minifizierte/obfuskierte Dateien mit `_0x...`, Base64-Blobs, `crypto.createDecipheriv`, `zlib.gunzipSync`, `eval`, `Function`.
- `files`-Feld und `.npmignore`: Wird wirklich nur das erwartete Paket ausgeliefert?

### Phase 6: Payload- und Exfiltrationsmuster

Suche in TS/JS/MJS/CJS/CLI-Dateien nach Kombinationen:

- Netzwerk: `fetch`, `http.request`, `https.get`, `axios`, `got`, `undici`, `curl`, `wget`, URL-Literale.
- Ausführung: `child_process`, `exec`, `execSync`, `spawn`, `eval`, `new Function`, `vm.runInNewContext`, `WebAssembly.instantiate`.
- Secrets: `process.env`, `GITHUB_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `ACTIONS_ID_TOKEN`, AWS-/Vault-Variablen.
- Lokale Credential-Dateien: `.npmrc`, `.aws/credentials`, `.config/gh/hosts.yml`, `.git-credentials`, `.netrc`, `.ssh`, `.docker/config.json`.
- Cloud-/Vault-Probes: `169.254.169.254`, `metadata.google.internal`, `127.0.0.1:8200`.
- GitHub API Write-Verhalten: `createCommitOnBranch`, `createRef`, `updateRef`, `repos/*/contents`, `api.github.com/graphql`.
- IDE-/Agent-Pfade: `.claude/settings.json`, `.vscode/tasks.json`, `.cursor`, `.devcontainer`.

Eine einzelne Netzwerk- oder Exec-Nutzung kann legitim sein. Die Kombination aus Netzwerk + Ausführung, Secret-Zugriff + Netzwerk oder IDE-Persistence + GitHub Write API ist ein Stop-Signal.

### Phase 7: GitHub Actions und CI/CD

Prüfe `.github/workflows/*.yml`:

- `pull_request_target` mit Checkout oder `run:` von untrusted Code.
- `workflow_run` mit Artefakt-Download und Ausführung.
- `permissions: write-all` oder fehlende Minimalrechte.
- `contents: write`, `packages: write`, `actions: write`, `id-token: write` ohne klare Begründung.
- `npm install`/`npm ci` ohne `--ignore-scripts` in Review-/Dependency-Jobs.
- `npm publish` mit `NPM_TOKEN`/`NODE_AUTH_TOKEN` aus nicht geschützten Branches.
- Third-party Actions ohne full-length Commit-SHA.

### Phase 8: TypeScript-/Package-Qualität

Bewerte:

- `tsconfig.json`: `strict`, `noImplicitAny`, `strictNullChecks`, `declaration` für Libraries.
- `types`/`typings`, `exports`, `main`, `module` zeigen auf vorhandene Dateien.
- Tests, Linting, Typecheck-Scripts und CI vorhanden.
- README, LICENSE, SECURITY.md, Repository-Metadaten, `engines.node`.
- Reproduzierbarkeit: Lockfile für Applications, dokumentierter Build, SBOM, Provenance/Attestations, Release-Tags.
- Keine unklare generierte Ausgabe in `dist/` ohne nachvollziehbare Quelle.
- Dependency-Policy: Cooldown für neue Versionen, Renovate/Dependabot mit menschlichem Review, Allowlist für Scripts und non-registry Sources.

## Sichere Installation nach Freigabe

Erst nach statischer Prüfung und manueller Freigabe:

```bash
npm ci --ignore-scripts --omit=optional
npm audit --audit-level=high
npm audit signatures
```

Für Review-Installationen optional zusätzlich moderne npm-Quellbeschränkungen nutzen, falls unterstützt:

```bash
npm ci --ignore-scripts --omit=optional --allow-git=none --allow-remote=none --allow-file=none
```

Wenn ein Paket legitime Native Builds oder Install-Scripts braucht, erst eine minimale Allowlist definieren, dann in einer Sandbox ohne Secrets ausführen.

## Natives Pi-Paketmanagement ("pi update")

Pi verwaltet Erweiterungen, Skills, Prompt-Templates und Themes nativ über Paket-Definitionen in `~/.pi/agent/settings.json` (unter `"packages"`) unter Verwendung der Protokolle `npm:` und `git:`.

- **npm-Pakete (`npm:pkg-name`)**: Werden global (`npm install -g`) oder projektlokal unter `.pi/npm/` installiert.
- **Git-Pakete (`git:github.com/user/repo`)**: Werden global nach `~/.pi/agent/git/<host>/<path>` geklont. Nach jedem `git pull` führt Pi automatisch `npm install` im geklonten Verzeichnis aus.

### Erstellung des Update-Vorschlags im Report

Der Auditor muss am Ende des Berichts **immer** den passenden, maßgeschneiderten Befehl zur Durchführung der sicheren Updates vorschlagen:

1. **Ausschluss-Regel**: Blockierte/quarantänisierte Pakete und zu frische Pakete (`too_fresh`, die die Altersschwelle `min_update_age_hours` unterschritten haben) dürfen **niemals** im Update-Vorschlag enthalten sein.
2. **Spezifischer Update-Vorschlag (Chaining)**: Wenn einzelne Pakete aufgrund von Sicherheitsbedenken oder Altersschwellen ausgelassen werden müssen, generiere einen verketteten Einzelupdate-Befehl mittels `&& \`, um nur die verifizierten Pakete gezielt zu aktualisieren:
   ```bash
   pi update npm:pi-mcp-adapter && \
   pi update npm:pi-total-recall && \
   pi update git:github.com/fgladisch/pi-skills
   ```
3. **Komplett-Update (Sammelbefehl)**: Wenn alle anstehenden Updates sicher sind und kein Paket ausgelassen werden muss, schlage den Sammelbefehl vor:
   ```bash
   pi update --extensions
   ```

### Interaktive Terminal-Integration (Wrapper)

Um den standardmäßigen `pi update` Befehl im Terminal abzufangen, sodass er automatisch diesen interaktiven Sicherheits-Audit triggert und eine interaktive Auswahl anbietet, kann folgende Shell-Funktion in die Shell-Konfiguration (z. B. `~/.zshrc` oder `~/.bashrc`) eingetragen werden:

**If installed via GitHub/Git (legacy):**
```bash
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/agent/git/github.com/testzugang/pi-plugins/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```

**If installed via npm:**
```bash
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/packages/node_modules/@testzugang/pi-plugin-dependency-audit/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```

Nach dem Neuladen der Shell (`source ~/.zshrc`) führt jede Eingabe von `pi update` oder `pi update --extensions` direkt zu dem interaktiven Audit-Menü.

## Severity-Regeln

- `CRITICAL`: bekannte IoC, Credential-Exfiltration, Download+Execute, Secret-Zugriff+Netzwerk, IDE-/Agent-Persistence mit GitHub-Write, Path-Traversal im Tarball, live Token im Paket.
- `HIGH`: Install-Phase-Lifecycle-Scripts, Git-/URL-/File-Dependencies in `optionalDependencies`, unpinned Git-Dependencies, obfuskierter Lifecycle-Entrypoint, CI mit untrusted Code und Write-/Publish-Rechten.
- `MEDIUM`: Lockfile-Einträge mit Install-Scripts, non-default Registries, fehlende Integrity, bundled Dependencies, risky Scripts ohne klare Exfil-Kombination, fehlender Lockfile bei Apps.
- `LOW`: Qualitäts-/Hygieneprobleme, fehlende Metadaten, schwache TS-Konfiguration, fehlende Security-Dateien.
- `INFO`: Inventar, Workspaces, neutrale Beobachtungen.

## Stop-Regeln

Empfehlung sofort auf **nicht nutzen / Quarantäne**, wenn eines zutrifft:

- Known IOC im Manifest, Lockfile oder Code.
- Lifecycle-Script lädt Code/Binaries nach und führt sie aus.
- Datei kombiniert `child_process`/`eval` mit `fetch`/HTTP/Download.
- Code liest Tokens oder Credential-Dateien und hat Netzwerk- oder GitHub-API-Zugriff.
- `optionalDependencies` zeigen auf GitHub/Git/URL und können `prepare` auslösen.
- npm-Tarball enthält unerwartete IDE-/Agent-Konfigurationen.
- Workflow kann untrusted Code mit `NPM_TOKEN`, GitHub Write-Rechten oder OIDC ausführen.

## Reportformat

Jeder Befund enthält:

- Severity.
- Kategorie.
- Datei und Zeile.
- Evidence, kurz und maskiert.
- Warum riskant.
- Empfohlene Maßnahme.
- Status: `confirmed`, `needs-human-review`, `false-positive-candidate`.

Nutze `templates/report.md` für manuelle Reviews und die Reports des Scanners für automatisierte Runs.

## Grenzen des Skills

Ein sauberer statischer Report beweist nicht, dass ein Paket sicher ist. Er reduziert Früh-Risiko vor Installation und Ausführung. Stark verschleierte Payloads, polymorphe Malware, native Binaries, absichtlich harmlose Stubs mit späterem Remote-Update und Registry-/Account-Kompromisse können zusätzliche manuelle oder sandboxed Analyse erfordern.
