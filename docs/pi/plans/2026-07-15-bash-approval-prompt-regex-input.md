# Interaktive Regex-Eingabe & Shortcuts in pi-bash-approval - Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erweitert den interaktiven Prompt von `pi-bash-approval` um die Tastenkombination `Ctrl+R`, die ein modal vorausgefülltes Texteingabefeld öffnet, um intelligente Scoping-Regeln oder freie Regex-Ausdrücke einzugeben, syntaktisch zu validieren und in `.bash-approval` ohne Duplikate zu speichern.

**Architecture:** Wir ersetzen das starre `ctx.ui.select` durch ein flexibles `ctx.ui.custom()` mit der eingebauten `SelectList` von `@earendil-works/pi-tui`. Wir binden das Tastatur-Event `ctrl+r` ab, brechen das Custom-Menü ab, öffnen das modal `ctx.ui.input` mit vorausgefülltem Scoping-Regex, validieren den Regex-Körper (ohne `r:`-Präfix), nutzen die bestehende `persistRule`-Funktion aus `utils.ts` zur Duplikatprüfung und Persistierung, und binden alles nahtlos in die bestehende `controller`-Zustandsmaschine ein, um Remote-Response-Kompatibilität zu wahren.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, Jest (in `pi-extensions`)

---

### Task 1: Regex-Schnittstelle und Vorbefüllung (utils.ts)

**Files:**
- Modify: `packages/pi-bash-approval/extensions/utils.ts`
- Test: `packages/pi-bash-approval/tests/bash-approval.spec.ts`

- [ ] **Step 1: Write the failing tests**

Füge folgende Tests am Ende des inneren `describe("tool_call event - regex-based pattern matching", ...)`-Blocks in `packages/pi-bash-approval/tests/bash-approval.spec.ts` hinzu:

```typescript
    it("suggests a correct regex-based pattern for git with directory-scoping", () => {
      expect(suggestRegexPattern("git -C /tmp/example status --short")).toBe(
        "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status --short$",
      );
      expect(suggestRegexPattern('git -C "/tmp/some folder" status --short')).toBe(
        "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status --short$",
      );
    });

    it("suggests a correct regex-based pattern for npm with directory-scoping", () => {
      expect(suggestRegexPattern("npm --prefix '/workspace/my app' run build")).toBe(
        "r:^npm --prefix (?:\"[^\"]+\"|'[^']+'|\\S+) run build$",
      );
    });

    it("suggests a correct regex-based pattern for docker exec with container-scoping", () => {
      expect(suggestRegexPattern("docker exec -it --user root my_container ls -la")).toBe(
        "r:^docker exec -it --user root (?:\"[^\"]+\"|'[^']+'|\\S+) ls -la$",
      );
      expect(suggestRegexPattern("docker exec -w /app container-123 npm install")).toBe(
        "r:^docker exec -w /app (?:\"[^\"]+\"|'[^']+'|\\S+) npm install$",
      );
    });

    it("suggests an exact escaped regex match as fallback for any other command", () => {
      expect(suggestRegexPattern("ls -la")).toBe("r:^ls -la$");
      expect(suggestRegexPattern("git status")).toBe("r:^git status$");
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: FAIL (Compile-Fehler: `suggestRegexPattern` nicht definiert)

- [ ] **Step 3: Write tokenizer, scoping suggestor and export persistRule**

Ergänze am Ende von `packages/pi-bash-approval/extensions/utils.ts` die Tokenizer- und Suggestor-Logik und exportiere die bestehende Funktion `persistRule`:

```typescript
const DOCKER_FLAGS_WITH_ARGS = new Set([
  "-u", "--user", "-w", "--workdir", "-e", "--env", "--cpus", "-m", "--memory", "--network", "--platform",
]);
const PATH_PATTERN = "(?:\"[^\"]+\"|'[^']+'|\\S+)";

