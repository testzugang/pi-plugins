# Design-Spezifikation: Interaktive Regex-Eingabe & Shortcuts in pi-bash-approval

**Datum:** 2026-07-15  
**Status:** Approved (nach Review)  
**Autoren:** Pi Coding Assistant & User

---

## 1. Zielsetzung & Motivation

Die manuelle Freigabe von Bash-Befehlen (`pi-bash-approval`) neigt bei komplexeren, verzeichnisbezogenen Workflows zu Bestätigungsmüdigkeit. Zwar schlägt der `pi-approval-recorder` im Nachgang über `/bash-approval-report` intelligente Regex-Regeln vor, der Prozess erfordert jedoch, dass der Befehl zuvor mehrfach ausgeführt und manuell freigegeben wurde.

Dieses Design erweitert **`pi-bash-approval`** (im Monorepo `pi-extensions`) um eine direkte Tastenkombination (**`Ctrl+R`**) während des interaktiven Freigabe-Prompts. Dadurch kann der Benutzer:
1. Sofort ein vorausgefülltes, intelligentes Regex-Scoping-Muster für den gerade blockierten Befehl sehen.
2. Dieses Muster direkt per Enter bestätigen oder im Eingabefeld beliebig verfeinern (z. B. Pfade verallgemeinern oder Parameter lockern).
3. Das validierte Muster mit nur einer Bestätigung dauerhaft in `.bash-approval` speichern und den Befehl freigeben.

---

## 2. Architektur & TUI-Integration

### 2.1 Custom TUI-Prompt in `pi-bash-approval`

- **Datei:** `packages/pi-bash-approval/extensions/index.ts`
- **Kontext:** Bisher nutzt `pi-bash-approval` die Standard-Methode `ctx.ui.select()`. Diese ist starr und erlaubt keine Custom-Keypress-Zustände.
- **Änderung:** Wir ersetzen die standardmäßige `ctx.ui.select`-Auswertung in `resolveLocalDecision` durch einen Custom-TUI-Aufruf mittels `ctx.ui.custom()`.
- **Eingebaute Komponenten:** Wir nutzen die im Harness-TUI-Paket (`@earendil-works/pi-tui`) bereitgestellten Komponenten `Container`, `SelectList`, `Text` und `DynamicBorder`, um ein optisch identisches, aber interaktives Menü aufzubauen.

### 2.2 Tastatur-Shortcut `Ctrl+R` & Zustandsmaschine

In der `handleInput`-Methode unseres Custom-TUI-Prompts fangen wir `matchesKey(data, "ctrl+r")` ab und steuern folgenden deterministischen Ablauf:

```
[Select Menu] ──(ctrl+r)──► [Input Dialog (vorausgefüllt)]
     ▲                                   │
     │                                (Enter)
     │                                   │
     │                             (Syntax-Check)
     │                                /     \
(Cancel / Escape) ◄──────(invalid)───        ───(valid)──► [Speichern & Erlauben]
```

1. **Abbruch des Auswahldialogs:** Wir rufen das `done`-Callback des Prompts mit einem speziellen Kontroll-Zustand auf, um den aktuellen Selektor sauber zu schließen.
2. **Regex-Generierung (Vorbefüllung):** Wir führen denselben robusten Tokenizer und die Scoping-Mustererkennung für bekannte Befehle (`git -C`, `npm --prefix`, `docker exec`) aus, um ein vorgeschlagenes Regex-Muster zu berechnen.
3. **Eingabe-Dialog:** Wir öffnen den modalen Texteingabedialog `ctx.ui.input("Custom Regex eingeben:", suggestedRegex)`.
4. **Validierung & Ergänzung:** 
   - Startet die vom Benutzer eingegebene Regex nicht mit `r:`, **ergänzen wir das Präfix `r:` automatisch am Anfang der Eingabe** (z. B. wird `^git status$` automatisch zu `r:^git status$`).
   - Wir prüfen die syntaktische Korrektheit, indem wir **`new RegExp(customRegex.slice(2).trim())`** (also exakt den extrahierten Regex-Teil ohne das `r:`-Präfix) instanziieren.
   - Tritt dabei ein Fehler auf, fangen wir diesen ab, zeigen eine visuelle TUI-Warnmeldung (`ctx.ui.notify`) mit der Fehlermeldung an und öffnen den Prompt-Auswahldialog erneut.
