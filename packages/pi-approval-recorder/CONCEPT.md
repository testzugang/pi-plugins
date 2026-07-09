# Konzept: pi-approval-recorder

## Ziel
Aufzeichnen manueller Bash-Bestätigungen, um wiederkehrende Muster zu erkennen. Erleichtert das Erstellen neuer Regeln für die `~/.pi/agent/.bash-approval` Allowlist von `pi-bash-approval`. Reduziert manuelle Freigaben langfristig.

## Warum Event-Subscription statt eigener Inferenz?
`pi-bash-approval` (>= 0.2.7) emittiert auf dem geteilten Event-Bus (`pi.events`) das Event `pi-bash-approval:allowed` mit `mode: "allowlist" | "allow_once" | "allow_always"`. Damit ist direkt beobachtbar, ob ein Kommando automatisch erlaubt oder manuell bestätigt wurde — eine eigene Nachbildung des Allowlist-Matchings (Regex-Interpretation, Chain-Splitting, Normalisierung) ist unnötig und war in der ersten Version fehlerhaft.

Das Event-Payload ist der öffentliche Vertrag; das Paket selbst wird nicht importiert (kein Entry Point). Payloads werden defensiv validiert.

## Architektur

### 1. Aufzeichnung (Event-Subscription)
- `pi.events.on("pi-bash-approval:allowed", …)`.
- `mode === "allowlist"` → ignorieren (automatisch erlaubt).
- `mode === "allow_once" | "allow_always"` → manuelle Bestätigung, wird geloggt (inkl. `rule`, falls persistiert).
- Fehler beim Loggen werden verschluckt: der Recorder ist ein passiver Beobachter und darf die Session nie stören.
- Schreibzugriffe auf das Log werden intern serialisiert (Append-Queue), damit schnell aufeinanderfolgende Events die Reihenfolge nicht verfälschen.

### 2. Datenhaltung
- Datei: `~/.pi/agent/logs/manual-approvals.jsonl` (append-only).
- Format: `{"timestamp": "...", "command": "...", "cwd": "...", "mode": "allow_once" | "allow_always", "rule": "..."?}`.
- Alt-Einträge ohne `mode` (aus der fehlerhaften Erstversion) werden beim Auswerten ignoriert.

### 3. Auswertung
- Kommando `/bash-approval-report`.
- Aggregiert `allow_once`-Einträge nach vorgeschlagener Regel; Schwelle: >= 2 Vorkommen.
- Vorschläge im Format von `pi-bash-approval` (`cmd subcmd:*` Prefix-Glob, analog dessen `suggestPrefixPattern`) — keine Regexes, keine mehrzeiligen Regeln.
- Regeln, die bereits wörtlich in der Allowlist stehen, werden nicht erneut vorgeschlagen.

## Abhängigkeiten
- Laufzeit: `@fgladisch/pi-bash-approval` >= 0.2.7 muss installiert sein, sonst wird nichts aufgezeichnet (Events fehlen).
- Modulstruktur: `extension.ts` (Wiring), `lib/manual-approval-log.ts` (Log), `lib/report.ts` (Auswertung).
