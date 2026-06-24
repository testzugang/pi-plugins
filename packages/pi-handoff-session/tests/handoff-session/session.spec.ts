import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { saveHandoffFile, executeSessionTransition } from "../../extensions/handoff-session/session.ts";

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
    expect(saved1.startsWith(path.join(tempDir, "docs", "pi", "handoffs"))).toBe(true);
    expect(saved1).toContain("feature-pipeline.md");

    // Save duplicate to verify monotonic retry collision handling
    const saved2 = await saveHandoffFile(tempDir, "feature/pipeline", prompt);
    expect(saved2).not.toBe(saved1);
    expect(saved2).toContain("feature-pipeline-1.md");
  });

  it("rejects path containment violation when trying to escape docs/pi/handoffs using relative breaks", async () => {
    // Relative escapes inside subdirectories should be safely intercepted by the Path Guard
    const borkedFilename = "../../../evil-file";
    await expect(saveHandoffFile(tempDir, borkedFilename, "content"))
      .rejects.toThrow("Path containment violation");
  });

  it("successfully runs session transition setup and triggers withSession to set prompt draft", async () => {
    const mockSessionManager = {
      appendSessionInfo: vi.fn(),
      appendModelChange: vi.fn(),
      getSessionFile: () => "parent-session.jsonl"
    };

    const mockReplacementCtx = {
      ui: {
        setEditorText: vi.fn(),
        notify: vi.fn()
      }
    };

    const mockNewSession = vi.fn().mockImplementation((opts) => {
      // Trigger both setup and withSession callbacks to test registrations
      opts.setup(mockSessionManager);
      opts.withSession(mockReplacementCtx);
      return Promise.resolve({ cancelled: false });
    });

    const mockCtx = {
      sessionManager: {
        getSessionFile: () => "parent-session.jsonl"
      },
      newSession: mockNewSession,
      ui: {
        notify: vi.fn()
      }
    };

    await executeSessionTransition(mockCtx as any, "## Goal\nTest Prompt", {
      sessionName: "test-session",
      targetModel: "anthropic/claude-3-5"
    });

    expect(mockNewSession).toHaveBeenCalledWith(expect.objectContaining({
      parentSession: "parent-session.jsonl"
    }));
    expect(mockSessionManager.appendSessionInfo).toHaveBeenCalledWith("test-session");
    expect(mockSessionManager.appendModelChange).toHaveBeenCalledWith("anthropic", "claude-3-5");
    expect(mockReplacementCtx.ui.setEditorText).toHaveBeenCalledWith("## Goal\nTest Prompt");
  });
});
