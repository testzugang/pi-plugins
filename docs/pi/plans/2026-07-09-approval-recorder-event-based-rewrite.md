# pi-approval-recorder Event-Based Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite pi-approval-recorder to record manual bash approvals by subscribing to pi-bash-approval's event bus channels instead of re-implementing (incorrectly) the allowlist matching.

**Architecture:** The current implementation infers "manual approval" by re-checking commands against `~/.pi/agent/.bash-approval` with anchored-regex semantics — but the real consumer (`@fgladisch/pi-bash-approval` 0.2.7) uses prefix-glob/exact matching with chain splitting, so the inference is wrong end to end. The rewrite drops all inference: pi-bash-approval emits `pi-bash-approval:allowed` on pi's shared `EventBus` (`pi.events`, see `node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.d.ts`) with `mode: "allowlist" | "allow_once" | "allow_always"`. The recorder subscribes to that channel, logs entries with `mode !== "allowlist"` to `~/.pi/agent/logs/manual-approvals.jsonl`, and the `/bash-approval-report` command aggregates recurring `allow_once` entries into suggestions in pi-bash-approval's own rule format (`cmd subcmd:*` prefix globs, mirroring its `suggestPrefixPattern`), skipping rules already present in the allowlist.

**Tech Stack:** TypeScript (pi extension, loaded from source), vitest 4 (repo devDependency, no config file — run via `npx vitest run <path>`), Node `fs/promises`.

## Global Constraints

- Runtime dependency contract: event payloads from `@fgladisch/pi-bash-approval` >= 0.2.7 (the version that emits `pi-bash-approval:*` events). Do NOT import from that package — it has no `main`/`exports`; the event payload is the public contract. Define minimal structural types locally and validate payloads defensively (they arrive as `unknown`).
- The recorder is a passive observer: no error may ever escape an event handler into pi's pipeline. The report command reports errors via `ctx.ui.notify(..., "error")`.
- Suggested rules must use pi-bash-approval's pattern semantics (from `matchesPattern` in its `extensions/utils.ts`): `prefix:*` = command equals prefix or starts with `prefix + " "`; `prefix*` = startsWith; otherwise exact string match. Never emit regex-escaped text and never emit multi-line rule text (the allowlist file is parsed line by line).
- Log file format stays JSONL at `~/.pi/agent/logs/manual-approvals.jsonl`. New entries carry a `mode` field. Legacy entries (written by the old broken version, no `mode`) must be ignored by the report — they are known-polluted data.
- Keep the extension registered as `./packages/pi-approval-recorder/extension.ts` in the root `package.json` `pi.extensions` (already the case; the manifest test must keep passing).
- Commit messages follow the repo's gitmoji convention (e.g. `✨ feat(pi-approval-recorder): …`). Never add a Co-Authored-By line.
- ESM imports between package files use explicit `.js` extension-less TS style used elsewhere in the repo? — No: this package is loaded as TS source by pi. Import sibling modules with their real relative path WITHOUT extension mapping tricks: use `./lib/manual-approval-log.ts`-style imports only if the repo already does so; otherwise use extensionless `./lib/manual-approval-log`. Check one existing multi-file package (`packages/pi-handoff-session/extensions/handoff-session`) and copy its import style exactly.

## File Structure

- `packages/pi-approval-recorder/lib/manual-approval-log.ts` — NEW. Entry type, log path helper, append, read+parse (filters malformed and legacy lines).
- `packages/pi-approval-recorder/lib/report.ts` — NEW. `suggestRule()` (prefix-glob suggestion), `readAllowlistRules()`, `generateReport()` (pure aggregation over entries + existing rules).
- `packages/pi-approval-recorder/extension.ts` — REWRITTEN. Thin wiring only: subscribe `pi.events.on("pi-bash-approval:allowed", …)`, register `/bash-approval-report`. All old code (hand-rolled `ToolResultEvent`/`ExtensionContext` types, `getExecutedCommand`, `checkIfCommandIsAllowed`, `escapeRegex`, the `tool_result` handler) is deleted.
- `packages/pi-approval-recorder/tests/manual-approval-log.spec.ts` — NEW unit tests.
- `packages/pi-approval-recorder/tests/report.spec.ts` — NEW unit tests.
- `packages/pi-approval-recorder/tests/approval-recorder.spec.ts` — REWRITTEN integration tests (fake pi with event bus; keeps the root-manifest registration test).
- `packages/pi-approval-recorder/CONCEPT.md` — UPDATED architecture section.

