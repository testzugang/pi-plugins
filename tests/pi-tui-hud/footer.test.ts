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

  it('should handle boundary cases for formatting correctly', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1000)).toBe('1k');
    expect(formatTokenCount(999999)).toBe('1000k');
    expect(formatTokenCount(1000000)).toBe('1M');
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

    // Case 1: Missing context usage (null) - falls back to cumulative
    mockCtx.getContextUsage.mockReturnValue(null);
    const lines = renderer.render(80);
    expect(lines[0]).toContain('10.0%/200k');

    // Case 2: Compacted / null values inside contextUsage - renders ?%
    mockCtx.getContextUsage.mockReturnValue({ tokens: null, percent: null, contextWindow: 200000 });
    const linesCompacted = renderer.render(80);
    expect(linesCompacted[0]).toContain('?%/200k');
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
      // Unsorted map with dangerous control characters, unclosed ESCs, CSIs, disallowed SGR, colon CSIs, tabs, C1 8-bit controls, DCS payloads, and OSC exploits
      getExtensionStatuses: () => new Map([
        ['z-ext', 'Z-Status\twith\tcontrol\x07chars and unclosed \x1b raw ESC \u009b2JC1CSI \u009d2;C1OSC\u0007'],
        ['a-ext', '\x1b[31mA-Status\x1b[39m with \x1b[2JCSIs \x1b[0 qintermediateSpace \x1b[200~private \x1b[2@finalbyte \x1b[>0cintermediates \x1b[38:2::255mcolonCSI \x1b[38;5;999999munboundedSGR \x1b[5mblink \x1b[8mhidden \x1b]2;incomplete OSC with spaces \x1bP1$rDangerousDcsPayload\x1b\\ \x1b(0charset'],
      ]),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const lines = renderer.render(200);

    // Line 2 should be sorted alphabetically:
    // a-ext first: SGR color code \x1b[31m and \x1b[39m are preserved. CSI, DCS (+payload), OSC, other ESC families (charset), disallowed SGR are stripped.
    // z-ext next: \x07 (BEL), \t (tab 0x09), raw \x1b, C1 controls are replaced with spaces or sanitized.
    expect(lines[1]).toContain('\x1b[31mA-Status\x1b[39m with CSIs intermediateSpace private finalbyte intermediates colonCSI unboundedSGR blink hidden charset\x1b[0m');
    expect(lines[1]).toContain('Z-Status with control chars and unclosed aw ESC C1CSI\x1b[0m');
    
    // Negative security assertions: Verifying all dangerous payloads were stripped completely
    expect(lines[1]).not.toContain('2JC1CSI');
    expect(lines[1]).not.toContain('2;C1OSC');
    expect(lines[1]).not.toContain('DangerousDcsPayload');
    
    // Verify style reset is appended to prevent leaks
    expect(lines[1].endsWith('\x1b[0m')).toBe(true);
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

    // Test extreme narrowness: width 3 (rightSegment is "⚡ med" which is 5 columns)
    // The output MUST be strictly truncated to exactly 3 columns.
    const extremeLines = renderer.render(3);
    expect(visibleWidth(extremeLines[0])).toBe(3);
  });

  it('should handle live streaming usage and request render on message updates', () => {
    let agentStartHandler: Function = () => {};
    let messageUpdateHandler: Function = () => {};
    let messageEndHandler: Function = () => {};

    mockPi.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'session_start') {
        sessionStartHandler = handler;
      } else if (event === 'agent_start') {
        agentStartHandler = handler;
      } else if (event === 'message_update') {
        messageUpdateHandler = handler;
      } else if (event === 'message_end') {
        messageEndHandler = handler;
      }
    });

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

    // Trigger footer setup to capture liveTui
    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);

    // Trigger agent_start
    agentStartHandler();
    expect(mockTui.requestRender).toHaveBeenCalledTimes(1);

    // Trigger message_update with live usage
    const mockMessage = { usage: { input: 2000, output: 1000, cost: { total: 0.05 } } };
    messageUpdateHandler({ message: mockMessage });
    expect(mockTui.requestRender).toHaveBeenCalledTimes(2);

    // Mock getContextUsage to null so it falls back to cumulative + live calculations
    mockCtx.getContextUsage.mockReturnValue(null);

    // Render footer during message update and verify live streaming tokens are accumulated
    const lines = renderer.render(80);
    // Cumulative (15k + 5k input/output) + Live (2k + 1k input/output) = 23k total tokens
    expect(lines[0]).toContain('11.5%/200k'); // 23000 / 200000 = 11.5%
    expect(lines[0]).toContain('↑12k'); // Cumulative 10k + Live 2k = 12k
    expect(lines[0]).toContain('↓6k'); // Cumulative 5k + Live 1k = 6k
    expect(lines[0]).toContain('$0.200'); // Cumulative 0.15 + Live 0.05 = 0.20

    // Trigger message_end
    messageEndHandler();
    expect(mockTui.requestRender).toHaveBeenCalledTimes(3);

    // Trigger dispose and verify safe cleanup
    renderer.dispose();
  });
});
