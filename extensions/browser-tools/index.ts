import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { Type } from "typebox";

const DEFAULT_BROWSER_TOOLS_DIR = join(
  __dirname,
  "..",
  "..",
  "scripts",
  "browser-tools",
);
const EXEC_TIMEOUT_MS = 10_000;

type NotifyLevel = "info" | "warning" | "error";

type ExecResult = {
  code: number | null;
  stdout?: string;
  stderr?: string;
};

type ProfileSelection = boolean | string;

type BrowserToolsConfig = {
  profile?: ProfileSelection;
};

type ChromeProfile = {
  directory: string;
  name: string;
  label: string;
};

export default function (pi: ExtensionAPI) {
  registerBrowserTools(pi);

  pi.registerCommand("browser-start", {
    description:
      "Start Chrome with remote debugging for browser automation. Pass 'profile [name]' to copy a Chrome profile.",
    handler: async (args, ctx) => {
      const profile = parseStartArgs(args) ?? loadDefaultProfile();
      const result = await runBrowserScript(
        pi,
        "browser-start.js",
        profileArgs(profile),
      );

      if (!resultOk(result)) {
        notify(ctx, `Browser start failed: ${failureMessage(result)}`, "error");
        return;
      }

      notify(ctx, browserStartMessage(profile), "info");
    },
  });

  pi.registerCommand("browser-profile", {
    description:
      "Select a Chrome profile and save it as the project browser default. Use 'clear' to remove the project default.",
    handler: async (args, ctx) => {
      if (args.trim() === "clear") {
        clearProjectDefaultProfile();
        notify(ctx, "Project browser profile default cleared", "info");
        return;
      }

      const profiles = discoverChromeProfiles();
      if (profiles.length === 0) {
        notify(ctx, "No Chrome profiles found", "warning");
        return;
      }

      if (!ctx.hasUI) {
        notify(
          ctx,
          `Available Chrome profiles:\n${profiles.map((profile) => `- ${profile.directory}`).join("\n")}`,
          "info",
        );
        return;
      }

      const labels = profiles.map((profile) => profile.label);
      const choice = await ctx.ui.select(
        "Select default Chrome profile",
        labels,
      );
      if (!choice) return;

      const selected = profiles.find((profile) => profile.label === choice);
      if (!selected) return;

      writeProjectDefaultProfile(selected.directory);
      notify(
        ctx,
        `Project browser profile default set to ${selected.directory}`,
        "info",
      );
    },
  });

  pi.registerCommand("browser-nav", {
    description:
      "Navigate the active browser tab to a URL. Usage: /browser-nav https://example.com [--new]",
    handler: async (args, ctx) => {
      const parsed = parseNavArgs(args);
      if (!parsed) {
        notify(ctx, "Usage: /browser-nav https://example.com [--new]", "error");
        return;
      }

      const scriptArgs = parsed.newTab ? [parsed.url, "--new"] : [parsed.url];
      const result = await runBrowserScript(pi, "browser-nav.js", scriptArgs);

      if (!resultOk(result)) {
        notify(
          ctx,
          `Browser navigation failed: ${failureMessage(result)}`,
          "error",
        );
        return;
      }

      notify(ctx, `Navigated to ${parsed.url}`, "info");
    },
  });

  pi.registerCommand("browser-eval", {
    description:
      "Evaluate JavaScript in the active browser tab. Usage: /browser-eval document.title",
    handler: async (args, ctx) => {
      const code = args.trim();
      if (!code) {
        notify(ctx, "Usage: /browser-eval document.title", "error");
        return;
      }

      const result = await runBrowserScript(pi, "browser-eval.js", [code]);

      if (!resultOk(result)) {
        notify(ctx, `Browser eval failed: ${failureMessage(result)}`, "error");
        return;
      }

      notify(ctx, outputText(result, "Browser eval completed"), "info");
    },
  });

  pi.registerCommand("browser-screenshot", {
    description:
      "Capture the active browser viewport and report the screenshot path.",
    handler: async (_args, ctx) => {
      const result = await runBrowserScript(pi, "browser-screenshot.js", []);

      if (!resultOk(result)) {
        notify(
          ctx,
          `Browser screenshot failed: ${failureMessage(result)}`,
          "error",
        );
        return;
      }

      notify(
        ctx,
        `Screenshot captured: ${outputText(result, "unknown path")}`,
        "info",
      );
    },
  });
}

function registerBrowserTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser_start",
    label: "Browser Start",
    description:
      "Start Chrome with remote debugging for browser automation. Optionally copy the user's profile for cookies and logins.",
    promptSnippet: "Start a Chrome browser automation session",
    promptGuidelines: [
      "Use browser_start before browser_nav, browser_eval, or browser_screenshot when no browser session is running.",
      "Set browser_start profile=true only when the user wants to preserve authentication state.",
      "Set browser_start profile to a string to use a specific Chrome profile directory, e.g. 'Profile 2' or 'Default'.",
    ],
    parameters: Type.Object({
      profile: Type.Optional(
        Type.Union([
          Type.Boolean({
            description:
              "Copy the default Chrome profile for cookies and logins",
          }),
          Type.String({
            description:
              "Chrome profile directory to copy, e.g. Default or Profile 2",
          }),
        ]),
      ),
    }),
    async execute(_toolCallId, params) {
      const profile = normalizeProfile(params.profile) ?? loadDefaultProfile();
      const result = await runBrowserScript(
        pi,
        "browser-start.js",
        profileArgs(profile),
      );
      if (!resultOk(result)) {
        throw new Error(`Browser start failed: ${failureMessage(result)}`);
      }

      return {
        content: [{ type: "text", text: browserStartMessage(profile) }],
        details: { profile: profile ?? false },
      };
    },
  });

  pi.registerTool({
    name: "browser_nav",
    label: "Browser Navigate",
    description: "Navigate the active Chrome automation tab to a URL.",
    promptSnippet: "Navigate the active browser tab to a URL",
    promptGuidelines: [
      "Use browser_nav to open pages in the Chrome automation session instead of shelling out to browser helper scripts.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
      newTab: Type.Optional(
        Type.Boolean({ description: "Open URL in a new tab" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const url = String(params.url ?? "").trim();
      if (!url) throw new Error("browser_nav: url is required");

      const newTab = params.newTab === true;
      const result = await runBrowserScript(
        pi,
        "browser-nav.js",
        newTab ? [url, "--new"] : [url],
      );
      if (!resultOk(result)) {
        throw new Error(`Browser navigation failed: ${failureMessage(result)}`);
      }

      return {
        content: [{ type: "text", text: `Navigated to ${url}` }],
        details: { url, newTab },
      };
    },
  });

  pi.registerTool({
    name: "browser_eval",
    label: "Browser Eval",
    description: "Evaluate JavaScript in the active Chrome automation tab.",
    promptSnippet: "Evaluate JavaScript in the active browser tab",
    promptGuidelines: [
      "Use browser_eval to inspect DOM state or perform simple browser interactions programmatically.",
      "Prefer one browser_eval call with a batched script over many small browser_eval calls.",
    ],
    parameters: Type.Object({
      code: Type.String({
        description: "JavaScript code to evaluate in the active tab",
      }),
    }),
    async execute(_toolCallId, params) {
      const code = String(params.code ?? "").trim();
      if (!code) throw new Error("browser_eval: code is required");

      const result = await runBrowserScript(pi, "browser-eval.js", [code]);
      if (!resultOk(result)) {
        throw new Error(`Browser eval failed: ${failureMessage(result)}`);
      }

      const output = outputText(result, "Browser eval completed");
      return {
        content: [{ type: "text", text: output }],
        details: { code, output },
      };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Capture the active Chrome automation viewport and return the screenshot path.",
    promptSnippet: "Capture a browser screenshot",
    promptGuidelines: [
      "Use browser_screenshot when visual inspection is required; prefer browser_eval for DOM inspection.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const result = await runBrowserScript(pi, "browser-screenshot.js", []);
      if (!resultOk(result)) {
        throw new Error(`Browser screenshot failed: ${failureMessage(result)}`);
      }

      const path = outputText(result, "unknown path");
      return {
        content: [{ type: "text", text: `Screenshot captured: ${path}` }],
        details: { path },
      };
    },
  });
}

async function runBrowserScript(
  pi: ExtensionAPI,
  scriptName: string,
  args: string[],
): Promise<ExecResult> {
  return pi.exec(scriptPath(scriptName), args, { timeout: EXEC_TIMEOUT_MS });
}

function scriptPath(scriptName: string): string {
  const baseDir = process.env.PI_BROWSER_TOOLS_DIR ?? DEFAULT_BROWSER_TOOLS_DIR;
  return `${baseDir}/${scriptName}`;
}

function parseStartArgs(args: string): ProfileSelection | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;
  if (trimmed === "profile") return true;
  if (trimmed.startsWith("profile ")) {
    return normalizeProfile(trimmed.slice("profile ".length));
  }
  return undefined;
}

function normalizeProfile(value: unknown): ProfileSelection | undefined {
  if (value === true) return true;
  if (value === false || value === undefined || value === null)
    return undefined;
  if (typeof value !== "string") return undefined;

  const profile = stripMatchingQuotes(value.trim());
  return profile ? profile : undefined;
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function discoverChromeProfiles(): ChromeProfile[] {
  const chromeDir = chromeUserDataDir();
  if (!existsSync(chromeDir)) return [];

  const names = profileDisplayNames(chromeDir);
  return readdirSync(chromeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (directory) =>
        directory === "Default" || directory.startsWith("Profile "),
    )
    .sort((a, b) => profileSortKey(a).localeCompare(profileSortKey(b)))
    .map((directory) => {
      const name = names[directory] ?? directory;
      return {
        directory,
        name,
        label: name === directory ? directory : `${name} (${directory})`,
      };
    });
}

function profileDisplayNames(chromeDir: string): Record<string, string> {
  const localState = join(chromeDir, "Local State");
  if (!existsSync(localState)) return {};

  try {
    const parsed = JSON.parse(readFileSync(localState, "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const cache = parsed.profile?.info_cache ?? {};
    return Object.fromEntries(
      Object.entries(cache).flatMap(([directory, info]) => {
        const name = info.name?.trim();
        return name ? [[directory, name]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function profileSortKey(directory: string): string {
  if (directory === "Default") return "0000";
  const match = /^Profile (\d+)$/.exec(directory);
  if (!match) return directory;
  return String(Number(match[1])).padStart(4, "0");
}

function chromeUserDataDir(): string {
  return join(
    process.env.HOME ?? homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
  );
}

function writeProjectDefaultProfile(profile: string): void {
  const configPath = projectConfigPath(process.cwd());
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    `${configPath}.tmp`,
    `${JSON.stringify({ profile }, null, 2)}\n`,
  );
  rmSync(configPath, { force: true });
  writeFileSync(configPath, readFileSync(`${configPath}.tmp`, "utf8"));
  rmSync(`${configPath}.tmp`, { force: true });
}

function clearProjectDefaultProfile(): void {
  rmSync(projectConfigPath(process.cwd()), { force: true });
}

function loadDefaultProfile(): ProfileSelection | undefined {
  for (const path of configPaths()) {
    const config = readConfig(path);
    const profile = normalizeProfile(config?.profile);
    if (profile !== undefined) return profile;
  }
  return undefined;
}

function configPaths(): string[] {
  return [...projectConfigPaths(process.cwd()), userConfigPath()];
}

function projectConfigPaths(startDir: string): string[] {
  const paths: string[] = [];
  let current = startDir;
  const root = parse(current).root;

  while (true) {
    paths.push(projectConfigPath(current));
    if (current === root) break;
    current = dirname(current);
  }

  return paths;
}

function projectConfigPath(projectDir: string): string {
  return join(projectDir, ".pi", "browser-tools.json");
}

function userConfigPath(): string {
  return join(homedir(), ".pi", "agent", "browser-tools.json");
}

function readConfig(path: string): BrowserToolsConfig | undefined {
  if (!existsSync(path)) return undefined;

  try {
    return JSON.parse(readFileSync(path, "utf8")) as BrowserToolsConfig;
  } catch {
    return undefined;
  }
}

function profileArgs(profile: ProfileSelection | undefined): string[] {
  if (typeof profile === "string") return ["--profile", profile];
  if (profile === true) return ["--profile"];
  return [];
}

function browserStartMessage(profile: ProfileSelection | undefined): string {
  if (typeof profile === "string") {
    return `Browser session started with profile ${profile}`;
  }
  if (profile === true) return "Browser session started with user profile";
  return "Fresh browser session started";
}

function parseNavArgs(args: string): { url: string; newTab: boolean } | null {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const newTab = tokens.includes("--new");
  const urls = tokens.filter((token) => token !== "--new");
  if (urls.length !== 1) return null;

  return { url: urls[0]!, newTab };
}

function resultOk(result: ExecResult): boolean {
  return result.code === 0;
}

function outputText(result: ExecResult, fallback: string): string {
  return result.stdout?.trim() || fallback;
}

function failureMessage(result: ExecResult): string {
  return (
    result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.code}`
  );
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  level: NotifyLevel,
): void {
  const maybeUi = (
    ctx as { ui?: { notify?: (message: string, level: NotifyLevel) => void } }
  ).ui;
  maybeUi?.notify?.(message, level);
}
