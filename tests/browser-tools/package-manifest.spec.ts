import { describe, expect, it } from "@jest/globals";
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
      skills: ["./skills"],
      extensions: ["./extensions"],
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
