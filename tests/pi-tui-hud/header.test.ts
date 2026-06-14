import { describe, it, expect } from 'vitest';
import { generateGradientHeader } from '../../extensions/pi-tui-hud/header';

describe('gradient logo header', () => {
  it('should render colored gradient bar', () => {
    const rendered = generateGradientHeader('PI AGENT', 80);
    expect(rendered).toContain('PI AGENT');
  });
});
