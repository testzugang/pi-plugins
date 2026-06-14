import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTokenCount, registerFooter } from '../../extensions/pi-tui-hud/footer';
import { readSettings } from '../../extensions/pi-tui-hud/settings';
import { visibleWidth } from '@earendil-works/pi-tui';

vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readSettings: vi.fn(),
}));

describe('token count formatting', () => {
  it('should scale counts into k/M suffix correctly', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(1500000)).toBe('1.5M');
  });
});

describe('footer registration and rendering', () => {
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
      getThinkingLevel: vi.fn().mockReturnValue('med'),
    };
    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        setFooter: vi.fn(),
      },
      model: { contextWindow: 200000 },
      getContextUsage: vi.fn().mockReturnValue({ tokens: 15000, contextWindow: 200000 }),
      sessionManager: {
        getEntries: vi.fn().mockReturnValue([
          {
            type: 'message',
            message: {
              role: 'assistant',
              usage: { input: 10000, output: 5000, cacheRead: 5000, cacheWrite: 0, cost: { total: 0.15 } },
            },
          },
        ]),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register and render complete TUI footer with correct segments', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let footerRendererFactory: any = null;
    mockCtx.ui.setFooter.mockImplementation((factory: any) => {
      footerRendererFactory = factory;
    });

    registerFooter(mockPi);
    expect(mockPi.on).toHaveBeenCalledWith('session_start', expect.any(Function));

    sessionStartHandler({}, mockCtx);
    expect(mockCtx.ui.setFooter).toHaveBeenCalled();

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = {
      fg: (token: string, text: string) => `[${token}]${text}`,
    };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map([['headroom', 'Headroom -42%']]),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const lines = renderer.render(80);

    expect(lines.length).toBe(2);
    
    // Line 1: Git branch, context usage, cumulative stats, costs, thinking status
    expect(lines[0]).toContain('[success]⎇ main');
    expect(lines[0]).toContain('7.5%/200k'); // 15000 / 200000 = 7.5%
    expect(lines[0]).toContain('↑10k');
    expect(lines[0]).toContain('↓5k');
    expect(lines[0]).toContain('CH:33.3%'); // cacheRead (5000) / prompt (10000 + 5000) = 33.3%
    expect(lines[0]).toContain('$0.150');
    expect(lines[0]).toContain('[accent]⚡ med');

    // Line 2: Extension status
    expect(lines[1]).toContain('Headroom -42%');

    // Verify mathematical padding size
    const totalVisibleWidth = visibleWidth(lines[0]);
    expect(totalVisibleWidth).toBe(80);
  });

  it('should render warning above 70% and error above 90% context usage', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let footerRendererFactory: any = null;
    mockCtx.ui.setFooter.mockImplementation((factory: any) => {
      footerRendererFactory = factory;
    });

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => `[${token}]${text}` };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map(),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);

    // Scenario A: 75% context usage (Warning)
    mockCtx.getContextUsage.mockReturnValue({ percent: 75, contextWindow: 200000 });
    const linesWarn = renderer.render(80);
    expect(linesWarn[0]).toContain('[warning]75.0%/200k');

    // Scenario B: 95% context usage (Error)
    mockCtx.getContextUsage.mockReturnValue({ percent: 95, contextWindow: 200000 });
    const linesErr = renderer.render(80);
    expect(linesErr[0]).toContain('[error]95.0%/200k');
  });

  it('should render unknown percentage when context usage is missing or null', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let footerRendererFactory: any = null;
    mockCtx.ui.setFooter.mockImplementation((factory: any) => {
      footerRendererFactory = factory;
    });

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map(),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);

    // Missing context usage (null)
    mockCtx.getContextUsage.mockReturnValue(null);
    const lines = renderer.render(80);
    expect(lines[0]).toContain('?%/200k');
  });

  it('should sort and sanitize extension statuses cleanly', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let footerRendererFactory: any = null;
    mockCtx.ui.setFooter.mockImplementation((factory: any) => {
      footerRendererFactory = factory;
    });

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text };
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      // Unsorted map with newlines and duplicate spaces
      getExtensionStatuses: () => new Map([
        ['z-ext', 'Z-Status\nwith newlines'],
        ['a-ext', '  A-Status   with  spaces  '],
      ]),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const lines = renderer.render(80);

    // Line 2 should be sorted alphabetically: a-ext first, then z-ext, and fully sanitized
    expect(lines[1]).toBe('A-Status with spaces  Z-Status with newlines');
  });

  it('should handle narrow terminal widths safely without overflowing maximum width', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let footerRendererFactory: any = null;
    mockCtx.ui.setFooter.mockImplementation((factory: any) => {
      footerRendererFactory = factory;
    });

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text };
    const mockFooterData = {
      getGitBranch: () => 'extremely-super-long-branch-name-that-does-not-fit-at-all',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map(),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    
    // Width is extremely small (30 columns)
    const lines = renderer.render(30);

    // Output length must be exactly 30 columns
    expect(visibleWidth(lines[0])).toBe(30);
    expect(lines[0]).toContain('⚡ med'); // Right segment is preserved
    expect(lines[0]).toContain('...'); // Left segment is truncated
  });
});
