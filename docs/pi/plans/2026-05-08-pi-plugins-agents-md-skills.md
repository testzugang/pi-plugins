# pi-plugins AGENTS.md Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new pi package repository named `pi-plugins` with two pi-native skills: `migrate-to-agents-md` and `audit-agents-md`.

**Architecture:** The repo is a conventional pi package: `package.json` declares `pi.skills`, and each skill lives in `skills/<name>/SKILL.md`. The migration skill handles `CLAUDE.md` to `AGENTS.md`; the audit skill checks only `AGENTS.md`.

**Tech Stack:** Markdown, pi Agent Skills standard, npm package metadata, shell-based validation.

---

## File Structure

- Create: `package.json` — pi package manifest and metadata.
- Create: `README.md` — installation and usage documentation.
- Create: `skills/migrate-to-agents-md/SKILL.md` — pi-native migration skill.
- Create: `skills/audit-agents-md/SKILL.md` — AGENTS.md-only audit skill.
- Create: `tests/skill-pressure-scenarios.md` — manual pressure scenarios for validating skill behavior.
- Create: `.gitignore` — standard local/editor ignores.

## Task 1: Initialize repository skeleton

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "pi-plugins",
  "version": "0.1.0",
  "description": "pi package with skills and workflows for agent documentation.",
  "private": true,
  "keywords": ["pi-package", "pi", "skills", "agents-md"],
  "license": "UNLICENSED",
  "pi": {
    "skills": ["./skills"]
  },
  "scripts": {
    "validate:skills": "node scripts/validate-skills.mjs"
  }
}
```

- [ ] **Step 2: Create README**

Create `README.md`:

```markdown
# pi-plugins

pi package with skills and workflows for agent documentation.

## Install locally

```bash
pi install ~/workspaces/sipgate/pi-plugins
```

## Skills

- `migrate-to-agents-md` — migrate agent-specific instructions from `CLAUDE.md` to `AGENTS.md`.
- `audit-agents-md` — audit only `AGENTS.md` for clarity, contradictions, and stale harness-specific instructions.

## Usage

```text
/skill:migrate-to-agents-md
/skill:audit-agents-md
```
```

- [ ] **Step 3: Create `.gitignore`**

Create `.gitignore`:

```gitignore
.DS_Store
node_modules/
.pi/
.env
```

- [ ] **Step 4: Initialize git**

Run:

```bash
git init
```

Expected: repository initialized on default branch.

## Task 2: Add skill pressure scenarios

**Files:**
- Create: `tests/skill-pressure-scenarios.md`

- [ ] **Step 1: Write pressure scenarios**

Create `tests/skill-pressure-scenarios.md`:

```markdown
# Skill Pressure Scenarios

Use these scenarios to validate the skills before release.

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
```

## Task 3: Add `audit-agents-md` skill

**Files:**
- Create: `skills/audit-agents-md/SKILL.md`

- [ ] **Step 1: Write skill**

Create `skills/audit-agents-md/SKILL.md` with valid Agent Skills frontmatter and instructions that:

- trigger only for `AGENTS.md` review/validation/cleanup
- explicitly forbid `CLAUDE.md` auditing
- require reading root `AGENTS.md`
- produce prioritized actionable findings
- avoid automatic edits unless the user asks after the report

- [ ] **Step 2: Validate skill frontmatter manually**

Check:

```bash
head -20 skills/audit-agents-md/SKILL.md
```

Expected:
- `name: audit-agents-md`
- description starts with `Use when`
- parent directory matches skill name

## Task 4: Add `migrate-to-agents-md` skill

**Files:**
- Create: `skills/migrate-to-agents-md/SKILL.md`

- [ ] **Step 1: Write skill**

Create `skills/migrate-to-agents-md/SKILL.md` with valid Agent Skills frontmatter and instructions that:

- trigger for migrating `CLAUDE.md` agent instructions to `AGENTS.md`
- use pi tool names (`find`, `read`, `write`, `edit`, `user_select`)
- require migration plan confirmation before writes
- handle existing `AGENTS.md` via user choice
- update `CLAUDE.md` only as needed
- recommend `/skill:audit-agents-md` after migration

- [ ] **Step 2: Validate skill frontmatter manually**

Check:

```bash
head -20 skills/migrate-to-agents-md/SKILL.md
```

Expected:
- `name: migrate-to-agents-md`
- description starts with `Use when`
- parent directory matches skill name

## Task 5: Add lightweight validation script

**Files:**
- Create: `scripts/validate-skills.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create validation script**

Create `scripts/validate-skills.mjs` to verify each `skills/*/SKILL.md` exists, has `name` and `description`, and the name matches the directory.

- [ ] **Step 2: Run validation**

Run:

```bash
npm run validate:skills
```

Expected: exits 0 and prints both skill names.

## Task 6: Final verification and commit

**Files:**
- All created files

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short
```

Expected: only intended new files are listed.

- [ ] **Step 2: Run validation**

Run:

```bash
npm run validate:skills
```

Expected: validation passes.

- [ ] **Step 3: Commit**

Run:

```bash
git add .
git commit -m "✨ add pi agent documentation skills"
```
