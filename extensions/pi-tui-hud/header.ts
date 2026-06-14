import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readSettings } from './settings';
import { hexFg } from './utils';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

export function getGradientText(text: string, startHex: string, endHex: string): string {
  const start = parseHex(startHex);
  const end = parseHex(endHex);
  if (!start || !end) return text;

  let result = '';
  const steps = text.length;
  for (let i = 0; i < steps; i++) {
    const ratio = steps > 1 ? i / (steps - 1) : 0;
    const r = Math.round(start.r + ratio * (end.r - start.r));
    const g = Math.round(start.g + ratio * (end.g - start.g));
    const b = Math.round(start.b + ratio * (end.b - start.b));
    result += `\x1b[38;2;${r};${g};${b}m${text[i]}\x1b[39m`;
  }
  return result;
}

export function generateGradientHeader(logoText: string, width: number): string {
  const fullLength = logoText.length + 4; // Includes '⚡ ' (2) and ' ⚡' (2)
  const paddingSize = Math.max(0, Math.floor((width - fullLength) / 2));
  const padding = ' '.repeat(paddingSize);

  // Gradient bar: Pink (#d787af) -> Cyan (#00afaf)
  const baseLogo = getGradientText(logoText, '#d787af', '#00afaf');
  return `${padding}⚡ ${baseLogo} ⚡`;
}

export function registerHeader(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    const s = readSettings(ctx.cwd);
    if (!s.enabled || !ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => {
      return {
        render(width: number): string[] {
          const currentSettings = readSettings(ctx.cwd);
          if (!currentSettings.enabled || !currentSettings.header) {
            return [];
          }
          const infoLines: string[] = [generateGradientHeader('PI-TUI-HUD', width)];
          if (currentSettings['header-info']) {
            infoLines.push(theme.fg('dim', ` Model: ${ctx.model?.id || 'unknown'} | CWD: ${ctx.cwd}`));
          }
          return infoLines;
        },
      };
    });
  });
}
