import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateGradientHeader, getGradientText, registerHeader } from '../../extensions/pi-tui-hud/header';
import { readSettings } from '../../extensions/pi-tui-hud/settings';
import { visibleWidth } from '@earendil-works/pi-tui';

vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readSettings: vi.fn(),
}));

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('gradient logo header', () => {
  let mockPi: any;
  let mockCtx: any;
  let sessionStartHandler: Function;

  beforeEach(() => {
    vi.resetAllMocks();
    mockPi = {
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === 'session_start') {
          sessionStartHandler = handler;
        }
      }),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        setHeader: vi.fn(),
      },
      model: { id: 'claude-3-5' },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate gradient text colors correctly', () => {
    const text = 'AB';
    const gradient = getGradientText(text, '#ff0000', '#0000ff');
    
    // First letter 'A' should be exactly pure red: #ff0000 -> rgb(255, 0, 0)
    expect(gradient).toContain('\x1b[38;2;255;0;0mA');
    // Second letter 'B' should be exactly pure blue: #0000ff -> rgb(0, 0, 255)
    expect(gradient).toContain('\x1b[38;2;0;0;255mB');
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

  it('should register and render reactive header lines', () => {
    vi.mocked(readSettings).mockReturnValue({
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
    vi.mocked(readSettings).mockReturnValue({
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
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: false, // Turn off!
      'header-info': false,
    });

    const lines = renderer.render(80);
    expect(lines.length).toBe(0);
  });

  it('should request render when hud_settings_changed is emitted', () => {
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
