import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { exec } from "node:child_process";

const COLOR_MAP: Record<string, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  green: "🟢",
  blue: "🔵",
  purple: "🟣",
  black: "⚫",
  white: "⚪",
};

const COLOR_TO_THEME_KEY: Record<
  string,
  "error" | "warning" | "success" | "accent" | "toolTitle" | "muted" | "dim"
> = {
  red: "error",
  orange: "warning",
  yellow: "warning",
  green: "success",
  blue: "accent",
  purple: "toolTitle",
  black: "muted",
  white: "dim",
};

type BrandingConfig = {
  color: string;
  soundCommand?: string;
};

export default function (pi: ExtensionAPI) {
  // Encapsulated state inside closure
  const currentBranding: BrandingConfig = {
    color: "blue",
    soundCommand: "",
  };

  let activeToolsCount = 0;
  let isThinking = false;
  let isBlocked = false;

  function updateTabTitle(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const statusEmoji = isBlocked
      ? "⚠️"
      : activeToolsCount > 0
        ? "⚙️"
        : isThinking
          ? "⏳"
          : "💤";
    const colorEmoji = COLOR_MAP[currentBranding.color] || "🔵";
    const sessionName = pi.getSessionName() || basename(ctx.cwd);
    const title = `${statusEmoji} ${colorEmoji} ${sessionName} | ${basename(ctx.cwd)}`;
    ctx.ui.setTitle(title);
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const sessionName = pi.getSessionName() || basename(ctx.cwd);
    const color = currentBranding.color;

    ctx.ui.setWidget(
      "session-branding-widget",
      (tui, theme) => {
        const themeKey = COLOR_TO_THEME_KEY[color] || "accent";
        const styledDot = theme.fg(themeKey, "●");
        return new Text(
          `${styledDot} Session: ${theme.bold(sessionName)} (${color})`,
          0,
          0,
        );
      },
      { placement: "aboveEditor" },
    );
  }

  function triggerBlockedSound() {
    if (currentBranding.soundCommand) {
      exec(currentBranding.soundCommand, (err) => {
        if (err) {
          process.stdout.write("\x07");
        }
      });
    } else {
      process.stdout.write("\x07");
    }
  }

  function loadConfig(cwd: string) {
    const configPath = join(cwd, ".pi", "branding.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(
          readFileSync(configPath, "utf8"),
        ) as BrandingConfig;
        if (config && typeof config === "object") {
          currentBranding.color =
            typeof config.color === "string" && COLOR_MAP[config.color]
              ? config.color
              : "blue";
          currentBranding.soundCommand =
            typeof config.soundCommand === "string" ? config.soundCommand : "";
        }
      } catch {
        // Keep defaults on failure
      }
    } else {
      currentBranding.color = "blue";
      currentBranding.soundCommand = "";
    }
  }

  function saveConfig(cwd: string) {
    const dir = join(cwd, ".pi");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "branding.json"),
        JSON.stringify(currentBranding, null, 2),
        "utf8",
      );
    } catch {
      // Ignore write issues in read-only environments
    }
  }

  function wrapUiInstance(ctx: ExtensionContext) {
    if (!ctx.hasUI || !ctx.ui) return;

    // Direct object wrapping (extremely safe, no prototype pollution)
    const uiObj = ctx.ui as any;
    if (uiObj.__patched_branding) return;

    const methodsToWrap = [
      "confirm",
      "select",
      "input",
      "editor",
      "custom",
    ] as const;

    for (const method of methodsToWrap) {
      const original = uiObj[method];
      if (typeof original === "function") {
        uiObj[method] = async function (this: any, ...args: any[]) {
          const wasBlocked = isBlocked;
          isBlocked = true;
          updateTabTitle(ctx);
          if (!wasBlocked) {
            triggerBlockedSound();
          }
          try {
            return await original.apply(this, args);
          } finally {
            isBlocked = false;
            updateTabTitle(ctx);
          }
        };
      }
    }

    uiObj.__patched_branding = true;
  }

  pi.on("session_start", async (event, ctx) => {
    loadConfig(ctx.cwd);
    activeToolsCount = 0;
    isThinking = false;
    isBlocked = false;

    wrapUiInstance(ctx);
    updateTabTitle(ctx);
    updateWidget(ctx);
  });

  pi.on("session_shutdown", async () => {
    // Session state clean. Wrapping instance directly avoids prototype restore needs.
  });

  pi.on("agent_start", async (event, ctx) => {
    isThinking = true;
    updateTabTitle(ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    isThinking = false;
    updateTabTitle(ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    activeToolsCount++;
    updateTabTitle(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    activeToolsCount = Math.max(0, activeToolsCount - 1);
    updateTabTitle(ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    updateTabTitle(ctx);
  });

  // Slash commands
  pi.registerCommand("session-name", {
    description: "Setzt den Anzeigenamen der aktuellen Session",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Bitte gib einen Namen an: /session-name <name>",
            "warning",
          );
        }
        return;
      }
      pi.setSessionName(name);
      updateTabTitle(ctx);
      updateWidget(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`Session-Name geändert in: ${name}`, "info");
      }
    },
  });

  pi.registerCommand("session-color", {
    description: "Setzt die Farbe für dieses Repository",
    handler: async (args, ctx) => {
      const colorInput = args.trim().toLowerCase();

      if (!colorInput) {
        if (!ctx.hasUI) return;

        const colors = Object.keys(COLOR_MAP);
        const selected = await ctx.ui.select(
          "Wähle eine Repository-Farbe:",
          colors,
        );
        if (selected) {
          currentBranding.color = selected;
          saveConfig(ctx.cwd);
          updateTabTitle(ctx);
          updateWidget(ctx);
          ctx.ui.notify(`Farbe geändert in: ${selected}`, "info");
        }
        return;
      }

      if (COLOR_MAP[colorInput]) {
        currentBranding.color = colorInput;
        saveConfig(ctx.cwd);
        updateTabTitle(ctx);
        updateWidget(ctx);
        if (ctx.hasUI) {
          ctx.ui.notify(`Farbe geändert in: ${colorInput}`, "info");
        }
      } else {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Ungültige Farbe. Unterstützt: ${Object.keys(COLOR_MAP).join(", ")}`,
            "error",
          );
        }
      }
    },
  });
}
