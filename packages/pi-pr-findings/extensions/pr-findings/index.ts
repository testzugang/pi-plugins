import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ExecResult = {
  code: number | null;
  stdout?: string;
  stderr?: string;
};

type Severity = "blocker" | "warning" | "nit" | "all";
type WaitMode = "new-review-activity" | "checks-finished";

type FindingsOptions = {
  prNumber?: number;
  repo?: string;
  unresolved: boolean;
  severity: Severity;
  includeStale: boolean;
  mine: boolean;
  waitForNextReview: boolean;
  waitMode: WaitMode;
  waitTimeoutSec: number;
  waitPollSec: number;
};

type ActivitySnapshot = {
  summaryCount: number;
  inlineCount: number;
  latestAtMs: number;
};

type PrSummaryComment = {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  url: string;
};

type InlineComment = {
  id: string;
  author: string;
  createdAt: string;
  path: string;
  line: number | null;
  body: string;
  commitId: string;
  url: string;
  isOutdated: boolean;
  isResolved: boolean;
};

type FindingsData = {
  pr: {
    number: number;
    state: string;
    headSha: string;
    url: string;
  };
  viewerLogin: string;
  checks: Array<{
    name: string;
    conclusion: string;
    url: string;
  }>;
  summaryComments: PrSummaryComment[];
  inlineComments: InlineComment[];
};

const EXEC_TIMEOUT_MS = 20_000;

const DROP_AUTHORS = new Set([
  "sonarqubecloud[bot]",
  "sonarcloud[bot]",
  "dependabot[bot]",
  "github-actions[bot]",
]);

const SECTION_HEADER_RE =
  /^#{1,6}\s*(?:🔴|🟡|🔵|✅)?\s*(blockers?|warnings?|nits?|approvals?|strengths?|suggestions?).*$/gim;
const NUMBERED_ITEM_RE = /^\s*\d+\.\s+/gm;

const DEFAULTS = {
  severity: "all" as Severity,
  unresolved: false,
  includeStale: false,
  mine: false,
  waitForNextReview: false,
  waitMode: "new-review-activity" as WaitMode,
  waitTimeoutSec: 60,
  waitPollSec: 30,
};

