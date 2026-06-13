import { describe, it, expect } from 'vitest';
import { withIcon, hexFg } from '../../extensions/pi-tui-hud/utils';

describe('utility functions', () => {
  it('should format text with icons correctly', () => {
    const result = withIcon('🚀', 'Launch');
    expect(result).toBe('🚀 Launch');
  });

  it('should wrap text in raw hex foreground escape codes', () => {
    const colored = hexFg('#ffffff', 'text');
    expect(colored).toBe('\x1b[38;2;255;255;255mtext\x1b[39m');
  });
});
