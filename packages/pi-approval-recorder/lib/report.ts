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
