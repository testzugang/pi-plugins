---
name: audit-agents-md
description: Use when reviewing, validating, or cleaning up an AGENTS.md file, especially for contradictions, unclear instructions, stale harness-specific tool names, or unsafe automation guidance.
---

# Audit AGENTS.md

## Core Rule

Audit **only `AGENTS.md`**. Do not read, summarize, validate, or suggest changes to `CLAUDE.md` unless the user explicitly changes the task.

This skill exists because default audit behavior tends to drift into `CLAUDE.md` comparison. Do not do that.

## Workflow

1. Locate `AGENTS.md` in the current project root.
   - If absent, report that no root `AGENTS.md` was found and stop.
   - Do not search for `CLAUDE.md`.
2. Read `AGENTS.md` completely.
3. Audit using the checklist below.
4. Produce a prioritized report.
5. Do not edit files automatically. If the user asks for fixes after the report, make a focused plan first.

## Audit Checklist

| Area          | Check                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Structure     | Clear title, headings, and readable markdown.                                                   |
| Scope         | Instructions are relevant for coding agents working in this repository.                         |
| Precedence    | No claims to override system, developer, or direct user instructions.                           |
| Consistency   | No duplicated, conflicting, or circular rules.                                                  |
| Actionability | Agents can tell what to do, when to do it, and what to avoid.                                   |
| Tooling       | Tool names and commands match the intended harness, or are written generically.                 |
| Safety        | No overly broad destructive automation, secret exposure, or unreviewed deployment instructions. |
| Freshness     | No stale references to removed commands, renamed files, or old workflows.                       |

## Stale Harness-Specific Leftovers

Flag Claude Code-specific content when it appears in `AGENTS.md` but the file is intended for pi or generic coding agents:

- `AskUserQuestion`, `WebFetch`, `Glob`, `Grep`, `Read`, `Write`, `Edit`, `Bash` as Claude Code tool names
- `$ARGUMENTS`, `$IF(...)`, command-frontmatter patterns
- instructions to use the Claude Code `Skill` tool
- slash commands that do not exist in pi
- hook/config references that only make sense in Claude Code

Suggest capability-oriented wording when appropriate, such as “ask the user with a structured choice tool” instead of a harness-specific tool name.

## Report Format

Use this format:

```text
AGENTS.md Audit

Summary:
- Overall status: pass | needs attention
- Highest priority issue: <one sentence or "none">

Findings:
1. [High|Medium|Low] <finding title>
   Evidence: <quote or section name>
   Why it matters: <impact>
   Suggested change: <concrete fix>

2. ...

Out of scope:
- CLAUDE.md was not audited.
```

If there are no findings, say so clearly and still include the out-of-scope note.

## Common Mistakes

| Mistake                                        | Correction                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Reading `CLAUDE.md` because it might conflict. | Do not read it. The user asked for `AGENTS.md`.                              |
| Rewriting the file during audit.               | Report first. Edit only after an explicit follow-up request.                 |
| Reporting vague advice like “improve clarity.” | Quote the unclear text and propose a concrete replacement direction.         |
| Treating every Claude-specific word as wrong.  | Flag only when it is stale, incompatible, or unclear for the target harness. |
