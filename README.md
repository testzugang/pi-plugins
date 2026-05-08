# pi-plugins

pi package with skills and workflows for agent documentation.

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

## Skills

- `migrate-to-agents-md` — migrate agent-specific instructions from `CLAUDE.md` to `AGENTS.md`.
- `audit-agents-md` — audit only `AGENTS.md` for clarity, contradictions, and stale harness-specific instructions.

## Usage

```text
/skill:migrate-to-agents-md
/skill:audit-agents-md
```
