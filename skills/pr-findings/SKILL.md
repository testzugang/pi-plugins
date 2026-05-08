---
name: pr-findings
description: Use when the user asks for GitHub PR review findings, review comments, unresolved findings, bot feedback, or reviewer feedback grouped by severity.
---

# PR Findings

## Goal

Fetch GitHub PR review findings with `gh`, format them by severity, and print the generated Markdown report verbatim.

This is a pi-native port. Do not use Claude command placeholders or Claude plugin root environment variables.

## Inputs

Infer these from the user's request:

- PR number, optional. If missing, resolve the PR for the current branch.
- Repository as `owner/repo`, optional. If missing, let `gh repo view` resolve it.
- Flags:
  - `--unresolved`
  - `--severity blocker|warning|nit|all`
  - `--include-stale`
  - `--mine`

When invoked as `/skill:pr-findings ...`, pi appends the user's arguments after the skill content. Treat those appended arguments as the input. Do not look for Claude-style command placeholder variables.

## Workflow

1. Confirm `gh` is available and authenticated if a command fails.
2. Resolve the PR number if missing:

   ```bash
   gh pr view --json number -q .number
   ```

   If this fails, tell the user: `no PR for current branch — pass a PR number`.
3. Resolve helper script paths relative to this skill directory.
   - The scripts are bundled next to this file:
     - `fetch.sh`
     - `format.py`
4. Run one pipeline:

   ```bash
   SKILL_DIR="/absolute/path/to/skills/pr-findings"
   bash "$SKILL_DIR/fetch.sh" <PR#> [owner/repo] | python3 "$SKILL_DIR/format.py" [--unresolved] [--severity <blocker|warning|nit|all>] [--include-stale] [--mine]
   ```

5. Print the resulting Markdown verbatim. Do not paraphrase the report.
6. Add exactly one closing line:
   - Blockers present → `Address blockers before merge.`
   - Only nits → `Nits only — safe to merge if you skip them.`
   - Empty → `No findings yet.`

## Path Resolution

Use the actual installed skill path. In this repository it is:

```text
skills/pr-findings
```

When installed as a package, use the path of the loaded `SKILL.md` file and run the adjacent scripts. Do not rely on current working directory unless it is the skill directory.

## Edge Cases

| Situation | Response |
| --- | --- |
| `gh` not authenticated | Tell the user to run `gh auth login`. |
| No PR for current branch | Ask for a PR number. |
| Cannot determine repository | Ask for `owner/repo`. |
| PR is closed or merged | Still fetch findings; the report includes PR state. |
| `gh` version is too old | Surface the script error requiring `gh >= 2.40`. |
| Rate limited | Surface the rate-limit error and reset time if available. |

## Common Mistakes

| Mistake | Correction |
| --- | --- |
| Parsing Claude command placeholder text. | Infer arguments from the user request or appended skill command text. |
| Running helper scripts through a Claude plugin root variable. | Use the adjacent `fetch.sh` and `format.py` files. |
| Summarizing the formatter output. | Print it verbatim. |
| Treating general PR status as findings. | Use this only for review comments/findings, not mergeability checks. |
