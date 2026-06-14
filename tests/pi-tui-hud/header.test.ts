import { describe, it, expect } from 'vitest';
import { generateGradientHeader } from '../../extensions/pi-tui-hud/header';

describe('gradient logo header', () => {
  it('should render colored gradient bar and verify mathematical centering', () => {
    const logoText = 'PI AGENT';
    const width = 80;
    const rendered = generateGradientHeader(logoText, width);
    
    expect(rendered).toContain('PI AGENT');

    // '⚡ ' (2) + 'PI AGENT' (8) + ' ⚡' (2) = 12 columns
    // padding: (80 - 12) / 2 = 34 spaces
    const expectedPadding = ' '.repeat(34);
    expect(rendered.startsWith(expectedPadding)).toBe(true);
    expect(rendered.endsWith('⚡')).toBe(true);
  });
});
