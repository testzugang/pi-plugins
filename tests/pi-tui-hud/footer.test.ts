import { describe, it, expect } from 'vitest';
import { formatTokenCount } from '../../extensions/pi-tui-hud/footer';

describe('token count formatting', () => {
  it('should scale counts into k/M suffix correctly', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(1500000)).toBe('1.5M');
  });
});
