# Handoff: Bash Approval Recorder Extension

- **Date:** 2026-06-16
- **Context:** We designed and implemented a new Pi extension (`pi-approval-recorder`) to track manually approved `bash` commands. The goal is to detect recurring manual approvals and suggest new Regex rules for `~/.pi/agent/.bash-approval` to reduce manual confirmation fatigue.

## Key Decisions

1. **Passive Event Analysis over UI-Proxy:** We explicitly decided against wrapping/proxying `ctx.ui.select`. Instead, the extension hooks into `pi.on("tool_result")` for `bash`. By comparing successfully executed commands against the known allowlist (`~/.pi/agent/.bash-approval`), we can deduce whether a command was manually approved (if it succeeded despite not being in the list). This avoids fragile string matching on UI prompts and race conditions with other extensions like `pi-guardrails`.
2. **Storage:** Approvals are stored as JSONL in `~/.pi/agent/logs/manual-approvals.jsonl` (format: timestamp, command, cwd) for easy appending and machine parsing.
3. **Command:** Added `/bash-approval-report` to generate a summary of commands approved at least twice, including exact-match Regex suggestions.

## Artifacts

- Concept: `packages/pi-approval-recorder/CONCEPT.md`
- Implementation: `packages/pi-approval-recorder/extension.ts`
- Package Config: `packages/pi-approval-recorder/package.json`
- Workspace integration: Added to `extensions` in root `package.json`.

## Next Steps / Review

1. **Verify Extension Loading:** Reload Pi and check if `pi-approval-recorder` is loaded without errors.
2. **Test Tracking:** Execute an unapproved bash command, approve it manually via the `pi-bash-approval` dialog, and verify it appears in `~/.pi/agent/logs/manual-approvals.jsonl`.
3. **Test Reporting:** Run the `/bash-approval-report` command in the Pi TUI to verify the aggregation and Regex suggestions.
4. **Regex Escaping:** The current suggestion logic in `generateReport()` uses a naive `replace` for regex escaping. This might need refinement for complex bash commands with quotes or variables.
