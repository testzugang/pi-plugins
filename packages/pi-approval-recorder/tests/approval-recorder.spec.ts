import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(TEST_DIR, "..", "..", "..");

type CommandOpts = {
  description: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

type FakePi = {
  pi: any;
  commands: Map<string, CommandOpts>;
  emit: (channel: string, data: unknown) => void;
};

function makeFakePi(): FakePi {
  const commands = new Map<string, CommandOpts>();
  const channels = new Map<string, Array<(data: unknown) => void>>();

  const pi = {
    on: vi.fn(),
    registerCommand: vi.fn((name: string, opts: CommandOpts) => {
      commands.set(name, opts);
    }),
    events: {
      on: vi.fn((channel: string, handler: (data: unknown) => void) => {
        if (!channels.has(channel)) channels.set(channel, []);
        channels.get(channel)!.push(handler);
        return () => {};
      }),
      emit: vi.fn(),
    },
  };

  return {
    pi,
    commands,
    emit: (channel, data) => {
      for (const handler of channels.get(channel) ?? []) handler(data);
    },
  };
}

function logPath(home: string) {
  return join(home, ".pi", "agent", "logs", "manual-approvals.jsonl");
}

function allowlistPath(home: string) {
  return join(home, ".pi", "agent", ".bash-approval");
}

async function loadExtension(home: string) {
  vi.resetModules();
  vi.doMock("node:os", () => ({
    homedir: () => home,
    tmpdir: () => tmpdir(),
  }));
  return (await import("../extension.ts")).default;
}

function allowedEvent(overrides: Record<string, unknown>) {
  return {
    plugin: "pi-bash-approval",
    toolCallId: "tool-call-1",
    cwd: "/tmp/project",
    command: "git push origin main",
    mode: "allow_once",
    createdAt: "2026-07-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("pi-approval-recorder extension", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = join(tmpdir(), `pi-approval-recorder-home-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    vi.doUnmock("node:os");
    vi.resetModules();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("is registered from the root package manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(WORKSPACE_ROOT, "package.json"), "utf8"),
    ) as { pi?: { extensions?: string[] } };

    expect(manifest.pi?.extensions).toContain(
      "./packages/pi-approval-recorder/extension.ts",
    );
  });

  it("records allow_once and allow_always events to the JSONL log", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allow_once" }));
    fake.emit(
      "pi-bash-approval:allowed",
      allowedEvent({ mode: "allow_always", command: "npm test unit", rule: "npm test:*" }),
    );

    await vi.waitFor(() => {
      expect(existsSync(logPath(tempHome))).toBe(true);
      expect(readFileSync(logPath(tempHome), "utf8").trim().split("\n")).toHaveLength(2);
    });

    const entries = readFileSync(logPath(tempHome), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(entries[0]).toMatchObject({
      command: "git push origin main",
      cwd: "/tmp/project",
      mode: "allow_once",
    });
    expect(new Date(entries[0].timestamp).toString()).not.toBe("Invalid Date");
    expect(entries[1]).toMatchObject({ mode: "allow_always", rule: "npm test:*" });
  });

  it("ignores allowlist-mode events and malformed payloads", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allowlist" }));
    fake.emit("pi-bash-approval:allowed", allowedEvent({ command: 42 }));
    fake.emit("pi-bash-approval:allowed", null);
    fake.emit("pi-bash-approval:allowed", "not an object");

    // Give fire-and-forget handlers a tick to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(existsSync(logPath(tempHome))).toBe(false);
  });

  it("never lets recording errors escape the event handler", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    // Make the log path unwritable: create a FILE where the logs DIRECTORY should be.
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(join(tempHome, ".pi", "agent", "logs"), "not a directory", "utf8");

    expect(() =>
      fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allow_once" })),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("recovers after a failed write: a later event is still recorded", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    // Make the log path unwritable: create a FILE where the logs DIRECTORY should be.
    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    writeFileSync(join(tempHome, ".pi", "agent", "logs"), "not a directory", "utf8");

    expect(() =>
      fake.emit("pi-bash-approval:allowed", allowedEvent({ mode: "allow_once" })),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(existsSync(logPath(tempHome))).toBe(false);

    // Unblock the path: subsequent appends must not stay jammed behind the failed one.
    rmSync(join(tempHome, ".pi", "agent", "logs"));

    fake.emit(
      "pi-bash-approval:allowed",
      allowedEvent({ mode: "allow_once", command: "npm run build" }),
    );

    await vi.waitFor(() => {
      expect(existsSync(logPath(tempHome))).toBe(true);
      const lines = readFileSync(logPath(tempHome), "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ command: "npm run build" });
    });
  });

  it("reports recurring manual approvals via /bash-approval-report", async () => {
    const logFile = logPath(tempHome);
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(
      logFile,
      [
        { timestamp: "2026-07-09T10:00:00.000Z", command: "git push origin main", cwd: "/a", mode: "allow_once" },
        { timestamp: "2026-07-09T10:01:00.000Z", command: "git push origin dev", cwd: "/b", mode: "allow_once" },
        // legacy entry without mode: must be ignored
        { timestamp: "2026-07-01T00:00:00.000Z", command: "curl example.com", cwd: "/c" },
        { timestamp: "2026-07-02T00:00:00.000Z", command: "curl example.com", cwd: "/c" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
      "utf8",
    );
    // Rule already covered by the allowlist must not be suggested.
    mkdirSync(dirname(allowlistPath(tempHome)), { recursive: true });
    writeFileSync(allowlistPath(tempHome), "npm test:*\n", "utf8");

    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    const reportCommand = fake.commands.get("bash-approval-report");
    expect(reportCommand).toBeDefined();

    const ctx = { ui: { notify: vi.fn() } };
    await reportCommand!.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    const [report, level] = ctx.ui.notify.mock.calls[0];
    expect(level).toBe("info");
    expect(report).toContain("2x: git push:*");
    expect(report).not.toContain("curl");
  });

  it("notifies an error when report generation fails", async () => {
    const extension = await loadExtension(tempHome);
    const fake = makeFakePi();
    extension(fake.pi as any);

    // Unreadable log: a directory at the log-file path makes readFile fail with EISDIR.
    mkdirSync(logPath(tempHome), { recursive: true });

    const ctx = { ui: { notify: vi.fn() } };
    await fake.commands.get("bash-approval-report")!.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate report"),
      "error",
    );
  });
});
