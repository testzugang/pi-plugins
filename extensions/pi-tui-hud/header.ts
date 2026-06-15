import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { readSettings, DEFAULT_SETTINGS } from './settings';
import { sanitizePlainText } from './breadcrumb';
import { isExtensionContext, parseHex } from './utils';

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
  let headerEnabled = false;
  let cachedSettings = DEFAULT_SETTINGS;

  function enable(ctx: ExtensionContext) {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    headerEnabled = true;
    cachedSettings = readSettings(ctx.cwd);

    ctx.ui.setHeader((_tui: any, theme: any) => {
      liveTui = _tui;
      return {
        render(width: number): string[] {
          // Read from cached config without FS I/O on hot path
          if (!cachedSettings.enabled || !cachedSettings.header) {
            return [];
          }
          const infoLines: string[] = [generateGradientHeader('PI-TUI-HUD', width)];
          if (cachedSettings['header-info']) {
            const rawInfo = ` Model: ${sanitizePlainText(ctx.model?.id || 'unknown')} | CWD: ${sanitizePlainText(ctx.cwd)}`;
            infoLines.push(truncateToWidth(theme.fg('dim', rawInfo), width, '...'));
          }
          return infoLines;
        },
        invalidate() {}, // Fully compliant with Component interface
      };
    });
  }

  function disable(ctx: any) {
    headerEnabled = false;
    liveTui = null;
    if (ctx && ctx.hasUI && ctx.ui) {
      ctx.ui.setHeader(undefined); // Properly restores default header!
    }
  }

  pi.on('session_start', (_event, ctx) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;

    const s = readSettings(ctx.cwd);
    if (s.enabled && s.header) {
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
      cachedSettings = updatedSettings;

      if (updatedSettings.enabled && updatedSettings.header && !headerEnabled) {
        enable(changeCtx);
      } else if ((!updatedSettings.enabled || !updatedSettings.header) && headerEnabled) {
        disable(changeCtx);
      } else if (headerEnabled && liveTui) {
        liveTui.requestRender();
      }
    });
  });

  pi.on('session_shutdown', (_event, ctx) => {
    if (headerEnabled) {
      disable(ctx);
    }
    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }
  });
}
