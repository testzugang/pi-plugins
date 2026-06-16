# Design-Spezifikation: pi-tui-hud Extension

## 1. Übersicht & Zielsetzung

`pi-tui-hud` ist eine sichere, modulare HUD-Extension für den Pi Coding Agent. Sie ersetzt die quarantänisierte `pi-powerline`-Extension durch auditierbaren TypeScript-Code ohne vorkompilierte, gepackte oder obfuskierte Payloads.

Ziele:

- **Sicherheit:** Kein verdeckter Code, keine Netzwerkaktivität, keine Shell-Ausführung.
- **HUD-Darstellung:** Gradient-Header, Powerline-ähnlicher Footer und Breadcrumbs im Editor oder als Widget.
- **Transparenz:** Live-Kontextauslastung, kumulierte Tokens, Cache-Hit-Rate und Session-Kosten.
- **Reaktive Konfiguration:** Slash-Command-Änderungen wirken im aktiven TUI ohne Render-Hotpath-Dateizugriffe.

## 2. Architektur

```text
extensions/pi-tui-hud/
├── index.ts       # Einstiegspunkt, Flag-Registrierung, Slash-Command
├── settings.ts    # Persistierte + effektive Settings, Validierung
├── footer.ts      # Footer-Renderer, Usage-/Status-Caches, Event-Reaktionen
├── header.ts      # Gradient-Header, Header-Info, Gradient-Memoization
├── editor.ts      # CustomEditor-Integration, Breadcrumb-State pro Editor-Instanz
├── breadcrumb.ts  # Breadcrumb-Daten, Sanitization, Rendering
└── utils.ts       # Typguards, Nerd-Font-Erkennung, Hex-Farben
```

Komponenten registrieren sich über Pi-Events (`session_start`, `hud_settings_changed`, `model_select`, `thinking_level_select`, `agent_start`, `message_update`, `message_end`, `session_shutdown`) und stellen native UI-Komponenten über `ctx.ui.setHeader`, `ctx.ui.setFooter`, `ctx.ui.setEditorComponent` und `ctx.ui.setWidget` bereit.

## 3. Konfiguration

Persistenz-Ebenen:

1. Global: `~/.pi/agent/hud/settings.json`
2. Projektlokal: `.pi/hud.json` im aktuellen CWD

Projektlokale Werte überschreiben globale Werte. Runtime-Flags werden zusätzlich über `readEffectiveSettings()` angewendet; `--hud=false` erzwingt `enabled: false`, ohne die persistierte Konfiguration zu verändern.

```json
{
  "enabled": true,
  "breadcrumb": "inner",
  "footer": true,
  "header": true,
  "header-info": false
}
```

Settings werden validiert. Ungültige Werte werden ignoriert und per Warnung gemeldet. `writeSetting()` persistiert nur validierte lokale Overrides.

## 4. Komponentenverhalten

### 4.1 Header

- Rendert `PI-TUI-HUD` mit Pink-zu-Cyan-Gradient (`#d787af` → `#00afaf`).
- Nutzt `Intl.Segmenter`, damit Unicode-Grapheme, Emoji und ZWJ-Sequenzen nicht durch ANSI-Codes zerlegt werden.
- Memoisiert `getGradientText(text, startHex, endHex)` nach exakt diesen Eingaben. Wiederholte Header-Renders vermeiden erneute Segmentierung und Farbinterpolation.
- Fällt bei ungültigen Hex-Farben unverändert auf Plaintext zurück.
- Optionales `header-info` zeigt Modell und CWD, beide vorher plaintext-sanitized.

### 4.2 Breadcrumb / Editor

Breadcrumb-Daten enthalten:

- Modellname
- Thinking-Level
- aktueller Ordner

Darstellung:

- `breadcrumb: "inner"`: Breadcrumb wird in die obere Rahmenlinie des `CustomEditor` gezeichnet.
- `breadcrumb: "top"`: Breadcrumb wird als Widget oberhalb des Editors gerendert.
- `breadcrumb: "hide"`: Breadcrumb-Darstellung wird deaktiviert.

Editor-State ist pro `HudCustomEditor`-Instanz snapshot-basiert. Alte Editor-Instanzen und alte Factory-Closures können dadurch kein neueres Modell, Thinking-Level, Folder oder Theme aus module-level mutable state anzeigen.

### 4.3 Footer

Der Footer zeigt in Zeile 1:

```text
[Git-Branch] [Context-Auslastung/Window] [Input ↑] [Output ↓] [Cache-Hit CH:%] [Kosten]
```

Der Footer zeigt **kein** Thinking-Level; Thinking-Level gehört zum Breadcrumb.

Kontext-Farben:

- `< 50 %`: `success`
- `50–69.9 %`: `accent`
- `70–90 %`: `warning`
- `> 90 %`: bold `error`

Usage-Verhalten:

- Kumulierte Assistant-Usage wird außerhalb des Render-Hotpaths gecacht.
- `render()` kombiniert nur gecachte kumulierte Usage mit aktueller Live-Usage.
- `message_end` aktualisiert den Usage-Cache aus dem Event; nur bei fehlender Event-Usage wird aus der Session-History neu aufgebaut.
- Identische `message_update`-Usage während Streaming triggert keinen redundanten Render.

Extension-Statuszeile:

- Status-Einträge werden sortiert, ANSI-/Control-Sequenzen sicher sanitisiert und als zweite Footer-Zeile gerendert.
- Sortierte/sanitisierte Statusausgabe wird über Content-Signaturen gecacht.
- Breiten-Truncation bleibt renderabhängig.

## 5. Slash-Command

`/hud` unterstützt:

- `/hud` — HUD global umschalten.
- `/hud info` — aktive Settings anzeigen.
- `/hud breadcrumb:<hide|top|inner>` — Breadcrumb-Modus setzen.
- `/hud footer:<on|off>` — Footer umschalten.
- `/hud header:<on|off>` — Header umschalten.
- `/hud header-info:<on|off>` — diagnostische Header-Zeile umschalten.

Nach Änderungen wird `hud_settings_changed` ausgelöst, damit Header/Footer/Editor ohne Neustart aktualisieren.

## 6. Sicherheit

- Keine transpilierte/minifizierte Runtime-Ausgabe im Repository.
- Keine Netzwerkzugriffe (`fetch`, `http`, `net`, `curl` etc.).
- Keine Shell-Ausführung (`child_process.exec`, `spawn` etc.).
- Lifecycle-Handler nutzen `isExtensionContext()`-Guards, bevor UI-Kontext verwendet wird.
- Von externen Extensions gelieferte Statusstrings werden aggressiv von gefährlichen Terminal-Control-Sequenzen bereinigt; nur sichere SGR-Farb-/Style-Codes bleiben erhalten.

## 7. Tests & Verifikation

Automatisierte Tests liegen unter `tests/pi-tui-hud/` und decken ab:

- Settings-Validierung, persistierte vs effektive Settings.
- Hex-Farbparser und Terminal-Farbhelper.
- Breadcrumb-Sanitization, Modell/Thinking/Folder-Rendering.
- Editor-State-Isolation und Widget-/Inner-Breadcrumb-Verhalten.
- Header-Gradient, Unicode-Grapheme, invalid Hex fallback, Gradient-Memoization.
- Footer-Usage-Berechnung, Status-Sanitization, Status-Cache, Live-Usage-Render-Dedupe.

Standard-Verifikation:

```bash
npx vitest run tests/pi-tui-hud
npm run validate
```
