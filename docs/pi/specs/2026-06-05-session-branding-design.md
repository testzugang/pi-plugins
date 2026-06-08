# Design-Spezifikation: Session-Branding Extension

## 1. Übersicht & Zielsetzung

Die `session-branding` Extension dient dazu, Pi-Sessions visuell und akustisch unterscheidbar zu machen. Sie ermöglicht es:

- Sessions einen Namen zu geben und diesen im Terminal-Tab anzuzeigen.
- Jeder Session bzw. jedem Repository eine feste, wiedererkennbare Farbe zuzuweisen, die dauerhaft im Projekt persistiert wird.
- Den aktuellen Aktivitäts-Status (Idle, Thinking, Executing, Blocked) live im Tab-Titel zu visualisieren.
- Einen Ton (Terminal-Bell oder konfigurierbarer System-Befehl) abzuspielen, wenn die Session in den Zustand "Blocked" (wartet auf Benutzereingabe) übergeht.

---

## 2. Technische Details & Architektur

### 2.1 Speicherort & Konfigurationsformat

Es gibt zwei unterschiedliche Persistenz-Ebenen:

1. **Repository-Farbe & Sound-Konfiguration (projektlokal)**:
   - **Datei**: `.pi/branding.json` im aktuellen Arbeitsverzeichnis (CWD).
   - **Format**:
     ```json
     {
       "color": "blue",
       "soundCommand": "afplay /System/Library/Sounds/Glass.aiff"
     }
     ```
     _(Hinweis: `soundCommand` ist optional. Ist es nicht definiert, wird standardmäßig die native Terminal-Bell `\x07` verwendet)._
2. **Session-Name (session-spezifisch)**:
   - Der Session-Name wird nativ über `pi.setSessionName()` im jeweiligen `.jsonl`-Session-File gespeichert. Er überdauert Reloads und `/resume`, ist aber an die spezifische Session gebunden.

### 2.2 Farb- und Emoji-Mapping

Folgende Farben werden unterstützt und auf Emojis für den Tab-Titel gemappt:

- `red` -> 🔴
- `orange` -> 🟠
- `yellow` -> 🟡
- `green` -> 🟢
- `blue` -> 🔵
- `purple` -> 🟣
- `black` -> ⚫
- `white` -> ⚪

### 2.3 Status-Steuerung & Emojis

Der Aktivitäts-Status wird im Tab-Titel über folgende Symbole dargestellt:

- **💤 Idle**: Bereit, wartet auf Benutzereingabe (Standardzustand).
- **⏳ Thinking**: LLM verarbeitet die Anfrage oder generiert eine Antwort.
- **⚙️ Executing**: Ein Tool (z. B. `bash`, `edit`, `write`) wird ausgeführt.
- **⚠️ Blocked**: Die Session wartet auf eine direkte Benutzerinteraktion (z. B. Bestätigung, Auswahldialog).

#### Zustands-Hierarchie (Prioritäten):

Da mehrere Aktionen parallel ablaufen können (z. B. parallele Tools), wird der aktive Zustand über ein einfaches Prioritätssystem bestimmt:

1. **Blocked** (wenn `isBlocked === true`) -> Höchste Priorität.
2. **Executing** (wenn `activeToolsCount > 0`) -> Zweithöchste Priorität.
3. **Thinking** (wenn `isThinking === true`) -> Dritthöchste Priorität.
4. **Idle** (Standardzustand) -> Niedrigste Priorität.

#### Zustands-Übergänge (Events):

- `session_start` -> Initialisierung: `isThinking = false`, `activeToolsCount = 0`, `isBlocked = false`. Status wird auf **💤 Idle** gesetzt.
- `agent_start` -> `isThinking = true`.
- `tool_execution_start` -> `activeToolsCount++`.
- `tool_execution_end` / `tool_result` -> `activeToolsCount--`.
- `agent_end` -> `isThinking = false`.

#### Blocked-Erkennung (Prototype Monkeypatching):

Um zuverlässig zu erkennen, wann ein beliebiges Tool oder eine andere Extension ein blockierendes UI-Element anzeigt, wird das Prototyp-Objekt von `ctx.ui` einmalig bei `session_start` gemonkeypatched:

- Die Methoden `confirm`, `select`, `input`, `editor` und `custom` des `ctx.ui`-Prototyps werden abgefangen:
  ```typescript
  const uiProto = Object.getPrototypeOf(ctx.ui);
  const originalConfirm = uiProto.confirm;
  uiProto.confirm = async function (...args) {
    setBlocked(true);
    try {
      return await originalConfirm.apply(this, args);
    } finally {
      setBlocked(false);
    }
  };
  ```
- Bei `setBlocked(true)` wird der Zustand auf **⚠️ Blocked** gesetzt und der Sound abgespielt.
- In `session_shutdown` werden die Original-Methoden auf dem Prototyp wiederhergestellt, um Seiteneffekte nach dem Entladen zu vermeiden.

#### Sound-Wiedergabe:

- **Terminal Bell**: Wird via `process.stdout.write("\x07")` ausgelöst.
- **Sound-Befehl**: Wird asynchron im Hintergrund über Node `child_process.exec` ausgeführt, um die UI nicht zu blockieren. Bei einem Fehler wird auf die Terminal Bell zurückgegriffen.

---

## 3. Schnittstellen (Commands & CLI)

### 3.1 Slash-Commands

- `/session-name <name>`:
  - Setzt den Anzeigenamen der aktuellen Session via `pi.setSessionName()`.
  - Aktualisiert den Tab-Titel sofort.
- `/session-color [<color>]`:
  - Setzt die Farbe für das aktuelle Repository.
  - Wenn `<color>` weggelassen wird, wird ein TUI-Auswahldialog (`ctx.ui.select`) mit allen verfügbaren Farben geöffnet.
  - Wenn ein ungültiger Farbwert übergeben wird, wird eine Fehlermeldung via `ctx.ui.notify` angezeigt und die Liste der unterstützten Farben ausgegeben.
  - Speichert die Auswahl in `.pi/branding.json`.
  - Aktualisiert Tab-Titel und TUI-Widget sofort.

### 3.2 TUI-Widget

Ein dezentes Widget über dem Editor (`placement: "aboveEditor"`) zeigt die Markenidentität der aktuellen Session an:

```text
● Session: [Session-Name] ([Farbe])
```

Das `●` Symbol wird in der gewählten TUI-Farbe gerendert (z. B. `theme.fg("error", "●")` bei rot).

---

## 4. Testbarkeit & Qualitätssicherung

- **Unit-Tests**: Abdeckung von Konfigurations-Lese/Schreibvorgängen, Farb-Mapping und Zustandsübergängen.
- **Manuelle Verifikation**: Überprüfung der Tab-Titel-Änderung in verschiedenen Terminal-Emulatoren (macOS Terminal, iTerm2).
- **Fehlerbehandlung**: Wenn `soundCommand` fehlschlägt, wird ein Fallback auf die Terminal-Bell durchgeführt und eine Warnung protokolliert.
