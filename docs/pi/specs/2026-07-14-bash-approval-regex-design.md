# Design-Spezifikation: Regex-Unterstützung für Bash-Approvals

**Datum:** 2026-07-14  
**Status:** In Review  
**Autoren:** Pi Coding Assistant & User  

---

## 1. Zielsetzung & Motivation
Die manuelle Freigabe von Bash-Befehlen (`pi-bash-approval`) neigt bei komplexeren Workflows zu Bestätigungsmüdigkeit (Confirmation Fatigue). Die bisherigen Glob-Muster (`:*` und `*`) sind oft entweder zu restriktiv oder zu unsicher (z. B. erlaubt `git -C:*` jegliche Git-Befehle im gesamten System).

Durch die Einführung von regulären Ausdrücken (Regex) können feingranulare, sichere Freigaberegeln definiert werden (z. B. `r:^git -C \S+ status --short$`), die Pfade flexibel halten, aber das ausgeführte Kommando exakt einschränken.

Diese Spezifikation beschreibt die Implementierung in zwei Repositories:
1. **`pi-extensions` (Upstream-Monorepo):** Erweiterung von `@fgladisch/pi-bash-approval` um die Auswertung von Regex-Regeln.
2. **`pi-plugins` (Lokales Repository):** Erweiterung von `pi-approval-recorder` um intelligente Regex-Vorschläge für Scoping-Befehle.

---

## 2. Architektur & Datenfluss

### 2.1 Regex-Evaluation in `pi-bash-approval`
- **Datei:** `packages/pi-bash-approval/extensions/utils.ts`
- **Schnittstelle:** `matchesPattern(command: string, pattern: string, onError?: (err: Error) => void): boolean`
- **Verhalten:**
  1. Falls das Pattern mit dem Präfix `r:` startet, wird der restliche String als regulärer Ausdruck interpretiert.
  2. **Vollständige Verankerungs-Enclosure (Sicherheit & Robustheit):**
     Um Sicherheitslücken durch unvollständige Verankerung oder logische Alternationen (wie `r:git status|.*`) mathematisch auszuschließen, transformieren wir den regulären Ausdruck beim Laden.
     - Da verschachteltes Anchoring wie `/^(?:^git status$)$/` in JavaScript regulären Ausdrücken völlig valide ist und sich identisch zu `/^(?:git status)$/` verhält, verzichten wir vollständig auf fehleranfälliges Abschneiden von führenden `^` oder trailing `$`. Dies verhindert die Zerstörung von legitimen Escapes am Zeilenende (wie `\$` in `echo \$`).
     - Wir umschließen die Regex-Quelle des Benutzers einfach immer direkt mit einem nicht-fangenden Gruppenkonstrukt: **`/^(?:<user_regex_source>)$/`**.
     - *Beispiel:* Aus `r:git status|ls -la` wird intern `/^(?:git status|ls -la)$/`. Aus `r:^git status$` wird `/^(?:^git status$)$/`. Dies garantiert, dass die gesamte Befehlszeile matchen muss und verhindert Injection-Angriffe an den Rändern.
  3. Die Regex wird mit `new RegExp(finalEnclosedSource)` geladen (Case-Sensitive, da Shell-Befehle Case-Sensitive sind).
  4. Tritt ein Syntaxfehler beim Kompilieren auf, wird der Fehler abgefangen, das `onError`-Callback aufgerufen und `false` zurückgegeben.
  5. Andernfalls wird `regex.test(trimmedCommand)` evaluiert.

**Integration in `evaluateCommand` und `index.ts`:**
- `evaluateCommand` erhält einen optionalen `onError`-Callback und reicht diesen an `matchesPattern` durch.
- Im TUI-Handler in `index.ts` übergeben wir ein Callback, das bei ungültigen Regex-Regeln über `ctx.ui.notify(..., "warning")` eine visuelle Warnung anzeigt, um den Benutzer auf den Fehler in seiner `.bash-approval` hinzuweisen.

---

