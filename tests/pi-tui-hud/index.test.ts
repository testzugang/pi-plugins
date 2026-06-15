import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import hudExtension from '../../extensions/pi-tui-hud/index';
import { readSettings, writeSetting } from '../../extensions/pi-tui-hud/settings';

vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readSettings: vi.fn(),
  writeSetting: vi.fn(),
  setPiRef: vi.fn(),
  DEFAULT_SETTINGS: {
    enabled: true,
    breadcrumb: 'inner',
    footer: true,
    header: true,
    'header-info': false,
  },
}));

describe('index extension registration and commands', () => {
  let mockPi: any;
  let mockCtx: any;
  let hudCommand: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockPi = {
      registerFlag: vi.fn(),
      registerCommand: vi.fn().mockImplementation((name, cmd) => {
        if (name === 'hud') {
          hudCommand = cmd;
        }
      }),
      on: vi.fn(),
      getFlag: vi.fn().mockReturnValue(true),
      events: { on: vi.fn(), emit: vi.fn() }
    };
    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        notify: vi.fn(),
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register command and load without crashes', () => {
    hudExtension(mockPi as any);
    expect(mockPi.registerCommand).toHaveBeenCalledWith('hud', expect.any(Object));
  });

  it('should toggle master enabled state when calling /hud with no args', async () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    hudExtension(mockPi as any);
    await hudCommand.handler('', mockCtx);

    expect(writeSetting).toHaveBeenCalledWith('/mock/cwd', 'enabled', false);
    expect(mockPi.events.emit).toHaveBeenCalledWith('hud_settings_changed', mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith('HUD enabled → off', 'info');
  });

  it('should show a warning and refuse to toggle if HUD is forced off by the CLI flag', async () => {
    mockPi.getFlag.mockReturnValue(false); // Force off via CLI flag --hud=false

    hudExtension(mockPi as any);
    await hudCommand.handler('', mockCtx);

    expect(writeSetting).not.toHaveBeenCalled();
    expect(mockCtx.ui.notify).toHaveBeenCalledWith('HUD is forced off by the --hud command-line flag.', 'warning');
  });

  it('should display settings info when calling /hud info', async () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    hudExtension(mockPi as any);
    await hudCommand.handler('info', mockCtx);

    expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('HUD Settings:'), 'info');
  });

  it('should update breadcrumb setting when calling /hud breadcrumb:<mode>', async () => {
    hudExtension(mockPi as any);
    await hudCommand.handler('breadcrumb:top', mockCtx);

    expect(writeSetting).toHaveBeenCalledWith('/mock/cwd', 'breadcrumb', 'top');
    expect(mockPi.events.emit).toHaveBeenCalledWith('hud_settings_changed', mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith('Breadcrumb set to: top', 'info');
  });

  it('should reject invalid values for breadcrumbs', async () => {
    hudExtension(mockPi as any);
    await hudCommand.handler('breadcrumb:bad', mockCtx);

    expect(writeSetting).not.toHaveBeenCalled();
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('must be: hide, top, or inner'), 'warning');
  });

  it('should update boolean settings when calling /hud <key>:<on|off>', async () => {
    hudExtension(mockPi as any);
    await hudCommand.handler('footer:off', mockCtx);

    expect(writeSetting).toHaveBeenCalledWith('/mock/cwd', 'footer', false);
    expect(mockPi.events.emit).toHaveBeenCalledWith('hud_settings_changed', mockCtx);
    expect(mockCtx.ui.notify).toHaveBeenCalledWith('footer turned off', 'info');

    // Test header:off and header-info:on
    await hudCommand.handler('header:off', mockCtx);
    expect(writeSetting).toHaveBeenCalledWith('/mock/cwd', 'header', false);

    await hudCommand.handler('header-info:on', mockCtx);
    expect(writeSetting).toHaveBeenCalledWith('/mock/cwd', 'header-info', true);
  });

  it('should reject invalid boolean values', async () => {
    hudExtension(mockPi as any);
    await hudCommand.handler('footer:maybe', mockCtx);

    expect(writeSetting).not.toHaveBeenCalled();
    expect(mockCtx.ui.notify).toHaveBeenCalledWith('Value must be: on or off', 'warning');
  });

  it('should reject invalid command formats', async () => {
    hudExtension(mockPi as any);
    await hudCommand.handler('invalid-no-colon', mockCtx);

    expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Invalid command format.'), 'error');
  });

  it('should catch writeSetting errors and notify the user with a friendly error message', async () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });
    // Force writeSetting to throw
    vi.mocked(writeSetting).mockImplementation(() => {
      throw new Error('Disk full');
    });

    hudExtension(mockPi as any);
    await hudCommand.handler('', mockCtx);

    expect(mockCtx.ui.notify).toHaveBeenCalledWith('Failed to save HUD settings: Disk full', 'error');
  });

  it('should return early and not crash if called in headless mode (no UI)', async () => {
    const headlessCtx = { cwd: '/mock/cwd', hasUI: false };
    hudExtension(mockPi as any);
    
    await expect(hudCommand.handler('info', headlessCtx)).resolves.not.toThrow();
    expect(writeSetting).not.toHaveBeenCalled();
  });
});
