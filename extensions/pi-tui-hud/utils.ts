import { env } from 'node:process';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export function isExtensionContext(val: unknown): val is ExtensionContext {
  return (
    typeof val === 'object' &&
    val !== null &&
    'cwd' in val &&
    typeof (val as any).cwd === 'string' &&
    'hasUI' in val &&
    typeof (val as any).hasUI === 'boolean' &&
    'ui' in val &&
    typeof (val as any).ui === 'object' &&
    (val as any).ui !== null &&
    'theme' in (val as any).ui &&
    typeof (val as any).ui.setHeader === 'function' &&
    typeof (val as any).ui.setFooter === 'function' &&
    typeof (val as any).ui.setEditorComponent === 'function' &&
    typeof (val as any).ui.setWidget === 'function'
  );
}

export function hasNerdFonts(): boolean {
  const nf = env.NERD_FONTS;
  const isNerdFontEnv = nf !== undefined && nf !== '0' && nf !== 'false' && nf !== 'off';
  return env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'Apple_Terminal' || isNerdFontEnv;
}

export function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    return null;
  }
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16),
  };
}

export function hexFg(hex: string, text: string): string {
  const color = parseHex(hex);
  if (!color) {
    return text;
  }
  return `\x1b[38;2;${color.r};${color.g};${color.b}m${text}\x1b[39m`;
}
