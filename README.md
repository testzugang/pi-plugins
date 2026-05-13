# pi-plugins

pi package for shared agent workflows. The repository is a home for pi resources such as skills, extensions, prompt templates, and themes.

## Install

Install the package once to get all included skills and extensions.

### From git

```bash
pi install git:git@github.com:testzugang/pi-plugins.git
```

### From a local checkout

From the repository root:

```bash
pi install .
```

Or from another directory:

```bash
pi install /path/to/pi-plugins
```

After installation, restart pi or run:

```text
/reload
```

## Feature quick start

### `migrate-to-agents-md`

Migrates agent-specific instructions from `CLAUDE.md` to `AGENTS.md`.

Install the package, then run:

```text
/skill:migrate-to-agents-md
```

Use when you want to split existing Claude/project instructions into a dedicated `AGENTS.md` file.

### `audit-agents-md`

Audits only `AGENTS.md` for clarity, contradictions, stale harness-specific instructions, and unsafe automation guidance.

Install the package, then run:

```text
/skill:audit-agents-md
```

Use after creating or editing `AGENTS.md`.

### `commit`

Creates gitmoji commits with staged-diff review, motivation, message proposal, and confirmation.

Install the package, stage your changes, then run:

```text
/skill:commit
```

The skill asks for motivation, proposes a commit message, and confirms before running `git commit`.

### `pr-findings`

Fetches GitHub PR review findings via `gh` and groups them by severity.

Prerequisites:

```bash
gh auth login
```

Install the package, then run one of:

```text
/skill:pr-findings
/skill:pr-findings 123
/skill:pr-findings 123 owner/repo --unresolved
/skill:pr-findings --severity blocker
/skill:pr-findings --mine --include-stale
```

If no PR number is provided, the skill tries to resolve the PR for the current branch.

### `grill-with-docs`

Stress-tests a plan against the existing domain model (`CONTEXT.md`) and architectural decisions (`docs/adr/`).

Install the package, then run:

```text
/skill:grill-with-docs
```

*Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills).*

### `improve-codebase-architecture`

Surfaces architectural friction and proposes deepening opportunities based on domain language.

Install the package, then run:

```text
/skill:improve-codebase-architecture
```

*Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills).*

### `handoff`

Compacts the current conversation into a document for another agent or session.

Install the package, then run:

```text
/skill:handoff
```

*Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills).*

### Browser tools

Starts and controls a Chrome browser automation session through pi commands and agent tools.

Install the package, then use the browser commands:

```text
/browser-start
/browser-start profile
/browser-start profile "Profile 2"
/browser-profile
/browser-profile clear
/browser-nav https://example.com
/browser-nav https://example.com --new
/browser-eval document.title
/browser-screenshot
```

Agents can also call these tools directly:

```text
browser_start({ profile?: boolean | string })
browser_nav({ url: string, newTab?: boolean })
browser_eval({ code: string })
browser_screenshot({})
```

For guidance during browser tasks, run:

```text
/skill:browser-tools
```

Chrome profile defaults can be stored in `.pi/browser-tools.json` for a project or `~/.pi/agent/browser-tools.json` for the user.

## Current resources

### Skills

- `migrate-to-agents-md`
- `audit-agents-md`
- `commit`
- `pr-findings`
- `browser-tools`
- `grill-with-docs`
- `improve-codebase-architecture`
- `handoff`
- `npm-typescript-package-audit`

### Extensions

- `browser-tools`

## Repository layout

```text
pi-plugins/
  skills/                 # Agent Skills (`<skill-name>/SKILL.md`)
  extensions/             # pi extensions (`*.ts` or `<name>/index.ts`)
  prompts/                # Prompt templates (`*.md`)
  themes/                 # TUI themes (`*.json`)
  scripts/                # Validation, helper scripts, and packaged tool scripts
    browser-tools/        # Helper scripts used by the browser-tools extension
  tests/                  # Skill pressure scenarios and package checks
```

Empty resource directories contain `.gitkeep` files until their first resource is added.

## Package manifest

pi discovers resources through `package.json`:

```json
{
  "pi": {
    "skills": ["./skills"],
    "extensions": ["./extensions"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

## Validate

```bash
npm run validate
```
