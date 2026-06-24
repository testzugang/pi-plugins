import type { Focusable, Theme, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { slugify } from "./naming.ts";

export interface HandoffOptions {
  goal: string;
  targetModel: string;
  sessionName: string;
  manualReferences: string;
  saveHandoff: boolean;
}

enum OptionsRow {
  Goal = 0,
  TargetModel = 1,
  SessionName = 2,
  References = 3,
  SaveHandoff = 4,
  GenerateButton = 5,
  CancelButton = 6
}

enum PreviewRow {
  Editor = 0,
  ConfirmButton = 1,
  BackButton = 2
}

export class HandoffOverlayComponent implements Focusable {
  readonly width = 74;
  focused = false;

  // phase: "options" | "loading" | "preview"
  private phase: "options" | "loading" | "preview" = "options";

  private selectedRow = 0;
  private goal: string;
  private targetModelIndex = 0;
  private sessionName: string;
  private manualReferences = "";
  private saveHandoff = false;

  private availableModels: string[];
  private theme: Theme;
  private ctx: ExtensionCommandContext;
  private tui: any; // Pi TUI Framework instance
  private done: (result: { options: HandoffOptions, prompt?: string } | undefined) => void;

  // Async generation hook with support for AbortSignal
  public onGenerate?: (options: HandoffOptions, signal: AbortSignal) => Promise<string | null>;
  private abortController = new AbortController();

  // Cursors for the text inputs in options phase
  private goalCursor = 0;
  private sessionNameCursor = 0;
  private referencesCursor = 0;

  // Preview Phase state (Single Source of Truth is previewLines)
  private previewLines: string[] = [];
  private previewCursorRow = 0;
  private previewCursorCol = 0;
  private previewScrollOffset = 0;

  constructor(
    ctx: ExtensionCommandContext,
    tui: any,
    initialGoal: string,
    availableModels: string[],
    done: (result: { options: HandoffOptions, prompt?: string } | undefined) => void
  ) {
    this.ctx = ctx;
    this.theme = ctx.ui.theme;
    this.tui = tui;
    this.goal = initialGoal || "Start the next step from this handoff";
    this.goalCursor = this.goal.length;
    this.sessionName = `handoff-${slugify(this.goal).slice(0, 30)}`;
    this.sessionNameCursor = this.sessionName.length;
    this.availableModels = availableModels;
    this.done = done;
  }

  public setGeneratedPrompt(prompt: string) {
    this.previewLines = prompt.split("\n");
    this.previewCursorRow = 0;
    this.previewCursorCol = 0;
    this.previewScrollOffset = 0;
    this.phase = "preview";
    this.selectedRow = PreviewRow.Editor; // Focus on the prompt editor
  }

  private pad(s: string, len: number): string {
    const vis = visibleWidth(s);
    return s + " ".repeat(Math.max(0, len - vis));
  }

  private row(th: Theme, content: string): string {
    const innerW = this.width - 2;
    return th.fg("border", "│") + this.pad(content, innerW) + th.fg("border", "│");
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.abortController.abort();
      this.done(undefined);
      return;
    }

    if (this.phase === "options") {
      this.handleOptionsInput(data);
    } else if (this.phase === "preview") {
      this.handlePreviewInput(data);
    }
  }

  private handleOptionsInput(data: string) {
    if (matchesKey(data, "return")) {
      if (this.selectedRow === OptionsRow.GenerateButton) { // "Generate" button
        const opts: HandoffOptions = {
          goal: this.goal,
          targetModel: this.availableModels[this.targetModelIndex] || "anthropic/claude-3-5-sonnet",
          sessionName: this.sessionName,
          manualReferences: this.manualReferences,
          saveHandoff: this.saveHandoff,
        };

        if (this.onGenerate) {
          this.phase = "loading";
          this.invalidate();

          this.onGenerate(opts, this.abortController.signal)
            .then((prompt) => {
              if (prompt && !this.abortController.signal.aborted) {
                this.setGeneratedPrompt(prompt);
              } else {
                this.phase = "options";
              }
              this.invalidate();
            })
            .catch((err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              this.ctx.ui.notify(`Prompt generation failed: ${errorMsg}`, "error");
              this.phase = "options";
              this.invalidate();
            });
        } else {
          this.done({ options: opts });
        }
      } else if (this.selectedRow === OptionsRow.CancelButton) { // "Cancel" button
        this.done(undefined);
      } else {
        // Move cursor to next input row
        this.selectedRow = Math.min(OptionsRow.CancelButton, this.selectedRow + 1);
      }
      return;
    }

    if (matchesKey(data, "up")) {
      this.selectedRow = Math.max(OptionsRow.Goal, this.selectedRow - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedRow = Math.min(OptionsRow.CancelButton, this.selectedRow + 1);
      return;
    }

    if (this.selectedRow === OptionsRow.Goal) {
      this.handleTextInput("goal", data);
      this.sessionName = `handoff-${slugify(this.goal).slice(0, 30)}`;
      this.sessionNameCursor = this.sessionName.length;
    } else if (this.selectedRow === OptionsRow.TargetModel) { // Target Model select
      if (this.availableModels.length > 0 && (matchesKey(data, "left") || matchesKey(data, "right"))) {
        const dir = matchesKey(data, "left") ? -1 : 1;
        this.targetModelIndex = (this.targetModelIndex + dir + this.availableModels.length) % this.availableModels.length;
      }
    } else if (this.selectedRow === OptionsRow.SessionName) {
      this.handleTextInput("sessionName", data);
    } else if (this.selectedRow === OptionsRow.References) {
      this.handleTextInput("references", data);
    } else if (this.selectedRow === OptionsRow.SaveHandoff) {
      if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, " ")) {
        this.saveHandoff = !this.saveHandoff;
      }
    }
  }

  private handlePreviewInput(data: string) {
    if (this.selectedRow === PreviewRow.Editor) { // Text editor focus
      if (matchesKey(data, "down")) {
        if (this.previewCursorRow < this.previewLines.length - 1) {
          this.previewCursorRow++;
          this.previewCursorCol = Math.min(this.previewCursorCol, this.previewLines[this.previewCursorRow]!.length);
          if (this.previewCursorRow - this.previewScrollOffset >= 8) {
            this.previewScrollOffset++;
          }
        } else {
          // Move focus to action buttons below
          this.selectedRow = PreviewRow.ConfirmButton;
        }
        return;
      }
      if (matchesKey(data, "up")) {
        if (this.previewCursorRow > 0) {
          this.previewCursorRow--;
          this.previewCursorCol = Math.min(this.previewCursorCol, this.previewLines[this.previewCursorRow]!.length);
          if (this.previewCursorRow < this.previewScrollOffset) {
            this.previewScrollOffset = this.previewCursorRow;
          }
        }
        return;
      }
      if (matchesKey(data, "left")) {
        if (this.previewCursorCol > 0) {
          this.previewCursorCol--;
        } else if (this.previewCursorRow > 0) {
          this.previewCursorRow--;
          this.previewCursorCol = this.previewLines[this.previewCursorRow]!.length;
        }
        return;
      }
      if (matchesKey(data, "right")) {
        if (this.previewCursorCol < this.previewLines[this.previewCursorRow]!.length) {
          this.previewCursorCol++;
        } else if (this.previewCursorRow < this.previewLines.length - 1) {
          this.previewCursorRow++;
          this.previewCursorCol = 0;
        }
        return;
      }

      // Editing prompt text
      const currentLine = this.previewLines[this.previewCursorRow]!;
      if (matchesKey(data, "backspace")) {
        if (this.previewCursorCol > 0) {
          this.previewLines[this.previewCursorRow] = currentLine.slice(0, this.previewCursorCol - 1) + currentLine.slice(this.previewCursorCol);
          this.previewCursorCol--;
        } else if (this.previewCursorRow > 0) {
          const prevLine = this.previewLines[this.previewCursorRow - 1]!;
          this.previewCursorCol = prevLine.length;
          this.previewLines[this.previewCursorRow - 1] = prevLine + currentLine;
          this.previewLines.splice(this.previewCursorRow, 1);
          this.previewCursorRow--;
        }
      } else if (matchesKey(data, "return")) {
        const before = currentLine.slice(0, this.previewCursorCol);
        const after = currentLine.slice(this.previewCursorCol);
        this.previewLines[this.previewCursorRow] = before;
        this.previewLines.splice(this.previewCursorRow + 1, 0, after);
        this.previewCursorRow++;
        this.previewCursorCol = 0;
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.previewLines[this.previewCursorRow] = currentLine.slice(0, this.previewCursorCol) + data + currentLine.slice(this.previewCursorCol);
        this.previewCursorCol++;
      }
    } else {
      // Button focus below text editor
      if (matchesKey(data, "up")) {
        this.selectedRow = PreviewRow.Editor;
        return;
      }
      if (matchesKey(data, "left") || matchesKey(data, "right")) {
        this.selectedRow = this.selectedRow === PreviewRow.ConfirmButton ? PreviewRow.BackButton : PreviewRow.ConfirmButton;
        return;
      }
      if (matchesKey(data, "return")) {
        if (this.selectedRow === PreviewRow.ConfirmButton) { // Confirm & Switch
          this.done({
            options: {
              goal: this.goal,
              targetModel: this.availableModels[this.targetModelIndex]!,
              sessionName: this.sessionName,
              manualReferences: this.manualReferences,
              saveHandoff: this.saveHandoff,
            },
            prompt: this.previewLines.join("\n"),
          });
        } else { // Back to options
          this.phase = "options";
          this.selectedRow = OptionsRow.Goal;
        }
      }
    }
  }

  private handleTextInput(field: "goal" | "sessionName" | "references", data: string) {
    let text = field === "goal" ? this.goal : field === "sessionName" ? this.sessionName : this.manualReferences;
    let cursor = field === "goal" ? this.goalCursor : field === "sessionName" ? this.sessionNameCursor : this.referencesCursor;

    // Hard Input Limits for Buffer Security
    const maxLen = field === "references" ? 500 : 120;

    if (matchesKey(data, "backspace")) {
      if (cursor > 0) {
        text = text.slice(0, cursor - 1) + text.slice(cursor);
        cursor--;
      }
    } else if (matchesKey(data, "left")) {
      cursor = Math.max(0, cursor - 1);
    } else if (matchesKey(data, "right")) {
      cursor = Math.min(text.length, cursor + 1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      if (text.length < maxLen) {
        text = text.slice(0, cursor) + data + text.slice(cursor);
        cursor++;
      }
    }

    if (field === "goal") {
      this.goal = text;
      this.goalCursor = cursor;
    } else if (field === "sessionName") {
      this.sessionName = text;
      this.sessionNameCursor = cursor;
    } else {
      this.manualReferences = text;
      this.referencesCursor = cursor;
    }
  }

  render(_width: number): string[] {
    const th = this.theme;
    if (this.phase === "options") return this.renderOptions(th);
    if (this.phase === "loading") return this.renderLoading(th);
    return this.renderPreview(th);
  }

  private renderOptions(th: Theme): string[] {
    const innerW = this.width - 2;
    const lines: string[] = [];

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(this.row(th, ` ${th.bold(th.fg("accent", "🤝 Create New Handoff Session"))}`));
    lines.push(this.row(th, ""));

    const renderInputField = (label: string, value: string, cursor: number, isSelected: boolean) => {
      const prefix = isSelected ? " ▶ " : "   ";
      const labelStr = isSelected ? th.fg("accent", this.pad(`${label}:`, 18)) : th.fg("text", this.pad(`${label}:`, 18));
      
      // Horizontal Scrolling / Truncation for Layout Protection (44 chars limit)
      let valueDisplay = value;
      let renderCursor = cursor;
      if (valueDisplay.length > 44) {
        const start = Math.max(0, cursor - 40);
        valueDisplay = (start > 0 ? "..." : "") + valueDisplay.slice(start, start + 40);
        renderCursor = cursor - start + (start > 0 ? 3 : 0);
      }

      if (isSelected) {
        const before = valueDisplay.slice(0, renderCursor);
        const cursorChar = renderCursor < valueDisplay.length ? valueDisplay[renderCursor] : " ";
        const after = valueDisplay.slice(renderCursor + 1);
        const marker = this.focused ? CURSOR_MARKER : "";
        // Theme-aware Accent Cursor-Highlight (prevents hardcoded ANSI escape codes)
        valueDisplay = before + marker + th.bold(th.fg("accent", cursorChar)) + after;
      } else {
        valueDisplay = th.fg("dim", value.length > 44 ? value.slice(0, 41) + "..." : value || "(empty)");
      }
      return this.row(th, `${prefix}${labelStr} ${valueDisplay}`);
    };

    lines.push(renderInputField("Goal", this.goal, this.goalCursor, this.selectedRow === OptionsRow.Goal));

    // Model selection with truncation support
    const rawModel = this.availableModels[this.targetModelIndex] || "None configured";
    const activeModel = rawModel.length > 44 ? rawModel.slice(0, 41) + "..." : rawModel;
    const modelPrefix = this.selectedRow === OptionsRow.TargetModel ? " ▶ " : "   ";
    const modelLabel = this.selectedRow === OptionsRow.TargetModel ? th.fg("accent", this.pad("Target Model:", 18)) : th.fg("text", this.pad("Target Model:", 18));
    const modelVal = this.selectedRow === OptionsRow.TargetModel ? `◀ ${th.fg("success", activeModel)} ▶` : th.fg("dim", activeModel);
    lines.push(this.row(th, `${modelPrefix}${modelLabel} ${modelVal}`));

    lines.push(renderInputField("Session Name", this.sessionName, this.sessionNameCursor, this.selectedRow === OptionsRow.SessionName));
    lines.push(renderInputField("References", this.manualReferences, this.referencesCursor, this.selectedRow === OptionsRow.References));

    const savePrefix = this.selectedRow === OptionsRow.SaveHandoff ? " ▶ " : "   ";
    const saveLabel = this.selectedRow === OptionsRow.SaveHandoff ? th.fg("accent", this.pad("Save Handoff File:", 18)) : th.fg("text", this.pad("Save Handoff File:", 18));
    const toggleVal = this.saveHandoff ? th.fg("success", "[X] Yes") : th.fg("muted", "[ ] No (Draft only)");
    lines.push(this.row(th, `${savePrefix}${saveLabel} ${toggleVal}`));

    lines.push(this.row(th, ""));
    
    // Theme-safe button rendering (no hardcoded ANSI escape codes)
    const btnGen = this.selectedRow === OptionsRow.GenerateButton 
      ? th.bold(th.fg("success", "[ Generate Handoff Prompt ]")) 
      : th.fg("accent", "[ Generate Handoff Prompt ]");
    const btnCancel = this.selectedRow === OptionsRow.CancelButton 
      ? th.bold(th.fg("success", "[ Cancel ]")) 
      : th.fg("muted", "[ Cancel ]");
      
    lines.push(this.row(th, `   ${btnGen}     ${btnCancel}`));
    lines.push(this.row(th, ""));
    lines.push(this.row(th, ` ${th.fg("dim", "↑↓ navigate • type to edit • ←→ select option • Enter confirm • Esc exit")}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  private renderLoading(th: Theme): string[] {
    const innerW = this.width - 2;
    const lines: string[] = [];

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(this.row(th, ` ${th.bold(th.fg("accent", "🤝 Generating Handoff Prompt"))}`));
    lines.push(this.row(th, ""));
    lines.push(this.row(th, "  Please wait while the active model condenses conversation context..."));
    lines.push(this.row(th, ""));
    lines.push(this.row(th, "  [ ⏳ Generating Prompt Text... ]"));
    lines.push(this.row(th, ""));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  private renderPreview(th: Theme): string[] {
    const innerW = this.width - 2;
    const lines: string[] = [];

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(this.row(th, ` ${th.bold(th.fg("accent", "📝 Edit Generated Prompt Preview"))}`));
    lines.push(this.row(th, ""));

    // Render 8 lines of scrollable prompt text box
    lines.push(this.row(th, th.fg("dim", "┌─ Prompt Text Editor ───────────────────────────────────────────────┐")));
    for (let i = 0; i < 8; i++) {
      const lineIndex = this.previewScrollOffset + i;
      const lineText = this.previewLines[lineIndex] ?? "";
      const isEditorSelected = this.selectedRow === PreviewRow.Editor;
      const isCurrentLine = isEditorSelected && lineIndex === this.previewCursorRow;

      let displayVal = lineText.slice(0, innerW - 4);
      if (isCurrentLine) {
        const col = this.previewCursorCol;
        const before = displayVal.slice(0, col);
        const cursorChar = col < displayVal.length ? displayVal[col] : " ";
        const after = displayVal.slice(col + 1);
        const marker = this.focused ? CURSOR_MARKER : "";
        displayVal = before + marker + th.bold(th.fg("accent", cursorChar)) + after;
      }
      lines.push(th.fg("border", "│") + "  " + displayVal + " ".repeat(Math.max(0, innerW - 4 - visibleWidth(lineText))) + "  " + th.fg("border", "│"));
    }
    lines.push(this.row(th, th.fg("dim", "└────────────────────────────────────────────────────────────────────┘")));
    lines.push(this.row(th, ""));

    const btnConfirm = this.selectedRow === PreviewRow.ConfirmButton 
      ? th.bold(th.fg("success", "[ Confirm & Switch ]")) 
      : th.fg("accent", "[ Confirm & Switch ]");
    const btnBack = this.selectedRow === PreviewRow.BackButton 
      ? th.bold(th.fg("success", "[ Back to Options ]")) 
      : th.fg("muted", "[ Back to Options ]");
      
    lines.push(this.row(th, `   ${btnConfirm}     ${btnBack}`));
    lines.push(this.row(th, ""));
    lines.push(this.row(th, ` ${th.fg("dim", "↑↓ navigate/edit prompt • Enter on buttons to submit • Esc cancel")}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {
    // Request a render directly in the active TUI framework to prevent stale states on async transitions
    this.tui.requestRender?.();
  }
  dispose(): void {}
}
