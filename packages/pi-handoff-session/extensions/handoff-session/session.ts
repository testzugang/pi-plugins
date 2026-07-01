import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { slugify } from "./naming.ts";

export interface ModelReference {
  provider: string;
  modelId: string;
}

export function formatModelReference(
  model: Pick<Model<any>, "provider" | "id">,
): string {
  return `${model.provider}/${model.id}`;
}

export function parseModelReference(
  reference: string,
): ModelReference | undefined {
  const separatorIndex = reference.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === reference.length - 1) {
    return undefined;
  }

  return {
    provider: reference.slice(0, separatorIndex),
    modelId: reference.slice(separatorIndex + 1),
  };
}

export function findModelByReference<
  T extends Pick<Model<any>, "provider" | "id">,
>(models: T[], reference: string): T | undefined {
  const parsed = parseModelReference(reference);
  if (!parsed) return undefined;
  return models.find(
    (model) =>
      model.provider === parsed.provider && model.id === parsed.modelId,
  );
}

export type SettingsLike = { enabledModels?: unknown } | undefined;

export function resolveEnabledModelPatterns(
  globalSettings: SettingsLike,
  projectSettings: SettingsLike,
): string[] | undefined {
  const projectEnabledModels = projectSettings?.enabledModels;
  if (
    Array.isArray(projectEnabledModels) &&
    projectEnabledModels.every((item) => typeof item === "string")
  ) {
    return projectEnabledModels;
  }

  const globalEnabledModels = globalSettings?.enabledModels;
  if (
    Array.isArray(globalEnabledModels) &&
    globalEnabledModels.every((item) => typeof item === "string")
  ) {
    return globalEnabledModels;
  }

  return undefined;
}

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function stripThinkingLevel(pattern: string): string {
  const separatorIndex = pattern.lastIndexOf(":");
  if (separatorIndex <= 0) return pattern;

  const suffix = pattern.slice(separatorIndex + 1);
  if (!THINKING_LEVELS.has(suffix)) return pattern;
  return pattern.slice(0, separatorIndex);
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesModelPattern(
  model: Pick<Model<any>, "provider" | "id">,
  pattern: string,
): boolean {
  const normalizedPattern = stripThinkingLevel(pattern.trim());
  if (!normalizedPattern) return false;

  const canonical = formatModelReference(model);
  const matcher = wildcardToRegExp(normalizedPattern);
  return matcher.test(canonical) || matcher.test(model.id);
}

export function filterModelsByEnabledPatterns<
  T extends Pick<Model<any>, "provider" | "id">,
>(availableModels: T[], patterns: string[] | undefined): T[] {
  if (!patterns || patterns.length === 0) return [];

  const scopedModels: T[] = [];
  for (const model of availableModels) {
    if (
      patterns.some((pattern) => matchesModelPattern(model, pattern)) &&
      !scopedModels.includes(model)
    ) {
      scopedModels.push(model);
    }
  }

  return scopedModels;
}

export function buildTargetModelChoices(
  currentModel: Pick<Model<any>, "provider" | "id">,
  scopedModels: Pick<Model<any>, "provider" | "id">[],
  availableModels: Pick<Model<any>, "provider" | "id">[],
): string[] {
  const sourceModels = scopedModels.length > 0 ? scopedModels : availableModels;
  const currentReference = formatModelReference(currentModel);
  const choices = [currentReference];

  for (const model of sourceModels) {
    const reference = formatModelReference(model);
    if (!choices.includes(reference)) {
      choices.push(reference);
    }
  }

  return choices;
}

export async function saveHandoffFile(
  cwd: string,
  sessionName: string,
  prompt: string,
): Promise<string> {
  const canonicalCwd = path.resolve(cwd);
  const targetDir = path.join(canonicalCwd, "docs", "pi", "handoffs");

  // Safe Fallback: Handle empty or invalid slug names
  const slug = slugify(sessionName) || "handoff-session";
  const targetFile = path.resolve(
    targetDir,
    `${new Date().toISOString().split("T")[0]}-${slug}.md`,
  );

  // Strict Path Containment Guard: verify that relative paths do not escape target directory
  const relativePath = path.relative(targetDir, targetFile);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      "Path containment violation: Target file must resolve inside docs/pi/handoffs",
    );
  }

  // Safety fallback: if sessionName itself directly contains relative directory escape tokens
  if (sessionName.includes("..")) {
    throw new Error(
      "Path containment violation: Malicious relative paths detected in filename",
    );
  }

  await fs.mkdir(targetDir, { recursive: true });

  const extIndex = targetFile.lastIndexOf(".");
  const base = extIndex !== -1 ? targetFile.slice(0, extIndex) : targetFile;
  const ext = extIndex !== -1 ? targetFile.slice(extIndex) : "";

  let resolvedFile = targetFile;
  let success = false;
  let attempts = 0;

  // Race-safe file write with wx flag and monotonic retry sequences
  while (!success && attempts < 10) {
    try {
      await fs.writeFile(resolvedFile, prompt, {
        flag: "wx",
        encoding: "utf8",
      });
      success = true;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as any).code === "EEXIST"
      ) {
        attempts++;
        resolvedFile = `${base}-${attempts}${ext}`;
      } else {
        throw err;
      }
    }
  }

  if (!success) {
    throw new Error(
      "Failed to write handoff file: Too many file write collisions",
    );
  }

  return resolvedFile;
}

export async function executeSessionTransition(
  ctx: ExtensionCommandContext,
  prompt: string,
  options: {
    sessionName: string;
    targetModel: string;
    targetModelObject?: Model<any>;
    switchTargetModel?: (model: Model<any>) => Promise<void>;
  },
): Promise<void> {
  const parentSessionFile = ctx.sessionManager.getSessionFile();

  if (options.targetModelObject && options.switchTargetModel) {
    await options.switchTargetModel(options.targetModelObject);
  }

  const result = await ctx.newSession({
    parentSession: parentSessionFile || undefined,
    setup: async (sm) => {
      // Apply session name info entry typsicher
      sm.appendSessionInfo(options.sessionName);

      // Apply target model change entry if specified
      if (options.targetModel) {
        const parts = options.targetModel.split("/");
        const provider = parts.length > 1 ? parts[0] : "anthropic";
        const modelId =
          parts.length > 1 ? parts.slice(1).join("/") : options.targetModel;
        sm.appendModelChange(provider, modelId);
      }
    },
    withSession: async (newCtx) => {
      // Set the editor draft prompt but DO NOT automatically send it!
      newCtx.ui.setEditorText(prompt);
      newCtx.ui.notify(`Session replaced successfully! Draft loaded.`, "info");
    },
  });

  if (result.cancelled) {
    ctx.ui.notify(
      "Session replacement cancelled by another extension.",
      "warning",
    );
  }
}
