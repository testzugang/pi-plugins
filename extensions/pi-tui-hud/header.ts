import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { readEffectiveSettings, DEFAULT_SETTINGS } from './settings';
import { sanitizePlainText } from './breadcrumb';
import { isExtensionContext, parseHex } from './utils';

const GRADIENT_TEXT_CACHE_LIMIT = 128;
const gradientTextCache = new Map<string, string>();

function cacheGradientText(key: string, value: string): string {
  if (gradientTextCache.size >= GRADIENT_TEXT_CACHE_LIMIT) {
    const oldestKey = gradientTextCache.keys().next().value;
    if (oldestKey !== undefined) {
      gradientTextCache.delete(oldestKey);
    }
  }
  gradientTextCache.set(key, value);
  return value;
}

export function getGradientText(text: string, startHex: string, endHex: string): string {
  const cacheKey = JSON.stringify([text, startHex, endHex]);
  const cached = gradientTextCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const start = parseHex(startHex);
  const end = parseHex(endHex);
  if (!start || !end) return cacheGradientText(cacheKey, text);

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
  return cacheGradientText(cacheKey, result);
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

  function runtimeSettings() {
    return { hudEnabled: pi.getFlag('hud') !== false };
  }

  function enable(ctx: ExtensionContext) {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    headerEnabled = true;
    cachedSettings = readEffectiveSettings(ctx.cwd, runtimeSettings());

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

    const s = readEffectiveSettings(ctx.cwd, runtimeSettings());
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
      
      const updatedSettings = readEffectiveSettings(changeCtx.cwd, runtimeSettings());
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
