import { describe, expect, it } from "vitest";
import { buildGeneratorPrompt } from "../../extensions/handoff-session/handoff.ts";

describe("Handoff Generator Prompt", () => {
  it("assembles correct instructions including goal and referenced documents without reading them", () => {
    const goal = "Refactor active validation pipeline";
    const manualRefs = ["packages/pi-commit/package.json"];
    const autoRefs = ["docs/pi/specs/design.md"];
    const compactionSummary = "Previous work set up workspaces";

    const prompt = buildGeneratorPrompt(goal, manualRefs, autoRefs, compactionSummary);
    
    // Core inputs
    expect(prompt).toContain(goal);
    expect(prompt).toContain("packages/pi-commit/package.json");
    expect(prompt).toContain("docs/pi/specs/design.md");
    expect(prompt).toContain(compactionSummary);
    
    // Constraints and design guidelines from spec
    expect(prompt).toContain("DO NOT read or copy their full text into the handoff prompt");
    expect(prompt).toContain("DO NOT speculate");
    expect(prompt).toContain("Mark any open questions");
  });
});