### 2.2 Intelligente Regex-Vorschläge in `pi-approval-recorder`
- **Datei:** `packages/pi-approval-recorder/lib/report.ts`
- **Verhalten:**
  Wir führen eine intelligente Mustererkennung für bekannte Scoping-Befehle ein.

  **Quote-Aware Tokenizer:**
  Um Pfade mit Leerzeichen in Anführungszeichen korrekt zu parsen, implementieren wir einen robusten Tokenizer in `lib/report.ts`:
  ```typescript
  export function tokenize(command: string): string[] {
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    const tokens: string[] = [];
    let match;
    while ((match = regex.exec(command)) !== null) {
      tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens;
  }
  ```

  **Universeller Pfad-Platzhalter (PATH_PATTERN):**
  Um sowohl ungequotete Pfade ohne Leerzeichen, als auch gequotete Pfade mit Leerzeichen sicher abzufangen, verwenden wir folgenden Regex-Platzhalter:
  👉 `(?:"[^"]+"|'[^']+'|\S+)`

  **Robuster Parsing-Algorithmus für Docker Exec:**
  - Bekannte Flags mit Argumenten werden in einem Set definiert:
    `const DOCKER_FLAGS_WITH_ARGS = new Set(["-u", "--user", "-w", "--workdir", "-e", "--env", "--cpus", "-m", "--memory", "--network", "--platform"]);`
  - Wenn die ersten beiden Tokens des Befehls `docker` und `exec` lauten, durchlaufen wir die nachfolgenden Tokens ab Index 2.
  - Trifft der Algorithmus auf ein Token, das in `DOCKER_FLAGS_WITH_ARGS` liegt, überspringt er das unmittelbar nachfolgende Token (da dieses der Wert des Flags ist).
  - Das erste verbleibende Token, das nicht mit `-` beginnt, ist der Container-Name.
  - Der Container-Name wird im Vorschlag durch `(?:"[^"]+"|'[^']+'|\S+)` ersetzt. Alle anderen Parameter bleiben exakt erhalten.

  **Beispiel-Erkennungen:**
  1. **Git mit Directory-Scoping:** `git -C <path> <subcommand>`
     - Regex-Vorschlag: `r:^git -C (?:"[^"]+"|'[^']+'|\S+) <subcommand_escaped>$`
  2. **npm mit Directory-Scoping:** `npm --prefix <path> <subcommand>`
     - Regex-Vorschlag: `r:^npm --prefix (?:"[^"]+"|'[^']+'|\S+) <subcommand_escaped>$`
  3. **Docker Exec mit Container-Scoping:** `docker exec -it --user root <container> <subcommand>`
     - Regex-Vorschlag: `r:^docker exec -it --user root (?:"[^"]+"|'[^']+'|\S+) <subcommand_escaped>$`

  **Regex-Escaping Hilfsfunktion:**
  Eine robuste Hilfsfunktion `escapeRegExp(string)` wird verwendet, um Regex-Metazeichen (wie `.`, `+`, `*`, `?`, `^`, `$`, `(`, `)`, `[`, `]`, `{`, `}`, `|`, `\`) in den statischen Befehlsteilen sicher zu maskieren.

  **Fallback:**
  Bei unklaren Strukturen oder Parsing-Unsicherheiten fallen wir konservativ auf klassische Prefix-Globs (z. B. `git status:*`) zurück.

---

## 3. Fehlerbehandlung & Sicherheit
- **Sicherheit (Command Injection):** Wird durch die automatische Verankerungs-Enclosure (`/^(?:...)$/`) auf Engine-Ebene unüberwindbar abgesichert.
- **Sicherheit (ReDoS):** Da `.bash-approval` eine lokale Vertrauensgrenze darstellt, ist das Risiko minimal. Automatisch generierte Regex-Muster sind flach (ohne verschachtelte Quantoren) und immun gegen ReDoS.
- **Robustheit:** Jegliche Fehler beim Parsen von regulären Ausdrücken werden mittels `try/catch` isoliert. Ein korruptes Regex-Muster darf niemals den Start von Pi oder die Ausführung von Werkzeugen blockieren.

---

## 4. Teststrategie (TDD)
Wir verwenden Vitest für automatisierte Unittests in beiden Repositories.

### 4.1 Tests für `pi-bash-approval`
- Matcht korrekte Regex-Muster (z. B. `r:git status --short` matcht `git status --short`).
- Verankerungs-Enclosure: `r:git status` matcht `git status` exakt, aber nicht `git status --short` oder `rm -rf / && git status`.
- Alternations-Sicherheit: `r:git status|ls -la` matcht `git status` und `ls -la` exakt, aber nicht `git status --short` oder `ls -la -R`.
- Escapes am Zeilenende: `r:echo \$` matcht `echo $` exakt (keine Zerstörung des Escapes).
- Fängt fehlerhafte reguläre Ausdrücke ab, ruft das `onError`-Callback auf und gibt `false` zurück.
- Gewährleistet Abwärtskompatibilität für klassische Globs (`:*` und `*`).

### 4.2 Tests für `pi-approval-recorder`
- Tokenizer: Erkennt Pfade mit Leerzeichen in Anführungszeichen korrekt als ein einzelnes Token.
- Generiert korrekte Regex-Vorschläge für `git -C ...` mit `(?:"[^"]+"|'[^']+'|\S+)` Platzhalter.
- Generiert korrekte Regex-Vorschläge für `npm --prefix ...` mit `(?:"[^"]+"|'[^']+'|\S+)` Platzhalter.
- Identifiziert Container-Namen bei `docker exec` auch bei komplexen Flags wie `--user root` und ersetzt sie korrekt.
- Escapt Sonderzeichen in den statischen Befehlsteilen korrekt.

---

## 5. Deployment- & PR-Ablauf
Wir unterteilen die Umsetzung in zwei logische Phasen:

### Phase 1: Upstream Regex-Matching (`pi-bash-approval`)
1. **Branch erstellen** im Monorepo `pi-extensions` (`feat/bash-approval-regex`).
2. **Implementierung & lokale Verifizierung** der Änderungen an `pi-bash-approval` inklusive Tests.
3. **Erstellung des Pull Requests** an `fgladisch/pi-extensions`.

### Phase 2: Lokale Recorder-Vorschläge (`pi-plugins`)
1. **Implementierung & Verifizierung** der erweiterten Vorschlagslogik in `pi-plugins` (`pi-approval-recorder`).
2. **Commit & Push** im lokalen Repository `pi-plugins`.
