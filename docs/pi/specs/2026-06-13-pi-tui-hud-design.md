# Design-Spezifikation: pi-tui-hud Extension

## 1. Übersicht & Zielsetzung

Die `pi-tui-hud` Extension ist eine sichere, modulare und transparente Implementierung eines Heads-Up-Displays (HUD) für den Pi Coding Agent. Sie dient als vollständiger, sicherer Ersatz ("Safe-by-Design Clean Rewrite") der infizierten und unter Quarantäne gestellten `pi-powerline`-Erweiterung.

Die Ziele von `pi-tui-hud` sind:
- **Sicherheits-Garantie**: Vollständiger Verzicht auf vorkompilierte, gepackte oder obfuskierte Binärdaten (wie sie in der alten Extension vorkamen). 100 % lesbarer und auditierbarer TypeScript-Code.
- **Vollständiges Powerline-Replica**: Nahtlose Rekonstruktion des beliebten Terminal-Designs mit segmentiertem Footer, Gradient-Header und im Editor eingebetteten Breadcrumbs.
- **Echtzeit-Tokenmaxxing & Kosten-Transparenz**: Eine genaue Live-Visualisierung der genutzten Tokens, des Cache-Status und der kumulierten Session-Kosten während des LLM-Streamings.
- **Konfigurations-Flexibilität**: Flexible Steuerung aller visuellen Elemente über dedizierte Konfigurationsdateien und einen integrierten Slash-Command.

---

## 2. Technische Details & Architektur

### 2.1 Verzeichnis- und Dateistruktur

Alle Quellcodedateien werden lokal im Monorepo-Workspace abgelegt und direkt geladen:

```
extensions/pi-tui-hud/
├── index.ts          # Haupteinstiegspunkt, Flag-Registrierung, Slash-Command
├── settings.ts       # Ladet und speichert Konfigurationen (global & lokal)
├── footer.ts         # Custom Footer Renderer (Git, Tokens, Kosten, Statuses)
├── header.ts         # Custom Header Renderer (Gradient, Diagnostic Info)
├── editor.ts         # Editor Patching / Breadcrumb-Integration
├── breadcrumb.ts     # Logik für Breadcrumb-Berechnung und Rendering
└── utils.ts          # Hilfsfunktionen (Nerd-Font Abfrage, Styling-Hilfen)
```

### 2.2 Speicherort & Konfigurationsformat

Es gibt zwei getrennte Persistenz-Ebenen für die Einstellungen:

1. **Globale Standardkonfiguration**:
   - **Datei**: `~/.pi/agent/hud/settings.json`
2. **Projektlokale Overrides**:
   - **Datei**: `.pi/hud.json` im aktuellen Repository (CWD).

#### JSON-Format der Konfiguration:
```json
{
  "enabled": true,
  "breadcrumb": "inner",
  "footer": true,
  "header": true,
  "header-info": false
}
```
- `breadcrumb`: Unterstützt `"hide"`, `"top"` (als Widget über dem Editor) oder `"inner"` (direkt in die obere Rahmenlinie des TUI-Editors integriert).
- `header-info`: Zeigt zusätzliche diagnostische Details im Header an, wenn auf `true` gesetzt.

---

## 3. Funktionsweise der Komponenten

### 3.1 `settings.ts` (Konfigurations-Manager)
- Lädt die Einstellungen sequenziell: Standardwerte ➜ Globale Konfiguration ➜ Lokale Overrides.
- Exportiert eine `saveSettings()`-Funktion, die zur Laufzeit geänderte Einstellungen (z. B. via Slash-Command) sicher persistiert.

### 3.2 `footer.ts` (Fortschrittlicher TUI-Footer)
- Ersetzt den standardmäßigen Pi-Footer über die Schnittstelle `ctx.ui.setFooter(renderer)`.
- **Echtzeit-Streaming-Integration:** 
  - Hört auf `agent_start`, `message_update` und `message_end` Events.
  - Summiert alle Tokens bereits persistierter Assistant-Turns im Verlauf des SessionManagers.
  - Fusioniert diese Zahlen live während des Streamings mit der temporären Auslastung (`liveAssistantUsage`).
