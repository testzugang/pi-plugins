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
    const contentWidth = Math.max(1, width - 2);
    const lines = super.render(contentWidth);
    if (lines.length < 3) return lines;

    const result = [...lines];

    if (breadcrumbMode === 'inner' && liveCtx && currentTheme) {
      const data = getBreadcrumbData(liveCtx);
      const infoPart = renderBreadcrumbInfo(data, currentTheme);
      const infoWidth = visibleWidth(infoPart);

      let paddingLen = width - 3 - infoWidth;
      let displayInfo = infoPart;

      if (paddingLen < 2) {
        const minDashes = 2;
        const availForInfo = width - 3 - minDashes;
        if (availForInfo > 0) {
          displayInfo = truncateToWidth(infoPart, availForInfo, '...');
          paddingLen = width - 3 - visibleWidth(displayInfo);
        }
      }

      if (paddingLen >= 0) {
        const borderChar = currentTheme.fg('borderAccent', '─');
        result[0] = borderChar + ' ' + displayInfo + ' ' + currentTheme.fg('borderAccent', '─'.repeat(paddingLen));
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

  pi.on('session_start', (_event, ctx) => {
    const s = readSettings(ctx.cwd);
    if (s.enabled) {
      enable(ctx);
    }
  });

  pi.on('model_select', (_event, ctx) => {
    liveCtx = ctx;
    breadcrumbMode = readSettings(ctx.cwd).breadcrumb;
    liveEditorTui?.requestRender();
  });
}
