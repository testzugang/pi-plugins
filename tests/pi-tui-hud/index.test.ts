import { describe, it, expect, vi } from 'vitest';
import hudExtension from '../../extensions/pi-tui-hud/index';

describe('index extension registration', () => {
  it('should register command and load without crashes', () => {
    const mockPi = {
      registerFlag: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() }
    };
    hudExtension(mockPi as any);
    expect(mockPi.registerCommand).toHaveBeenCalledWith('hud', expect.any(Object));
  });
});
