import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { complete, type Message } from "@earendil-works/pi-ai";
import { HandoffOverlayComponent, type HandoffOptions } from "./ui.ts";
import { parseReferences, autoDetectReferences } from "./references.ts";
import { buildGeneratorPrompt } from "./handoff.ts";
import {
  buildTargetModelChoices,
  executeSessionTransition,
  filterModelsByEnabledPatterns,
  findModelByReference,
  resolveEnabledModelPatterns,
  saveHandoffFile,
} from "./session.ts";

function entryToMessage(entry: SessionEntry) {
  if (entry.type === "message") {
    // String Buffer protection: truncate excessively large single messages (like logs) to max 5000 chars
    const msg = entry.message;
    if (typeof msg.content === "string" && msg.content.length > 5000) {
      return {
        ...msg,
        content:
          msg.content.slice(0, 5000) +
          "\n[Content truncated for token and buffer protection]",
      };
    }
    return msg;
  }
  if (entry.type === "custom_message") {
    return {
      role: "user",
      content: entry.content,
      timestamp: new Date(entry.timestamp).getTime(),
    } as any;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    } as any;
  }
  return undefined;
}

export interface HandoffContext {
  messages: any[];
  compactionSummary?: string;
}

async function readSettingsJson(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as any).code === "ENOENT"
    ) {
      return undefined;
    }
    return undefined;
  }
}

async function getScopedModelsFromSettings(ctx: ExtensionCommandContext) {
  const globalSettingsPath = path.join(
    os.homedir(),
    ".pi",
    "agent",
    "settings.json",
  );
  const projectSettingsPath = path.join(
    ctx.cwd || process.cwd(),
    ".pi",
    "settings.json",
  );
  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsJson(globalSettingsPath),
    readSettingsJson(projectSettingsPath),
  ]);
  const enabledPatterns = resolveEnabledModelPatterns(
    globalSettings,
    projectSettings,
  );
  return filterModelsByEnabledPatterns(
    ctx.modelRegistry.getAvailable(),
    enabledPatterns,
  );
}

