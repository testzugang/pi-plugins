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
