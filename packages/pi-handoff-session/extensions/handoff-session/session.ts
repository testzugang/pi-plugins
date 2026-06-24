import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { slugify } from "./naming.ts";

export async function saveHandoffFile(
  cwd: string,
  sessionName: string,
  prompt: string
): Promise<string> {
  const canonicalCwd = path.resolve(cwd);
  const targetDir = path.join(canonicalCwd, "docs", "pi", "handoffs");
  
  // Safe Fallback: Handle empty or invalid slug names
  const slug = slugify(sessionName) || "handoff-session";
  const targetFile = path.resolve(targetDir, `${new Date().toISOString().split("T")[0]}-${slug}.md`);

  // Strict Path Containment Guard: verify that relative paths do not escape target directory
  const relativePath = path.relative(targetDir, targetFile);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path containment violation: Target file must resolve inside docs/pi/handoffs");
  }

  // Safety fallback: if sessionName itself directly contains relative directory escape tokens
  if (sessionName.includes("..")) {
    throw new Error("Path containment violation: Malicious relative paths detected in filename");
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
      await fs.writeFile(resolvedFile, prompt, { flag: "wx", encoding: "utf8" });
      success = true;
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as any).code === "EEXIST") {
        attempts++;
        resolvedFile = `${base}-${attempts}${ext}`;
      } else {
        throw err;
      }
    }
  }

  if (!success) {
    throw new Error("Failed to write handoff file: Too many file write collisions");
  }

  return resolvedFile;
}

export async function executeSessionTransition(
  ctx: ExtensionCommandContext,
  prompt: string,
  options: {
    sessionName: string;
    targetModel: string;
  }
): Promise<void> {
  const parentSessionFile = ctx.sessionManager.getSessionFile();

  const result = await ctx.newSession({
    parentSession: parentSessionFile || undefined,
    setup: async (sm) => {
      // Apply session name info entry typsicher
      sm.appendSessionInfo(options.sessionName);
      
      // Apply target model change entry if specified
      if (options.targetModel) {
        const parts = options.targetModel.split("/");
        const provider = parts.length > 1 ? parts[0] : "anthropic";
        const modelId = parts.length > 1 ? parts.slice(1).join("/") : options.targetModel;
        sm.appendModelChange(provider, modelId);
      }
    },
    withSession: async (newCtx) => {
      // Set the editor draft prompt but DO NOT automatically send it!
      newCtx.ui.setEditorText(prompt);
      newCtx.ui.notify(`Session replaced successfully! Draft loaded.`, "info");
    }
  });

  if (result.cancelled) {
    ctx.ui.notify("Session replacement cancelled by another extension.", "warning");
  }
}