export function tokenize(command: string): string[] {
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const tokens: string[] = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export function tokenizeWithIndices(command: string): Array<{ value: string; raw: string; start: number; end: number }> {
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const tokens: Array<{ value: string; raw: string; start: number; end: number }> = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    const raw = match[0];
    const value = match[1] ?? match[2] ?? match[3];
    const start = match.index;
    const end = regex.lastIndex;
    tokens.push({ value, raw, start, end });
  }
  return tokens;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function suggestRegexPattern(command: string): string {
  const firstLine = command.trim().split("\n")[0];
  if (!firstLine) return `r:^$`;
  const tokens = tokenizeWithIndices(firstLine);
  if (tokens.length === 0) return `r:^$`;

  // Case 1: git -C <path> ...
  if (
    tokens.length >= 4 &&
    tokens[0]?.value === "git" &&
    tokens[1]?.value === "-C"
  ) {
    const dirToken = tokens[2];
    if (dirToken) {
      const before = firstLine.slice(0, dirToken.start);
      const after = firstLine.slice(dirToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Case 2: npm --prefix <path> ...
  if (
    tokens.length >= 4 &&
    tokens[0]?.value === "npm" &&
    tokens[1]?.value === "--prefix"
  ) {
    const dirToken = tokens[2];
    if (dirToken) {
      const before = firstLine.slice(0, dirToken.start);
      const after = firstLine.slice(dirToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Case 3: docker exec ...
  if (
    tokens.length >= 3 &&
    tokens[0]?.value === "docker" &&
    tokens[1]?.value === "exec"
  ) {
    let containerToken: typeof tokens[number] | null = null;
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) continue;
      if (DOCKER_FLAGS_WITH_ARGS.has(t.value)) {
        i++; // Skip argument
        continue;
      }
      if (t.value.startsWith("-")) continue; // Skip other flags
      containerToken = t;
      break;
    }
    if (containerToken) {
      const before = firstLine.slice(0, containerToken.start);
      const after = firstLine.slice(containerToken.end);
      return `r:^${escapeRegExp(before)}${PATH_PATTERN}${escapeRegExp(after)}$`;
    }
  }

  // Fallback: Exakter Match
  return `r:^${escapeRegExp(firstLine)}$`;
}
```

Ändere außerdem die Zeile `function persistRule` in `packages/pi-bash-approval/extensions/utils.ts` in:
```typescript
export function persistRule(
```

Importiere `suggestRegexPattern` oben im Testfile `packages/pi-bash-approval/tests/bash-approval.spec.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/extensions/utils.ts packages/pi-bash-approval/tests/bash-approval.spec.ts
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "feat(bash-approval): implement and test suggestRegexPattern scoping helper"
```

---

### Task 2: Custom TUI-Prompt mit `SelectList` und `Ctrl+R` Shortcut

**Files:**
- Modify: `packages/pi-bash-approval/extensions/index.ts`
- Test: `packages/pi-bash-approval/tests/bash-approval.spec.ts`

- [ ] **Step 1: Write the failing tests and mock `ctx.ui.custom`**

Füge `custom` zum `makeCtx` Helper-Mock in `packages/pi-bash-approval/tests/bash-approval.spec.ts` hinzu, damit existierende Tests nicht wegen fehlender `custom`-Funktion fehlschlagen:

```typescript
function makeCtx(
  opts: { hasUI?: boolean; pick?: (options: string[]) => string | null } = {},
) {
  const notify = jest.fn();
  const select = jest
    .fn<SelectFn>()
    .mockImplementation((_msg, options) =>
      Promise.resolve(opts.pick ? opts.pick(options) : null),
    );
  const custom = jest
    .fn<any>()
    .mockImplementation((factory) => {
      const tui = { requestRender: jest.fn() };
      const theme = {
        fg: (c: string, t: string) => t,
        bg: (c: string, t: string) => t,
        bold: (t: string) => t,
      };
      const kb = {};
      const done = (value: any) => Promise.resolve(value);
      factory(tui, theme, kb, done);
      const options = ["Allow once", "Deny"];
      const choice = opts.pick ? opts.pick(options) : null;
      return Promise.resolve(choice);
    });
  const ctx = { hasUI: opts.hasUI ?? true, ui: { notify, select, custom } };

  return { ctx, notify, select, custom };
}
```

Ergänze einen neuen Test-Suite-Block für das Keypress-Abfangen in `packages/pi-bash-approval/tests/bash-approval.spec.ts`:

```typescript
  describe("TUI Prompt - custom select dialog and ctrl+r", () => {
    it("handles selection using SelectList and intercepts ctrl+r keypress", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      let receivedOptions: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          receivedOptions = options;
          return "Allow once";
        },
      });

      const result = await toolCallHandler!(bashEvent("whoami"), ctx);
      expect(result).toBeUndefined();
      expect(receivedOptions).toContain("Allow once");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: PASS (da `custom` bereits im Mock integriert ist und standardmäßig mit `opts.pick` auflöst)

- [ ] **Step 3: Write custom Select-List prompt with `DynamicBorder` import from `@earendil-works/pi-coding-agent`**

Importiere `matchesKey`, `Container`, `SelectList`, `Text` von `@earendil-works/pi-tui` und `DynamicBorder` von `@earendil-works/pi-coding-agent` in `packages/pi-bash-approval/extensions/index.ts`.

Schreibe die Funktion `resolveLocalDecision` in `packages/pi-bash-approval/extensions/index.ts` so um, dass sie ein `ctx.ui.custom`-Overlay startet:

```typescript
import {
  Container,
  matchesKey,
  SelectList,
  Text,
} from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";

async function resolveLocalDecision(
  promptOptions: readonly string[],
  rulesByOption: Record<string, string>,
  ctx: any,
  command: string,
  failingSegment: string,
  isAlreadyResolved: () => boolean,
): Promise<BashDecision | null> {
  const items = promptOptions.map((opt) => ({ value: opt, label: opt }));

  const choice = await ctx.ui.custom(
    (tui: any, theme: any, _kb: any, done: (val: any) => void) => {
      const container = new Container();

      // Top Border (DynamicBorder aus pi-coding-agent)
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      // Header
      container.addChild(
        new Text(
          theme.fg(
            "accent",
            theme.bold("Bash command not on allow-list:\n"),
          ) + theme.fg("text", command),
          1,
          0,
        ),
      );
      container.addChild(
        new Text(
          theme.fg("warning", `First failing segment: `) +
            theme.fg("text", failingSegment),
          1,
          0,
        ),
      );

      // SelectList
      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      });
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      // Help Text mit neuem Shortcut
      container.addChild(
        new Text(
          theme.fg(
            "dim",
            "↑↓ navigate • enter select • ctrl+r enter regex • esc cancel",
          ),
          1,
          0,
        ),
      );

      // Bottom Border
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          if (matchesKey(data, "ctrl+r")) {
            done("__ctrl_r__");
          } else {
            selectList.handleInput(data);
            tui.requestRender();
          }
        },
      };
    },
  );

  if (isAlreadyResolved()) {
    return null;
  }

  if (choice === "__ctrl_r__") {
    return {
      selectedBy: "local",
      decision: { action: "allow_always", rule: "__ctrl_r__" },
      choice: "__ctrl_r__",
    };
  }

  if (!choice || choice === DENY) {
    return {
      selectedBy: "local",
      decision: { action: "deny", reason: BLOCKED_BY_USER },
      choice: choice ?? undefined,
    };
  }

  const rule = rulesByOption[choice];
  if (rule) {
    return {
      selectedBy: "local",
      decision: { action: "allow_always", rule },
      choice,
    };
  }

  return {
    selectedBy: "local",
    decision: { action: "allow_once" },
    choice,
  };
}
```

Aktualisiere den Aufruf von `resolveLocalDecision` in `packages/pi-bash-approval/extensions/index.ts`:

```typescript
        void resolveLocalDecision(
          prompt.options,
          prompt.rulesByOption,
          ctx,
          command,
          failingSegment,
          controller.isSettled,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/extensions/index.ts
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "feat(bash-approval): use SelectList component for custom local prompt with ctrl+r hook"
```

---

### Task 3: Regex-Eingabe, Loopback, Validierung, Duplikatausschluss und Remote-Kompatibilität

**Files:**
- Modify: `packages/pi-bash-approval/extensions/index.ts`
- Test: `packages/pi-bash-approval/tests/bash-approval.spec.ts`

- [ ] **Step 1: Write the failing tests with `appendFileSync` and exact mock regex input assertions**

Füge folgende Tests in `packages/pi-bash-approval/tests/bash-approval.spec.ts` hinzu:

```typescript
    it("opens a custom regex input pre-filled with the scoped recommendation on ctrl+r", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const inputMock = jest.fn<any>().mockResolvedValue("r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status$");
      const notifyMock = jest.fn();
      
      const ctx = {
        hasUI: true,
        ui: {
          custom: jest.fn<any>().mockResolvedValue("__ctrl_r__"),
          input: inputMock,
          notify: notifyMock,
          theme: { fg: (c: string, t: string) => t, bold: (t: string) => t },
        },
      };

      const result = await toolCallHandler!(bashEvent("git -C /tmp/foo status"), ctx as any);
      expect(result).toBeUndefined();
      expect(inputMock).toHaveBeenCalledWith(
        "Verbesserte/Eigene Regex eingeben:",
        expect.stringContaining("status$"),
      );
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        ALLOW_LIST_PATH,
        "r:^git -C (?:\"[^\"]+\"|'[^']+'|\\S+) status$\n",
        "utf8",
      );
    });

    it("automatically prepends r: prefix if omitted by user", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const inputMock = jest.fn<any>().mockResolvedValue("^git status$");
      
      const ctx = {
        hasUI: true,
        ui: {
          custom: jest.fn<any>().mockResolvedValue("__ctrl_r__"),
          input: inputMock,
          notify: jest.fn(),
          theme: { fg: (c: string, t: string) => t, bold: (t: string) => t },
        },
      };

      await toolCallHandler!(bashEvent("git status"), ctx as any);
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        ALLOW_LIST_PATH,
        "r:^git status$\n",
        "utf8",
      );
    });

    it("guards against compiling invalid regex and restarts the dialog loop", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const inputMock = jest.fn<any>()
        .mockResolvedValueOnce("r:^git [a-z$") // Invalid
        .mockResolvedValueOnce(null); // Cancel/Escape
      
      const notifyMock = jest.fn();
      const customMock = jest.fn<any>()
        .mockResolvedValueOnce("__ctrl_r__") // First call triggers ctrl+r
        .mockResolvedValueOnce("__ctrl_r__") // Loop back triggers ctrl+r
        .mockResolvedValueOnce("Deny"); // Fallback end

      const ctx = {
        hasUI: true,
        ui: {
          custom: customMock,
          input: inputMock,
          notify: notifyMock,
          theme: { fg: (c: string, t: string) => t, bold: (t: string) => t },
        },
      };

      const result = await toolCallHandler!(bashEvent("git status"), ctx as any);
      expect(result).toMatchObject({ block: true });
      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining("Ungültige Regex:"),
        "error",
      );
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it("prevents writing duplicate rules to allow-list", async () => {
      const { toolCallHandler, fs } = setup({
        configFile: JSON.stringify({ allowed: ["r:^git status$"] }),
      });
      const inputMock = jest.fn<any>().mockResolvedValue("r:^git status$");
      
      const ctx = {
        hasUI: true,
        ui: {
          custom: jest.fn<any>().mockResolvedValue("__ctrl_r__"),
          input: inputMock,
          notify: jest.fn(),
          theme: { fg: (c: string, t: string) => t, bold: (t: string) => t },
        },
      };

      await toolCallHandler!(bashEvent("git status"), ctx as any);
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: FAIL (Compile-Fehler)

- [ ] **Step 3: Implement local loopback and persistRule encapsulation while keeping controller.promise**

Importiere `suggestRegexPattern`, `persistRule` und `ALLOW_LIST_PATH` aus `./utils` in `packages/pi-bash-approval/extensions/index.ts`.

Schreibe den `tool_call` Event-Handler so um, dass er die `controller`-Zustandsmaschine beibehält, aber die lokale Promptermittlung in einer asynchronen, loopbaren Funktion kapselt. Das garantiert 100%ige Kompatibilität mit asynchronen Remote-Responses:

```typescript
import { suggestRegexPattern, persistRule, ALLOW_LIST_PATH } from "./utils";

// ... inside pi.on("tool_call") ...
    const prompt = buildPromptOptions(trimmedCommand, failingSegment, config);
    const options = buildEventOptions(prompt.options, prompt.rulesByOption);
    const requestBase = {
      requestId: randomUUID(),
      plugin: PLUGIN_NAME,
      kind: "bash_approval",
      toolCallId,
      cwd,
      createdAt,
    } as const;
    const controller = createController<BashDecision>();
    const localPromptAbort = new AbortController();
    let closedReason: BashApprovalClosedEvent["reason"] = "resolved";

    const requestEvent: BashApprovalRequestEvent = {
      ...requestBase,
      command,
      trimmedCommand,
      failingSegment,
      options,
      respond: (response) =>
        respondToBashApproval(response, options, controller, localPromptAbort),
    };

    try {
      emitSafe(pi, "pi-bash-approval:request", requestEvent);

      // Lokale Interaktion kapseln und loopbar machen (Zustandsmaschine)
      const resolveLocalLoop = async (): Promise<BashDecision | null> => {
        let loopDialog = true;
        let localDecision: BashDecision | null = null;

        while (loopDialog && !controller.isSettled()) {
          localDecision = await resolveLocalDecision(
            prompt.options,
            prompt.rulesByOption,
            ctx,
            command,
            failingSegment,
            controller.isSettled,
          );

          if (
            localDecision &&
            localDecision.decision.action === "allow_always" &&
            localDecision.decision.rule === "__ctrl_r__"
          ) {
            // Regex Custom Input Mode
            const recommended = suggestRegexPattern(command);
            const inputRegex = await ctx.ui.input(
              "Verbesserte/Eigene Regex eingeben:",
              recommended,
            );

            if (inputRegex === null || inputRegex === undefined || inputRegex.trim() === "") {
              // Escape/Cancel: Loop zurück zum Select-Dialog
              continue;
            }

            let customRegex = inputRegex.trim();
            if (!customRegex.startsWith("r:")) {
              customRegex = `r:${customRegex}`;
            }

            try {
              // Validierung mittels new RegExp auf den reinen Regex-Körper (ohne r:)
              const regexBody = customRegex.slice(2).trim();
              new RegExp(regexBody);

              // Persistierung über die zentrale persistRule Utility-Funktion
              const persistResult = persistRule(config, customRegex, ctx);

              if (persistResult.success) {
                const rulePersistedEvent: BashApprovalRulePersistedEvent = {
                  plugin: PLUGIN_NAME,
                  requestId: requestBase.requestId,
                  toolCallId,
                  rule: customRegex,
                  path: ALLOW_LIST_PATH,
                  success: true,
                  createdAt: new Date().toISOString(),
                };
                emitSafe(pi, "pi-bash-approval:rule_persisted", rulePersistedEvent);
              }

              localDecision = {
                selectedBy: "local",
                decision: { action: "allow_always", rule: customRegex },
                choice: customRegex,
              };
              loopDialog = false;
            } catch (err: any) {
              ctx.ui.notify(`Ungültige Regex: ${err.message}`, "error");
              continue;
            }
          } else {
            loopDialog = false;
          }
        }
        return localDecision;
      };

      if (!controller.isSettled()) {
        void resolveLocalLoop().then(
          (decision) => {
            if (decision) {
              controller.accept(decision);
            }
          },
          (error: unknown) => {
            controller.fail(error);
          },
        );
      }

      const bashDecision = await controller.promise;
```

- [ ] **Step 4: Run tests to verify they pass**

Führe aus:
`npm --prefix /Users/gredig/Privat/workspaces/opensource/pi-extensions run test packages/pi-bash-approval/tests/bash-approval.spec.ts`

Erwartet: PASS (Alle 199 Tests im gesamten pi-extensions Monorepo sind erfolgreich!)

- [ ] **Step 5: Commit**

```bash
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions add packages/pi-bash-approval/extensions/index.ts
git -C /Users/gredig/Privat/workspaces/opensource/pi-extensions commit -m "feat(bash-approval): complete robust regex input flow with remote controller compatibility and test coverage"
```
