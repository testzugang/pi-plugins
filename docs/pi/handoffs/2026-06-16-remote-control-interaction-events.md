# Remote Control Interaction Events for `pi-bash-approval` and `pi-user-select`

Date: 2026-06-16

## Context

A planned `pi-remote-control` extension should allow a paired smartphone in the local WLAN to observe and interact with active Pi sessions. The remote UI should support normal prompts, steering/follow-ups, aborts, and interactive decisions such as Bash approvals and `user_select` choices.

Current package versions inspected on 2026-06-16:

- `@fgladisch/pi-user-select@0.1.3`
  - Registers the `user_select` tool.
  - Calls `ctx.ui.select(...)` for option selection.
  - Calls `ctx.ui.input(...)` for custom answers.
- `@fgladisch/pi-bash-approval@0.2.6`
  - Handles Pi `tool_call` events for the `bash` tool.
  - Evaluates the command against the allow-list.
  - Calls `ctx.ui.select(...)` for manual approval when the command is not allow-listed.

Pi extensions already support inter-extension communication through `pi.events.emit(...)` / `pi.events.on(...)`.

## Desired Interaction Model

Both plugins should keep their existing local TUI behavior, but expose interaction lifecycle events so another extension can mirror and answer prompts remotely.

Core behavior:

- Local UI remains active.
- Remote UI may answer in parallel.
- The first valid answer wins.
- Later answers receive `already_resolved`.
- If no listener exists, behavior remains exactly as today.
- If a listener throws, local UI remains the fallback.
- Events should not persist data themselves; any logging is handled by the remote-control extension.

## Recommended Event Pattern

Request events should include a `respond()` callback, not just passive metadata.

```ts
type InteractionSource = "local" | "remote" | "system" | "timeout";

type RespondResult =
  | { accepted: true }
  | {
      accepted: false;
      reason: "already_resolved" | "expired" | "invalid_response";
    };

type InteractionBase = {
  requestId: string;
  plugin: "pi-user-select" | "pi-bash-approval";
  kind: "select" | "custom_input" | "bash_approval";
  toolCallId?: string;
  cwd?: string;
  createdAt: string;
  expiresAt?: string;
};
```

Example:

```ts
pi.events.emit("pi-user-select:request", {
  requestId,
  question,
  options,
  allowCustom,
  respond,
});
```

The plugin can then race local and remote answers:

```ts
const local = ctx.ui.select(question, displayOptions);
const remote = waitForRespondCallback(requestId);
const winner = await Promise.race([local, remote]);
```

## Events for `pi-user-select`

### MUST: `pi-user-select:request`

Emit immediately before opening the local `ctx.ui.select(...)` dialog.

```ts
type UserSelectRequestEvent = InteractionBase & {
  plugin: "pi-user-select";
  kind: "select";
  question: string;
  options: Array<{
    index: number;
    label: string;
    description?: string;
    displayLabel: string;
  }>;
  allowCustom: boolean;

  respond: (
    response: UserSelectResponse,
  ) => Promise<RespondResult> | RespondResult;
};

type UserSelectResponse =
  | {
      source: "remote";
      kind: "select";
      optionIndex: number;
    }
  | {
      source: "remote";
      kind: "custom";
      value: string;
    }
  | {
      source: "remote";
      kind: "cancel";
    };
```

Notes:

- Remote should be allowed to submit a custom value directly when `allowCustom=true`.
- The remote side should not have to trigger a second input request unless the plugin prefers a two-step flow internally.
- Use `optionIndex` as the stable selection identifier; labels are UI text.

### SHOULD: `pi-user-select:resolved`

Emit after the winning answer is known, regardless of whether it came from local UI or remote UI.

```ts
type UserSelectResolvedEvent = InteractionBase & {
  selectedBy: InteractionSource;
  result:
    | { kind: "select"; optionIndex: number; label: string }
    | { kind: "custom"; value: string }
    | { kind: "cancel" };
};
```

Purpose:

- Remote UI can close the dialog.
- Remote UI can show `answered locally` if the TUI won.

### SHOULD: `pi-user-select:closed`

Emit in `finally` when the request can no longer be answered.

```ts
type UserSelectClosedEvent = InteractionBase & {
  reason: "resolved" | "cancelled" | "error" | "session_shutdown";
};
```

### NICE: `pi-user-select:custom-input-request`

Only needed if the plugin wants to keep the custom-answer flow as two separate prompts.

```ts
type CustomInputRequestEvent = InteractionBase & {
  plugin: "pi-user-select";
  kind: "custom_input";
  question: string;
  respond: (
    response:
      | { source: "remote"; kind: "submit"; value: string }
      | { source: "remote"; kind: "cancel" },
  ) => Promise<RespondResult> | RespondResult;
};
```

### NICE: `pi-user-select:error`

```ts
type UserSelectErrorEvent = InteractionBase & {
  error: string;
};
```

## Events for `pi-bash-approval`

### SHOULD: `pi-bash-approval:evaluated`

Emit after allow-list evaluation, including auto-allowed commands.

