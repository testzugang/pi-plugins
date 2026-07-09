import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appendManualApproval,
  manualApprovalLogPath,
  readManualApprovals,
  type ManualApprovalEntry,
} from "../lib/manual-approval-log.ts";

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