---

### Task 1: Manual-approval log module

**Files:**
- Create: `packages/pi-approval-recorder/lib/manual-approval-log.ts`
- Test: `packages/pi-approval-recorder/tests/manual-approval-log.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 2 and 3):
  - `type ApprovalMode = "allow_once" | "allow_always"`
  - `type ManualApprovalEntry = { timestamp: string; command: string; cwd: string; mode: ApprovalMode; rule?: string }`
  - `manualApprovalLogPath(agentDir: string): string`
  - `appendManualApproval(logFile: string, entry: ManualApprovalEntry): Promise<void>`
  - `readManualApprovals(logFile: string): Promise<ManualApprovalEntry[]>`

- [x] **Step 1: Write the failing tests**

Create `packages/pi-approval-recorder/tests/manual-approval-log.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appendManualApproval,
  manualApprovalLogPath,
  readManualApprovals,
  type ManualApprovalEntry,
} from "../lib/manual-approval-log";

describe("manual-approval-log", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = join(tmpdir(), `pi-approval-recorder-log-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("builds the log path under the agent dir", () => {
    expect(manualApprovalLogPath(agentDir)).toBe(
      join(agentDir, "logs", "manual-approvals.jsonl"),
    );
  });

  it("appends entries as JSONL, creating the directory on demand", async () => {
    const logFile = manualApprovalLogPath(agentDir);
    const entry: ManualApprovalEntry = {
      timestamp: "2026-07-09T10:00:00.000Z",
      command: "git -C /tmp status",
      cwd: "/tmp",
      mode: "allow_once",
    };

    await appendManualApproval(logFile, entry);
    await appendManualApproval(logFile, { ...entry, mode: "allow_always", rule: "git -C:*" });

    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(entry);
    expect(JSON.parse(lines[1]).rule).toBe("git -C:*");
  });

  it("returns an empty list when the log file does not exist", async () => {
    await expect(
      readManualApprovals(manualApprovalLogPath(agentDir)),
    ).resolves.toEqual([]);
  });

  it("skips malformed lines and legacy entries without a mode field", async () => {
    const logFile = manualApprovalLogPath(agentDir);
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(
      logFile,
      [
        // legacy entry from the old broken implementation: no mode
        JSON.stringify({ timestamp: "2026-07-01T00:00:00.000Z", command: "npm test", cwd: "/tmp" }),
        "{ malformed jsonl",
        JSON.stringify({ timestamp: "2026-07-09T10:00:00.000Z", command: "git push", cwd: "/tmp", mode: "allow_once" }),
        JSON.stringify({ timestamp: "2026-07-09T10:01:00.000Z", command: "", cwd: "/tmp", mode: "allow_once" }),
        JSON.stringify({ timestamp: "2026-07-09T10:02:00.000Z", command: "rm -rf build", cwd: "/tmp", mode: "unknown-mode" }),
      ].join("\n"),
      "utf8",
    );

    const entries = await readManualApprovals(logFile);
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toBe("git push");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-approval-recorder/tests/manual-approval-log.spec.ts`
Expected: FAIL — cannot resolve `../lib/manual-approval-log`.

- [x] **Step 3: Write the implementation**

Create `packages/pi-approval-recorder/lib/manual-approval-log.ts`:

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ApprovalMode = "allow_once" | "allow_always";

export type ManualApprovalEntry = {
  timestamp: string;
  command: string;
  cwd: string;
  mode: ApprovalMode;
  rule?: string;
};

export function manualApprovalLogPath(agentDir: string): string {
  return path.join(agentDir, "logs", "manual-approvals.jsonl");
}

export async function appendManualApproval(
  logFile: string,
  entry: ManualApprovalEntry,
): Promise<void> {
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, `${JSON.stringify(entry)}\n`);
}

export async function readManualApprovals(
  logFile: string,
): Promise<ManualApprovalEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(logFile, "utf-8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const entries: ManualApprovalEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (
        typeof parsed?.command === "string" &&
        parsed.command.trim() &&
        (parsed.mode === "allow_once" || parsed.mode === "allow_always")
      ) {
        entries.push(parsed as ManualApprovalEntry);
      }
    } catch {
      // Ignore malformed JSONL lines so one bad write does not break reporting.
    }
  }
  return entries;
}
```

Note: if the import style check from Global Constraints requires explicit extensions, adjust the test import accordingly — implementation stays the same.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-approval-recorder/tests/manual-approval-log.spec.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add packages/pi-approval-recorder/lib/manual-approval-log.ts packages/pi-approval-recorder/tests/manual-approval-log.spec.ts
git commit -m "✨ feat(pi-approval-recorder): add manual-approval JSONL log module"
```

