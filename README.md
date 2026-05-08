# pi-plugins

pi package for shared agent workflows. The repository is a home for pi resources such as skills, extensions, prompt templates, and themes.

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
- `browser-tools` — guidance for using the browser automation extension tools.

Use skills in pi with skill commands:

```text
/skill:migrate-to-agents-md
/skill:audit-agents-md
/skill:browser-tools
```

### Extensions

#### Browser tools

Registers slash commands and agent tools for controlling a Chrome browser automation session.

User commands:

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

Agent tools:

```text
browser_start({ profile?: boolean | string })
browser_nav({ url: string, newTab?: boolean })
browser_eval({ code: string })
browser_screenshot({})
```

Chrome profile defaults can be stored in `.pi/browser-tools.json` for a project or `~/.pi/agent/browser-tools.json` for the user.

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
