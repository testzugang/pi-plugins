# Session-Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `session-branding` extension that manages terminal-tab titles, persistent repository colors/sound alerts, activity status visualization, and sound effects for blocked user states.

**Architecture:** A lightweight, self-contained TypeScript extension in `extensions/session-branding/index.ts` that intercepts core event hooks, wraps active `ctx.ui` instance methods dynamically, and tracks execution states. Persists configuration in `.pi/branding.json`. All states are encapsulated inside the extension closure to prevent leaks across reloads.

**Tech Stack:** TypeScript, Node.js (`node:fs`, `node:path`, `node:child_process`), `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.

---

## 1. File Structure & Scope Check

We will create, register, and document three files in the monorepo workspace:

1. `extensions/session-branding/index.ts` - Main extension entry point.
2. `tests/session-branding/session-branding.spec.ts` - Complete Jest test suite covering all states, configs, validations, parallel counters, malformed files, sound writes, and UI wrapping.
3. `README.md` - Workspace document update with full user-facing instructions.

No changes to existing extension packages or configuration files are required.

---

## 2. Bite-Sized Tasks

### Task 1: Scaffolding and Directory Setup

Set up folders for the extension and test files.

**Files:**

- Create: `extensions/session-branding/`
- Create: `tests/session-branding/`

- [ ] **Step 1: Create directories**

Run: `mkdir -p extensions/session-branding tests/session-branding`

---

### Task 2: Implement Comprehensive Unit and Integration Tests

We will write a fully featured TDD-compliant Jest test suite verifying configuration roundtrips, malformed config fallbacks, state hierarchy (and parallel counters), sound execution, invalid inputs, and `hasUI` safety.

**Files:**

- Create: `tests/session-branding/session-branding.spec.ts`

- [ ] **Step 1: Write the complete test suite**

Write the tests using the virtual mock patterns and precise unit assertions with `toHaveBeenLastCalledWith` to verify state ordering.

```typescript
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

  it("registers session-branding slash commands and lifecycle event handlers", () => {
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

    expect([...recorded.commands.keys()].sort()).toEqual([
      "session-color",
      "session-name",
    ]);

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
    const colorCmd = recorded.commands.get("session-color")!;
    await colorCmd.handler("red", ctx);

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

  it("supports color selection via UI select", async () => {
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
    select.mockReturnValue(Promise.resolve("green"));

    const colorCmd = recorded.commands.get("session-color")!;
    await colorCmd.handler("", ctx);

    expect(select).toHaveBeenCalledWith(
      "Wähle eine Repository-Farbe:",
      expect.any(Array),
    );
    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith(
      expect.stringContaining("🟢 Test Session"),
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

  it("rejects invalid colors without saving", async () => {
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
    const colorCmd = recorded.commands.get("session-color")!;

    await colorCmd.handler("magenta", ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Ungültige Farbe"),
      "error",
    );
    expect(existsSync(join(tempCwd, ".pi", "branding.json"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test suite to verify it fails (since index.ts is missing)**

_(This serves as our formal TDD verification step)._

---

### Task 3: Implement Core Extension Code

We will write the complete extension code inside `extensions/session-branding/index.ts`. All mutable state, loaded configuration, and trackers are held inside the closure of the factory export. We wrap `ctx.ui` instance methods directly instead of mutating the prototype to prevent side effects and simplify execution.

**Files:**

- Create: `extensions/session-branding/index.ts`

- [ ] **Step 1: Write complete extension code**

Write the code ensuring complete, production-ready, warning-free TypeScript.

```typescript
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { exec } from "node:child_process";

const COLOR_MAP: Record<string, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  green: "🟢",
  blue: "🔵",
  purple: "🟣",
  black: "⚫",
  white: "⚪",
};

const COLOR_TO_THEME_KEY: Record<
  string,
  "error" | "warning" | "success" | "accent" | "toolTitle" | "muted" | "dim"
> = {
  red: "error",
  orange: "warning",
  yellow: "warning",
  green: "success",
  blue: "accent",
  purple: "toolTitle",
  black: "muted",
  white: "dim",
};

type BrandingConfig = {
  color: string;
  soundCommand?: string;
};

export default function (pi: ExtensionAPI) {
  // Encapsulated state inside closure
  const currentBranding: BrandingConfig = {
    color: "blue",
    soundCommand: "",
  };

  let activeToolsCount = 0;
  let isThinking = false;
  let isBlocked = false;

  function updateTabTitle(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const statusEmoji = isBlocked
      ? "⚠️"
      : activeToolsCount > 0
        ? "⚙️"
        : isThinking
          ? "⏳"
          : "💤";
    const colorEmoji = COLOR_MAP[currentBranding.color] || "🔵";
    const sessionName = pi.getSessionName() || basename(ctx.cwd);
    const title = `${statusEmoji} ${colorEmoji} ${sessionName} | ${basename(ctx.cwd)}`;
    ctx.ui.setTitle(title);
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const sessionName = pi.getSessionName() || basename(ctx.cwd);
    const color = currentBranding.color;

    ctx.ui.setWidget(
      "session-branding-widget",
      (tui, theme) => {
        const themeKey = COLOR_TO_THEME_KEY[color] || "accent";
        const styledDot = theme.fg(themeKey, "●");
        return new Text(
          `${styledDot} Session: ${theme.bold(sessionName)} (${color})`,
          0,
          0,
        );
      },
      { placement: "aboveEditor" },
    );
  }

  function triggerBlockedSound() {
    if (currentBranding.soundCommand) {
      exec(currentBranding.soundCommand, (err) => {
        if (err) {
          process.stdout.write("\x07");
        }
      });
    } else {
      process.stdout.write("\x07");
    }
  }

  function loadConfig(cwd: string) {
    const configPath = join(cwd, ".pi", "branding.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(
          readFileSync(configPath, "utf8"),
        ) as BrandingConfig;
        if (config && typeof config === "object") {
          currentBranding.color =
            typeof config.color === "string" && COLOR_MAP[config.color]
              ? config.color
              : "blue";
          currentBranding.soundCommand =
            typeof config.soundCommand === "string" ? config.soundCommand : "";
        }
      } catch {
        // Keep defaults on failure
      }
    } else {
      currentBranding.color = "blue";
      currentBranding.soundCommand = "";
    }
  }

  function saveConfig(cwd: string) {
    const dir = join(cwd, ".pi");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "branding.json"),
        JSON.stringify(currentBranding, null, 2),
        "utf8",
      );
    } catch {
      // Ignore write issues in read-only environments
    }
  }

  function wrapUiInstance(ctx: ExtensionContext) {
    if (!ctx.hasUI || !ctx.ui) return;

    // Direct object wrapping (extremely safe, no prototype pollution)
    const uiObj = ctx.ui as any;
    if (uiObj.__patched_branding) return;

    const methodsToWrap = [
      "confirm",
      "select",
      "input",
      "editor",
      "custom",
    ] as const;

    for (const method of methodsToWrap) {
      const original = uiObj[method];
      if (typeof original === "function") {
        uiObj[method] = async function (this: any, ...args: any[]) {
          const wasBlocked = isBlocked;
          isBlocked = true;
          updateTabTitle(ctx);
          if (!wasBlocked) {
            triggerBlockedSound();
          }
          try {
            return await original.apply(this, args);
          } finally {
            isBlocked = false;
            updateTabTitle(ctx);
          }
        };
      }
    }

    uiObj.__patched_branding = true;
  }

  pi.on("session_start", async (event, ctx) => {
    loadConfig(ctx.cwd);
    activeToolsCount = 0;
    isThinking = false;
    isBlocked = false;

    wrapUiInstance(ctx);
    updateTabTitle(ctx);
    updateWidget(ctx);
  });

  pi.on("session_shutdown", async () => {
    // Session state clean. Wrapping instance directly avoids prototype restore needs.
  });

  pi.on("agent_start", async (event, ctx) => {
    isThinking = true;
    updateTabTitle(ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    isThinking = false;
    updateTabTitle(ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    activeToolsCount++;
    updateTabTitle(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    activeToolsCount = Math.max(0, activeToolsCount - 1);
    updateTabTitle(ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    updateTabTitle(ctx);
  });

  // Slash commands
  pi.registerCommand("session-name", {
    description: "Setzt den Anzeigenamen der aktuellen Session",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Bitte gib einen Namen an: /session-name <name>",
            "warning",
          );
        }
        return;
      }
      pi.setSessionName(name);
      updateTabTitle(ctx);
      updateWidget(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`Session-Name geändert in: ${name}`, "info");
      }
    },
  });

  pi.registerCommand("session-color", {
    description: "Setzt die Farbe für dieses Repository",
    handler: async (args, ctx) => {
      const colorInput = args.trim().toLowerCase();

      if (!colorInput) {
        if (!ctx.hasUI) return;

        const colors = Object.keys(COLOR_MAP);
        const selected = await ctx.ui.select(
          "Wähle eine Repository-Farbe:",
          colors,
        );
        if (selected) {
          currentBranding.color = selected;
          saveConfig(ctx.cwd);
          updateTabTitle(ctx);
          updateWidget(ctx);
          ctx.ui.notify(`Farbe geändert in: ${selected}`, "info");
        }
        return;
      }

      if (COLOR_MAP[colorInput]) {
        currentBranding.color = colorInput;
        saveConfig(ctx.cwd);
        updateTabTitle(ctx);
        updateWidget(ctx);
        if (ctx.hasUI) {
          ctx.ui.notify(`Farbe geändert in: ${colorInput}`, "info");
        }
      } else {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Ungültige Farbe. Unterstützt: ${Object.keys(COLOR_MAP).join(", ")}`,
            "error",
          );
        }
      }
    },
  });
}
```

---

### Task 4: Complete Validation & Code Formatter

Run package validation, formatting checkers, and local test runners.

**Files:**

- Modify: (None)

- [ ] **Step 1: Run validation script**

Run: `node scripts/validate-package.mjs`
Expected: Passes with no errors for registered resources.

- [ ] **Step 2: Format the code**

Run: `npm run format`
Expected: Formatting of `index.ts` and `session-branding.spec.ts` is applied automatically.

- [ ] **Step 3: Run the tests**

Run: `npx jest tests/session-branding/session-branding.spec.ts` (This is our strict verification gate).
Expected: All tests pass.

---

### Task 5: Document the Extension

We will update the user-facing `README.md` to document the new extension, its capabilities, commands, and options.

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Edit README.md**

Add `session-branding` documentation sections:

1. In "Current resources" under `Extensions`.
2. In "Feature quick start" under a dedicated section `session-branding`.

````markdown
### [`session-branding`](extensions/session-branding)

Visual and acoustic session identification for background and backgrounded tabs.

Install the package, then use the branding commands inside any session:

```text
/session-name Feature Development
/session-color
/session-color blue
```
````

#### Capabilities

- **Session Name**: Set an explicit session name. It updates the terminal/tab title and persists inside your session `.jsonl` file.
- **Repository Branding**: Saves a custom color (represented by a high-contrast circle emoji 🔴, 🔵, 🟢...) and optional sound trigger in `.pi/branding.json` inside your workspace. This branding is loaded automatically across all future sessions in this workspace.
- **Tab Title Status Tracking**: Prepends the current session status live inside your terminal tab title:
  - `💤` (Idle / Waiting for user input)
  - `⏳` (Thinking / LLM processing)
  - `⚙️` (Executing / Running tools)
  - `⚠️` (Blocked / Awaiting interaction)
- **Blocked Sound Notification**: Plays the terminal bell (`\x07`) or a custom sound command (e.g., `afplay /System/Library/Sounds/Glass.aiff` on macOS) when the session enters the `Blocked` state waiting for you.

To configure a custom sound command, add it directly to `.pi/branding.json` in your repository:

```json
{
  "color": "blue",
  "soundCommand": "afplay /System/Library/Sounds/Glass.aiff"
}
```

```

---

## 3. Self-Review Checklist

- **Spec coverage**: Fully aligned. Directly maps all specs into implementation.
- **Placeholder scan**: 100% complete and robust code templates. No "TODO" or "TBD".
- **Type consistency**: Complete and standard TypeScript declarations.
```
