import { describe, expect, it, jest } from "@jest/globals";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@earendil-works/pi-coding-agent", () => ({}), { virtual: true });

jest.mock(
  "typebox",
  () => ({
    Type: {
      Object: (properties: unknown, options?: unknown) => ({
        kind: "object",
        properties,
        options,
      }),
      String: (options?: unknown) => ({ kind: "string", options }),
      Boolean: (options?: unknown) => ({ kind: "boolean", options }),
      Optional: (schema: unknown) => ({ kind: "optional", schema }),
      Union: (schemas: unknown[], options?: unknown) => ({
        kind: "union",
        schemas,
        options,
      }),
    },
  }),
  { virtual: true },
);

type Notify = (message: string, level: "info" | "warning" | "error") => void;
type Select = (
  question: string,
  options: string[],
) => Promise<string | undefined>;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type CommandOpts = {
  description: string;
  handler: CommandHandler;
};

type ExecResult = { code: number; stdout: string; stderr: string };
type ExecMock = jest.Mock<
  (
    command: string,
    args: readonly string[],
    options?: unknown,
  ) => Promise<ExecResult>
>;

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
  }>;
};

type Recorded = {
  commands: Map<string, CommandOpts>;
  tools: Map<string, ToolDefinition>;
  exec: ExecMock;
};

const LEGACY_BROWSER_TOOLS_DIR =
  "~/.agents/skills/testzugang-pi-skills/browser-tools";
const BROWSER_TOOLS_DIR = join(
  __dirname,
  "..",
  "..",
  "scripts",
  "browser-tools",
);

function makeFakePi(rec: Recorded) {
  return {
    on: jest.fn(),
    registerTool: jest.fn((definition: ToolDefinition) => {
      rec.tools.set(definition.name, definition);
    }),
    registerCommand: jest.fn((name: string, opts: CommandOpts) => {
      rec.commands.set(name, opts);
    }),
    exec: rec.exec,
  };
}

function makeCtx(selection?: string) {
  const notify = jest.fn<Notify>();
  const select = jest.fn<Select>(() => Promise.resolve(selection));
  return { ctx: { hasUI: true, ui: { notify, select } }, notify, select };
}

function setup(
  execImpl: (
    command: string,
    args: readonly string[],
    options?: unknown,
  ) => Promise<ExecResult> | ExecResult = () => ({
    code: 0,
    stdout: "ok",
    stderr: "",
  }),
): Recorded {
  jest.resetModules();

  const exec: ExecMock = jest.fn(async (command, args, options) =>
    execImpl(command, args, options),
  );

  const recorded: Recorded = { commands: new Map(), tools: new Map(), exec };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../../extensions/browser-tools") as {
    default: (pi: unknown) => void;
  };
  mod.default(makeFakePi(recorded));

  return recorded;
}

function getCommand(rec: Recorded, name: string): CommandOpts {
  const command = rec.commands.get(name);
  if (!command) throw new Error(`${name} command was not registered`);
  return command;
}

function getTool(rec: Recorded, name: string): ToolDefinition {
  const tool = rec.tools.get(name);
  if (!tool) throw new Error(`${name} tool was not registered`);
  return tool;
}

