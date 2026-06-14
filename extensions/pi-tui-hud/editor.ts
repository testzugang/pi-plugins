import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CustomEditor } from '@earendil-works/pi-coding-agent';
import { visibleWidth, truncateToWidth } from '@earendil-works/pi-tui';
import { getBreadcrumbData, renderBreadcrumbInfo } from './breadcrumb';
import { readSettings } from './settings';

let currentTheme: any = null;
let breadcrumbMode = 'inner';
let liveCtx: ExtensionContext | null = null;
let liveEditorTui: any = null;

export class HudCustomEditor extends CustomEditor {
  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) return lines;

    const result = [...lines];

    if (breadcrumbMode === 'inner' && liveCtx && currentTheme) {
      const data = getBreadcrumbData(liveCtx);
      const infoPart = renderBreadcrumbInfo(data, currentTheme);
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
        const borderChar = currentTheme.fg('borderAccent', '─');
        const leftBracket = currentTheme.fg('borderAccent', '┤');
        const rightBracket = currentTheme.fg('borderAccent', '├');
        const leftCorner = currentTheme.fg('borderAccent', '┌');
        const rightCorner = currentTheme.fg('borderAccent', '┐');
        result[0] = leftCorner + borderChar + leftBracket + ' ' + displayInfo + ' ' + rightBracket + borderChar.repeat(paddingLen) + rightCorner;
      }
    }

    return result;
  }
}

export function registerEditor(pi: ExtensionAPI) {
  let editorEnabled = false;

  function enable(ctx: ExtensionContext) {
    editorEnabled = true;
    liveCtx = ctx;
    currentTheme = ctx.ui.theme;
    breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
    ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
      liveEditorTui = tui;
      return new HudCustomEditor(tui, theme, keybindings);
    });
  }

  function disable(ctx: ExtensionContext) {
    editorEnabled = false;
    liveCtx = null;
    currentTheme = null;
    liveEditorTui = null;
    ctx.ui.setEditorComponent(undefined);
  }

  pi.on('session_start', (_event, ctx) => {
    const s = readSettings(ctx.cwd);
    if (s.enabled) {
      enable(ctx);
    } else {
      disable(ctx);
    }
  });

  pi.on('model_select', (_event, ctx) => {
    if (editorEnabled) {
      liveCtx = ctx;
      breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
      liveEditorTui?.requestRender();
    }
  });

  pi.on('session_shutdown', (_event, ctx) => {
    if (editorEnabled) {
      disable(ctx);
    }
  });

  pi.events.on('hud_settings_changed', (ctx) => {
    const s = readSettings(ctx.cwd);
    if (s.enabled && !editorEnabled) {
      enable(ctx);
    } else if (!s.enabled && editorEnabled) {
      disable(ctx);
    } else if (editorEnabled) {
      liveCtx = ctx;
      breadcrumbMode = s.breadcrumb;
      liveEditorTui?.requestRender();
    }
  });
}
