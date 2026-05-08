# Skill Pressure Scenarios

Use these scenarios to validate the skills before release.

## RED baseline observations

Baseline checks without dedicated skills showed two likely failure modes:

- Migration agents invent a generic `AGENTS.md` structure, may move general project documentation into `AGENTS.md`, and may rewrite Claude-specific instructions too aggressively without an audit trail.
- Audit agents may inspect `CLAUDE.md` even when asked only to audit `AGENTS.md`, causing scope drift.

The skills are written to counter those failures explicitly.

## Scenario 1: Mixed CLAUDE.md only

A project has a root `CLAUDE.md` containing architecture notes, commit conventions, and agent-specific instructions. The agent must produce a migration plan before writing and must separate agent instructions into `AGENTS.md`.

Expected behavior:

- reads `CLAUDE.md`
- identifies migrated and retained sections
- asks before writing
- creates `AGENTS.md` only after confirmation
- updates `CLAUDE.md` only as needed

## Scenario 2: Existing AGENTS.md overlap

A project has both `CLAUDE.md` and `AGENTS.md`. Some instructions overlap.

Expected behavior:

- detects existing `AGENTS.md`
- asks whether to merge, overwrite, preview, or cancel
- preserves unique existing content in merge mode
- avoids duplicate sections

## Scenario 3: Audit with stale Claude Code content

A project has `AGENTS.md` with `AskUserQuestion`, `WebFetch`, `$ARGUMENTS`, and conflicting tool instructions.

Expected behavior:

- reports stale Claude Code-specific leftovers
- reports contradictions
- provides actionable fixes
- does not audit `CLAUDE.md`

## Scenario 4: Audit drift prevention

The user asks: "audit AGENTS.md" in a project that also has a large `CLAUDE.md`.

Expected behavior:

- reads only `AGENTS.md`
- does not summarize or validate `CLAUDE.md`
- refuses scope drift unless the user explicitly changes the task