5. **Persistierung & Duplikatprüfung:** 
   - Ist die Eingabe valide, prüfen wir zuerst, ob die Regel bereits in `config.allowed` vorhanden ist.
   - Falls die Regel ein Duplikat ist, überspringen wir das erneute Schreiben in die Datei.
   - Falls neu, schreiben wir sie an das Ende von `~/.pi/agent/.bash-approval` (`ALLOW_LIST_PATH`) und fügen sie `config.allowed` hinzu.
   - Der Befehl wird freigegeben und das `pi-bash-approval:allowed`-Event mit `mode: "allow_always"` gefeuert.

---

## 3. Datenfluss & Detail-Algorithmen

### 3.1 Tokenizer & Regex-Vorbefüllung in `pi-bash-approval`

Wir integrieren den bewährten, Quote-Aware Tokenizer in `packages/pi-bash-approval/extensions/utils.ts`, um Pfade mit Leerzeichen sicher als ein einzelnes Argument zu parsen.

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

Die Funktion `suggestRegexPattern(command: string): string` ermittelt:
- **Git Scoping:** Ist es ein Git-Befehl mit `-C <path>`? -> `r:^git -C (?:"[^"]+"|'[^']+'|\S+) <rest_escaped>$`
- **npm Scoping:** Ist es ein npm-Befehl mit `--prefix <path>`? -> `r:^npm --prefix (?:"[^"]+"|'[^']+'|\S+) <rest_escaped>$`
- **Docker Exec Scoping:** Ist es ein Docker-Befehl mit `exec <container>`?
  - Wir überspringen bekannte Option-Flags mit Argumenten: `const DOCKER_FLAGS_WITH_ARGS = new Set(["-u", "--user", "-w", "--workdir", "-e", "--env", "--cpus", "-m", "--memory", "--network", "--platform"]);`
  - Wir suchen das erste Token ab Index 2, das weder ein Option-Flag (startet mit `-`) noch das Argument eines vorherigen Flags ist. Dieses Token identifizieren wir als Container-Namen.
  - Generiertes Muster: `r:^docker exec <flags> (?:"[^"]+"|'[^']+'|\S+) <rest_escaped>$`
- **Fallback (jeder andere Befehl):** `r:^<escaped_command>$` (exakter Regex-Match als sichere Vorlage zum Editieren).

---

## 4. Fehlerbehandlung & Robustheit

- **Syntaktische Validierung:** Jede vom Benutzer eingegebene Regex wird zur Laufzeit in einem `try/catch`-Block kompiliert. Fehlerhafte reguläre Ausdrücke werden abgefangen, führen zu einer Warnmeldung auf dem Bildschirm und blockieren die Ausführung nicht destruktiv.
- **Benutzerabbruch (Escape):** Bricht der Benutzer den `ctx.ui.input`-Dialog mit `Escape` ab (Eingabe ist `null` oder `undefined`), fällt das System sicher auf den interaktiven Auswahldialog zurück, ohne den Befehl unkontrolliert freizugeben oder abzuspeichern.

---

## 5. Teststrategie (TDD)

Wir schreiben automatisierte Unit-Tests in `packages/pi-bash-approval/tests/bash-approval.spec.ts`:

- **Shortcut `ctrl+r`:** Prüft, ob `ctrl+r` im Prompt-Zustand korrekt abgefangen wird.
- **Vorbefüllung:** Verifiziert, dass ein Druck auf `ctrl+r` das `ctx.ui.input`-Feld mit der korrekten Regex-Vorbefüllung (z. B. bei `git -C`) öffnet.
- **Docker-Scoping-Muster:** Verifiziert die korrekte Regex-Generierung für Docker Exec-Szenarien inklusive Überspringen von Flags mit Argumenten.
- **Auto-Prefixing:** Verifiziert, dass Eingaben ohne `r:` automatisch um `r:` ergänzt werden.
- **Kompilierungs-Validierung:** Verifiziert, dass fehlerhafte Regex-Eingaben über `new RegExp` mit `slice(2)` korrekt abgefangen werden, eine Warnung ausgeben und nicht persistiert werden.
- **Duplikatvermeidung:** Verifiziert, dass bereits in der Whitelist existierende Regeln nicht erneut in die `.bash-approval`-Datei geschrieben werden.
- **Abbruchpfad:** Verifiziert, dass bei Abbruch des Eingabefelds (Escape) der Auswahldialog unberührt bleibt.
