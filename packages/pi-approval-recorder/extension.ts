import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendManualApproval,
  manualApprovalLogPath,
  readManualApprovals,
  type ApprovalMode,
} from "./lib/manual-approval-log.ts";
import { generateReport, readAllowlistRules } from "./lib/report.ts";

// Structural contract of the `pi-bash-approval:allowed` event emitted by
// @fgladisch/pi-bash-approval >= 0.2.7. Not imported: that package exposes
// no entry point; the event payload is the public interface.
const MANUAL_MODES: ReadonlySet<string> = new Set(["allow_once", "allow_always"]);

// Serializes appends to the JSONL log: concurrent `pi-bash-approval:allowed`
// events (e.g. two approvals in the same tick) would otherwise race on
// mkdir/appendFile and land out of order. Failures are isolated per append
// so one bad write doesn't jam the queue for subsequent events.
let appendQueue: Promise<void> = Promise.resolve();

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

  const entry = {
    timestamp: new Date().toISOString(),
    command: event.command.trim(),
    cwd: typeof event.cwd === "string" ? event.cwd : process.cwd(),
    mode: event.mode as ApprovalMode,
    ...(typeof event.rule === "string" ? { rule: event.rule } : {}),
  };

  const logFile = manualApprovalLogPath(getAgentDir());
  const task = appendQueue.catch(() => {}).then(() => appendManualApproval(logFile, entry));
  appendQueue = task.catch(() => {});
  await task;
}
