import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildTargetModelChoices,
  createTargetModelSwitcher,
  executeSessionTransition,
  filterModelsByEnabledPatterns,
  findModelByReference,
  parseModelReference,
  resolveEnabledModelPatterns,
  saveHandoffFile,
} from "../../extensions/handoff-session/session.ts";

const tempDir = path.resolve(process.cwd(), "temp-tests-handoff");

describe("Session & File Persistence", () => {
  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("saves handoff file under target subdirectory, handles slashes via slugify, and resolves collisions safely", async () => {
    const prompt = "## Goal\nRefactor pipeline";

    // Test that slashes are safely resolved via slugification
    const saved1 = await saveHandoffFile(tempDir, "feature/pipeline", prompt);

    const content = await fs.readFile(saved1, "utf8");
    expect(content).toBe(prompt);
    expect(
      saved1.startsWith(path.join(tempDir, "docs", "pi", "handoffs")),
    ).toBe(true);
    expect(saved1).toContain("feature-pipeline.md");

    // Save duplicate to verify monotonic retry collision handling
    const saved2 = await saveHandoffFile(tempDir, "feature/pipeline", prompt);
    expect(saved2).not.toBe(saved1);
    expect(saved2).toContain("feature-pipeline-1.md");
  });

  it("rejects path containment violation when trying to escape docs/pi/handoffs using relative breaks", async () => {
    // Relative escapes inside subdirectories should be safely intercepted by the Path Guard
    const borkedFilename = "../../../evil-file";
    await expect(
      saveHandoffFile(tempDir, borkedFilename, "content"),
    ).rejects.toThrow("Path containment violation");
  });

  it("parses provider-prefixed model references with model ids that contain slashes", () => {
    expect(parseModelReference("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
    });
    expect(
      parseModelReference("openrouter/anthropic/claude-sonnet-4.5"),
    ).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4.5",
    });
  });

  it("finds a target model by canonical provider/model reference", () => {
    const models = [
      { provider: "anthropic", id: "claude-sonnet-4-5" },
      { provider: "openrouter", id: "anthropic/claude-sonnet-4.5" },
    ] as any[];

    expect(
      findModelByReference(models, "openrouter/anthropic/claude-sonnet-4.5"),
    ).toBe(models[1]);
    expect(
      findModelByReference(models, "anthropic/claude-sonnet-4.5"),
    ).toBeUndefined();
  });

  it("resolves project enabled-model settings ahead of global settings", () => {
    expect(
      resolveEnabledModelPatterns(
        { enabledModels: ["claude-*"] },
        { enabledModels: ["openai/gpt-5.2"] },
      ),
    ).toEqual(["openai/gpt-5.2"]);
    expect(
      resolveEnabledModelPatterns({ enabledModels: ["claude-*"] }, {}),
    ).toEqual(["claude-*"]);
    expect(
      resolveEnabledModelPatterns({ enabledModels: "claude-*" }, {}),
    ).toBeUndefined();
  });

  it("filters available models through enabled model patterns", () => {
    const models = [
      { provider: "anthropic", id: "claude-opus-4-1" },
      { provider: "anthropic", id: "claude-sonnet-4-5" },
      { provider: "openai", id: "gpt-5.2" },
      { provider: "google", id: "gemini-3-pro" },
    ] as any[];

    expect(
      filterModelsByEnabledPatterns(models, [
        "claude-*",
        "openai/gpt-5.2:high",
      ]),
    ).toEqual([models[0], models[1], models[2]]);
  });

  it("builds concise target model choices from scoped models while keeping the current model first", () => {
    const currentModel = {
      provider: "anthropic",
      id: "claude-opus-4-1",
    } as any;
    const scopedModels = [
      currentModel,
      { provider: "openai", id: "gpt-5.2" },
      { provider: "anthropic", id: "claude-opus-4-1" },
    ] as any[];
    const availableModels = [
      currentModel,
      { provider: "openai", id: "gpt-5.2" },
      { provider: "google", id: "gemini-3-pro" },
    ] as any[];

    expect(
      buildTargetModelChoices(currentModel, scopedModels, availableModels),
    ).toEqual(["anthropic/claude-opus-4-1", "openai/gpt-5.2"]);
  });

  it("successfully runs session transition setup and triggers withSession to set prompt draft", async () => {
    const mockSessionManager = {
      appendSessionInfo: vi.fn(),
      appendModelChange: vi.fn(),
      getSessionFile: () => "parent-session.jsonl",
    };

    const mockReplacementCtx = {
      ui: {
        setEditorText: vi.fn(),
        notify: vi.fn(),
      },
    };

    const mockNewSession = vi.fn().mockImplementation((opts) => {
      // Trigger both setup and withSession callbacks to test registrations
      opts.setup(mockSessionManager);
      opts.withSession(mockReplacementCtx);
      return Promise.resolve({ cancelled: false });
    });

    const mockCtx = {
      sessionManager: {
        getSessionFile: () => "parent-session.jsonl",
      },
      newSession: mockNewSession,
      ui: {
        notify: vi.fn(),
      },
    };

    await executeSessionTransition(mockCtx as any, "## Goal\nTest Prompt", {
      sessionName: "test-session",
      targetModel: "anthropic/claude-3-5",
    });

    expect(mockNewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSession: "parent-session.jsonl",
      }),
    );
    expect(mockSessionManager.appendSessionInfo).toHaveBeenCalledWith(
      "test-session",
    );
    expect(mockSessionManager.appendModelChange).toHaveBeenCalledWith(
      "anthropic",
      "claude-3-5",
    );
    expect(mockReplacementCtx.ui.setEditorText).toHaveBeenCalledWith(
      "## Goal\nTest Prompt",
    );
  });

  it("switches to the target model before creating the replacement session runtime", async () => {
    const callOrder: string[] = [];
    const targetModel = { provider: "openai", id: "gpt-5.2" } as any;
    const switchTargetModel = vi.fn().mockImplementation(async () => {
      callOrder.push("switch");
    });
    const mockNewSession = vi.fn().mockImplementation((opts) => {
      callOrder.push("newSession");
      opts.setup({ appendSessionInfo: vi.fn(), appendModelChange: vi.fn() });
      opts.withSession({ ui: { setEditorText: vi.fn(), notify: vi.fn() } });
      return Promise.resolve({ cancelled: false });
    });
    const mockCtx = {
      sessionManager: { getSessionFile: () => "parent-session.jsonl" },
      newSession: mockNewSession,
      ui: { notify: vi.fn() },
    };

    await executeSessionTransition(mockCtx as any, "## Goal\nTest Prompt", {
      sessionName: "test-session",
      targetModel: "openai/gpt-5.2",
      targetModelObject: targetModel,
      switchTargetModel,
    });

    expect(switchTargetModel).toHaveBeenCalledWith(targetModel);
    expect(callOrder).toEqual(["switch", "newSession"]);
  });

  it("always applies the selected target model before handoff session creation", async () => {
    const targetModel = { provider: "anthropic", id: "claude-sonnet-4-5" } as any;
    const setModel = vi.fn().mockResolvedValue(true);
    const switchTargetModel = createTargetModelSwitcher(setModel);

    await switchTargetModel(targetModel);

    expect(setModel).toHaveBeenCalledWith(targetModel);
  });

  it("reports missing authentication when applying the target model fails", async () => {
    const targetModel = { provider: "openai", id: "gpt-5.2" } as any;
    const setModel = vi.fn().mockResolvedValue(false);
    const switchTargetModel = createTargetModelSwitcher(setModel);

    await expect(switchTargetModel(targetModel)).rejects.toThrow(
      "No API key for openai/gpt-5.2",
    );
  });

  it("rejects invalid target model references before creating a replacement session", async () => {
    const mockNewSession = vi.fn();
    const mockCtx = {
      sessionManager: { getSessionFile: () => "parent-session.jsonl" },
      newSession: mockNewSession,
      ui: { notify: vi.fn() },
    };

    await expect(
      executeSessionTransition(mockCtx as any, "## Goal\nTest Prompt", {
        sessionName: "test-session",
        targetModel: "claude-without-provider",
      }),
    ).rejects.toThrow("Invalid target model reference: claude-without-provider");
    expect(mockNewSession).not.toHaveBeenCalled();
  });
});
