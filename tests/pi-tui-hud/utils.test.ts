import { describe, it, expect, vi, afterEach } from 'vitest';
import { withIcon, hexFg, hasNerdFonts, parseHex } from '../../extensions/pi-tui-hud/utils';

describe('utility functions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should format text with icons correctly', () => {
    const result = withIcon('🚀', 'Launch');
    expect(result).toBe('🚀 Launch');
  });

  it('should fallback gracefully if icon is empty', () => {
    const result = withIcon('', 'Launch');
    expect(result).toBe('Launch');
  });

  it('should parse shared six-digit hex colors with or without leading hash', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('should reject invalid shared hex color inputs', () => {
    expect(parseHex('invalid')).toBeNull();
    expect(parseHex('123')).toBeNull();
    expect(parseHex('ff#ffff')).toBeNull();
  });

  it('should wrap text in raw hex foreground escape codes', () => {
    const colored = hexFg('#ffffff', 'text');
    expect(colored).toBe('\x1b[38;2;255;255;255mtext\x1b[39m');

    const hashless = hexFg('0000ff', 'text');
    expect(hashless).toBe('\x1b[38;2;0;0;255mtext\x1b[39m');
  });

  it('should fallback to plain text if hex is invalid', () => {
    const badHex = hexFg('invalid', 'text');
    expect(badHex).toBe('text');

    const shortHex = hexFg('123', 'text');
    expect(shortHex).toBe('text');

    const misplacedHash = hexFg('ff#ffff', 'text');
    expect(misplacedHash).toBe('text');
  });

  it('should detect nerd fonts based on terminal program or NERD_FONTS env', () => {
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    expect(hasNerdFonts()).toBe(true);

    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    expect(hasNerdFonts()).toBe(true);

    vi.stubEnv('TERM_PROGRAM', 'other');
    vi.stubEnv('NERD_FONTS', '1');
    expect(hasNerdFonts()).toBe(true);

    vi.stubEnv('NERD_FONTS', '0');
    expect(hasNerdFonts()).toBe(false);

    vi.stubEnv('NERD_FONTS', 'false');
    expect(hasNerdFonts()).toBe(false);

    vi.stubEnv('NERD_FONTS', 'off');
    expect(hasNerdFonts()).toBe(false);
  });
});
