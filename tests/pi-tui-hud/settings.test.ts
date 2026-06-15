import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { readEffectiveSettings, readSettings, writeSetting, DEFAULT_SETTINGS } from '../../extensions/pi-tui-hud/settings';

vi.mock('node:fs');
vi.mock('node:os', () => ({
  homedir: () => '/mock/home',
}));

const cwd = '/mock/cwd';
const globalPath = join('/mock/home', '.pi', 'agent', 'hud', 'settings.json');
const localPath = join(cwd, '.pi', 'hud.json');
const localDir = join(cwd, '.pi');

describe('settings management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return default settings if files do not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const settings = readSettings(cwd);

    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('should merge global settings before local settings so local settings win', () => {
    vi.mocked(fs.existsSync).mockImplementation((path) => path === globalPath || path === localPath);
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      if (path === globalPath) {
        return JSON.stringify({ enabled: false, breadcrumb: 'top', footer: false });
      }
      if (path === localPath) {
        return JSON.stringify({ breadcrumb: 'hide', header: false });
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const settings = readSettings(cwd);

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      breadcrumb: 'hide',
      footer: false,
      header: false,
    });
  });

  it('should ignore malformed JSON and invalid setting types or values', () => {
    vi.mocked(fs.existsSync).mockImplementation((path) => path === globalPath || path === localPath);
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      if (path === globalPath) {
        return JSON.stringify({ enabled: 'false', breadcrumb: 'bad', footer: false });
      }
      if (path === localPath) {
        return '{ malformed json';
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const settings = readSettings(cwd);

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      footer: false,
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it('should write only local settings without freezing global settings', () => {
    vi.mocked(fs.existsSync).mockImplementation((path) => path === globalPath || path === localPath);
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      if (path === globalPath) {
        return JSON.stringify({ enabled: false, breadcrumb: 'top', footer: false });
      }
      if (path === localPath) {
        return JSON.stringify({ header: false });
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    writeSetting(cwd, 'breadcrumb', 'hide');

    expect(fs.mkdirSync).toHaveBeenCalledWith(localDir, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      localPath,
      JSON.stringify({ header: false, breadcrumb: 'hide' }, null, 2),
      'utf8',
    );
  });

  it('should create local config with only the changed setting when local config is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    writeSetting(cwd, 'enabled', false);

    expect(fs.mkdirSync).toHaveBeenCalledWith(localDir, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      localPath,
      JSON.stringify({ enabled: false }, null, 2),
      'utf8',
    );
  });

  it('should reject invalid setting values before writing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => writeSetting(cwd, 'breadcrumb', 'bad' as unknown as 'hide')).toThrow(TypeError);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should return persisted settings without applying the runtime HUD flag', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const settings = readSettings(cwd);

    expect(settings.enabled).toBe(true);
  });

  it('should force effective settings off when the runtime HUD flag is disabled', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const settings = readEffectiveSettings(cwd, { hudEnabled: false });

    expect(settings).toEqual({ ...DEFAULT_SETTINGS, enabled: false });
  });

  it('should preserve persisted disabled state when resolving effective settings', () => {
    vi.mocked(fs.existsSync).mockImplementation((path) => path === localPath);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ enabled: false }));

    const settings = readEffectiveSettings(cwd, { hudEnabled: true });

    expect(settings.enabled).toBe(false);
  });

  it('should propagate write/filesystem errors during writeSetting', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => writeSetting(cwd, 'enabled', false)).toThrow('EACCES: permission denied');
  });
});