describe("browser-session extension", () => {
  it("registers browser commands and tools", () => {
    const rec = setup();

    expect([...rec.commands.keys()].sort()).toEqual([
      "browser",
      "browser-eval",
      "browser-executable",
      "browser-nav",
      "browser-profile",
      "browser-screenshot",
      "browser-start",
    ]);
    expect([...rec.tools.keys()].sort()).toEqual([
      "browser_eval",
      "browser_nav",
      "browser_screenshot",
      "browser_start",
    ]);
  });

  it("ships browser helper scripts inside the pi-plugins package", () => {
    for (const script of [
      "browser-start.js",
      "browser-nav.js",
      "browser-eval.js",
      "browser-screenshot.js",
    ]) {
      expect(existsSync(join(BROWSER_TOOLS_DIR, script))).toBe(true);
    }
  });

  it("starts a fresh browser session by default", async () => {
    const rec = setup();
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-start").handler("", ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      [],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(rec.exec.mock.calls[0]![0]).not.toContain(LEGACY_BROWSER_TOOLS_DIR);
    expect(notify).toHaveBeenCalledWith(
      "Fresh browser session started",
      "info",
    );
  });

  it("starts a browser session with the user profile when requested", async () => {
    const rec = setup();
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-start").handler("profile", ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      ["--profile"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Browser session started with user profile",
      "info",
    );
  });

  it("starts a named browser profile from the slash command", async () => {
    const rec = setup();
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-start").handler('profile "Profile 2"', ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      ["--profile", "Profile 2"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Browser session started with profile Profile 2",
      "info",
    );
  });

  it("uses the project browser profile default when no profile argument is given", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "pi-browser-tools-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(projectDir);
    mkdirSync(join(projectDir, ".pi"));
    writeFileSync(
      join(projectDir, ".pi", "browser-tools.json"),
      JSON.stringify({ profile: "Work" }),
    );
    try {
      const rec = setup();
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "browser-start").handler("", ctx);

      expect(rec.exec).toHaveBeenCalledWith(
        join(BROWSER_TOOLS_DIR, "browser-start.js"),
        ["--profile", "Work"],
        expect.objectContaining({ timeout: 10000 }),
      );
      expect(notify).toHaveBeenCalledWith(
        "Browser session started with profile Work",
        "info",
      );
    } finally {
      cwdSpy.mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("lets the user select a Chrome profile and saves it as project default", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "pi-browser-tools-"));
    const homeDir = mkdtempSync(join(tmpdir(), "pi-browser-home-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(projectDir);
    const originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    const chromeDir = join(
      homeDir,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
    mkdirSync(join(chromeDir, "Default"), { recursive: true });
    mkdirSync(join(chromeDir, "Profile 2"), { recursive: true });
    writeFileSync(
      join(chromeDir, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "Personal" },
            "Profile 2": { name: "Work" },
          },
        },
      }),
    );

    try {
      const rec = setup();
      const { ctx, notify, select } = makeCtx("Work (Profile 2)");

      await getCommand(rec, "browser-profile").handler("", ctx);

      expect(select).toHaveBeenCalledWith("Select default Chrome profile", [
        "Personal (Default)",
        "Work (Profile 2)",
      ]);
      expect(
        JSON.parse(
          readFileSync(join(projectDir, ".pi", "browser-tools.json"), "utf8"),
        ),
      ).toEqual({
        profile: "Profile 2",
      });
      expect(notify).toHaveBeenCalledWith(
        "Project browser profile default set to Profile 2",
        "info",
      );
    } finally {
      cwdSpy.mockRestore();
      process.env.HOME = originalHome;
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("clears the project browser profile default", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "pi-browser-tools-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(projectDir);
    mkdirSync(join(projectDir, ".pi"));
    writeFileSync(
      join(projectDir, ".pi", "browser-tools.json"),
      JSON.stringify({ profile: "Work" }),
    );

    try {
      const rec = setup();
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "browser-profile").handler("clear", ctx);

      expect(existsSync(join(projectDir, ".pi", "browser-tools.json"))).toBe(
        false,
      );
      expect(notify).toHaveBeenCalledWith(
        "Project browser profile default cleared",
        "info",
      );
    } finally {
      cwdSpy.mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("lists Chrome profiles without saving when no UI is available", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "pi-browser-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    const chromeDir = join(
      homeDir,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
    mkdirSync(join(chromeDir, "Default"), { recursive: true });
    mkdirSync(join(chromeDir, "Profile 2"), { recursive: true });

    try {
      const rec = setup();
      const notify = jest.fn<Notify>();
      const ctx = { hasUI: false, ui: { notify } };

      await getCommand(rec, "browser-profile").handler("", ctx);

      expect(notify).toHaveBeenCalledWith(
        "Available Chrome profiles:\n- Default\n- Profile 2",
        "info",
      );
    } finally {
      process.env.HOME = originalHome;
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("navigates to the provided URL", async () => {
    const rec = setup();
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-nav").handler(" https://example.com ", ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-nav.js"),
      ["https://example.com"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Navigated to https://example.com",
      "info",
    );
  });

  it("shows usage instead of navigating without a URL", async () => {
    const rec = setup();
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-nav").handler("   ", ctx);

    expect(rec.exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Usage: /browser-nav https://example.com [--new]",
      "error",
    );
  });

  it("passes --new through browser navigation", async () => {
    const rec = setup();
    const { ctx } = makeCtx();

    await getCommand(rec, "browser-nav").handler(
      "https://example.com --new",
      ctx,
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-nav.js"),
      ["https://example.com", "--new"],
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("evaluates JavaScript in the active tab and reports stdout", async () => {
    const rec = setup(() => ({
      code: 0,
      stdout: "Example Domain\n",
      stderr: "",
    }));
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-eval").handler("document.title", ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-eval.js"),
      ["document.title"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(notify).toHaveBeenCalledWith("Example Domain", "info");
  });

  it("captures a screenshot and reports the output path", async () => {
    const rec = setup(() => ({
      code: 0,
      stdout: "/tmp/browser-shot.png\n",
      stderr: "",
    }));
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-screenshot").handler("", ctx);

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-screenshot.js"),
      [],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Screenshot captured: /tmp/browser-shot.png",
      "info",
    );
  });

  it("notifies command failures with stderr", async () => {
    const rec = setup(() => ({ code: 1, stdout: "", stderr: "boom" }));
    const { ctx, notify } = makeCtx();

    await getCommand(rec, "browser-start").handler("", ctx);

    expect(notify).toHaveBeenCalledWith("Browser start failed: boom", "error");
  });

  it("browser_start tool starts a profile browser session", async () => {
    const rec = setup();

    const result = await getTool(rec, "browser_start").execute(
      "id",
      { profile: true },
      null,
      null,
      {},
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      ["--profile"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.content[0]!.text).toBe(
      "Browser session started with user profile",
    );
    expect(result.details).toEqual({ profile: true });
  });

  it("browser_start tool starts a named profile browser session", async () => {
    const rec = setup();

    const result = await getTool(rec, "browser_start").execute(
      "id",
      { profile: "Work" },
      null,
      null,
      {},
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      ["--profile", "Work"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.content[0]!.text).toBe(
      "Browser session started with profile Work",
    );
    expect(result.details).toEqual({ profile: "Work" });
  });

  it("browser_nav tool navigates to a new tab", async () => {
    const rec = setup();

    const result = await getTool(rec, "browser_nav").execute(
      "id",
      { url: "https://example.com", newTab: true },
      null,
      null,
      {},
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-nav.js"),
      ["https://example.com", "--new"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.content[0]!.text).toBe("Navigated to https://example.com");
    expect(result.details).toEqual({
      url: "https://example.com",
      newTab: true,
    });
  });

  it("browser_eval tool returns stdout", async () => {
    const rec = setup(() => ({
      code: 0,
      stdout: "Example Domain\n",
      stderr: "",
    }));

    const result = await getTool(rec, "browser_eval").execute(
      "id",
      { code: "document.title" },
      null,
      null,
      {},
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-eval.js"),
      ["document.title"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.content[0]!.text).toBe("Example Domain");
    expect(result.details).toEqual({
      code: "document.title",
      output: "Example Domain",
    });
  });

  it("browser_screenshot tool returns the screenshot path", async () => {
    const rec = setup(() => ({
      code: 0,
      stdout: "/tmp/browser-shot.png\n",
      stderr: "",
    }));

    const result = await getTool(rec, "browser_screenshot").execute(
      "id",
      {},
      null,
      null,
      {},
    );

    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-screenshot.js"),
      [],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.content[0]!.text).toBe(
      "Screenshot captured: /tmp/browser-shot.png",
    );
    expect(result.details).toEqual({ path: "/tmp/browser-shot.png" });
  });

  it("master browser command delegates to correct sub-handlers", async () => {
    const rec = setup();
    const { ctx } = makeCtx();

    // Test start
    await getCommand(rec, "browser").handler("start profile", ctx);
    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-start.js"),
      ["--profile"],
      expect.objectContaining({ timeout: 10000 }),
    );

    // Test nav
    await getCommand(rec, "browser").handler("nav https://google.com", ctx);
    expect(rec.exec).toHaveBeenCalledWith(
      join(BROWSER_TOOLS_DIR, "browser-nav.js"),
      ["https://google.com"],
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("browser tools throw on script failure", async () => {
    const rec = setup(() => ({ code: 1, stdout: "", stderr: "boom" }));

    await expect(
      getTool(rec, "browser_start").execute("id", {}, null, null, {}),
    ).rejects.toThrow("Browser start failed: boom");
  });
});
