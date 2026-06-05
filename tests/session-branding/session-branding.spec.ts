import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Virtual mocks for pi packages
jest.mock("@earendil-works/pi-coding-agent", () => ({}), { virtual: true });
jest.mock(
  "@earendil-works/pi-tui",
  () => {
    class Text {
      constructor(
        public content: string,
        public x: number,
        public y: number,
      ) {}
    }
    return { Text };
  },
  { virtual: true },
);

type CommandOpts = {
  description: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

type Recorded = {
  commands: Map<string, CommandOpts>;
  events: Map<string, Array<(event: any, ctx: any) => Promise<any>>>;
  setSessionName: jest.Mock;
  getSessionName: jest.Mock;
};

function makeFakePi(rec: Recorded) {
  return {
    on: jest.fn((name: string, handler: any) => {
      if (!rec.events.has(name)) rec.events.set(name, []);
      rec.events.get(name)!.push(handler);
    }),
    registerTool: jest.fn(),
    registerCommand: jest.fn((name: string, opts: CommandOpts) => {
      rec.commands.set(name, opts);
    }),
    setSessionName: rec.setSessionName,
    getSessionName: rec.getSessionName,
  };
}

function makeFakeCtx(cwd: string) {
  const notify = jest.fn();
  const select = jest.fn();
  const setTitle = jest.fn();
  const setWidget = jest.fn();
  const theme = {
    bold: (t: string) => `[bold:${t}]`,
    fg: (c: string, t: string) => `[color:${c}:${t}]`,
  };

  return {
    ctx: {
      hasUI: true,
      cwd,
      ui: {
        notify,
        select,
        setTitle,
        setWidget,
        theme,
        confirm: jest.fn(() => Promise.resolve(true)),
        input: jest.fn(() => Promise.resolve("input_val")),
        editor: jest.fn(() => Promise.resolve("editor_val")),
        custom: jest.fn(() => Promise.resolve("custom_val")),
      },
    },
    notify,
    select,
    setTitle,
    setWidget,
  };
}

describe("session-branding extension", () => {
  let tempCwd: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempCwd = join(tmpdir(), `pi-session-branding-test-${Date.now()}`);
    mkdirSync(tempCwd, { recursive: true });
    originalCwd = process.cwd;
    process.cwd = () => tempCwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempCwd, { recursive: true, force: true });
  });

  it("registers a single session-branding slash command and lifecycle event handlers", () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    expect([...recorded.commands.keys()].sort()).toEqual(["session-branding"]);

    expect([...recorded.events.keys()].sort()).toEqual([
      "agent_end",
      "agent_start",
      "session_shutdown",
      "session_start",
      "tool_execution_end",
      "tool_execution_start",
      "tool_result",
    ]);
  });

  it("loads and saves color config correctly", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const startHandler = recorded.events.get("session_start")![0];
    const { ctx } = makeFakeCtx(tempCwd);

    // Initial load when file is missing should default to blue
    await startHandler({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("🔵 Test Session"),
    );

    // Set color via command
    const brandingCmd = recorded.commands.get("session-branding")!;
    await brandingCmd.handler("color red", ctx);

    // Should rewrite branding.json
    const brandingPath = join(tempCwd, ".pi", "branding.json");
    expect(existsSync(brandingPath)).toBe(true);
    expect(JSON.parse(readFileSync(brandingPath, "utf8"))).toEqual({
      color: "red",
      soundCommand: "",
    });

    // Reset and reload
    const freshRecorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const freshFakePi = makeFakePi(freshRecorded);
    extension(freshFakePi);
    const freshStart = freshRecorded.events.get("session_start")![0];
    const freshCtx = makeFakeCtx(tempCwd);

    await freshStart({}, freshCtx);
    expect(freshCtx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("🔴 Test Session"),
    );
  });

  it("retains defaults when branding.json is malformed", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const brandingPath = join(tempCwd, ".pi", "branding.json");
    mkdirSync(join(tempCwd, ".pi"), { recursive: true });
    writeFileSync(brandingPath, "{ malformed json...", "utf8");

    const startHandler = recorded.events.get("session_start")![0];
    const { ctx } = makeFakeCtx(tempCwd);

    await startHandler({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("🔵 Test Session"),
    );
  });

  it("supports color selection via interactive UI select", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx, select } = makeFakeCtx(tempCwd);
    select.mockImplementation((question: string) => {
      if (question.includes("Was möchtest du konfigurieren?")) {
        return Promise.resolve("🎨 Repository-Farbe ändern");
      }
      return Promise.resolve("green");
    });

    const brandingCmd = recorded.commands.get("session-branding")!;
    await brandingCmd.handler("", ctx);

    expect(select).toHaveBeenNthCalledWith(
      2,
      "Wähle eine Repository-Farbe:",
      expect.any(Array),
    );
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("🟢 Test Session"),
    );
  });

  it("supports session name configuration via interactive UI input", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Old Name"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx, select } = makeFakeCtx(tempCwd);
    select.mockReturnValue(Promise.resolve("🏷️ Session-Name ändern"));

    const inputMock = ctx.ui.input as jest.Mock;
    inputMock.mockReturnValue(Promise.resolve("New Custom Name"));

    const brandingCmd = recorded.commands.get("session-branding")!;
    await brandingCmd.handler("", ctx);

    expect(fakePi.setSessionName).toHaveBeenCalledWith("New Custom Name");
  });

  it("supports sound command configuration via interactive UI input", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx, select, notify } = makeFakeCtx(tempCwd);
    select.mockReturnValue(Promise.resolve("🔊 Blocked-Sound-Befehl ändern"));

    const inputMock = ctx.ui.input as jest.Mock;
    inputMock.mockReturnValue(Promise.resolve("say beep"));

    const brandingCmd = recorded.commands.get("session-branding")!;
    await brandingCmd.handler("", ctx);

    const brandingPath = join(tempCwd, ".pi", "branding.json");
    expect(JSON.parse(readFileSync(brandingPath, "utf8"))).toEqual({
      color: "blue",
      soundCommand: "say beep",
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Sound-Befehl geändert in: say beep"),
      "info",
    );
  });

  it("handles status-emoji hierarchy on events and UI blocks", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx } = makeFakeCtx(tempCwd);

    const start = recorded.events.get("session_start")![0];
    const agentStart = recorded.events.get("agent_start")![0];
    const toolStart = recorded.events.get("tool_execution_start")![0];
    const toolEnd = recorded.events.get("tool_execution_end")![0];
    const agentEnd = recorded.events.get("agent_end")![0];

    // 1. Idle
    await start({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("💤 🔵 Test Session"),
    );

    // 2. Thinking
    await agentStart({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⏳ 🔵 Test Session"),
    );

    // 3. Executing Tool
    await toolStart({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚙️ 🔵 Test Session"),
    );

    // 4. Blocked (Simulate confirm dialog)
    const blockPromise = ctx.ui.confirm("Check");
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚠️ 🔵 Test Session"),
    );
    await blockPromise;

    // After resolution, goes back to ⚙️ Executing
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚙️ 🔵 Test Session"),
    );

    // 5. Back to thinking
    await toolEnd({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⏳ 🔵 Test Session"),
    );

    // 6. Back to idle
    await agentEnd({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("💤 🔵 Test Session"),
    );
  });

  it("correctly handles parallel tool execution state counts", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx } = makeFakeCtx(tempCwd);

    const start = recorded.events.get("session_start")![0];
    const toolStart = recorded.events.get("tool_execution_start")![0];
    const toolEnd = recorded.events.get("tool_execution_end")![0];

    await start({}, ctx);

    // 2 parallel tools start
    await toolStart({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚙️ 🔵 Test Session"),
    );
    await toolStart({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚙️ 🔵 Test Session"),
    );

    // 1 parallel tool ends -> should remain in Executing (⚙️)
    await toolEnd({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("⚙️ 🔵 Test Session"),
    );

    // Last tool ends -> back to idle
    await toolEnd({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("💤 🔵 Test Session"),
    );
  });

  it("triggers bell sound write on UI block", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx } = makeFakeCtx(tempCwd);
    const start = recorded.events.get("session_start")![0];

    await start({}, ctx);

    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as any);

    await ctx.ui.confirm("Check Block Sound");

    expect(writeSpy).toHaveBeenCalledWith("\x07");
    writeSpy.mockRestore();
  });

  it("rejects invalid colors without saving via direct command", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx, notify } = makeFakeCtx(tempCwd);
    const brandingCmd = recorded.commands.get("session-branding")!;

    await brandingCmd.handler("color magenta", ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Ungültige Farbe"),
      "error",
    );
    expect(existsSync(join(tempCwd, ".pi", "branding.json"))).toBe(false);
  });

  it("supports sound command configuration via direct subcommand", async () => {
    const recorded: Recorded = {
      commands: new Map(),
      events: new Map(),
      setSessionName: jest.fn(),
      getSessionName: jest.fn(() => "Test Session"),
    };
    const fakePi = makeFakePi(recorded);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extension = require("../../extensions/session-branding").default;
    extension(fakePi);

    const { ctx, notify } = makeFakeCtx(tempCwd);
    const brandingCmd = recorded.commands.get("session-branding")!;

    // 1. Set sound command directly
    await brandingCmd.handler("sound afplay /path/to/sound.aiff", ctx);

    const brandingPath = join(tempCwd, ".pi", "branding.json");
    expect(existsSync(brandingPath)).toBe(true);
    expect(JSON.parse(readFileSync(brandingPath, "utf8"))).toEqual({
      color: "blue",
      soundCommand: "afplay /path/to/sound.aiff",
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(
        "Sound-Befehl geändert in: afplay /path/to/sound.aiff",
      ),
      "info",
    );

    // 2. Clear sound command (using "clear" or "default")
    await brandingCmd.handler("sound clear", ctx);
    expect(JSON.parse(readFileSync(brandingPath, "utf8"))).toEqual({
      color: "blue",
      soundCommand: "",
    });
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Sound-Befehl auf Standard zurückgesetzt."),
      "info",
    );
  });
});