// Highly efficient O(n) pass that slices branch history and extracts compaction metadata in a single run
export function prepareHandoffContext(branch: SessionEntry[]): HandoffContext {
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionIndex = i;
      break;
    }
  }

  if (compactionIndex < 0) {
    // Limit unbounded history buffers to max 100 messages for ultimate memory protection
    const messages = branch.map(entryToMessage).filter(Boolean).slice(-100);
    return { messages };
  }

  const compaction = branch[compactionIndex]!;
  const firstKeptIndex = branch.findIndex(
    (entry) => entry.id === compaction.firstKeptEntryId,
  );
  const compactedBranch = [
    compaction,
    ...(firstKeptIndex >= 0
      ? branch.slice(firstKeptIndex, compactionIndex)
      : []),
    ...branch.slice(compactionIndex + 1),
  ];

  const messages = compactedBranch
    .map(entryToMessage)
    .filter(Boolean)
    .slice(-100);
  return {
    messages,
    compactionSummary: compaction.summary,
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff-session", {
    description: "Start a focused handoff session transition",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify(
            "Handoff session command is only available in interactive TUI mode.",
            "error",
          );
          return;
        }

        // Spec Guard: Ensure active model is selected and auth is configured
        const activeModel = ctx.model;
        if (!activeModel) {
          ctx.ui.notify(
            "No model selected in the current session. Cannot generate handoff.",
            "error",
          );
          return;
        }

        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(activeModel);
        if (!auth.ok || !auth.apiKey) {
          ctx.ui.notify(
            `Authentication for model ${activeModel.provider}/${activeModel.id} is missing or invalid. Handoff generation aborted.`,
            "error",
          );
          return;
        }

        // Build target model strings from the user's configured model scope where possible.
        // Pi does not currently expose session-only model scope to extensions, so settings-backed
        // enabledModels is the public approximation and getAvailable() is the safe fallback.
        const availableModelObjects = ctx.modelRegistry.getAvailable();
        const scopedModelObjects = await getScopedModelsFromSettings(ctx);
        const availableModels = buildTargetModelChoices(
          activeModel,
          scopedModelObjects,
          availableModelObjects,
        );

        // 1. Show Custom TUI Dialog in Overlay mode
        const customUIResult = await ctx.ui.custom<
          { options: HandoffOptions; prompt?: string } | undefined
        >(
          (tui, _theme, _kb, done) => {
            const component = new HandoffOverlayComponent(
              ctx,
              tui,
              args,
              availableModels,
              done,
            );

            // Register the inline onGenerate callback to fetch from LLM with AbortSignal
            component.onGenerate = async (opts, signal) => {
              try {
                const manualRefs = parseReferences(opts.manualReferences);
                const branch = ctx.sessionManager.getBranch();

                // Token Protection: Limit transmitted history to recent non-compacted messages
                const handoffCtx = prepareHandoffContext(branch);
                const autoRefs = autoDetectReferences(handoffCtx.messages);

                const generatorInstructions = buildGeneratorPrompt(
                  opts.goal,
                  manualRefs,
                  autoRefs,
                  handoffCtx.compactionSummary,
                );

                const llmMessages = convertToLlm(handoffCtx.messages);
                const conversationText = serializeConversation(llmMessages);

                const userMessage: Message = {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `## Conversation History\n\n${conversationText}\n\n## Generation Instructions\n\n${generatorInstructions}`,
                    },
                  ],
                  timestamp: Date.now(),
                };

                const response = await complete(
                  activeModel,
                  {
                    systemPrompt: "You are a professional context compactor.",
                    messages: [userMessage],
                  },
                  { apiKey: auth.apiKey, headers: auth.headers, signal }, // Pass abort signal to stop in-flight request on escape
                );

                if (response.stopReason === "aborted") {
                  return null;
                }

                return response.content
                  .filter(
                    (c): c is { type: "text"; text: string } =>
                      c.type === "text",
                  )
                  .map((c) => c.text)
                  .join("\n");
              } catch (err: unknown) {
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                console.error("Inline handoff generation failed:", err);
                ctx.ui.notify(`Prompt generation failed: ${errorMsg}`, "error");
                return null;
              }
            };

            return component;
          },
          { overlay: true },
        );

        if (!customUIResult || !customUIResult.prompt) {
          ctx.ui.notify("Handoff cancelled.", "info");
          return;
        }

        const { options, prompt: generatedPrompt } = customUIResult;
        const editedPrompt = await ctx.ui.editor(
          "Edit handoff prompt",
          generatedPrompt,
        );
        if (editedPrompt === undefined) {
          ctx.ui.notify("Handoff cancelled.", "info");
          return;
        }
        const finalPrompt = editedPrompt;
        const targetModelObject = findModelByReference(
          availableModelObjects,
          options.targetModel,
        );
        if (!targetModelObject) {
          ctx.ui.notify(
            `Target model ${options.targetModel} is not available. Handoff cancelled.`,
            "error",
          );
          return;
        }

        // 2. Optional file persistence
        if (options.saveHandoff) {
          const savedFile = await saveHandoffFile(
            ctx.cwd || process.cwd(),
            options.sessionName,
            finalPrompt,
          );
          ctx.ui.notify(`Saved handoff record to: ${savedFile}`, "info");
        }

        // 3. Transition
        await executeSessionTransition(ctx, finalPrompt, {
          sessionName: options.sessionName,
          targetModel: options.targetModel,
          targetModelObject,
          switchTargetModel: async (model) => {
            if (
              model.provider === activeModel.provider &&
              model.id === activeModel.id
            )
              return;
            const ok = await pi.setModel(model);
            if (!ok)
              throw new Error(`No API key for ${model.provider}/${model.id}`);
          },
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Handoff session failed: ${errorMsg}`, "error");
      }
    },
  });
}
