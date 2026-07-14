# Bash-Approval Regex-Unterstützung (Upstream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement robust, secure regex (regular expressions) support inside the upstream `pi-bash-approval` package, including full anchor enclosure, graceful TUI notification warnings for invalid syntax, comprehensive documentation, and a standard changeset.

**Architecture:** Extend `matchesPattern` to interpret `r:` prefixed patterns. Ensure all regexes are automatically wrapped inside `^(?:pattern)$` to mathematically block command injections and unanchored OR-bypasses. Catch syntax compiler errors, report them back via an `onError` callback, and visualize warnings in the Pi TUI.

**Tech Stack:** TypeScript, Node.js, Jest (unit tests).

---

## File Structure

- **Modify:** `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/models/bash-approval.model.ts`
  - Purpose: Update `NotifyLevel` to support the `"warning"` status level so TypeScript compilation succeeds.
- **Modify:** `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/utils.ts`
  - Purpose: Enhance `matchesPattern` to recognize `r:` prefix, wrap it inside non-capturing groups with start/end anchors, and add `onError` callbacks up to `evaluateCommand`.
- **Modify:** `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/index.ts`
  - Purpose: Provide the `onError` callback to `evaluateCommand` and show a guarded visual warning `ctx.ui.notify` in the Pi TUI when a pattern contains syntax errors.
- **Modify:** `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/README.md`
  - Purpose: Document the new `r:` regex pattern syntax and anchor enclosure safety behaviors in the project README.
- **Modify:** `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/tests/bash-approval.spec.ts`
  - Purpose: Add automated unit tests to verify the robustness, security, and error handling of regex-based rules.

---

## Tasks

### Task 1: Pre-implementation Branch and Preparation

**Files:**

- Create/Checkout Branch: `feat/bash-approval-regex`
- Read: `/Users/gredig/Privat/workspaces/opensource/pi-extensions/docs/code-conventions.md`

- [ ] **Step 1: Check out a dedicated feature branch in the upstream repository**

Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions checkout -b feat/bash-approval-regex
```

Expected: Switched to a new branch 'feat/bash-approval-regex'.

- [ ] **Step 2: Read docs/code-conventions.md to align with repository guidelines**

Utilize the standard `read` tool:
Run `read` on `/Users/gredig/Privat/workspaces/opensource/pi-extensions/docs/code-conventions.md`.

- [ ] **Step 3: Update model definitions to add "warning" to `NotifyLevel`**

In `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/models/bash-approval.model.ts`, update:

```typescript
export type NotifyLevel = "info" | "error" | "warning";
```

- [ ] **Step 4: Verify type checking**

Run: `npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run typecheck`
Expected: Passes with no errors.

- [ ] **Step 5: Commit initial types**

Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/extensions/models/bash-approval.model.ts
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "types(bash-approval): add warning level to NotifyLevel"
```

---

### Task 2: Implement TDD Regex Unit Tests (Red Phase)

We add our unit tests first to establish clear, robust boundaries for regex matching and safety, but do not commit them yet to avoid breaking pre-commit test hooks.

**Files:**

- Modify: `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/tests/bash-approval.spec.ts`

- [ ] **Step 1: Add a regex-focused test suite inside `bash-approval.spec.ts`**

Append the following test suite to `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/tests/bash-approval.spec.ts`:

