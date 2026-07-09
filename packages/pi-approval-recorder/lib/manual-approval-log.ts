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
