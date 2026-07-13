import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(__dirname, "..", "..");

describe("pi-plugins package manifest", () => {
  it("declares both extension and skill resources", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as {
      pi?: { extensions?: string[]; skills?: string[] };
      files?: string[];
    };

    expect(manifest.pi).toEqual({
      skills: [
        "./skills",
        "./packages/pi-migrate-to-agents-md/skills",
        "./packages/pi-audit-agents-md/skills",
        "./packages/pi-commit/skills",
        "./packages/pi-pr-findings/skills",
        "./packages/pi-dependency-audit/skills",
      ],
      extensions: [
        "./extensions",
        "./packages/pi-pr-findings/extensions",
        "./packages/pi-handoff-session/extensions/handoff-session",
        "./packages/pi-approval-recorder/extension.ts",
      ],
      prompts: ["./prompts"],
      themes: ["./themes"],
    });
  });

  it("ships browser tool usage guidance as a skill", () => {
    const skillPath = join(PACKAGE_ROOT, "skills", "browser-tools", "SKILL.md");

    expect(existsSync(skillPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toContain("name: browser-tools");
    expect(skill).toContain("browser_start");
    expect(skill).toContain("browser_nav");
    expect(skill).toContain("browser_eval");
    expect(skill).toContain("browser_screenshot");
    expect(skill).toContain("profile: true");
    expect(skill).toMatch(/prefer.*browser_eval/is);
  });
});