---

### Task 2: Report module (aggregation + rule suggestions)

**Files:**
- Create: `packages/pi-approval-recorder/lib/report.ts`
- Test: `packages/pi-approval-recorder/tests/report.spec.ts`

**Interfaces:**
- Consumes: `ManualApprovalEntry` from `../lib/manual-approval-log` (Task 1).
- Produces (used by Task 3):
  - `suggestRule(command: string): string | null` — prefix-glob suggestion in pi-bash-approval format
  - `readAllowlistRules(allowlistFile: string): Promise<Set<string>>`
  - `generateReport(entries: ManualApprovalEntry[], existingRules: Set<string>): string`

Suggestion semantics (mirrors pi-bash-approval's `suggestPrefixPattern`, utils.ts:886-911): take the first line of the trimmed command, split on whitespace; two or more tokens → `"<t1> <t2>:*"`, exactly one token → `"<t1>:*"`, empty → `null`. This is a whitespace approximation of its quote-aware tokenizer — acceptable because suggestions are reviewed by a human before pasting.

Report rules:
- Only `mode === "allow_once"` entries count toward suggestions (`allow_always` already persisted a rule via pi-bash-approval itself).
- Aggregate by suggested rule (not by raw command), threshold: total count >= 2.
- Skip rules already present in the allowlist (exact trimmed-line comparison — no semantic matching, that is pi-bash-approval's job).
- Show up to 3 example commands per rule, first line only, truncated to 80 chars.

- [x] **Step 1: Write the failing tests**

Create `packages/pi-approval-recorder/tests/report.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManualApprovalEntry } from "../lib/manual-approval-log";
import {
  generateReport,
  readAllowlistRules,
  suggestRule,
} from "../lib/report";

function entry(command: string, mode: ManualApprovalEntry["mode"] = "allow_once"): ManualApprovalEntry {
  return { timestamp: "2026-07-09T10:00:00.000Z", command, cwd: "/tmp", mode };
}

describe("suggestRule", () => {
  it("suggests a two-token prefix glob", () => {
    expect(suggestRule("git -C /tmp/example status --short")).toBe("git -C:*");
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
    dir = join(tmpdir(), `pi-approval-recorder-allow-${process.pid}-${Math.random().toString(36).slice(2)}`);
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
    await expect(readAllowlistRules(join(dir, "missing"))).resolves.toEqual(new Set());
  });
});

describe("generateReport", () => {
  it("suggests rules for recurring allow_once approvals, aggregated by rule", () => {
    const report = generateReport(
      [
        entry("git -C /tmp/a status"),
        entry("git -C /tmp/b diff"),
        entry("npm run lint"),
      ],
      new Set(),
    );

    expect(report).toContain("git -C:*");
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

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-approval-recorder/tests/report.spec.ts`
Expected: FAIL — cannot resolve `../lib/report`.

- [x] **Step 3: Write the implementation**

Create `packages/pi-approval-recorder/lib/report.ts`:

```typescript
import * as fs from "node:fs/promises";
import type { ManualApprovalEntry } from "./manual-approval-log";

const RULE_THRESHOLD = 2;
const MAX_EXAMPLES = 3;
const EXAMPLE_MAX_LENGTH = 80;

export function suggestRule(command: string): string | null {
  const firstLine = command.trim().split("\n")[0];
  const tokens = firstLine.split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (!first) {
    return null;
  }
  const second = tokens[1];
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
    if (bucket.examples.length < MAX_EXAMPLES && !bucket.examples.includes(example)) {
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

  let report = "Suggested bash approval rules (from recurring manual approvals):\n\n";
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

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-approval-recorder/tests/report.spec.ts`
Expected: PASS (8 tests).

- [x] **Step 5: Commit**

```bash
git add packages/pi-approval-recorder/lib/report.ts packages/pi-approval-recorder/tests/report.spec.ts
git commit -m "✨ feat(pi-approval-recorder): aggregate approvals into prefix-glob rule suggestions"
```

---

### Task 3: Rewrite extension wiring to the event bus

**Files:**
- Modify: `packages/pi-approval-recorder/extension.ts` (full rewrite)
- Modify: `packages/pi-approval-recorder/tests/approval-recorder.spec.ts` (full rewrite)

**Interfaces:**
- Consumes:
  - Task 1: `appendManualApproval(logFile, entry)`, `manualApprovalLogPath(agentDir)`, `readManualApprovals(logFile)`
  - Task 2: `generateReport(entries, existingRules)`, `readAllowlistRules(allowlistFile)`
  - pi API: `pi.events.on(channel: string, handler: (data: unknown) => void)` (`ExtensionAPI.events: EventBus`, `dist/core/extensions/types.d.ts:936`; `dist/core/event-bus.d.ts`)
  - Event payload contract (`pi-bash-approval:allowed`, emitted by @fgladisch/pi-bash-approval 0.2.7): `{ command: string; cwd: string; mode: "allowlist" | "allow_once" | "allow_always"; rule?: string; toolCallId: string; createdAt: string }`
- Produces: registered `/bash-approval-report` command; the extension default export.

The old `tool_result` handler, `getExecutedCommand` (with the dead `sessionManager.getMessages` fallback — that method does not exist on `ReadonlySessionManager`), `checkIfCommandIsAllowed`, `logManualApproval`, `generateReport`, `escapeRegex`, and the hand-rolled `ToolResultEvent`/`ExtensionContext` types are all deleted. The old test's `jest.doMock("@earendil-works/pi-coding-agent", …, { virtual: true })` scaffolding is deleted too (the import is type-only; vitest has no `virtual` option).

- [x] **Step 1: Rewrite the test file (failing first)**

Replace `packages/pi-approval-recorder/tests/approval-recorder.spec.ts` entirely:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(TEST_DIR, "..", "..", "..");

type CommandOpts = {
  description: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

type FakePi = {
  pi: any;
  commands: Map<string, CommandOpts>;
  emit: (channel: string, data: unknown) => void;
};

function makeFakePi(): FakePi {
  const commands = new Map<string, CommandOpts>();
  const channels = new Map<string, Array<(data: unknown) => void>>();

  const pi = {
    on: vi.fn(),
    registerCommand: vi.fn((name: string, opts: CommandOpts) => {
      commands.set(name, opts);
    }),
    events: {
      on: vi.fn((channel: string, handler: (data: unknown) => void) => {
        if (!channels.has(channel)) channels.set(channel, []);
        channels.get(channel)!.push(handler);
        return () => {};
      }),
      emit: vi.fn(),
    },
  };

  return {
    pi,
    commands,
    emit: (channel, data) => {
      for (const handler of channels.get(channel) ?? []) handler(data);
    },
  };
}

function logPath(home: string) {
  return join(home, ".pi", "agent", "logs", "manual-approvals.jsonl");
}

function allowlistPath(home: string) {
  return join(home, ".pi", "agent", ".bash-approval");
}

async function loadExtension(home: string) {
  vi.resetModules();
  vi.doMock("node:os", () => ({
    homedir: () => home,
    tmpdir: () => tmpdir(),
  }));
  return (await import("../extension")).default;
}

function allowedEvent(overrides: Record<string, unknown>) {
  return {
    plugin: "pi-bash-approval",
    toolCallId: "tool-call-1",
    cwd: "/tmp/project",
    command: "git push origin main",
    mode: "allow_once",
    createdAt: "2026-07-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("pi-approval-recorder extension", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = join(tmpdir(), `pi-approval-recorder-home-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("is registered from the root package manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(WORKSPACE_ROOT, "package.json"), "utf8"),
    ) as { pi?: { extensions?: string[] } };

    expect(manifest.pi?.extensions).toContain(
      "./packages/pi-approval-recorder/extension.ts",
    );
  });

  it("records allow_once and allow_always events to the JSONL log", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allow_once" }));
    fake.emit(
      "pi-bash-approval:allowed",
      allowedEvent({ mode: "allow_always", command: "npm test unit", rule: "npm test:*" }),
    );

    await vi.waitFor(() => {
      expect(existsSync(logPath(tempHome))).toBe(true);
      expect(readFileSync(logPath(tempHome), "utf8").trim().split("\n")).toHaveLength(2);
    });

    const entries = readFileSync(logPath(tempHome), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(entries[0]).toMatchObject({
      command: "git push origin main",
      cwd: "/tmp/project",
      mode: "allow_once",
    });
    expect(new Date(entries[0].timestamp).toString()).not.toBe("Invalid Date");
    expect(entries[1]).toMatchObject({ mode: "allow_always", rule: "npm test:*" });
  });

  it("ignores allowlist-mode events and malformed payloads", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allowlist" }));
    fake.emit("pi-bash-approval:allowed", allowedEvent({ command: 42 }));
    fake.emit("pi-bash-approval:allowed", null);
    fake.emit("pi-bash-approval:allowed", "not an object");

    // Give fire-and-forget handlers a tick to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(existsSync(logPath(tempHome))).toBe(false);
  });

  it("never lets recording errors escape the event handler", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    // Make the log path unwritable: create a FILE where the logs DIRECTORY should be.
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(join(tempHome, ".pi", "agent", "logs"), "not a directory", "utf8");

    expect(() =>
      fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allow_once" })),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("reports recurring manual approvals via /bash-approval-report", async () => {
    const logFile = logPath(tempHome);
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(
      logFile,
      [
        { timestamp: "2026-07-09T10:00:00.000Z", command: "git push origin main", cwd: "/a", mode: "allow_once" },
        { timestamp: "2026-07-09T10:01:00.000Z", command: "git push origin dev", cwd: "/b", mode: "allow_once" },
        // legacy entry without mode: must be ignored
        { timestamp: "2026-07-01T00:00:00.000Z", command: "curl example.com", cwd: "/c" },
        { timestamp: "2026-07-02T00:00:00.000Z", command: "curl example.com", cwd: "/c" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
      "utf8",
    );
    // Rule already covered by the allowlist must not be suggested.
    mkdirSync(dirname(allowlistPath(tempHome)), { recursive: true });
    writeFileSync(allowlistPath(tempHome), "npm test:*\n", "utf8");

    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    const reportCommand = fake.commands.get("bash-approval-report");
    expect(reportCommand).toBeDefined();

    const ctx = { ui: { notify: vi.fn() } };
    await reportCommand!.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const [report, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(report).toContain("2x: git push:*");
    expect(report).not.toContain("curl");
  });

  it("notifies an error when report generation fails", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    // Unreadable log: a directory at the log-file path makes readFile fail with EISDIR.
    mkdirSync(logPath(tempHome), { recursive: true });

    const ctx = { ui: { notify: vi.fn() } };
    await fake.commands.get("bash-approval-report")!.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate report"),
      "error",
    );
  });
});
```

Note `WORKSPACE_ROOT`: the old spec computed it wrong by naming (`PACKAGE_ROOT` pointed at `packages/`); here it is three levels up from `tests/` = repo root. Verify the manifest test passes against the real root `package.json`.

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run packages/pi-approval-recorder/tests/approval-recorder.spec.ts`
Expected: manifest test PASS; all event/report tests FAIL (extension still has the old `tool_result` implementation, no `events.on` subscription).

