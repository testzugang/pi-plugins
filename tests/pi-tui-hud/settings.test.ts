import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSettings, writeSetting, DEFAULT_SETTINGS } from '../../extensions/pi-tui-hud/settings';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('settings management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return default settings if files do not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const settings = readSettings('/mock/cwd');
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});
