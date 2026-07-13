# Design-Spezifikation: Handoff-Session Extension

## 1. Übersicht & Zielsetzung

`pi-handoff-session` ist eine Pi-Extension, die aus der aktuellen Session einen fokussierten Handoff für eine neue Session erzeugt. Ziel ist ein schneller, kontrollierter Session-Wechsel: Kontext wird verdichtet, das Ziel der nächsten Session wird klar formuliert, relevante Dokumente werden referenziert statt dupliziert, und die neue Session wird vorbereitet, aber nicht automatisch gestartet.

Der primäre Slash-Command ist:

```text
/handoff-session
```

Ziele:

- **Fokussierter Neustart:** Eine neue Session soll direkt auf den nächsten Arbeitsschritt vorbereitet sein.
- **Kontrollierte Verdichtung:** Der Handoff enthält das Ziel der neuen Session und nur notwendigen Kontext, der nicht bereits in referenzierten Dokumenten steht.
- **Referenz statt Duplikation:** Specs, ADRs, Pläne, Handoffs, PRs oder Commits werden verlinkt/referenziert; ihr Inhalt wird nicht in den Handoff kopiert.
- **Explizite UI-Kontrolle:** Optionale Angaben werden über eine Custom-UI erfasst und vor dem Wechsel prüfbar gemacht.
- **Sicherer Start:** Der erzeugte Prompt landet als Draft im Editor der neuen Session. Der User sendet ihn manuell ab.

## 2. Paketstruktur

Das Feature wird als eigenes Monorepo-Package umgesetzt:

```text
packages/pi-handoff-session/
├── package.json
├── README.md
├── extensions/
│   └── handoff-session/
│       ├── index.ts          # Extension entrypoint, command registration
│       ├── handoff.ts        # Context extraction and prompt generation inputs
│       ├── ui.ts             # Custom overlay form and prompt editor component
│       ├── references.ts     # Reference parsing, auto-detection, path/link formatting
│       ├── session.ts        # New-session setup: parent, model entry, name entry, editor draft
│       └── naming.ts         # Session name and file slug generation
└── tests/
    └── handoff-session/
```

`package.json` exposes the extension through Pi package metadata:

