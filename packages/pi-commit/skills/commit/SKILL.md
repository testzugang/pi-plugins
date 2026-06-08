---
name: commit
description: Use when the user asks to commit, create a git commit, stage and commit changes, or wants a gitmoji commit message for staged changes.
---

# Commit

## Goal

Create a git commit using a disciplined gitmoji workflow: inspect staged changes, understand the motivation, propose a message, confirm with the user, then commit.

Do not commit without explicit confirmation.

## Workflow

1. Inspect repository state:
   - `git status --short`
   - `git diff --cached --stat`
   - `git diff --cached`
   - `git log --oneline -10`
2. Decide path:
   - **If files are already staged:** use fast-path (no staging questions).
   - **If nothing is staged and user requested staging/commit all:** show candidate files once and ask once before staging.
   - **If nothing is staged and recent assistant work produced unstaged/untracked changes:** treat the commit request as implicit staging intent. Show candidate files once, including any unstaged/untracked files so unrelated leftovers are visible, and ask once before staging.
   - **If nothing is staged and there is no explicit staging request or recent assistant work context:** stop and tell the user no staged changes.
   - **After any staging step:** rerun `git status --short`, `git diff --cached --stat`, and `git diff --cached` before drafting the commit.
3. Check whether staged changes contain multiple unrelated concerns.
   - If yes, recommend separate commits and ask how to proceed.
4. Gather message inputs with minimal churn:
   - Ask for motivation once.
   - Gitmoji selection only if not already specified by the user.
5. Draft a commit message with subject and body.
6. Ask exactly one final confirmation (`user_select`) with full message + file list.
7. Run `git commit` only after final confirmation.
8. Run `git status --short` after the commit and report the result.

## Gitmoji Reference

| Emoji | Use when                                          |
| ----- | ------------------------------------------------- |
| ✨    | adding a feature or new capability                |
| 🐛    | fixing a bug                                      |
| 🔧    | changing configuration, tooling, or package setup |
| ♻️    | refactoring without behavior change               |
| ✅    | adding or updating tests                          |
| 📝    | changing documentation                            |
| 🎨    | formatting or code style only                     |
| ⚡    | improving performance                             |
| 🔥    | removing code or files                            |
| 🔖    | release commits                                   |

Follow the repository's existing commit style when it is more specific than this table.

## Message Format

Default format:

```text
<gitmoji> <short description>

<motivation sentence: why this change is needed>

<optional technical detail sentence: what changed>
```

Keep the subject under 72 characters when possible. The subject should describe the outcome, not just list touched files.

## Confirmation Rules

- Keep confirmations minimal while preserving safety.
- **Always require one explicit final confirmation before `git commit`.**
- Do not ask duplicate confirmations for the same decision.
- If files are already staged, do not ask extra staging questions.
- If staging is needed because the user requested it or the current session just produced unstaged/untracked changes, ask once for file selection, then proceed to final confirmation.
- Never stage files silently. Recent assistant work plus a commit request implies staging intent, but not staging consent.

## Confirmation Prompt

Use one `user_select` call before committing:

```text
Proposed commit:

  <subject>

<body>

Files to be committed:
  - <file>

Commit with this message and file list?
```

Options:

- Commit as-is
- Edit the message
- Edit the file selection
- Cancel

If the user edits the message or file selection, re-confirm before committing.

## Commit Command

Use a heredoc so multiline messages are preserved:

```bash
git commit -m "$(cat <<'EOF'
<subject>

<body>
EOF
)"
```

Only use `--no-verify` if the user explicitly asks for it.

## Hook Failures

If a hook fails:

1. Summarize the failure.
2. Ask whether to fix, show full output, retry with `--no-verify`, or cancel.
3. Do not silently skip hooks.

## Common Mistakes

| Mistake                                           | Correction                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Committing without reading the staged diff.       | Always inspect staged changes first.                                                                                  |
| Staging all files silently.                       | Ask once before staging; recent assistant work plus a commit request implies staging intent, but not staging consent. |
| Warning after active work that nothing is staged. | Treat the commit request as implicit staging intent, show all candidate files, and ask once before staging.           |
| Drafting from stale staged diff after staging.    | Rerun staged status/stat/diff after staging and before writing the message.                                           |
| Asking the same confirmation twice.               | Use one staging confirmation (only if needed) and one final commit confirmation.                                      |
| Writing a message with no “why.”                  | Ask for motivation and include it in the body.                                                                        |
| Choosing a gitmoji silently when ambiguous.       | Offer likely options with `user_select`.                                                                              |
| Using `--no-verify` by default.                   | Only use it when explicitly requested.                                                                                |
