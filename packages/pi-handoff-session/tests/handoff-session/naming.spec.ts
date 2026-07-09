import { describe, expect, it } from "vitest";
import {
  createConciseSessionName,
  slugify,
} from "../../extensions/handoff-session/naming.ts";

describe("Naming Utilities", () => {
  it("slugifies simple text into lowercase ASCII kebab-case", () => {
    expect(slugify("Implement Handoff Session!")).toBe("implement-handoff-session");
    expect(slugify("test/123_456")).toBe("test-123-456");
    expect(slugify("---hello---world---")).toBe("hello-world");
  });

  it("creates concise session names without generic filler words", () => {
    expect(
      createConciseSessionName(
        "Start the next step from this handoff: fix selected model switching",
      ),
    ).toBe("fix-selected-model-switching");
    expect(
      createConciseSessionName(
        "Bitte die nächste Session für Handoff Session Extension verbessern",
      ),
    ).toBe("extension-verbessern");
  });
});
