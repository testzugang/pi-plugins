# pi-plugins

pi package for shared agent workflows. The repository is structured as a monorepo containing modular, published packages under [`packages/`](packages/), while [`skills/`](skills/) and [`extensions/`](extensions/) contain unmigrated shared resources.

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

### From npm (Individual packages)

The following selected plugins are published to npm and can be installed individually:

- **[`migrate-to-agents-md`](packages/pi-migrate-to-agents-md)**: `pi install npm:@testzugang/pi-migrate-to-agents-md`
- **[`audit-agents-md`](packages/pi-audit-agents-md)**: `pi install npm:@testzugang/pi-audit-agents-md`
- **[`commit`](packages/pi-commit)**: `pi install npm:@testzugang/pi-commit`
- **[`pr-findings`](packages/pi-pr-findings)**: `pi install npm:@testzugang/pi-pr-findings`
- **[`dependency-audit`](packages/pi-dependency-audit)**: `pi install npm:@testzugang/pi-dependency-audit`

After installation, restart pi or run:

```text
/reload
```

## Feature quick start

### [`migrate-to-agents-md`](packages/pi-migrate-to-agents-md)

Migrates agent-specific instructions from `CLAUDE.md` to `AGENTS.md`.

Install the package, then run:

```text
/skill:migrate-to-agents-md
```

Use when you want to split existing Claude/project instructions into a dedicated `AGENTS.md` file.

### [`audit-agents-md`](packages/pi-audit-agents-md)

Audits only `AGENTS.md` for clarity, contradictions, stale harness-specific instructions, and unsafe automation guidance.

Install the package, then run:

```text
/skill:audit-agents-md
```

Use after creating or editing `AGENTS.md`.

### [`commit`](packages/pi-commit)

Creates gitmoji commits with staged-diff review, motivation, message proposal, and confirmation. It can also stage recent session changes after one explicit file-selection confirmation.

Install the package, then run:

```text
/skill:commit
```

The skill asks for motivation, proposes a commit message, confirms any needed staging, and confirms before running `git commit`.

### [`pr-findings`](packages/pi-pr-findings)

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

Agent/tool usage:

```text
pr_findings({ unresolved: true })
pr_findings({ prNumber: 123, repo: "owner/repo", severity: "blocker" })
pr_findings({ waitForNextReview: true, waitTimeoutSec: 60, waitPollSec: 30 })
```

`waitForNextReview` is useful right after a push so findings are only read after fresh review activity (default wait mode: `new-review-activity`).

### [`grill-with-docs`](skills/grill-with-docs)

Stress-tests a plan against the existing domain model (`CONTEXT.md`) and architectural decisions (`docs/adr/`).

Install the package, then run:

```text
/skill:grill-with-docs
```

_Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills)._

### [`improve-codebase-architecture`](skills/improve-codebase-architecture)

Surfaces architectural friction and proposes deepening opportunities based on domain language.

Install the package, then run:

```text
/skill:improve-codebase-architecture
```

_Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills)._

### [`handoff`](skills/handoff)

Compacts the current conversation into a document for another agent or session.

Install the package, then run:

```text
/skill:handoff
```