```ts
type BashApprovalEvaluatedEvent = {
  plugin: "pi-bash-approval";
  toolCallId: string;
  cwd: string;
  command: string;
  trimmedCommand: string;
  allMatch: boolean;
  failingSegment?: string;
  splitChains: boolean;
  createdAt: string;
};
```

Purpose:

- Remote UI can show a complete bash timeline.
- Auto-allowed commands can be displayed as such.

### MUST: `pi-bash-approval:request`

Emit immediately before opening the local approval dialog.

```ts
type BashApprovalRequestEvent = InteractionBase & {
  plugin: "pi-bash-approval";
  kind: "bash_approval";
  toolCallId: string;
  cwd: string;

  command: string;
  trimmedCommand: string;
  failingSegment: string;

  options: Array<
    | {
        id: "allow_once";
        label: "Allow once";
        action: "allow_once";
      }
    | {
        id: string;
        label: string;
        action: "allow_always";
        rule: string;
      }
    | {
        id: "deny";
        label: "Deny";
        action: "deny";
      }
  >;

  respond: (
    response: BashApprovalResponse,
  ) => Promise<RespondResult> | RespondResult;
};

type BashApprovalResponse =
  | {
      source: "remote";
      action: "allow_once";
    }
  | {
      source: "remote";
      action: "allow_always";
      optionId: string;
      rule: string;
    }
  | {
      source: "remote";
      action: "deny";
      reason?: string;
    };
```

Notes:

- Use `optionId`, not label matching.
- Labels are presentation text and may change.
- `rule` should be included for `allow_always` so the remote UI can show exactly what will be persisted.

### MUST: `pi-bash-approval:resolved`

Emit after the winning decision is known.

```ts
type BashApprovalResolvedEvent = InteractionBase & {
  toolCallId: string;
  cwd: string;
  command: string;
  selectedBy: InteractionSource;
  decision:
    | { action: "allow_once" }
    | { action: "allow_always"; rule: string }
    | { action: "deny"; reason?: string };
};
```

### SHOULD: `pi-bash-approval:rule_persisted`

Emit when an `Allow always` rule is written to the allow-list.

```ts
type BashApprovalRulePersistedEvent = {
  plugin: "pi-bash-approval";
  requestId: string;
  toolCallId: string;
  rule: string;
  path: string; // ~/.pi/agent/.bash-approval
  success: boolean;
  error?: string;
  createdAt: string;
};
```

### SHOULD: `pi-bash-approval:blocked`

Emit when the bash tool call is blocked.

```ts
type BashApprovalBlockedEvent = {
  plugin: "pi-bash-approval";
  requestId?: string;
  toolCallId: string;
  cwd: string;
  command: string;
  reason: string;
  selectedBy?: InteractionSource;
  createdAt: string;
};
```

### SHOULD: `pi-bash-approval:allowed`

Emit when the bash tool call is allowed.

```ts
type BashApprovalAllowedEvent = {
  plugin: "pi-bash-approval";
  requestId?: string;
  toolCallId: string;
  cwd: string;
  command: string;
  mode: "allowlist" | "allow_once" | "allow_always";
  selectedBy?: InteractionSource;
  rule?: string;
  createdAt: string;
};
```

### SHOULD: `pi-bash-approval:closed`

Emit in `finally` when the approval request can no longer be answered.

```ts
type BashApprovalClosedEvent = InteractionBase & {
  toolCallId: string;
  reason: "resolved" | "cancelled" | "error" | "session_shutdown";
};
```

### NICE: Config and Reload Events

```ts
type BashApprovalConfigLoadedEvent = {
  plugin: "pi-bash-approval";
  allowedCount: number;
  splitChains: boolean;
  createdAt: string;
};

type BashApprovalReloadedEvent = {
  plugin: "pi-bash-approval";
  allowedCount: number;
  splitChains: boolean;
  source: "command" | "startup";
  createdAt: string;
};
```

Suggested names:

```text
pi-bash-approval:config_loaded
pi-bash-approval:reloaded
```

## Minimal Event Set

If only the smallest useful integration is possible, these four events are enough:

```text
pi-user-select:request
pi-user-select:resolved
pi-bash-approval:request
pi-bash-approval:resolved
```

## Preferred Complete Event Set

```text
pi-user-select:request
pi-user-select:resolved
pi-user-select:closed
pi-user-select:error
pi-user-select:custom-input-request

pi-bash-approval:evaluated
pi-bash-approval:request
pi-bash-approval:resolved
pi-bash-approval:rule_persisted
pi-bash-approval:blocked
pi-bash-approval:allowed
pi-bash-approval:closed
pi-bash-approval:config_loaded
pi-bash-approval:reloaded
```

## Security Notes

- Events may include commands and user-visible prompt text.
- The remote-control extension must apply redaction before forwarding data to mobile clients.
- The event-producing plugins should not persist prompt text, commands, or answers by default.
- Remote approvals and selections should be treated as user actions and surfaced clearly in follow-up events through `selectedBy: "remote"`.
- If a remote response arrives after local resolution, `respond()` must reject it with `already_resolved`.
