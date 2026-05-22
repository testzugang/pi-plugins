---
name: pr-findings
description: Use when the user asks for GitHub PR review findings, review comments, unresolved findings, bot feedback, or reviewer feedback grouped by severity.
---

# PR Findings

## Goal

Fetch GitHub PR review findings through the `pr_findings` tool (backed by `gh`), format by severity, and print the tool output verbatim.

## Inputs

Infer from the user request (or `/skill:pr-findings ...` args):

- PR number (optional)
- Repository `owner/repo` (optional)
- `--unresolved`
- `--severity blocker|warning|nit|all`
- `--include-stale`
- `--mine`
- `--wait-for-next-review` (optional)
- `--wait-timeout-sec <n>` (default 60)
- `--wait-poll-sec <n>` (default 30)

## Workflow

1. Build tool params from user input.
2. Call `pr_findings`.
3. Print returned Markdown verbatim (do not paraphrase).

## Tool Call

```text
pr_findings({
  prNumber?: number,
  repo?: "owner/repo",
  unresolved?: boolean,
  severity?: "blocker" | "warning" | "nit" | "all",
  includeStale?: boolean,
  mine?: boolean,
  waitForNextReview?: boolean,
  waitMode?: "new-review-activity" | "checks-finished",
  waitTimeoutSec?: number,
  waitPollSec?: number
})
```

Default wait behavior when enabled:

- `waitMode="new-review-activity"`
- `waitTimeoutSec=60`
- `waitPollSec=30`

## Recommended Usage After Push

Use waiting mode after pushing fixes so findings are not read too early:

```text
pr_findings({ waitForNextReview: true, unresolved: true })
```

## Edge Cases

| Situation                   | Response                                                   |
| --------------------------- | ---------------------------------------------------------- |
| `gh` not authenticated      | Tell the user to run `gh auth login`.                      |
| No PR for current branch    | Ask for a PR number.                                       |
| Cannot determine repository | Ask for `owner/repo`.                                      |
| PR is closed or merged      | Still fetch findings; report includes PR state.            |
| `gh` too old                | Surface error requiring `gh >= 2.40`.                      |
| Wait timed out              | Report that timeout was reached and show current findings. |