_Ported and optimized for pi from [mattpocock/skills](https://github.com/mattpocock/skills)._

### [`dependency-audit`](packages/pi-dependency-audit)

Static-first review of TypeScript dependencies, npm packages, and GitHub repositories for supply-chain malware and risky scripts. Dependency updates are diff-aware: findings are split into new/changed vs inherited, and only new or changed risks block updates. Global Pi audits write JSON plus Markdown reports, including held-back/rejected update details. Default config treats `@earendil-works/*` as trusted peer dependency scope only; normal dependencies remain strict.

Install the package, then run:

```text
/skill:dependency-audit
```

When run without parameters, the skill asks first whether to audit pi dependencies, project dependencies, or both. You can also pass a specific package or repository URL:

```text
/skill:dependency-audit https://github.com/user/repo
```

For reusable global-pi checks and interactive terminal updates, see:

- [`packages/pi-dependency-audit/skills/dependency-audit/scripts/pi-check-*.sh`](packages/pi-dependency-audit/skills/dependency-audit/scripts)
- [`packages/pi-dependency-audit/skills/dependency-audit/scripts/run_pi_dependency_audit.py`](packages/pi-dependency-audit/skills/dependency-audit/scripts/run_pi_dependency_audit.py) (writes `/tmp/pi_audit_aggregated.json` and `/tmp/pi_audit_report.md` by default)
- [`packages/pi-dependency-audit/skills/dependency-audit/scripts/summarize_pi_dependency_audit.py`](packages/pi-dependency-audit/skills/dependency-audit/scripts/summarize_pi_dependency_audit.py) (Markdown summary with rejected/held-back details)
- [`packages/pi-dependency-audit/skills/dependency-audit/scripts/pi-interactive-update.py`](packages/pi-dependency-audit/skills/dependency-audit/scripts/pi-interactive-update.py) (interactive CLI selector)
- [`packages/pi-dependency-audit/skills/dependency-audit/config.json`](packages/pi-dependency-audit/skills/dependency-audit/config.json) (default age-gate: 24h; trusted peer scope: `@earendil-works/*`)

#### Pimp `pi update` with security checks

To automatically run the security audit and launch the interactive selection menu every time you type `pi update` or `pi update --extensions` in your terminal, add this function to your shell configuration (e.g., `~/.zshrc`):

```bash
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/agent/git/github.com/testzugang/pi-plugins/packages/pi-dependency-audit/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```

### [`browser-tools`](skills/browser-tools)

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

### [`session-branding`](extensions/session-branding)

Visual and acoustic session identification for background and backgrounded tabs.

Install the package, then configure your branding directly inside any session:

```text
/session-branding
```

Or configure specific settings directly:

```text
/session-branding name Feature Development
/session-branding color blue
/session-branding sound afplay /System/Library/Sounds/Glass.aiff
/session-branding sound clear
```

#### Capabilities

- **Session Name**: Set an explicit session name via `/session-branding name <name>` or the interactive menu. It updates the terminal/tab title and persists inside your session `.jsonl` file.
- **Repository Branding**: Saves a custom color (represented by a high-contrast circle emoji 🔴, 🔵, 🟢...) in `.pi/branding.json` inside your workspace. This branding is loaded automatically across all future sessions in this workspace. Configure it directly via `/session-branding color <farbe>` or through the interactive menu.
- **Blocked Sound Notification**: Plays the terminal bell (`\x07`) or a custom sound command (e.g., `afplay /System/Library/Sounds/Glass.aiff` on macOS) when the session enters the `Blocked` state waiting for you. Configure it directly via `/session-branding sound <befehl>` or through the interactive menu.
- **Tab Title Status Tracking**: Prepends the current session status live inside your terminal tab title:
  - `💤` (Idle / Waiting for user input)
  - `⏳` (Thinking / LLM processing)
  - `⚙️` (Executing / Running tools)
  - `⚠️` (Blocked / Awaiting interaction)

### [`pi-tui-hud`](extensions/pi-tui-hud)

Secure, high-fidelity HUD and Status Bar for Pi. Real-time token tracking, cumulative cost accounting, model-to-folder breadcrumbs, and gradient logo headers.

Install the package, then configure your HUD directly inside any session:

```text
/hud
/hud info
/hud breadcrumb:top
/hud footer:off
/hud header:off
/hud header-info:on
```

## Current resources

### Skills

- [`migrate-to-agents-md`](packages/pi-migrate-to-agents-md)
- [`audit-agents-md`](packages/pi-audit-agents-md)
- [`commit`](packages/pi-commit)
- [`pr-findings`](packages/pi-pr-findings)
- [`browser-tools`](skills/browser-tools)
- [`grill-with-docs`](skills/grill-with-docs)
- [`improve-codebase-architecture`](skills/improve-codebase-architecture)
- [`handoff`](skills/handoff)
- [`dependency-audit`](packages/pi-dependency-audit)

### Extensions

- [`browser-tools`](extensions/browser-tools)
- [`session-branding`](extensions/session-branding)
- [`pi-tui-hud`](extensions/pi-tui-hud)
- [`pr-findings`](packages/pi-pr-findings)

## Repository layout

The repository uses a monorepo structure where modular, high-maturity plugins are isolated as independent NPM packages inside the [`packages/`](packages/) directory. Unmigrated or legacy shared agent resources reside in the root [`skills/`](skills/) and [`extensions/`](extensions/) directories.

```text
pi-plugins/
  packages/               # Published independent npm packages (Monorepo Workspaces)
    pi-xxx/        # Package workspace containing its own package.json, SKILL.md and assets
  skills/                 # Remaining unmigrated shared Agent Skills (legacy root)
  extensions/             # Remaining unmigrated shared extensions (legacy root)
  prompts/                # Shared Prompt templates
  themes/                 # Shared TUI themes
  scripts/                # Shared validation and utility scripts
  tests/                  # Shared test suites and package-manifest checks
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