- [x] **Step 3: Rewrite the extension**

Replace `packages/pi-approval-recorder/extension.ts` entirely:

```typescript
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendManualApproval,
  manualApprovalLogPath,
  readManualApprovals,
  type ApprovalMode,
} from "./lib/manual-approval-log";
import { generateReport, readAllowlistRules } from "./lib/report";

// Structural contract of the `pi-bash-approval:allowed` event emitted by
// @fgladisch/pi-bash-approval >= 0.2.7. Not imported: that package exposes
// no entry point; the event payload is the public interface.
const MANUAL_MODES: ReadonlySet<string> = new Set(["allow_once", "allow_always"]);

export default function (pi: ExtensionAPI) {
  pi.events.on("pi-bash-approval:allowed", (data) => {
    recordManualApproval(data).catch(() => {
      // Passive observer: recording must never break the session.
    });
  });

  pi.registerCommand("bash-approval-report", {
    description:
      "Analyze recorded manual bash approvals and suggest new allowlist rules",
    handler: async (_args, ctx) => {
      try {
        const agentDir = getAgentDir();
        const entries = await readManualApprovals(manualApprovalLogPath(agentDir));
        const existingRules = await readAllowlistRules(
          path.join(agentDir, ".bash-approval"),
        );
        ctx.ui.notify(generateReport(entries, existingRules), "info");
      } catch (e: any) {
        ctx.ui.notify(`Failed to generate report: ${e.message}`, "error");
      }
    },
  });
}

function getAgentDir(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

async function recordManualApproval(data: unknown): Promise<void> {
  if (typeof data !== "object" || data === null) {
    return;
  }
  const event = data as Record<string, unknown>;
  if (typeof event.mode !== "string" || !MANUAL_MODES.has(event.mode)) {
    return;
  }
  if (typeof event.command !== "string" || !event.command.trim()) {
    return;
  }

  await appendManualApproval(manualApprovalLogPath(getAgentDir()), {
    timestamp: new Date().toISOString(),
    command: event.command.trim(),
    cwd: typeof event.cwd === "string" ? event.cwd : process.cwd(),
    mode: event.mode as ApprovalMode,
    ...(typeof event.rule === "string" ? { rule: event.rule } : {}),
  });
}
```

