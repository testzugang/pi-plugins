import { createConciseSessionName } from "./naming.ts";

export interface HandoffSuggestion {
  goal: string;
  sessionName: string;
}

export function contentBlocksToText(
  content: Array<{ type: string; text?: string; [key: string]: unknown }>,
): string {
  return content
    .filter((block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export function buildSuggestionPrompt(
  conversationSummary: string,
  fallbackGoal: string,
): string {
  return `Analyze the recent Pi coding session context and propose better defaults for a handoff to a new session.

Fallback goal from the command/UI:
${fallbackGoal}

Recent session context:
${conversationSummary}

Return only JSON with this exact shape:
{"goal":"one concrete next-session goal","sessionName":"short kebab-case topic name"}

Rules:
- The goal must match the actual recent context and next likely task.
- If the fallback goal is explicit, preserve that intent and only make it more concrete.
- The sessionName must be concise, lowercase, and omit filler words like handoff, session, next, step, continue.
- Do not include markdown, comments, or explanatory text.`;
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

export function parseSuggestionResponse(
  responseText: string,
  fallbackGoal: string,
): HandoffSuggestion {
  let goal = fallbackGoal;
  let rawSessionName = fallbackGoal;

  const jsonText = extractJsonObject(responseText);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if (typeof parsed.goal === "string" && parsed.goal.trim()) {
        goal = parsed.goal.trim();
      }
      if (
        typeof parsed.sessionName === "string" &&
        parsed.sessionName.trim()
      ) {
        rawSessionName = parsed.sessionName.trim();
      } else {
        rawSessionName = goal;
      }
    } catch {
      rawSessionName = goal;
    }
  }

  return {
    goal,
    sessionName: createConciseSessionName(rawSessionName),
  };
}

export function buildGeneratorPrompt(
  goal: string,
  manualReferences: string[],
  autoReferences: string[],
  compactionSummary: string | undefined
): string {
  const allRefs = Array.from(new Set([...manualReferences, ...autoReferences]));

  return `You are a professional context compactor and session transition architect.
Your goal is to write a highly focused Handoff-Prompt for a brand-new session that will run on the same workspace.

Target Goal of the new session:
"${goal}"

Existing Compaction Summary (if any):
${compactionSummary || "None."}

Referenced documents/commits/links to guide the next session:
${allRefs.map(r => `- ${r}`).join("\n") || "None."}

RULES:
1. Refer to documents, specs, PRs or commits by their path/URL/hash. DO NOT read or copy their full text into the handoff prompt! The next agent can read them if needed.
2. DO NOT speculate. Only document proven facts and decisions.
3. Mark any open questions or gaps explicitly.
4. If relevant, outline the current workspace CWD, branch or local uncommitted changes that are critical to pick up immediately.
5. Clearly formulate the Goal, Decisions taken so far, and the "Next task" to pick up.
6. Keep the prompt compact, concise, and structured as follows:

## Goal
[Goal of the new session]

## Context
[Essential context only, excluding large code blocks or redundant file bodies]

## Decisions
[Key decisions taken in this session]

## References
[Bullet list of file paths/hashes/URLs with a short reason why they are relevant]

## Next task
[One single, concrete task that the new agent should execute immediately]

## Recommended skills/tools
[Recommended tools or skills for the work]

Now, write the finalized Markdown Handoff-Prompt. Start directly with the markdown content, no explanation.`;
}
