import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { readSettings } from './settings';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
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
  // Use Intl.Segmenter for grapheme-cluster safe splitting (protects ZWJ, skin tones, etc.)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = Array.from(segmenter.segment(text)).map((s) => s.segment);
  const steps = segments.length;
  for (let i = 0; i < steps; i++) {
    const ratio = steps > 1 ? i / (steps - 1) : 0;
    const r = Math.round(start.r + ratio * (end.r - start.r));
    const g = Math.round(start.g + ratio * (end.g - start.g));
    const b = Math.round(start.b + ratio * (end.b - start.b));
    result += `\x1b[38;2;${r};${g};${b}m${segments[i]}\x1b[39m`;
  }
  return result;
}

export function generateGradientHeader(logoText: string, width: number): string {
  const decorLen = visibleWidth(`⚡ ${logoText} ⚡`);
  if (width < decorLen) {
    return truncateToWidth(logoText, width, '...');
  }
  const paddingSize = Math.max(0, Math.floor((width - decorLen) / 2));
  const padding = ' '.repeat(paddingSize);

  // Gradient bar: Pink (#d787af) -> Cyan (#00afaf)
  const baseLogo = getGradientText(logoText, '#d787af', '#00afaf');
  return `${padding}⚡ ${baseLogo} ⚡`;
}

export function registerHeader(pi: ExtensionAPI) {
  let liveTui: any = null;
  let unsubSettings: (() => void) | null = null;

  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => {
      liveTui = _tui;
      return {
        render(width: number): string[] {
          const currentSettings = readSettings(ctx.cwd);
          if (!currentSettings.enabled || !currentSettings.header) {
            return [];
          }
          const infoLines: string[] = [generateGradientHeader('PI-TUI-HUD', width)];
          if (currentSettings['header-info']) {
            const rawInfo = ` Model: ${ctx.model?.id || 'unknown'} | CWD: ${ctx.cwd}`;
            infoLines.push(truncateToWidth(theme.fg('dim', rawInfo), width, '...'));
          }
          return infoLines;
        },
      };
    });

    if (unsubSettings) {
      unsubSettings();
    }

    unsubSettings = pi.events.on('hud_settings_changed', (changeCtx) => {
      if (changeCtx && liveTui) {
        liveTui.requestRender();
      }
    });
  });

  pi.on('session_shutdown', (_event, ctx) => {
    liveTui = null;
    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }
  });
}