- [x] **Step 4: Run the full package test suite**

Run: `npx vitest run packages/pi-approval-recorder`
Expected: PASS — all specs from Tasks 1-3.

- [x] **Step 5: Commit**

```bash
git add packages/pi-approval-recorder/extension.ts packages/pi-approval-recorder/tests/approval-recorder.spec.ts
git commit -m "♻️ refactor(pi-approval-recorder): record approvals from pi-bash-approval events instead of allowlist inference"
```

---

### Task 4: Update CONCEPT.md and validate the workspace

**Files:**
- Modify: `packages/pi-approval-recorder/CONCEPT.md`

**Interfaces:**
- Consumes: the architecture implemented in Tasks 1-3.
- Produces: documentation matching the implementation.

- [x] **Step 1: Rewrite the architecture sections of CONCEPT.md**

Replace the content of `packages/pi-approval-recorder/CONCEPT.md` with:

```markdown
# Konzept: pi-approval-recorder

## Ziel
Aufzeichnen manueller Bash-Bestätigungen, um wiederkehrende Muster zu erkennen. Erleichtert das Erstellen neuer Regeln für die `~/.pi/agent/.bash-approval` Allowlist von `pi-bash-approval`. Reduziert manuelle Freigaben langfristig.

## Warum Event-Subscription statt eigener Inferenz?
`pi-bash-approval` (>= 0.2.7) emittiert auf dem geteilten Event-Bus (`pi.events`) das Event `pi-bash-approval:allowed` mit `mode: "allowlist" | "allow_once" | "allow_always"`. Damit ist direkt beobachtbar, ob ein Kommando automatisch erlaubt oder manuell bestätigt wurde — eine eigene Nachbildung des Allowlist-Matchings (Regex-Interpretation, Chain-Splitting, Normalisierung) ist unnötig und war in der ersten Version fehlerhaft.

Das Event-Payload ist der öffentliche Vertrag; das Paket selbst wird nicht importiert (kein Entry Point). Payloads werden defensiv validiert.

## Architektur

### 1. Aufzeichnung (Event-Subscription)
- `pi.events.on("pi-bash-approval:allowed", …)`.
- `mode === "allowlist"` → ignorieren (automatisch erlaubt).
- `mode === "allow_once" | "allow_always"` → manuelle Bestätigung, wird geloggt (inkl. `rule`, falls persistiert).
- Fehler beim Loggen werden verschluckt: der Recorder ist ein passiver Beobachter und darf die Session nie stören.

### 2. Datenhaltung
- Datei: `~/.pi/agent/logs/manual-approvals.jsonl` (append-only).
- Format: `{"timestamp": "...", "command": "...", "cwd": "...", "mode": "allow_once" | "allow_always", "rule": "..."?}`.
- Alt-Einträge ohne `mode` (aus der fehlerhaften Erstversion) werden beim Auswerten ignoriert.

### 3. Auswertung
- Kommando `/bash-approval-report`.
- Aggregiert `allow_once`-Einträge nach vorgeschlagener Regel; Schwelle: >= 2 Vorkommen.
- Vorschläge im Format von `pi-bash-approval` (`cmd subcmd:*` Prefix-Glob, analog dessen `suggestPrefixPattern`) — keine Regexes, keine mehrzeiligen Regeln.
- Regeln, die bereits wörtlich in der Allowlist stehen, werden nicht erneut vorgeschlagen.

## Abhängigkeiten
- Laufzeit: `@fgladisch/pi-bash-approval` >= 0.2.7 muss installiert sein, sonst wird nichts aufgezeichnet (Events fehlen).
- Modulstruktur: `extension.ts` (Wiring), `lib/manual-approval-log.ts` (Log), `lib/report.ts` (Auswertung).
```

- [x] **Step 2: Run the package tests and the workspace validation**

Run: `npx vitest run packages/pi-approval-recorder`
Expected: PASS.

Run: `npm run validate`
Expected: exit 0 (package manifest validation).

- [x] **Step 3: Commit**

```bash
git add packages/pi-approval-recorder/CONCEPT.md
git commit -m "📝 docs(pi-approval-recorder): document event-based recording architecture"
```
