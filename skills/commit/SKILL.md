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
2. If nothing is staged, tell the user there are no staged changes.
   - Do not stage files automatically unless the user explicitly asked for staging.
   - If the user asked to stage and commit, show the candidate file list and ask before staging.
3. Check whether staged changes contain multiple unrelated concerns.
   - If yes, recommend separate commits and ask how to proceed.
4. Ask the user for the motivation: why this change exists.
5. Select a gitmoji.
   - If the user specified one, use it.
   - Otherwise propose 2-3 likely choices with `user_select`.
6. Draft a commit message with subject and body.
7. Show the exact files and complete message, then ask for confirmation with `user_select`.
8. Run `git commit` only after confirmation.
9. Run `git status --short` after the commit and report the result.

## Gitmoji Reference

| Emoji | Use when |
| --- | --- |
| ✨ | adding a feature or new capability |
| 🐛 | fixing a bug |
| 🔧 | changing configuration, tooling, or package setup |
| ♻️ | refactoring without behavior change |
| ✅ | adding or updating tests |
| 📝 | changing documentation |
| 🎨 | formatting or code style only |
| ⚡ | improving performance |
| 🔥 | removing code or files |
| 🔖 | release commits |

Follow the repository's existing commit style when it is more specific than this table.

## Message Format

Default format:

```text
<gitmoji> <short description>

<motivation sentence: why this change is needed>

<optional technical detail sentence: what changed>
```

Keep the subject under 72 characters when possible. The subject should describe the outcome, not just list touched files.

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

| Mistake | Correction |
| --- | --- |
| Committing without reading the staged diff. | Always inspect staged changes first. |
| Staging all files automatically. | Ask before staging unless explicitly requested. |
| Writing a message with no “why.” | Ask for motivation and include it in the body. |
| Choosing a gitmoji silently when ambiguous. | Offer likely options with `user_select`. |
| Using `--no-verify` by default. | Only use it when explicitly requested. |