```typescript
describe("tool_call event - regex-based pattern matching", () => {
  it("permits exact matches with regex", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: ["r:git status"] }),
    });
    const result = await toolCallHandler!(
      bashEvent("git status"),
      makeCtx().ctx,
    );

    expect(result).toBeUndefined();
  });

  it("anchors the regex fully on both sides to prevent partial match bypasses", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: ["r:git status"] }),
    });
    const result = await toolCallHandler!(
      bashEvent("git status --short"),
      makeCtx({ hasUI: false }).ctx,
    );

    expect(result).toMatchObject({ block: true });
  });

  it("prevents command injection bypasses like rm -rf / && git status", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: ["r:git status"] }),
    });
    const result = await toolCallHandler!(
      bashEvent("rm -rf / && git status"),
      makeCtx({ hasUI: false }).ctx,
    );

    expect(result).toMatchObject({ block: true });
  });

  it("supports alternation OR groups securely with enclosing anchors", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: ["r:git status|ls -la"] }),
    });

    expect(
      await toolCallHandler!(bashEvent("git status"), makeCtx().ctx),
    ).toBeUndefined();
    expect(
      await toolCallHandler!(bashEvent("ls -la"), makeCtx().ctx),
    ).toBeUndefined();

    expect(
      await toolCallHandler!(
        bashEvent("git status --short"),
        makeCtx({ hasUI: false }).ctx,
      ),
    ).toMatchObject({ block: true });
  });

  it("preserves trailing escapes correctly", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: [String.raw`r:echo \$`] }),
    });
    const result = await toolCallHandler!(bashEvent("echo $"), makeCtx().ctx);

    expect(result).toBeUndefined();
  });

  it("catches malformed regex syntax errors and triggers TUI warning on interactive contexts", async () => {
    const { toolCallHandler } = setup({
      configFile: JSON.stringify({ allowed: ["r:git status[a-z"] }),
    });
    const { ctx, notify } = makeCtx({ hasUI: true });
    const result = await toolCallHandler!(bashEvent("git status"), ctx);

    expect(result).toMatchObject({ block: true });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Invalid regex pattern in .bash-approval"),
      "warning",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify that the newly added regex tests fail as expected**

Run: `npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test`
Expected: Test suite fails (Red Phase). Do not commit yet to avoid triggering git pre-commit script aborts.

---

### Task 3: Implement Core Matching & Extension Warning Logic (TDD Green Phase)

We implement both `utils.ts` and `index.ts` matching and hook logics to satisfy all our new TDD unit tests, and commit them together once everything is green.

**Files:**

- Modify: `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/utils.ts`
- Modify: `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/index.ts`

- [ ] **Step 1: Refactor `matchesPattern`, `firstFailingSegment`, and `evaluateCommand` inside `utils.ts`**

Update `packages/pi-bash-approval/extensions/utils.ts` to include the `onError` forwarding and regex evaluation:

```typescript
export function matchesPattern(
  command: string,
  pattern: string,
  onError?: (err: Error) => void,
): boolean {
  const trimmedCommand = command.trim();
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return false;
  }

  if (trimmedPattern.startsWith("r:")) {
    const patternSource = trimmedPattern.slice(2).trim();
    const finalEnclosedSource = `^(?:${patternSource})$`;
    try {
      const regex = new RegExp(finalEnclosedSource);
      return regex.test(trimmedCommand);
    } catch (err) {
      if (onError && err instanceof Error) {
        onError(err);
      }
      return false;
    }
  }

  if (trimmedPattern.endsWith(":*")) {
    return matchesPrefixGlob(trimmedCommand, trimmedPattern);
  }

  if (trimmedPattern.endsWith("*")) {
    const prefix = trimmedPattern.slice(0, -TRAILING_GLOB_SUFFIX_LENGTH);

    return trimmedCommand.startsWith(prefix);
  }

  return trimmedCommand === trimmedPattern;
}
```

And:

```typescript
function firstFailingSegment(
  segments: readonly string[],
  rules: readonly string[],
  onError?: (err: Error) => void,
): string | null {
  return (
    segments.find(
      (segment) =>
        !rules.some((rule) => matchesPattern(segment, rule, onError)),
    ) ?? null
  );
}

