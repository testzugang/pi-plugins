import * as fs from "node:fs/promises";
import type { ManualApprovalEntry } from "./manual-approval-log.ts";

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
