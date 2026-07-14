# Bash-Approval Regex-Unterstützung (Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the local `pi-approval-recorder` package to generate precise, quote-aware regex-based approval suggestions for directory and container-scoped commands.

**Architecture:** Implement a quote-aware tokenizer with match indices to locate scoped arguments (such as directories in `git -C` or `npm --prefix`, or container names in `docker exec`) within commands. Generate suggestions of the form `r:^<prefix> (?:"[^"]+"|'[^']+'|\S+) <remainder>$` that escape regex metacharacters in static parts but preserve exact quotes and arguments, falling back cleanly to classical globbing for other patterns.

**Tech Stack:** TypeScript, Node.js, Vitest (unit tests).

---

## File Structure

- **Modify:** `packages/pi-approval-recorder/lib/report.ts`
  - Purpose: Replace simplistic whitespace splitting with `tokenize` and `tokenizeWithIndices`. Rewrite `suggestRule` to support advanced token-aware regex scoping suggestions.
- **Modify:** `packages/pi-approval-recorder/tests/report.spec.ts`
  - Purpose: Update and extend unit tests first (TDD) to cover quote-aware tokenization, regex escaping of static parts, and correct suggestion outputs for git, npm, and docker-scoped commands.

---

## Tasks

### Task 1: Update Test Suite with Regex Escaping & Quote-Aware Scenarios (TDD Red Phase)

We update and expand our automated test cases first to establish the desired behavior before updating implementation code.

**Files:**

- Modify: `packages/pi-approval-recorder/tests/report.spec.ts`

- [ ] **Step 1: Replace test file contents to define quote-aware, docker-scoped, and regex-escaped scenarios**

Update `/Users/gredig/Privat/workspaces/Flexcoding/pi-plugins/packages/pi-approval-recorder/tests/report.spec.ts` with this complete suite:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManualApprovalEntry } from "../lib/manual-approval-log.ts";
import {
  generateReport,
  readAllowlistRules,
  suggestRule,
  tokenize,
} from "../lib/report.ts";

function entry(
  command: string,
  mode: ManualApprovalEntry["mode"] = "allow_once",
): ManualApprovalEntry {
  return { timestamp: "2026-07-09T10:00:00.000Z", command, cwd: "/tmp", mode };
}

describe("tokenize", () => {
  it("correctly splits simple arguments", () => {
    expect(tokenize("git status")).toEqual(["git", "status"]);
  });

  it("handles double-quoted paths with spaces as single tokens", () => {
    expect(tokenize('git -C "/path with space" status')).toEqual([
      "git",
      "-C",
      "/path with space",
      "status",
    ]);
  });

  it("handles single-quoted paths with spaces as single tokens", () => {
    expect(tokenize("npm --prefix 'another path with space' run dev")).toEqual([
      "npm",
      "--prefix",
      "another path with space",
      "run",
      "dev",
    ]);
  });
});

describe("suggestRule", () => {
  it("suggests a regex-based pattern for git with directory-scoping", () => {
    expect(suggestRule("git -C /tmp/example status --short")).toBe(
      "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status --short$",
    );
  });

  it("handles directory-scoping with quoted paths with spaces correctly", () => {
    expect(suggestRule('git -C "/tmp/some folder" status --short')).toBe(
      "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status --short$",
    );
  });

  it("suggests a regex-based pattern for npm with directory-scoping", () => {
    expect(suggestRule("npm --prefix '/workspace/my app' run build")).toBe(
      "r:^npm --prefix (?:\"[^\"]+\"|'[^']+'|\\S+) run build$",
    );
  });

  it("suggests a regex-based pattern for docker exec with container-scoping", () => {
    expect(suggestRule("docker exec -it --user root my_container ls -la")).toBe(
      "r:^docker exec -it --user root (?:\"[^\"]+\"|'[^']+'|\\S+) ls -la$",
    );
  });

  it("handles docker exec option skipping correctly", () => {
    expect(suggestRule("docker exec -w /app container-123 npm install")).toBe(
      "r:^docker exec -w /app (?:\"[^\"]+\"|'[^']+'|\\S+) npm install$",
    );
  });

  it("escapes regex metacharacters in static command parts correctly", () => {
    expect(suggestRule("git -C /tmp/dir log --grep='fix(foo)'")).toBe(
      "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) log --grep='fix\\(foo\\)'$",
    );
  });

  it("falls back to standard globbing for regular commands", () => {
    expect(suggestRule("ls -la")).toBe("ls -la:*");
  });

  it("suggests a one-token prefix glob for single-token commands", () => {
    expect(suggestRule("ls")).toBe("ls:*");
  });

  it("uses only the first line of multi-line commands", () => {
    expect(suggestRule("git commit -m 'x'\nrm -rf *")).toBe("git commit:*");
  });

  it("returns null for empty commands", () => {
    expect(suggestRule("   ")).toBeNull();
  });
});

