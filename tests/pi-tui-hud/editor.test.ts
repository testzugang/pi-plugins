import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerEditor } from '../../extensions/pi-tui-hud/editor';
import { readSettings } from '../../extensions/pi-tui-hud/settings';

vi.mock('node:fs');
vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readSettings: vi.fn(),
}));

describe('editor registration and lifecycle', () => {
  let mockPi: any;
  let mockCtx: any;
  let eventHandlers: Record<string, Function>;
  let busHandlers: Record<string, Function>;
  let unsubMock: any;

  beforeEach(() => {
    vi.resetAllMocks();
    eventHandlers = {};
    busHandlers = {};
    unsubMock = vi.fn();

    mockPi = {
      on: vi.fn().mockImplementation((event, handler) => {
        eventHandlers[event] = handler;
      }),
      events: {
        on: vi.fn().mockImplementation((event, handler) => {
          busHandlers[event] = handler;
          return unsubMock;
        }),
      },
    };

    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        theme: {
          fg: (token: string, text: string) => `[${token}]${text}`,
        },
        setEditorComponent: vi.fn(),
        setWidget: vi.fn(),
      },
      model: { id: 'claude-3-5', name: 'Claude 3.5' },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register session_start, model_select, and session_shutdown handlers', () => {
    registerEditor(mockPi);
    expect(mockPi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('model_select', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('session_shutdown', expect.any(Function));

    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });
    eventHandlers['session_start']({}, mockCtx);
    expect(mockPi.events.on).toHaveBeenCalledWith('hud_settings_changed', expect.any(Function));
  });

  it('should register CustomEditor when enabled and breadcrumb is inner', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(expect.any(Function));
    expect(mockCtx.ui.setWidget).toHaveBeenCalledWith('hud-breadcrumb-widget', undefined);
  });

  it('should register top widget instead of CustomEditor when enabled and breadcrumb is top', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'top',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(undefined);
    expect(mockCtx.ui.setWidget).toHaveBeenCalledWith('hud-breadcrumb-widget', expect.any(Function), { placement: 'aboveEditor' });
  });

  it('should clean up completely and call unsubscribe on shutdown', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx); // Enables and registers unsubSettings
    eventHandlers['session_shutdown']({}, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
    expect(unsubMock).toHaveBeenCalled();
  });

  it('should dynamically enable or disable on settings changed event', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: false,
      breadcrumb: 'hide',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx); // Starts disabled

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(undefined);

    // Simulate settings changing to inner breadcrumb
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    busHandlers['hud_settings_changed'](mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenLastCalledWith(expect.any(Function));
  });
});
