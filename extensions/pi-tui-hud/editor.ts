import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { visibleWidth, truncateToWidth, Text } from '@earendil-works/pi-tui';
import { getBreadcrumbData, renderBreadcrumbInfo } from './breadcrumb';
import { readSettings } from './settings';
import { isExtensionContext } from './utils';

let currentTheme: any = null;
let breadcrumbMode = 'inner';
let liveCtx: ExtensionContext | null = null;
let liveEditorTui: any = null;
let liveThinkingLevel = 'off';

export class HudCustomEditor extends CustomEditor {
  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) return lines;

    const result = [...lines];
    const theme = liveCtx?.ui?.theme || currentTheme;

    if (breadcrumbMode === 'inner' && liveCtx && theme) {
      const data = getBreadcrumbData(liveCtx, liveThinkingLevel);
      const infoPart = renderBreadcrumbInfo(data, theme);
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

  function updateTopWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI || !ctx.ui) return;
    const s = readSettings(ctx.cwd);
    if (s.enabled && s.breadcrumb === 'top') {
      ctx.ui.setWidget('hud-breadcrumb-widget', (tui, theme) => {
        const data = getBreadcrumbData(ctx, liveThinkingLevel);
        return new Text(renderBreadcrumbInfo(data, theme), 0, 0);
      }, { placement: 'aboveEditor' });
    } else {
      ctx.ui.setWidget('hud-breadcrumb-widget', undefined);
    }
  }

  function enable(ctx: ExtensionContext) {
    editorEnabled = true;
    liveCtx = ctx;
    liveThinkingLevel = pi.getThinkingLevel() || 'off';
    currentTheme = ctx.ui.theme;
    
    const s = readSettings(ctx.cwd);
    breadcrumbMode = s.breadcrumb;

    if (s.breadcrumb === 'inner') {
      ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
        liveEditorTui = tui;
        return new HudCustomEditor(tui, theme, keybindings);
      });
    } else {
      ctx.ui.setEditorComponent(undefined);
    }
    updateTopWidget(ctx);
  }

  function disable(ctx: ExtensionContext) {
    editorEnabled = false;
    liveCtx = null;
    liveThinkingLevel = 'off';
    currentTheme = null;
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
        liveCtx = changeCtx;
        liveThinkingLevel = pi.getThinkingLevel() || 'off';
        breadcrumbMode = updatedSettings.breadcrumb;
        
        if (updatedSettings.breadcrumb === 'inner') {
          changeCtx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
            liveEditorTui = tui;
            return new HudCustomEditor(tui, theme, keybindings);
          });
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
      liveCtx = ctx;
      liveThinkingLevel = pi.getThinkingLevel() || 'off';
      breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
      updateTopWidget(ctx);
      liveEditorTui?.requestRender();
    }
  });

  pi.on('thinking_level_select', (event, ctx) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    if (editorEnabled) {
      liveCtx = ctx;
      liveThinkingLevel = event.level || pi.getThinkingLevel() || 'off';
      breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
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