describe("readAllowlistRules", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `pi-approval-recorder-allow-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns trimmed non-comment lines as a set", async () => {
    const file = join(dir, ".bash-approval");
    writeFileSync(file, "# comment\n\n git add:* \nnpm test:*\n", "utf8");
    await expect(readAllowlistRules(file)).resolves.toEqual(
      new Set(["git add:*", "npm test:*"]),
    );
  });

  it("returns an empty set when the file does not exist", async () => {
    await expect(readAllowlistRules(join(dir, "missing"))).resolves.toEqual(
      new Set(),
    );
  });
});

describe("generateReport", () => {
  it("suggests rules for recurring allow_once approvals, aggregated by rule", () => {
    const report = generateReport(
      [
        entry("git -C /tmp/a status"),
        entry("git -C /tmp/b status"),
        entry("npm run lint"),
      ],
      new Set(),
    );

    expect(report).toContain("r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status$");
    expect(report).toContain("2x");
    expect(report).not.toContain("npm run:*"); // only once → below threshold
    expect(report).toContain("Add these lines to ~/.pi/agent/.bash-approval");
  });

  it("ignores allow_always entries and rules already in the allowlist", () => {
    const report = generateReport(
      [
        entry("git push origin main"),
        entry("git push origin dev"),
        entry("npm test unit", "allow_always"),
        entry("npm test e2e", "allow_always"),
      ],
      new Set(["git push:*"]),
    );

    expect(report).toBe("No recurring manual approvals found yet.");
  });

  it("never emits multi-line or regex-escaped suggestions", () => {
    const report = generateReport(
      [
        entry("npm run test (unit)\nsecond line"),
        entry("npm run test (unit)\nother second line"),
      ],
      new Set(),
    );

    expect(report).toContain("npm run:*");
    expect(report).not.toContain("\\(");
    // Examples show only the first line of multi-line commands.
    expect(report).not.toContain("second line");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail as expected**

Run: `npx vitest run packages/pi-approval-recorder/tests/report.spec.ts`
Expected: 7 tests fail (due to unimplemented regex features, unmatched tokens, and missing helpers).

- [ ] **Step 3: Commit the test suite changes**

Run:

```bash
git add packages/pi-approval-recorder/tests/report.spec.ts
git commit -m "test(approval-recorder): define failing TDD unit tests for quote-aware tokenization and regex suggestor with metacharacter escaping"
```

---

### Task 2: Implement Tokenizer, Escaper, and Suggestor Core Logic (TDD Green Phase)

We now write the actual logic inside the source file to satisfy all tests and bring them back to green.

**Files:**

- Modify: `packages/pi-approval-recorder/lib/report.ts`

- [ ] **Step 1: Replace file contents of `lib/report.ts` to implement quote-aware tokenizer and robust scoping suggestion generation**

Update `/Users/gredig/Privat/workspaces/Flexcoding/pi-plugins/packages/pi-approval-recorder/lib/report.ts`:

```typescript
import * as fs from "node:fs/promises";
import type { ManualApprovalEntry } from "./manual-approval-log.ts";

const RULE_THRESHOLD = 2;
const MAX_EXAMPLES = 3;
const EXAMPLE_MAX_LENGTH = 80;

export function tokenize(command: string): string[] {
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const tokens: string[] = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

interface TokenWithIndex {
  value: string;
  raw: string;
  start: number;
  end: number;
}

export function tokenizeWithIndices(command: string): TokenWithIndex[] {
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const tokens: TokenWithIndex[] = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    const raw = match[0];
    const value = match[1] ?? match[2] ?? match[3];
    const start = match.index;
    const end = regex.lastIndex;
    tokens.push({ value, raw, start, end });
  }
  return tokens;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DOCKER_FLAGS_WITH_ARGS = new Set([
  "-u",
  "--user",
  "-w",
  "--workdir",
  "-e",
  "--env",
  "--cpus",
  "-m",
  "--memory",
  "--network",
  "--platform",
]);

const PATH_PATTERN = "(?:\"[^\"]+\"|'[^']+'|\\S+)";

export function suggestRule(command: string): string | null {
  const firstLine = command.trim().split("\n")[0];
  if (!firstLine) {
    return null;
  }

  const tokens = tokenizeWithIndices(firstLine);
  if (tokens.length === 0) {
    return null;
  }

  // Case 1: git -C <path> ...
  if (
    tokens.length >= 4 &&
    tokens[0]?.value === "git" &&
    tokens[1]?.value === "-C"
  ) {
    const dirToken = tokens[2];
    if (dirToken) {
      const before = firstLine.slice(0, dirToken.start);
      const after = firstLine.slice(dirToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Case 2: npm --prefix <path> ...
  if (
    tokens.length >= 4 &&
    tokens[0]?.value === "npm" &&
    tokens[1]?.value === "--prefix"
  ) {
    const dirToken = tokens[2];
    if (dirToken) {
      const before = firstLine.slice(0, dirToken.start);
      const after = firstLine.slice(dirToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Case 3: docker exec ...
  if (
    tokens.length >= 3 &&
    tokens[0]?.value === "docker" &&
    tokens[1]?.value === "exec"
  ) {
    let containerToken: TokenWithIndex | null = null;
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) continue;
      if (DOCKER_FLAGS_WITH_ARGS.has(t.value)) {
        i++; // Skip next token as it's the flag's argument
        continue;
      }
      if (t.value.startsWith("-")) {
        continue; // Skip other option flags
      }
      containerToken = t;
      break;
    }

    if (containerToken) {
      const before = firstLine.slice(0, containerToken.start);
      const after = firstLine.slice(containerToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Fallback to classical glob pattern
  const first = tokens[0]?.value;
  if (!first) {
    return null;
  }
  const second = tokens[1]?.value;
  return second ? `${first} ${second}:*` : `${first}:*`;
}

export async function readAllowlistRules(
  allowlistFile: string,
): Promise<Set<string>> {
  try {
    const content = await fs.readFile(allowlistFile, "utf-8");
    return new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    );
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      return new Set();
    }
    throw e;
  }
}

export function generateReport(
  entries: ManualApprovalEntry[],
  existingRules: Set<string>,
): string {
  const byRule = new Map<string, { count: number; examples: string[] }>();

  for (const entry of entries) {
    if (entry.mode !== "allow_once") {
      continue;
    }
    const rule = suggestRule(entry.command);
    if (!rule || existingRules.has(rule)) {
      continue;
    }
    const bucket = byRule.get(rule) ?? { count: 0, examples: [] };
    bucket.count += 1;
    const example = truncate(entry.command.trim().split("\n")[0]);
    if (
      bucket.examples.length < MAX_EXAMPLES &&
      !bucket.examples.includes(example)
    ) {
      bucket.examples.push(example);
    }
    byRule.set(rule, bucket);
  }

  const recurring = Array.from(byRule.entries())
    .filter(([, { count }]) => count >= RULE_THRESHOLD)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  if (recurring.length === 0) {
    return "No recurring manual approvals found yet.";
  }

  let report =
    "Suggested bash approval rules (from recurring manual approvals):\n\n";
  for (const [rule, { count, examples }] of recurring) {
    report += `${count}x: ${rule}\n`;
    for (const example of examples) {
      report += `     e.g. ${example}\n`;
    }
    report += "\n";
  }
  report += "Add these lines to ~/.pi/agent/.bash-approval";
  return report;
}

function truncate(value: string): string {
  if (value.length <= EXAMPLE_MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, EXAMPLE_MAX_LENGTH)}…`;
}
```

- [ ] **Step 2: Run tests in the local repository workspace to verify they are all green**

Run: `npx vitest run packages/pi-approval-recorder/tests/report.spec.ts`
Expected: 100% tests pass (no failing cases).

- [ ] **Step 3: Commit the implemented suggestor logic**

Run:

```bash
git add packages/pi-approval-recorder/lib/report.ts
git commit -m "feat(approval-recorder): implement quote-aware tokenizer and regex suggestor with robust escaping"
```

---

### Task 3: Workspace-wide Format & Test Verification (Terminal Gate)

**Files:**

- None (Workspace operations)

- [ ] **Step 1: Format workspace code**

Run: `npm run format`
Expected: Prettier formats files clean.

- [ ] **Step 2: Run all workspace package-wide unit tests**

Run: `npx vitest run`
Expected: Passes with 100% success rate on all specs.

- [ ] **Step 3: Commit final formatting alignment**

Run:

```bash
git status --short
# If any changes shown:
# git commit -a -m "chore(approval-recorder): align formatting"
```