export function evaluateCommand(
  command: string,
  config: BashApprovalConfig,
  onError?: (err: Error) => void,
): CommandEvaluation {
  const trimmedCommand = command.trim();
  const rawSegments = config.splitChains
    ? splitCommand(command)
    : [trimmedCommand];
  const segments = rawSegments.flatMap((segment) =>
    normalizeCommandSegments(segment),
  );

  if (segments.length === 0) {
    return { allMatch: true };
  }

  const failingSegment = firstFailingSegment(segments, config.allowed, onError);

  if (!failingSegment) {
    return { allMatch: true };
  }

  return { allMatch: false, failingSegment };
}
```

- [ ] **Step 2: Provide guarded `onError` callback during `evaluateCommand` inside `index.ts`**

In `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/extensions/index.ts`, locate `const evaluation = evaluateCommand(command, config);` and change it to ensure we only call `ctx.ui.notify` when `ctx.hasUI` is active:

```typescript
const evaluation = evaluateCommand(command, config, (err) => {
  if (ctx.hasUI) {
    ctx.ui.notify(
      `Invalid regex pattern in .bash-approval: ${err.message}`,
      "warning",
    );
  }
});
```

- [ ] **Step 3: Run all unit tests to confirm everything is green**

Run: `npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test`
Expected: 100% tests pass cleanly.

- [ ] **Step 4: Commit both tests and implementation logic safely as a green commit**

Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/extensions/utils.ts packages/pi-bash-approval/extensions/index.ts packages/pi-bash-approval/tests/bash-approval.spec.ts
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "feat(bash-approval): support r: regex patterns with robust anchoring and TUI warning notification"
```

---

### Task 4: Documentation & Changeset Creation

**Files:**

- Modify: `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/README.md`
- Create: Upstream changeset file (automatically generated via changeset script)

- [ ] **Step 1: Document `r:` pattern syntax in `packages/pi-bash-approval/README.md`**

In `/Users/gredig/Privat/workspaces/opensource/pi-extensions/packages/pi-bash-approval/README.md`, find the table under `### Pattern syntax` and append the description for reguläre Ausdrücke (`r:`):

```markdown
| `r:<regex>` | regular expression: command matched against `<regex>`. |
```

And add a note explaining our automatic enclosure and safety:

```markdown
#### Regex patterns (`r:`)

Prefixing a pattern with `r:` allows full regular expressions. For security, every regex is automatically wrapped inside `^(?:<regex>)$` at runtime to prevent unanchored OR-bypasses or command injection.
```

- [ ] **Step 2: Generate standard package changeset using repository changeset script**

Run: `npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run changeset`
When prompted:

1. Select `@fgladisch/pi-bash-approval` (space to select).
2. Choose "patch" version.
3. Summary of changes: "Add support for secure, anchor-enclosed regex-based bash approval rules"
   Expected: A `.changeset/*.md` file is created.

- [ ] **Step 3: Commit docs and changeset**

Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/README.md .changeset/
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "docs(bash-approval): document r: regex syntax and add changeset"
```

---

### Task 5: Monorepo Formatting, Linting, & PR Workflow

**Files:**

- None (Workspace operations)

- [ ] **Step 1: Run format & lint rules**

Run:

```bash
npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run format
npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run lint
```

Expected: Successfully executes clean.

- [ ] **Step 2: Stage and commit any automatic code-formatting or lint-fixing changes**

Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions status --short
```

If there are any modified files (due to Prettier/ESLint auto-fixes), stage and commit them before proceeding:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add -A
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "chore(bash-approval): format and lint codebase"
```

- [ ] **Step 3: Run all typechecks and unit tests as final terminal gate**

Run:

```bash
npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run typecheck
npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test
```

Expected: 100% green typechecking and test outcomes.

- [ ] **Step 4: Live runtime exercise validation**

Manually trigger or simulate a local run of the extension package under a test Pi harness configuration, ensuring `ctx.ui.notify` fires correctly on malformed inputs and matches expected warnings.

- [ ] **Step 5: Push the branch upstream and open the Pull Request (requiring explicit user confirmation)**

Ensure git push conforms with user credentials/preferences.
Run:

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions push origin feat/bash-approval-regex
```

Expected: Branch is pushed upstream. Then construct and output the GitHub PR URL to fgladisch/pi-extensions.
