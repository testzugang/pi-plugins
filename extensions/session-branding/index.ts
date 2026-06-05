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
  pi.registerCommand("session-branding", {
    description:
      "Konfiguriert Name, Farbe oder Sound-Benachrichtigung für diese Session/dieses Repository",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();
      const value = parts.slice(1).join(" ");

      const colors = Object.keys(COLOR_MAP);

      // 1. Direktaufrufe mit Argumenten
      if (subcommand === "color") {
        const colorVal = value.toLowerCase();
        if (!colorVal) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Bitte gib eine Farbe an: /session-branding color <farbe>",
              "warning",
            );
          }
          return;
        }
        if (COLOR_MAP[colorVal]) {
          currentBranding.color = colorVal;
          saveConfig(ctx.cwd);
          updateTabTitle(ctx);
          updateWidget(ctx);
          if (ctx.hasUI)
            ctx.ui.notify(`Farbe geändert in: ${colorVal}`, "info");
        } else {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Ungültige Farbe. Unterstützt: ${colors.join(", ")}`,
              "error",
            );
          }
        }
        return;
      }

      if (subcommand === "name") {
        if (!value) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Bitte gib einen Session-Namen an: /session-branding name <name>",
              "warning",
            );
          }
          return;
        }
        pi.setSessionName(value);
        updateTabTitle(ctx);
        updateWidget(ctx);
        if (ctx.hasUI)
          ctx.ui.notify(`Session-Name geändert in: ${value}`, "info");
        return;
      }

      if (subcommand === "sound") {
        if (!value) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Bitte gib einen Sound-Befehl an: /session-branding sound <befehl> (oder 'clear'/'default')",
              "warning",
            );
          }
          return;
        }
        currentBranding.soundCommand =
          value === "clear" || value === "default" ? "" : value;
        saveConfig(ctx.cwd);
        if (ctx.hasUI) {
          const msg = currentBranding.soundCommand
            ? `Sound-Befehl geändert in: ${currentBranding.soundCommand}`
            : "Sound-Befehl auf Standard zurückgesetzt.";
          ctx.ui.notify(msg, "info");
        }
        return;
      }

      // Falls ein ungültiger Unterbefehl übergeben wurde
      if (subcommand) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Ungültiger Befehl. Verwendung:\n" +
              "• /session-branding (interaktives Menü)\n" +
              "• /session-branding color <farbe>\n" +
              "• /session-branding name <name>\n" +
              "• /session-branding sound <befehl>",
            "error",
          );
        }
        return;
      }

      // 2. Interaktives Konfigurationsmenü (ohne Argumente)
      if (!ctx.hasUI) return;

      const action = await ctx.ui.select("Was möchtest du konfigurieren?", [
        "🎨 Repository-Farbe ändern",
        "🏷️ Session-Name ändern",
        "🔊 Blocked-Sound-Befehl ändern",
      ]);

      if (action === "🎨 Repository-Farbe ändern") {
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
      } else if (action === "🏷️ Session-Name ändern") {
        const currentName = pi.getSessionName() || "";
        const entered = await ctx.ui.input(
          `Aktueller Session-Name: ${currentName || "keiner"}\nNeuen Namen eingeben:`,
        );
        if (entered !== undefined && entered.trim()) {
          pi.setSessionName(entered.trim());
          updateTabTitle(ctx);
          updateWidget(ctx);
          ctx.ui.notify(`Session-Name geändert in: ${entered.trim()}`, "info");
        }
      } else if (action === "🔊 Blocked-Sound-Befehl ändern") {
        const currentSound =
          currentBranding.soundCommand || "Standard (Terminal-Bell)";
        const entered = await ctx.ui.input(
          `Aktueller Sound-Befehl: ${currentSound}\nNeuen Befehl eingeben (oder 'clear'/'default' für Standard):`,
        );
        if (entered !== undefined) {
          const cleanVal = entered.trim();
          currentBranding.soundCommand =
            cleanVal === "clear" || cleanVal === "default" || !cleanVal
              ? ""
              : cleanVal;
          saveConfig(ctx.cwd);
          const msg = currentBranding.soundCommand
            ? `Sound-Befehl geändert in: ${currentBranding.soundCommand}`
            : "Sound-Befehl auf Standard zurückgesetzt.";
          ctx.ui.notify(msg, "info");
        }
      }
    },
  });
}
