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
});
