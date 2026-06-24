import { describe, expect, it } from "vitest";
import { slugify } from "../../extensions/handoff-session/naming.ts";

describe("Naming Utilities", () => {
  it("slugifies simple text into lowercase ASCII kebab-case", () => {
    expect(slugify("Implement Handoff Session!")).toBe("implement-handoff-session");
    expect(slugify("test/123_456")).toBe("test-123-456");
    expect(slugify("---hello---world---")).toBe("hello-world");
  });
});
