# pi-plugins

pi package for shared agent workflows. The repository is intended as a home for pi resources such as skills, extensions, prompt templates, and themes.

The first version ships focused skills for working with agent documentation. The package layout is already prepared for extensions, prompt templates, and themes.

## Install locally

From the repository root:

```bash
pi install .
```

Or from another directory:

```bash
pi install /path/to/pi-plugins
```

## Install from git

```bash
pi install git:git@github.com:testzugang/pi-plugins.git
```

## Current resources

### Skills

- `migrate-to-agents-md` — migrate agent-specific instructions from `CLAUDE.md` to `AGENTS.md`.
- `audit-agents-md` — audit only `AGENTS.md` for clarity, contradictions, and stale harness-specific instructions.

Use them in pi with skill commands:

```text
/skill:migrate-to-agents-md
/skill:audit-agents-md
```

## Repository layout

```text
pi-plugins/
  skills/       # Agent Skills (`<skill-name>/SKILL.md`)
  extensions/   # Future pi extensions (`*.ts` or `<name>/index.ts`)
  prompts/      # Future prompt templates (`*.md`)
  themes/       # Future TUI themes (`*.json`)
  scripts/      # Validation and maintenance scripts
  tests/        # Skill pressure scenarios and package checks
```

The resource directories are present from the start. Empty directories contain `.gitkeep` files until their first resource is added.

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
