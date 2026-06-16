import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateGradientHeader, getGradientText, registerHeader } from '../../extensions/pi-tui-hud/header';
import { readEffectiveSettings } from '../../extensions/pi-tui-hud/settings';
import { visibleWidth } from '@earendil-works/pi-tui';

vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readEffectiveSettings: vi.fn(),
  DEFAULT_SETTINGS: {
    enabled: true,
    breadcrumb: 'inner',
    footer: true,
    header: true,
    'header-info': false,
  },
}));

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('gradient logo header', () => {
  let mockPi: any;
  let mockCtx: any;
  let sessionStartHandler: Function;
  let busHandlers: Record<string, Function>;

  beforeEach(() => {
    vi.resetAllMocks();
    busHandlers = {};
    mockPi = {
      getFlag: vi.fn().mockReturnValue(true),
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === 'session_start') {
          sessionStartHandler = handler;
        }
      }),
      events: {
        on: vi.fn().mockImplementation((event, handler) => {
          busHandlers[event] = handler;
          return vi.fn(); // Mock unsubscribe
        }),
        emit: vi.fn(),
      },
    };
    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        setHeader: vi.fn(),
        setFooter: vi.fn(),
        setEditorComponent: vi.fn(),
        setWidget: vi.fn(),
        theme: {
          fg: (token: string, text: string) => `[${token}]${text}`,
        },
      },
      model: { id: 'claude-3-5' },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate gradient text colors correctly from shared hex parser semantics', () => {
    const text = 'AB';
    const gradient = getGradientText(text, '#ff0000', '0000ff');
    
    // First letter 'A' should be exactly pure red: #ff0000 -> rgb(255, 0, 0)
    expect(gradient).toContain('\x1b[38;2;255;0;0mA');
    // Second letter 'B' should be exactly pure blue: #0000ff -> rgb(0, 0, 255)
    expect(gradient).toContain('\x1b[38;2;0;0;255mB');
  });

  it('should return plain text when gradient hex colors are invalid', () => {
    expect(getGradientText('AB', 'invalid', '#0000ff')).toBe('AB');
    expect(getGradientText('AB', '#ff0000', '123')).toBe('AB');
    expect(getGradientText('AB', '#ff0000', 'ff#ffff')).toBe('AB');
  });

  it('should handle astral Unicode surrogate pairs safely without splitting', () => {
    const text = '🌟✨'; // Two high-surrogate emojis
    const gradient = getGradientText(text, '#ff0000', '#0000ff');
    expect(stripAnsi(gradient)).toBe('🌟✨');
  });

  it('should protect complex ZWJ grapheme clusters from being split by colors', () => {
    const text = '👩‍👩‍👧‍👦'; // Family emoji with multiple ZWJ joins
    const gradient = getGradientText(text, '#ff0000', '#0000ff');
    expect(stripAnsi(gradient)).toBe('👩‍👩‍👧‍👦');
    
    // Core check: Verify the entire multi-code-point emoji was not split by ANSI escape codes inside
    expect(gradient).toContain(text);
  });

  it('should reuse cached gradient work for repeated identical inputs', () => {
    const segmentSpy = vi.spyOn(Intl.Segmenter.prototype, 'segment');

    const first = getGradientText('CACHE-REUSE-ONE', '#112233', '#445566');
    const second = getGradientText('CACHE-REUSE-ONE', '#112233', '#445566');

    expect(second).toBe(first);
    expect(segmentSpy).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cached gradient work when text or colors change', () => {
    const segmentSpy = vi.spyOn(Intl.Segmenter.prototype, 'segment');

    getGradientText('CACHE-INVALIDATE-ONE', '#112233', '#445566');
    getGradientText('CACHE-INVALIDATE-ONE', '#112233', '#445566');
    getGradientText('CACHE-INVALIDATE-TWO', '#112233', '#445566');
    getGradientText('CACHE-INVALIDATE-TWO', '#112233', '#778899');

    expect(segmentSpy).toHaveBeenCalledTimes(3);
  });

  it('should render colored gradient bar and verify mathematical centering', () => {
    const logoText = 'PI AGENT';
    const width = 80;
    const rendered = generateGradientHeader(logoText, width);
    
    expect(stripAnsi(rendered)).toContain('PI AGENT');

    // Dynamically calculate visible width of decorated logo
    const decorLen = visibleWidth(`⚡ ${logoText} ⚡`);
    const expectedPaddingSize = Math.max(0, Math.floor((width - decorLen) / 2));
    
    const leadingSpaces = rendered.match(/^ */)?.[0] || '';
    expect(leadingSpaces.length).toBe(expectedPaddingSize);
    expect(rendered.endsWith('⚡')).toBe(true);
  });

  it('should handle narrow terminal widths gracefully by truncating the logo', () => {
    const logoText = 'SUPERLONG_LOGO_TEXT';
    const width = 10; // width is smaller than logoText + 4
    const rendered = generateGradientHeader(logoText, width);
    expect(stripAnsi(rendered)).toBe('SUPERLO...');
  });

  it('should not register header when HUD is forced off by runtime flag', () => {
    mockPi.getFlag.mockReturnValue(false);
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: false,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerHeader(mockPi);
    sessionStartHandler({}, mockCtx);

    expect(readEffectiveSettings).toHaveBeenCalledWith('/mock/cwd', { hudEnabled: false });
    expect(mockCtx.ui.setHeader).toHaveBeenCalledWith(undefined);
  });

  it('should register and render reactive header lines', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': true,
    });

    let headerRendererFactory: any = null;
    mockCtx.ui.setHeader.mockImplementation((factory: any) => {
      headerRendererFactory = factory;
    });

    registerHeader(mockPi);
    expect(mockPi.on).toHaveBeenCalledWith('session_start', expect.any(Function));

    // Trigger session_start
    sessionStartHandler({}, mockCtx);
    expect(mockCtx.ui.setHeader).toHaveBeenCalled();

    // Verify rendered lines
    const mockTheme = { fg: (token: string, text: string) => `[${token}]${text}` };
    const renderer = headerRendererFactory({}, mockTheme);
    const lines = renderer.render(80);

    expect(lines.length).toBe(2);
    expect(stripAnsi(lines[0])).toContain('PI-TUI-HUD');
    expect(lines[1]).toContain('Model: claude-3-5');
    expect(lines[1]).toContain('CWD: /mock/cwd');
    expect(lines[1]).toContain('[dim]');
  });

  it('should return empty lines if header is disabled at runtime', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let headerRendererFactory: any = null;
    mockCtx.ui.setHeader.mockImplementation((factory: any) => {
      headerRendererFactory = factory;
    });

    registerHeader(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTheme = { fg: (token: string, text: string) => text };
    const renderer = headerRendererFactory({}, mockTheme);

    // Turn off header dynamically
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: false, // Turn off!
      'header-info': false,
    });

    // Since it is turned off dynamically, the event handler will disable it and call setHeader(undefined)
    busHandlers['hud_settings_changed'](mockCtx);
    expect(mockCtx.ui.setHeader).toHaveBeenLastCalledWith(undefined);
  });

  it('should request render when hud_settings_changed is emitted', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let settingsChangedHandler: Function = () => {};
    mockPi.events.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'hud_settings_changed') {
        settingsChangedHandler = handler;
      }
      return vi.fn(); // Mock unsubscribe
    });

    registerHeader(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text };
    
    // Trigger header factory registration to capture liveTui
    mockCtx.ui.setHeader.mock.calls[0][0](mockTui, mockTheme);

    // Trigger settings changed event
    settingsChangedHandler(mockCtx);
    expect(mockTui.requestRender).toHaveBeenCalled();
  });
});
