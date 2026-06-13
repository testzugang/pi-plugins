import { env } from 'node:process';

export function hasNerdFonts(): boolean {
  const nf = env.NERD_FONTS;
  const isNerdFontEnv = nf !== undefined && nf !== '0' && nf !== 'false' && nf !== 'off';
  return env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'Apple_Terminal' || isNerdFontEnv;
}

export function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

export function hexFg(hex: string, text: string): string {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    return text;
  }
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}
