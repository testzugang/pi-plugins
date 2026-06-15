import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { visibleWidth, truncateToWidth, Text } from '@earendil-works/pi-tui';
import { getBreadcrumbData, renderBreadcrumbInfo, type BreadcrumbData } from './breadcrumb';
import { readSettings, type HudSettings } from './settings';
import { isExtensionContext } from './utils';

export interface HudEditorState {
  breadcrumbData: BreadcrumbData | null;
  theme: Theme | null;
  breadcrumbMode: HudSettings['breadcrumb'];
  thinkingLevel: string;
}

let liveEditorTui: any = null;
let activeEditorState: HudEditorState | null = null;

function createEditorState(ctx: ExtensionContext, thinkingLevel: string, breadcrumbMode: HudSettings['breadcrumb']): HudEditorState {
  return {
    breadcrumbData: getBreadcrumbData(ctx, thinkingLevel),
    theme: ctx.ui?.theme ?? null,
    breadcrumbMode,
    thinkingLevel,
  };
}

export class HudCustomEditor extends CustomEditor {
  private readonly hudState: HudEditorState;

  constructor(tui: any, theme: any, keybindings: any, state: HudEditorState & { ctx?: ExtensionContext | null }) {
    super(tui, theme, keybindings);
    this.hudState = {
      ...state,
      breadcrumbData: state.breadcrumbData ?? getBreadcrumbData(state.ctx ?? null, state.thinkingLevel),
    };
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) return lines;

    const result = [...lines];
    const { breadcrumbData, theme, breadcrumbMode } = this.hudState;

    if (breadcrumbMode === 'inner' && breadcrumbData && theme) {
      const infoPart = renderBreadcrumbInfo(breadcrumbData, theme);
      const infoWidth = visibleWidth(infoPart);
      
      let paddingLen = width - 7 - infoWidth;
      let displayInfo = infoPart;

      if (paddingLen < 2) {
        const minDashes = 2;
        const availForInfo = width - 7 - minDashes;
        if (availForInfo > 0) {
          displayInfo = truncateToWidth(infoPart, availForInfo, '...');
          paddingLen = width - 7 - visibleWidth(displayInfo);
        }
      }

      if (paddingLen >= 0) {
        const borderChar = theme.fg('borderAccent', '─');
        const leftBracket = theme.fg('borderAccent', '┤');
        const rightBracket = theme.fg('borderAccent', '├');
        const leftCorner = theme.fg('borderAccent', '┌');
        const rightCorner = theme.fg('borderAccent', '┐');
        result[0] = leftCorner + borderChar + leftBracket + ' ' + displayInfo + ' ' + rightBracket + borderChar.repeat(paddingLen) + rightCorner;
      }
    }

    return result;
  }
}

export function registerEditor(pi: ExtensionAPI) {
  let editorEnabled = false;
  let unsubSettings: (() => void) | null = null;

  function currentThinkingLevel() {
    return pi.getThinkingLevel() || 'off';
  }

  function updateTopWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI || !ctx.ui) return;
    const s = readSettings(ctx.cwd);
    const thinkingLevel = activeEditorState?.thinkingLevel ?? currentThinkingLevel();
    if (s.enabled && s.breadcrumb === 'top') {
      ctx.ui.setWidget('hud-breadcrumb-widget', (_tui, theme) => {
        const data = getBreadcrumbData(ctx, thinkingLevel);
        return new Text(renderBreadcrumbInfo(data, theme), 0, 0);
      }, { placement: 'aboveEditor' });
    } else {
      ctx.ui.setWidget('hud-breadcrumb-widget', undefined);
    }
  }

  function setInnerEditor(ctx: ExtensionContext) {
    if (!activeEditorState) return;
    const capturedState = activeEditorState;
    ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
      liveEditorTui = tui;
      return new HudCustomEditor(tui, theme, keybindings, { ...capturedState, theme });
    });
  }

  function enable(ctx: ExtensionContext) {
    editorEnabled = true;
    const s = readSettings(ctx.cwd);
    activeEditorState = createEditorState(ctx, currentThinkingLevel(), s.breadcrumb);

    if (s.breadcrumb === 'inner') {
      setInnerEditor(ctx);
    } else {
      ctx.ui.setEditorComponent(undefined);
    }
    updateTopWidget(ctx);
  }

  function disable(ctx: ExtensionContext) {
    editorEnabled = false;
    activeEditorState = null;
    liveEditorTui = null;
    if (ctx && ctx.hasUI && ctx.ui) {
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setWidget('hud-breadcrumb-widget', undefined);
    }
  }

  pi.on('session_start', (_event, ctx) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    
    const s = readSettings(ctx.cwd);
    if (s.enabled) {
      enable(ctx);
    } else {
      disable(ctx);
    }

    if (unsubSettings) {
      unsubSettings();
    }

    unsubSettings = pi.events.on('hud_settings_changed', (changeCtx) => {
      if (!isExtensionContext(changeCtx)) return;
      
      const updatedSettings = readSettings(changeCtx.cwd);
      if (updatedSettings.enabled && !editorEnabled) {
        enable(changeCtx);
      } else if (!updatedSettings.enabled && editorEnabled) {
        disable(changeCtx);
      } else if (editorEnabled) {
        activeEditorState = createEditorState(changeCtx, currentThinkingLevel(), updatedSettings.breadcrumb);
        
        if (updatedSettings.breadcrumb === 'inner') {
          setInnerEditor(changeCtx);
        } else {
          changeCtx.ui.setEditorComponent(undefined);
          liveEditorTui = null;
        }
        
        updateTopWidget(changeCtx);
        liveEditorTui?.requestRender();
      }
    });
  });

  pi.on('model_select', (_event, ctx) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    if (editorEnabled) {
      const breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
      activeEditorState = createEditorState(ctx, currentThinkingLevel(), breadcrumbMode);
      if (breadcrumbMode === 'inner') {
        setInnerEditor(ctx);
      } else {
        ctx.ui.setEditorComponent(undefined);
        liveEditorTui = null;
      }
      updateTopWidget(ctx);
      liveEditorTui?.requestRender();
    }
  });

  pi.on('thinking_level_select', (event, ctx) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    if (editorEnabled) {
      const breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
      const thinkingLevel = event.level || currentThinkingLevel();
      activeEditorState = createEditorState(ctx, thinkingLevel, breadcrumbMode);
      if (breadcrumbMode === 'inner') {
        setInnerEditor(ctx);
      } else {
        ctx.ui.setEditorComponent(undefined);
        liveEditorTui = null;
      }
      updateTopWidget(ctx);
      liveEditorTui?.requestRender();
    }
  });

  pi.on('session_shutdown', (_event, ctx) => {
    if (!ctx) return;
    if (editorEnabled) {
      disable(ctx);
    }
    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }
  });
}
