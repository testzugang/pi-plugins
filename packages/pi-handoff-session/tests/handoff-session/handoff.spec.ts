import { describe, expect, it } from "vitest";
import {
  buildGeneratorPrompt,
  buildSuggestionPrompt,
  contentBlocksToText,
  parseSuggestionResponse,
} from "../../extensions/handoff-session/handoff.ts";

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

  it("builds a context-aware suggestion prompt with JSON-only output contract", () => {
    const prompt = buildSuggestionPrompt(
      "User fixed model switching and now wants better handoff defaults.",
      "Start the next step from this handoff",
    );

    expect(prompt).toContain("User fixed model switching");
    expect(prompt).toContain("goal");
    expect(prompt).toContain("sessionName");
    expect(prompt).toContain("Return only JSON");
  });

  it("parses suggestion JSON and normalizes concise session names", () => {
    const suggestion = parseSuggestionResponse(
      '{"goal":"Improve handoff defaults from recent session context","sessionName":"handoff session improve defaults"}',
      "Fallback goal",
    );

    expect(suggestion).toEqual({
      goal: "Improve handoff defaults from recent session context",
      sessionName: "improve-defaults",
    });
  });

  it("extracts text blocks from model response content", () => {
    expect(
      contentBlocksToText([
        { type: "text", text: "first" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("falls back when suggestion output is not valid JSON", () => {
    const suggestion = parseSuggestionResponse(
      "I would call it model fix",
      "Fix target model handoff",
    );

    expect(suggestion).toEqual({
      goal: "Fix target model handoff",
      sessionName: "fix-target-model",
    });
  });
});
