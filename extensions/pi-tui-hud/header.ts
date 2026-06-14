import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readSettings } from './settings';
import { hexFg } from './utils';

export function generateGradientHeader(logoText: string, width: number): string {
  const fullLength = logoText.length + 4; // Includes '⚡ ' (2) and ' ⚡' (2)
  const paddingSize = Math.max(0, Math.floor((width - fullLength) / 2));
  const padding = ' '.repeat(paddingSize);

  // Custom secure gradient bar: Blue -> Cyan -> Purple
  const baseLogo = hexFg('#5fafd7', logoText);
  return `${padding}⚡ ${baseLogo} ⚡`;
}

export function registerHeader(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    const s = readSettings(ctx.cwd);
    if (!s.enabled || !s.header || !ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => {
      return {
        render(width: number): string[] {
          const infoLines: string[] = [generateGradientHeader('PI-TUI-HUD', width)];
          if (s['header-info']) {
            infoLines.push(theme.fg('dim', ` Model: ${ctx.model?.id || 'unknown'} | CWD: ${ctx.cwd}`));
          }
          return infoLines;
        },
      };
    });
  });
}
