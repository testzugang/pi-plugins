---
name: migrate-to-agents-md
description: Use when migrating, splitting, or restructuring agent-specific instructions from CLAUDE.md into AGENTS.md, especially when preserving project documentation while moving agent guidance.
---

# Migrate to AGENTS.md

## Goal

Move agent-specific guidance from `CLAUDE.md` into root `AGENTS.md` while preserving general project documentation in `CLAUDE.md`.

Do not perform a blind rewrite. Present a migration plan and get user confirmation before writing files.

## What Belongs Where

| Destination | Content                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` | Agent behavior rules, tool/workflow guidance, delegation rules, safety constraints for agents, harness-specific instructions, trigger conditions, review workflows.         |
| `CLAUDE.md` | Project overview, architecture, setup, development commands, testing notes, commit conventions, release process, team conventions that are useful as project documentation. |

When content is mixed, split it conservatively. Preserve meaning over clever rewriting.

## Workflow

1. Find root `CLAUDE.md`.
   - If it does not exist, report that there is nothing to migrate and stop.
2. Read `CLAUDE.md` completely.
3. Check whether root `AGENTS.md` exists.
4. Classify `CLAUDE.md` sections:
   - move to `AGENTS.md`
   - keep in `CLAUDE.md`
   - rewrite/generalize before moving
   - ambiguous, needs user choice
5. Present a migration plan before writing.
6. Ask the user what to do with `user_select`.
7. Write only after explicit confirmation.
8. After writing, summarize changed files and recommend `/skill:audit-agents-md`.

## Existing AGENTS.md

If `AGENTS.md` already exists, stop and ask the user how to proceed:

- Merge migrated content into existing `AGENTS.md`.
- Overwrite existing `AGENTS.md`.
- Preview proposed `AGENTS.md` first.
- Cancel migration.

Merge mode must preserve unique existing content and avoid duplicate sections. If the merge is ambiguous, ask before writing.

## Migration Plan Format

Before edits, show:

```text
Migration Plan

Move to AGENTS.md:
- <section>: <reason>

Keep in CLAUDE.md:
- <section>: <reason>

Rewrite before moving:
- <section>: <what changes and why>

Needs user decision:
- <section>: <question>

Files that would change:
- AGENTS.md: create | merge | overwrite
- CLAUDE.md: update | unchanged
```

Then ask the user to choose:

- Proceed with migration.
- Preview full proposed files first.
- Customize section choices.
- Cancel migration.

## Writing AGENTS.md

Use a clear structure. Adapt headings to the source material, but prefer this shape when no better structure exists:

```markdown
# AGENTS.md

Instructions for coding agents working in this repository.

## Project Context

Short context needed by agents. Do not duplicate long project documentation.

## Agent Instructions

Rules and workflows agents must follow.

## Tools and Commands

Harness-specific or project-specific tool guidance.

## Safety and Verification

Testing, review, destructive-operation, and permission rules.
```

Do not move all architecture or setup docs into `AGENTS.md`. Link or summarize only what agents need to act safely.

## Updating CLAUDE.md

Update `CLAUDE.md` only as needed:

- Remove or reduce migrated agent-specific sections.
- Preserve general project documentation.
- Add a short pointer if useful:

```markdown
## Agent Instructions

See [AGENTS.md](./AGENTS.md) for coding-agent instructions.
```

Do not delete `CLAUDE.md` unless the user explicitly asks.

## Claude Code to pi Cleanup

When moving instructions intended for pi or generic agents, flag stale Claude Code mechanics instead of copying them blindly:

- `AskUserQuestion` → ask the user with an available structured-choice tool when possible
- `WebFetch` → use available web/content-fetching tools when needed
- `$ARGUMENTS` and `$IF(...)` → remove command-template syntax from skills
- `Skill` tool instructions → use pi skill loading via `/skill:<name>` or read the skill file when applicable
- command frontmatter → do not copy into `AGENTS.md` unless documenting Claude Code commands intentionally

If the target harness is unclear, preserve the original wording and mark it for user review.

## After Migration

Report:

```text
Migration complete

Changed:
- AGENTS.md: created | updated
- CLAUDE.md: updated | unchanged

Review recommended:
- Run /skill:audit-agents-md to validate AGENTS.md.
```

## Common Mistakes

| Mistake                                                 | Correction                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Moving all project docs into `AGENTS.md`.               | Keep general documentation in `CLAUDE.md`; move agent instructions only. |
| Rewriting ambiguous instructions without asking.        | Mark ambiguous sections for user decision.                               |
| Overwriting existing `AGENTS.md` silently.              | Always ask when it exists.                                               |
| Copying Claude Code command syntax into pi-facing docs. | Convert or flag it during migration.                                     |
| Writing files before showing the migration plan.        | Plan first, confirmation second, edits third.                            |