- **Berechnungen & Formatierung:**
  - Zeigt die relative Context-Auslastung in Prozent relativ zum maximalen Window des Modells an.
  - Wendet Schwellenwert-Färbungen an (TUI-Themenfarben): Gelb (`warning`) ab 70 % Auslastung, Rot (`error`) ab 90 % Auslastung.
  * Berechnet die Cache-Hit-Rate (`cacheRead / promptTokens * 100`) und zeigt diese an, sobald Caching aktiv ist.
  * Visualisiert akkumulierte Dollarkosten der Session.
- **Layout-Aufbau:**
  - **Zeile 1 (Status):**
    `[Git-Branch (Grün)]  [Context-Auslastung] [Input ↑] [Output ↓] [Cache R/W] [Kosten]   ...padding...  [Reasoning Level (farbig)]`
  - **Zeile 2 (Extension-Meldungen):**
    Visualisiert registrierte Status-Strings anderer Extensions (z. B. Headroom).

### 3.3 `header.ts` (Branding-Header)
- Ersetzt den Standard-Header durch ein elegantes, zentriertes Logo mit ansprechendem Farbverlauf.
- Zeigt bei aktiviertem `header-info` Systemdetails wie CWD, Modell-ID, Node-Version und aktive Extensions im Header-Widget an.

### 3.4 `editor.ts` & `breadcrumb.ts` (Breadcrumb-Integration)
- Holt den aktuellen Zustand des Editors über Pi-interne Events.
- Zeichnet den aktuellen Dateipfad sowie die Cursor-Zeilen- und Spaltenposition (`Line X, Col Y`).
- Bietet zwei Layout-Modi:
  - **`top`**: Ein separates TUI-Widget über dem Editor-Bereich.
  - **`inner`**: Ein hochgradig integriertes Patching der oberen Editor-Randlinie des TUI, um die Information platzsparend und bündig direkt in den TUI-Rahmen zu zeichnen.

---

## 4. Schnittstellen & Slash-Commands

### 4.1 `/hud` Befehl
Ein einheitlicher Slash-Command zur Steuerung des HUDs mit Autovervollständigung:

- `/hud`: Schaltet das HUD masterseitig ein oder aus.
- `/hud info`: Gibt den aktuellen Aktivitätsstatus aller Sub-Komponenten aus.
- `/hud breadcrumb:<hide|top|inner>`: Wechselt den Darstellungsmodus der Breadcrumbs.
- `/hud footer:<on|off>`: Schaltet den benutzerdefinierten Token-Footer an oder aus.
- `/hud header:<on|off>`: Schaltet den Gradienten-Header an oder aus.
- `/hud header-info:<on|off>`: Blendet Diagnoseinformationen im Header ein oder aus.

---

## 5. Sicherheitsgarantie & Auditing

Um die Sicherheitsbedenken der alten Powerline-Extension vollständig auszuräumen, verpflichtet sich `pi-tui-hud` zu folgenden strikten Richtlinien:

1. **Kein verdeckter Code:** Keine transpilierte `.js`-Ausgabe im Repository, kein Minifizieren und keine verschleierten Zeichenketten (`_0x...` oder Base64-Ausführungen).
2. **Keine Netzwerkaktivität:** Das Plugin führt keinerlei ausgehende Netzwerk- oder Socket-Verbindungen aus (`fetch`, `http`, `curl` usw. sind absolut verboten).
3. **Keine Shell-Injektionen:** Vollständiger Verzicht auf das Ausführen externer Shell-Prozesse (`child_process.exec` oder `spawn`). Alle Operationen werden nativ in TypeScript innerhalb des Pi-Agent-Prozesses abgewickelt.

---

## 6. Testbarkeit & Qualitätssicherung

- **Unit-Tests**: Abdeckung der mathematischen Token-Summierung, Cache-Hit-Raten-Ermittlung und Konfigurationsauflösung in `tests/pi-tui-hud/`.
- **Manuelle TUI-Prüfung**: Visuelle Kontrolle des Layouts bei Fenstergrößenänderungen (Resize) und verschiedenen Terminal-Emulatoren (macOS Terminal, iTerm2, Kitty).
- **Graceful Fallbacks**: Wenn ein Modell keine Reasoning-Tokens unterstützt oder das Context-Window unbekannt ist, fällt das Layout automatisch auf eine sichere Standard-Darstellung zurück.