```json
{
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

The top-level workspace can include this package through the existing `workspaces` pattern.

## 3. Slash-Command Verhalten

### 3.1 Command

`/handoff-session` öffnet in TUI mode eine Custom-Overlay-UI. In nicht-interaktiven Modi meldet der Command einen Fehler, weil der Workflow auf Dialog- und Editor-UI angewiesen ist.

Argumente für den Command sind Teil des MVP:

```text
/handoff-session implement the next phase
```

Wenn Argumente vorhanden sind, werden sie als initiales Ziel in die UI übernommen. Ohne Argument wird das Ziel-Feld mit einem sinnvollen Default vorbelegt, z. B. `Start the next step from this handoff`.

### 3.2 UI-Felder

Die Custom-UI enthält:

- **Goal**: Ziel der neuen Session; wird im Handoff prominent als Aufgabe formuliert.
- **Target model**: Ziel-Model der neuen Session; Default ist das aktuelle Model, kann aber separat gewählt werden.
- **Session name**: automatisch aus Ziel/Handoff generiert und editierbar.
- **References**: optionales Freitextfeld für Pfade, URLs, PRs, Commits oder Issue-IDs.
- **Save handoff file**: optionaler Toggle; Default `false`.
- **Handoff prompt preview/editor**: nach der Generierung editierbarer Prompt innerhalb derselben Custom-UI.

Die UI hat zwei Phasen:

1. **Options phase**: User erfasst Ziel, Ziel-Model, Referenzen und Speicheroption.
2. **Preview phase**: Extension generiert den Handoff-Prompt und zeigt ihn editierbar an. User kann bestätigen oder abbrechen.

Abbruch in beiden Phasen lässt die aktuelle Session unverändert.

## 4. Model-Konzept

Es gibt zwei Model-Rollen:

1. **Generator model**: immer das aktuelle Model der bestehenden Session. Es erzeugt den Handoff-Prompt.
2. **Target model**: das in der UI gewählte Model für die neue Session.

Begründung:

- Der Generator bleibt an den aktuellen Session-Kontext und die vorhandene Authentifizierung gebunden.
- Die neue Session kann bewusst mit einem anderen Model weitergeführt werden, ohne den Handoff-Generator umzuschalten.
- Die UI bleibt verständlich: eine explizite Auswahl betrifft nur die neue Session.

Wenn kein aktuelles Generator-Model verfügbar ist oder kein API-Key aufgelöst werden kann, bricht der Command mit einer UI-Fehlermeldung ab.

## 5. Handoff-Erzeugung

### 5.1 Eingaben

Der Generator erhält:

- aktuelle Branch-Historie der Session,
- vorhandene Compaction Summary, falls die Session bereits kompaktierte Teile enthält,
- Ziel der neuen Session,
- manuelle Referenzen aus der UI,
- automatisch erkannte Referenzen aus der aktuellen Session,
- Hinweis, dass referenzierte Dokumente nicht dupliziert werden sollen.

Referenzierte Dokumente werden **nicht** gelesen. Sie werden nur als Pfade/Links an den Generator übergeben. Der nächste Agent kann sie bei Bedarf gezielt öffnen.

### 5.2 Auto-Erkennung von Referenzen

Die Extension erkennt aus dem aktuellen Session-Branch mindestens:

- Projektdateipfade aus User-/Assistant-Nachrichten,
- bereits erwähnte Specs, ADRs, Pläne und Handoffs,
- Commit-Hashes,
- PR-/Issue-URLs,
- explizite Markdown-Dokumente unter `docs/`.

Die Erkennung ist best-effort. Manuelle Referenzen aus der UI haben Vorrang und werden immer übernommen.

### 5.3 Prompt-Regeln

Der Generator-Prompt fordert folgende Struktur:

```markdown
## Goal
[Ziel der neuen Session]

## Context
[Notwendiger Kontext, der nicht bereits in referenzierten Dokumenten steht]

## Decisions
[Wichtige Entscheidungen aus der bisherigen Session]

## References
- [Pfad/URL/Commit] — kurzer Hinweis, warum relevant

## Next task
[Konkrete Startaufgabe für die neue Session]