export default function registerPrFindings(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pr_findings",
    label: "PR Findings",
    description:
      "Fetch GitHub PR review findings via gh, grouped by severity, with optional wait for fresh review activity.",
    promptSnippet: "Fetch GitHub PR findings and summarize by severity",
    promptGuidelines: [
      "Use waitForNextReview=true after pushing fixes so you don't read stale findings before the next review run finishes.",
      "Default wait timeout is 60s with 30s polling when waiting is enabled.",
    ],
    parameters: Type.Object({
      prNumber: Type.Optional(Type.Number({ description: "PR number" })),
      repo: Type.Optional(
        Type.String({ description: "Repository in owner/repo format" }),
      ),
      unresolved: Type.Optional(
        Type.Boolean({ description: "Show unresolved findings only" }),
      ),
      severity: Type.Optional(
        Type.Union([
          Type.Literal("blocker"),
          Type.Literal("warning"),
          Type.Literal("nit"),
          Type.Literal("all"),
        ]),
      ),
      includeStale: Type.Optional(
        Type.Boolean({ description: "Include stale findings on old commits" }),
      ),
      mine: Type.Optional(
        Type.Boolean({
          description: "Show only findings authored by current gh user",
        }),
      ),
      waitForNextReview: Type.Optional(
        Type.Boolean({
          description:
            "Wait for new review activity before reading findings (useful right after a push)",
        }),
      ),
      waitMode: Type.Optional(
        Type.Union([
          Type.Literal("new-review-activity"),
          Type.Literal("checks-finished"),
        ]),
      ),
      waitTimeoutSec: Type.Optional(
        Type.Number({
          description: "Timeout for waiting mode in seconds (default 60)",
        }),
      ),
      waitPollSec: Type.Optional(
        Type.Number({
          description:
            "Polling interval for waiting mode in seconds (default 30)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      await ensureGhAvailable(pi);

      const options = normalizeOptions(params);
      const repo = await resolveRepo(pi, options.repo);
      const prNumber = await resolvePrNumber(pi, repo, options.prNumber);

      let waitSummary = "";
      if (options.waitForNextReview) {
        if (options.waitMode === "checks-finished") {
          const waited = await waitForChecksFinished(
            pi,
            repo,
            prNumber,
            options,
          );
          waitSummary = waited
            ? "Waited for checks to finish before collecting findings."
            : "Wait timeout reached before checks finished; collected current findings.";
        } else {
          const waited = await waitForNewReviewActivity(
            pi,
            repo,
            prNumber,
            options,
          );
          waitSummary = waited
            ? "Detected new review activity before collecting findings."
            : "Wait timeout reached before new review activity; collected current findings.";
        }
      }

      const data = await fetchFindingsData(pi, repo, prNumber);
      const report = renderMarkdown(data, options);
      const closing = closingLine(report);
      const text = waitSummary
        ? `${report}\n${closing}\n\n${waitSummary}`
        : `${report}\n${closing}`;

      return {
        content: [{ type: "text", text }],
        details: {
          repo,
          prNumber,
          waitForNextReview: options.waitForNextReview,
          waitMode: options.waitMode,
          waitTimeoutSec: options.waitTimeoutSec,
          waitPollSec: options.waitPollSec,
        },
      };
    },
  });
}

function normalizeOptions(params: Record<string, unknown>): FindingsOptions {
  const severity = normalizeSeverity(params.severity);
  const waitMode = normalizeWaitMode(params.waitMode);
  const waitTimeoutSec = clampPositiveNumber(
    params.waitTimeoutSec,
    DEFAULTS.waitTimeoutSec,
    5,
    3600,
  );
  const waitPollSec = clampPositiveNumber(
    params.waitPollSec,
    DEFAULTS.waitPollSec,
    5,
    600,
  );

  return {
    prNumber:
      typeof params.prNumber === "number" && Number.isInteger(params.prNumber)
        ? params.prNumber
        : undefined,
    repo: normalizeRepo(params.repo),
    unresolved: params.unresolved === true,
    severity,
    includeStale: params.includeStale === true,
    mine: params.mine === true,
    waitForNextReview: params.waitForNextReview === true,
    waitMode,
    waitTimeoutSec,
    waitPollSec,
  };
}

function normalizeSeverity(value: unknown): Severity {
  if (value === "blocker" || value === "warning" || value === "nit") {
    return value;
  }
  return DEFAULTS.severity;
}

function normalizeWaitMode(value: unknown): WaitMode {
  if (value === "checks-finished") return "checks-finished";
  return DEFAULTS.waitMode;
}

function clampPositiveNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const repo = value.trim();
  if (!repo) return undefined;
  return repo;
}

async function ensureGhAvailable(pi: ExtensionAPI): Promise<void> {
  const result = await exec(pi, "gh", ["--version"], EXEC_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new Error("gh CLI is required. Install gh and run `gh auth login`.");
  }
}

async function resolveRepo(pi: ExtensionAPI, repo?: string): Promise<string> {
  if (repo) return repo;
  const resolved = await ghText(pi, [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
  if (!resolved) {
    throw new Error("cannot determine repo — pass repo as owner/repo");
  }
  return resolved;
}

async function resolvePrNumber(
  pi: ExtensionAPI,
  repo: string,
  prNumber?: number,
): Promise<number> {
  if (prNumber && prNumber > 0) return prNumber;
  const resolved = await ghText(pi, [
    "pr",
    "view",
    "-R",
    repo,
    "--json",
    "number",
    "-q",
    ".number",
  ]);
  const num = Number.parseInt(resolved, 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error("no PR for current branch — pass a PR number");
  }
  return num;
}

async function waitForNewReviewActivity(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
  options: FindingsOptions,
): Promise<boolean> {
  const baseline = await fetchActivitySnapshot(pi, repo, prNumber);
  const deadline = Date.now() + options.waitTimeoutSec * 1000;

  while (Date.now() < deadline) {
    await sleep(options.waitPollSec * 1000);
    const current = await fetchActivitySnapshot(pi, repo, prNumber);
    if (hasNewActivity(current, baseline)) {
      return true;
    }
  }

  return false;
}

async function waitForChecksFinished(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
  options: FindingsOptions,
): Promise<boolean> {
  const deadline = Date.now() + options.waitTimeoutSec * 1000;

  while (Date.now() < deadline) {
    await sleep(options.waitPollSec * 1000);
    const checks = await fetchChecks(pi, repo, prNumber);
    if (allChecksTerminal(checks)) {
      return true;
    }
  }

  return false;
}

function hasNewActivity(
  current: ActivitySnapshot,
  baseline: ActivitySnapshot,
): boolean {
  if (current.summaryCount > baseline.summaryCount) return true;
  if (current.inlineCount > baseline.inlineCount) return true;
  if (current.latestAtMs > baseline.latestAtMs) return true;
  return false;
}

async function fetchActivitySnapshot(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<ActivitySnapshot> {
  const prView = await ghJson<{
    comments?: Array<{ createdAt?: string }>;
    reviews?: Array<{ submittedAt?: string }>;
  }>(pi, [
    "pr",
    "view",
    String(prNumber),
    "-R",
    repo,
    "--json",
    "comments,reviews",
  ]);

  const inline = await ghJson<Array<{ created_at?: string }>>(pi, [
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
  ]);

  const summaryTimes = [
    ...(prView.comments ?? []).map((c) => c.createdAt ?? ""),
    ...(prView.reviews ?? []).map((r) => r.submittedAt ?? ""),
  ];
  const inlineTimes = (inline ?? []).map((c) => c.created_at ?? "");
  const latestAtMs = Math.max(
    ...[...summaryTimes, ...inlineTimes].map((iso) => parseIsoToMs(iso)),
    0,
  );

  return {
    summaryCount:
      (prView.comments ?? []).length + (prView.reviews ?? []).length,
    inlineCount: (inline ?? []).length,
    latestAtMs,
  };
}

async function fetchFindingsData(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<FindingsData> {
  const owner = repo.split("/")[0] ?? "";
  const name = repo.split("/")[1] ?? "";
  if (!owner || !name) {
    throw new Error("repo must be owner/repo");
  }

  await ensureGhVersion(pi);

  const prView = await ghJson<{
    number: number;
    state: string;
    headRefOid: string;
    url: string;
    comments?: Array<{
      id?: string;
      author?: { login?: string };
      createdAt?: string;
      body?: string;
      url?: string;
    }>;
    reviews?: Array<{
      id?: string;
      author?: { login?: string };
      submittedAt?: string;
      body?: string;
      url?: string;
    }>;
    statusCheckRollup?: Array<{
      name?: string;
      context?: string;
      conclusion?: string;
      state?: string;
      detailsUrl?: string;
      targetUrl?: string;
    }>;
  }>(pi, [
    "pr",
    "view",
    String(prNumber),
    "-R",
    repo,
    "--json",
    "number,state,headRefOid,url,comments,reviews,statusCheckRollup",
  ]);

  const inline = await ghJson<
    Array<{
      id?: number;
      user?: { login?: string };
      created_at?: string;
      path?: string;
      line?: number;
      original_line?: number;
      body?: string;
      commit_id?: string;
      html_url?: string;
    }>
  >(pi, [
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${owner}/${name}/pulls/${prNumber}/comments?per_page=100`,
  ]);

  const threads = await ghJson<{
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              isResolved?: boolean;
              isOutdated?: boolean;
              comments?: { nodes?: Array<{ databaseId?: number }> };
            }>;
          };
        };
      };
    };
  }>(pi, [
    "api",
    "graphql",
    "-f",
    "query=query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:100){nodes{databaseId}}}}}}}",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `num=${prNumber}`,
  ]);

  const viewerLogin = await ghText(pi, ["api", "user", "-q", ".login"]);

  const resolvedMap = buildResolvedMap(threads);
  const headSha = prView.headRefOid ?? "";

  const summaryComments: PrSummaryComment[] = [
    ...((prView.comments ?? []).map((c) => ({
      id: String(c.id ?? ""),
      author: c.author?.login ?? "unknown",
      createdAt: c.createdAt ?? "",
      body: c.body ?? "",
      url: c.url ?? "",
    })) as PrSummaryComment[]),
    ...((prView.reviews ?? [])
      .filter((r) => (r.body ?? "") !== "")
      .map((r) => ({
        id: String(r.id ?? ""),
        author: r.author?.login ?? "unknown",
        createdAt: r.submittedAt ?? "",
        body: r.body ?? "",
        url: r.url ?? "",
      })) as PrSummaryComment[]),
  ];

  const inlineComments: InlineComment[] = (inline ?? []).map((c) => {
    const id = String(c.id ?? "");
    const resolved = resolvedMap[id] ?? {
      isOutdated: false,
      isResolved: false,
    };
    return {
      id,
      author: c.user?.login ?? "unknown",
      createdAt: c.created_at ?? "",
      path: c.path ?? "?",
      line: c.line ?? c.original_line ?? null,
      body: c.body ?? "",
      commitId: c.commit_id ?? "",
      url: c.html_url ?? "",
      isOutdated:
        resolved.isOutdated ||
        Boolean((c.commit_id ?? "") && (c.commit_id ?? "") !== headSha),
      isResolved: resolved.isResolved,
    };
  });

  return {
    pr: {
      number: prView.number,
      state: prView.state ?? "OPEN",
      headSha,
      url: prView.url ?? "",
    },
    viewerLogin,
    checks: (prView.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? check.context ?? "check",
      conclusion: check.conclusion ?? check.state ?? "PENDING",
      url: check.detailsUrl ?? check.targetUrl ?? "",
    })),
    summaryComments,
    inlineComments,
  };
}

function buildResolvedMap(threads: {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{
            isResolved?: boolean;
            isOutdated?: boolean;
            comments?: { nodes?: Array<{ databaseId?: number }> };
          }>;
        };
      };
    };
  };
}): Record<string, { isResolved: boolean; isOutdated: boolean }> {
  const out: Record<string, { isResolved: boolean; isOutdated: boolean }> = {};
  const nodes =
    threads.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

  for (const thread of nodes) {
    const isResolved = thread.isResolved === true;
    const isOutdated = thread.isOutdated === true;
    for (const comment of thread.comments?.nodes ?? []) {
      if (typeof comment.databaseId !== "number") continue;
      out[String(comment.databaseId)] = { isResolved, isOutdated };
    }
  }

  return out;
}

async function ensureGhVersion(pi: ExtensionAPI): Promise<void> {
  const version = await ghText(pi, ["--version"]);
  const firstLine = version.split("\n")[0] ?? "";
  const raw = firstLine.split(" ")[2] ?? "";
  const [majorText, minorText] = raw.split(".");
  const major = Number.parseInt(majorText ?? "0", 10);
  const minor = Number.parseInt(minorText ?? "0", 10);
  if (major < 2 || (major === 2 && minor < 40)) {
    throw new Error(
      `gh ${raw || "unknown"} is too old — need >= 2.40 for statusCheckRollup`,
    );
  }
}

async function fetchChecks(
  pi: ExtensionAPI,
  repo: string,
  prNumber: number,
): Promise<Array<{ conclusion?: string; state?: string }>> {
  const prView = await ghJson<{
    statusCheckRollup?: Array<{ conclusion?: string; state?: string }>;
  }>(pi, [
    "pr",
    "view",
    String(prNumber),
    "-R",
    repo,
    "--json",
    "statusCheckRollup",
  ]);

  return prView.statusCheckRollup ?? [];
}

function allChecksTerminal(
  checks: Array<{ conclusion?: string; state?: string }>,
): boolean {
  if (checks.length === 0) return true;
  return checks.every((check) => {
    const value = (check.conclusion ?? check.state ?? "").toUpperCase();
    return ![
      "PENDING",
      "IN_PROGRESS",
      "QUEUED",
      "WAITING",
      "REQUESTED",
    ].includes(value);
  });
}

function renderMarkdown(data: FindingsData, options: FindingsOptions): string {
  const findings: Record<"blocker" | "warning" | "nit" | "info", string[]> = {
    blocker: [],
    warning: [],
    nit: [],
    info: [],
  };

  let staleDropped = 0;

  const keep = (author: string, isResolved?: boolean): boolean => {
    const lower = author.toLowerCase();
    if (DROP_AUTHORS.has(lower)) return false;
    if (options.mine && lower !== data.viewerLogin.toLowerCase()) return false;
    if (options.unresolved && isResolved) return false;
    return true;
  };

  for (const c of data.inlineComments) {
    if (!keep(c.author, c.isResolved)) continue;
    if (c.isOutdated && !options.includeStale) {
      staleDropped += 1;
      continue;
    }
    const sev = classify(c.body);
    const lineNo = c.line ?? "?";
    findings[sev].push(
      `- \`${c.path}:${lineNo}\` — ${excerpt(c.body)} ([link](${c.url}))`,
    );
  }

  for (const c of data.summaryComments) {
    if (!keep(c.author, false)) continue;

    const split = splitBotSummary(c.body);
    if (split) {
      for (const part of split) {
        findings[part.severity].push(
          `- _${c.author}_: ${excerpt(part.item)} ([link](${c.url}))`,
        );
      }
      continue;
    }

    const sev = classify(c.body);
    findings[sev].push(
      `- _${c.author}_ (${humanizeAge(c.createdAt)}): ${excerpt(c.body)} ([link](${c.url}))`,
    );
  }

  if (options.severity !== "all") {
    for (const key of Object.keys(findings) as Array<
      "blocker" | "warning" | "nit" | "info"
    >) {
      if (key !== options.severity) findings[key] = [];
    }
  }

  const shortSha = data.pr.headSha.slice(0, 7);
  const parts: string[] = [];
  parts.push(
    `## PR #${data.pr.number} findings — revision \`${shortSha}\` ${stateBadge(data.pr.state)}`.trim(),
  );

  if (data.checks.length > 0) {
    const renderedChecks = data.checks
      .map((check) => {
        const failed = ["FAILURE", "ERROR"].includes(
          (check.conclusion ?? "").toUpperCase(),
        );
        const details = failed && check.url ? ` ([details](${check.url}))` : "";
        return `${checkIcon(check.conclusion)} ${check.name}${details}`;
      })
      .join(" · ");
    parts.push(`\n**Status checks:** ${renderedChecks}`);
  }

  const sections: Array<[keyof typeof findings, string]> = [
    ["blocker", "### 🔴 Blockers"],
    ["warning", "### 🟡 Warnings"],
    ["nit", "### 🔵 Nits"],
    ["info", "### ✅ Approvals / strengths"],
  ];

  for (const [key, header] of sections) {
    const items = findings[key];
    if (items.length === 0) continue;
    parts.push(`\n${header} (${items.length})\n`);
    parts.push(...items);
  }

  if (staleDropped > 0 && !options.includeStale) {
    parts.push(
      `\n---\n<small>${staleDropped} stale finding(s) on older commits skipped (use \`--include-stale\` to show).</small>`,
    );
  }

  const total = Object.values(findings).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  if (total === 0) {
    parts.push("\n_No findings._");
  }

  return `${parts.join("\n")}\n`;
}

function classify(body: string): "blocker" | "warning" | "nit" | "info" {
  const text = body.toLowerCase();

  if (matchesAny(text, ["🔴", "blocker", "must fix", "critical", "breaks"])) {
    return "blocker";
  }
  if (
    matchesAny(text, ["🟡", "warning", "should", "leak", "race", "missing"])
  ) {
    return "warning";
  }
  if (
    matchesAny(text, [
      "🔵",
      "nit",
      "suggestion",
      "consider",
      "could be",
      "minor",
    ])
  ) {
    return "nit";
  }
  if (matchesAny(text, ["approved", "lgtm", "strength", "looks good"])) {
    return "info";
  }

  return "warning";
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (
      pattern.length === 1 ||
      pattern.includes("🔴") ||
      pattern.includes("🟡") ||
      pattern.includes("🔵")
    ) {
      return text.includes(pattern.toLowerCase());
    }
    return new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i").test(text);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitBotSummary(body: string): Array<{
  severity: "blocker" | "warning" | "nit" | "info";
  item: string;
}> | null {
  const sectionHeaderRe = new RegExp(
    SECTION_HEADER_RE.source,
    SECTION_HEADER_RE.flags,
  );
  const matches = Array.from(body.matchAll(sectionHeaderRe));
  if (matches.length === 0) return null;

  const out: Array<{
    severity: "blocker" | "warning" | "nit" | "info";
    item: string;
  }> = [];

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const section = current?.[1] ?? "";
    const start =
      current?.index !== undefined ? current.index + current[0].length : 0;
    const end =
      i + 1 < matches.length && matches[i + 1]?.index !== undefined
        ? (matches[i + 1]?.index as number)
        : body.length;

    const sectionBody = body.slice(start, end).trim();
    const severity = sectionToSeverity(section);
    const items = sectionBody
      .split(NUMBERED_ITEM_RE)
      .map((item) => item.trim())
      .filter(Boolean);

    if (items.length === 0) {
      if (sectionBody) out.push({ severity, item: sectionBody });
      continue;
    }

    for (const item of items) {
      out.push({ severity, item });
    }
  }

  return out.length > 0 ? out : null;
}

function sectionToSeverity(
  section: string,
): "blocker" | "warning" | "nit" | "info" {
  const value = section.toLowerCase();
  if (value.includes("blocker")) return "blocker";
  if (value.includes("warning")) return "warning";
  if (value.includes("nit") || value.includes("suggestion")) return "nit";
  if (value.includes("approval") || value.includes("strength")) return "info";
  return "warning";
}

function parseIsoToMs(iso: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function humanizeAge(iso: string): string {
  const ms = parseIsoToMs(iso);
  if (ms <= 0) return "";
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function excerpt(body: string, limit = 200): string {
  const text = body.split(/\s+/).filter(Boolean).join(" ");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function checkIcon(conclusion: string): string {
  const value = (conclusion || "").toUpperCase();
  const map: Record<string, string> = {
    SUCCESS: "✅",
    FAILURE: "❌",
    ERROR: "❌",
    CANCELLED: "⚪",
    SKIPPED: "⚪",
    PENDING: "⏳",
    IN_PROGRESS: "⏳",
    NEUTRAL: "➖",
  };
  return map[value] ?? "❓";
}

function stateBadge(state: string): string {
  const value = (state || "").toUpperCase();
  if (value === "OPEN" || !value) return "";
  return `_(PR is ${value})_`;
}

function closingLine(report: string): string {
  if (report.includes("### 🔴 Blockers")) {
    return "Address blockers before merge.";
  }
  if (report.includes("### 🟡 Warnings")) {
    return "Review warnings before merge.";
  }
  if (report.includes("### 🔵 Nits")) {
    return "Nits only — safe to merge if you skip them.";
  }
  return "No unresolved findings remain.";
}

async function ghText(pi: ExtensionAPI, args: string[]): Promise<string> {
  const result = await exec(pi, "gh", args, EXEC_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new Error(formatGhError(result));
  }
  return result.stdout?.trim() ?? "";
}

async function ghJson<T>(pi: ExtensionAPI, args: string[]): Promise<T> {
  const result = await exec(pi, "gh", args, EXEC_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new Error(formatGhError(result));
  }

  const text = result.stdout?.trim() ?? "";
  if (!text) {
    throw new Error("gh returned empty response");
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid gh JSON response: ${message}`);
  }
}

function formatGhError(result: ExecResult): string {
  const raw = (
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    "gh command failed"
  ).trim();
  if (raw.includes("authentication") || raw.includes("gh auth login")) {
    return "gh is not authenticated. Run `gh auth login`.";
  }
  return raw;
}

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ExecResult> {
  return pi.exec(command, args, { timeout: timeoutMs });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
