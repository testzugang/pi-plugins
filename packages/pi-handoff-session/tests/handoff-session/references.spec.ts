import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseReferences, autoDetectReferences } from "../../extensions/handoff-session/references.ts";
import { prepareHandoffContext } from "../../extensions/handoff-session/index.ts";

describe("Reference Utilities", () => {
  it("parses and normalizes manual reference inputs, including deduplication", () => {
    const input = "docs/pi/specs/design.md, @packages/foo/index.ts, docs/pi/specs/design.md, https://github.com/org/repo/pull/12";
    const parsed = parseReferences(input);
    
    expect(parsed).toContain("docs/pi/specs/design.md");
    expect(parsed).toContain("packages/foo/index.ts");
    expect(parsed).toContain("https://github.com/org/repo/pull/12");
    
    // Check that there is no leading @
    expect(parsed).not.toContain("@packages/foo/index.ts");

    // Deduplication check
    expect(parsed.filter(r => r === "docs/pi/specs/design.md").length).toBe(1);
  });

  it("auto-detects paths, markdown docs and git hashes from session message entries", () => {
    const entries: SessionEntry[] = [
      {
        id: "1",
        type: "message",
        timestamp: "2026-06-24T12:00:00.000Z",
        message: {
          role: "user",
          content: "Please check docs/pi/specs/2026-06-23-handoff-session-design.md, we also changed packages/pi-commit/package.json.",
        },
      },
      {
        id: "2",
        type: "message",
        timestamp: "2026-06-24T12:01:00.000Z",
        message: {
          role: "assistant",
          content: "Done, the changes are committed under 0b83ed4. PR is on https://github.com/hasit/pi/pull/42, we also have another on https://github.com/hasit/pi/pull/13.",
        },
      },
    ];
    
    const detected = autoDetectReferences(entries);
    expect(detected).toContain("docs/pi/specs/2026-06-23-handoff-session-design.md");
    expect(detected).toContain("packages/pi-commit/package.json");
    expect(detected).toContain("0b83ed4");
    expect(detected).toContain("https://github.com/hasit/pi/pull/42");
    expect(detected).toContain("https://github.com/hasit/pi/pull/13");
    // Ensure trailing punctuation was successfully stripped
    expect(detected).not.toContain("https://github.com/hasit/pi/pull/42,");
    expect(detected).not.toContain("https://github.com/hasit/pi/pull/13.");
  });

  it("extracts and slices messages properly based on compaction entries for token protection", () => {
    const branch: SessionEntry[] = [
      {
        id: "old-1",
        type: "message",
        timestamp: "2026-06-24T10:00:00.000Z",
        message: { role: "user", content: "Compacted message 1" }
      },
      {
        id: "compaction-1",
        type: "compaction",
        timestamp: "2026-06-24T10:05:00.000Z",
        summary: "This is the compaction summary",
        tokensBefore: 2000,
        firstKeptEntryId: "kept-1"
      },
      {
        id: "kept-1",
        type: "message",
        timestamp: "2026-06-24T10:10:00.000Z",
        message: { role: "user", content: "Kept message after compaction" }
      }
    ];

    const handoffCtx = prepareHandoffContext(branch);
    const messages = handoffCtx.messages;
    
    // Should contain the compaction summary entry and the kept message, but not the compacted old message
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("compactionSummary");
    expect(messages[0].summary).toBe("This is the compaction summary");
    expect(messages[1].content).toBe("Kept message after compaction");
    expect(handoffCtx.compactionSummary).toBe("This is the compaction summary");
  });
});