## Recommended skills/tools
[Optional: relevante Skills oder Prüfungen]
```

Wichtige Regeln:

- Keine langen Inhalte aus referenzierten Dokumenten kopieren.
- Keine Spekulation als Fakt darstellen.
- Offene Fragen explizit markieren.
- Aktuellen CWD, Branch und relevante Dateiänderungen nennen, wenn sie für den nächsten Schritt wichtig sind.
- Den Prompt so schreiben, dass die neue Session ohne die alte Konversation starten kann.

## 6. Neue Session

Nach Bestätigung der Preview erzeugt die Extension über die Pi Session-API eine neue Session.

Die neue Session erhält:

- **Parent-Link** auf die aktuelle Session über `ctx.newSession({ parentSession })`.
- **Session name** aus dem editierbaren UI-Feld über `SessionManager.appendSessionInfo(name)` während `setup`.
- **Target model** als `model_change`-Entry über `SessionManager.appendModelChange(provider, modelId)` während `setup`.
- **Editor draft** mit dem finalen Handoff-Prompt über `replacementCtx.ui.setEditorText(prompt)` im `withSession`-Kontext.

Der Prompt wird **nicht automatisch abgesendet**. Die neue Session öffnet sich mit dem Handoff-Prompt im Editor; der User kann noch letzte Änderungen machen und drückt selbst Enter.

## 7. Optionales Speichern als Datei

Wenn `Save handoff file` aktiviert ist, schreibt die Extension den finalen Handoff nach:

```text
docs/pi/handoffs/YYYY-MM-DD-<slug>.md
```

Der Slug wird aus dem Session-Namen oder Ziel erzeugt:

- lowercase,
- ASCII-orientiert,
- Wörter durch `-` getrennt,
- keine Shell- oder Pfad-Sonderzeichen,
- Kollisionen werden mit numerischem Suffix aufgelöst.

Dateien werden nur innerhalb `docs/pi/handoffs/` geschrieben. Existierende Dateien werden nicht überschrieben.

Default bleibt `Save handoff file = false`, damit der schnelle Workflow keine unnötigen temporären Dateien erzeugt.

## 8. Fehlerbehandlung und Sicherheit

- Der Command läuft nur in interaktivem TUI mode mit UI-Unterstützung.
- Fehlendes Generator-Model, fehlende API-Credentials oder abgebrochene Generierung werden als UI-Fehler bzw. Info gemeldet.
- Der Wechsel in eine neue Session erfolgt erst nach expliziter Bestätigung der Preview.
- Bei abgebrochenem `ctx.newSession()` wird die alte Session nicht weiter verändert.
- Referenzpfade werden normalisiert und dürfen beim optionalen Speichern nicht aus `docs/pi/handoffs/` ausbrechen.
- Die Extension liest keine Secrets und keine `.env`-Inhalte.
- Referenzierte Dateien werden nicht automatisch gelesen; dadurch werden große oder sensible Dokumente nicht ungefragt in den Generator-Prompt aufgenommen.

## 9. Tests & Verifikation

Automatisierte Tests sollten abdecken:

- Slug-Generierung inklusive Sonderzeichen und Kollisionssuffix.
- Referenz-Parsing für Pfade, URLs, Commits und Duplikate.
- Prompt-Input-Aufbau mit Ziel, Referenzen und Compaction Summary.
- Regel: referenzierte Dokumente werden nicht gelesen.
- Handoff-Dateipfad bleibt unter `docs/pi/handoffs/`.
- Session-Setup schreibt Parent, Session-Name, Target-Model und Editor-Draft über die vorgesehenen Pi APIs bzw. Session-Einträge.
- Abbruchpfade verändern weder aktuelle noch neue Session ungewollt.

Standard-Verifikation:

```bash
npm run validate
npx vitest run packages/pi-handoff-session/tests
```

Manuelle Verifikation:

1. `/handoff-session` in einer normalen TUI-Session öffnen.
2. Ziel, anderes Target-Model und Session-Name setzen.
3. Referenzen eintragen und Speichern deaktiviert lassen.
4. Preview prüfen und bestätigen.
5. Neue Session öffnet sich mit korrektem Namen, Target-Model und Prompt-Draft.
6. Zurück prüfen, dass kein Handoff-File geschrieben wurde.
7. Workflow wiederholen mit `Save handoff file = true`; Datei unter `docs/pi/handoffs/` prüfen.

## 10. Abgrenzung / Nicht-Ziele

Nicht Teil des MVP:

- Automatisches Absenden des Handoff-Prompts.
- Vollständige Tree-Auswahl einzelner Session-Branches.
- Lesen oder Zusammenfassen referenzierter Dokumente.
- Persistente globale Defaults für die UI.
- Cross-project Session-Handoffs.
- Import oder Migration bestehender Handoff-Dokumente.

Diese Punkte können später ergänzt werden, wenn der MVP stabil ist.

## 11. Quellen

- Pi Skills: `/skill:name` commands und Skill-Discovery — `~/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Pi Slash Commands: Extension Commands, Skill Commands und Prompt Templates — `~/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/usage.md`
- Pi Extensions: `pi.registerCommand()`, `ctx.ui`, `ctx.newSession()` und Session-Replacement-Footguns — `~/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi Prompt Templates: einfache Slash-Command-Alternative ohne eigene UI/Session-Steuerung — `~/.nvm/versions/node/v22.22.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/prompt-templates.md`
- Bestehendes Handoff-Skill-Verhalten im Repository — `skills/handoff/SKILL.md`
