import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTokenCount, registerFooter } from '../../extensions/pi-tui-hud/footer';
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
      getFlag: vi.fn().mockReturnValue(true),
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === 'session_start') {
          sessionStartHandler = handler;
        }
      }),
      getThinkingLevel: vi.fn().mockReturnValue('med'),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    mockCtx = {
      cwd: '/mock/cwd',
      hasUI: true,
      ui: {
        setFooter: vi.fn(),
        setHeader: vi.fn(),
        setEditorComponent: vi.fn(),
        setWidget: vi.fn(),
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

  it('should not register footer when HUD is forced off by runtime flag', () => {
    mockPi.getFlag.mockReturnValue(false);
    vi.mocked(readEffectiveSettings).mockReturnValue({
      enabled: false,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    expect(readEffectiveSettings).toHaveBeenCalledWith('/mock/cwd', { hudEnabled: false });
    expect(mockCtx.ui.setFooter).toHaveBeenCalledWith(undefined);
  });

  it('should register and render complete TUI footer with correct segments', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
      bold: (text: string) => `<b>${text}</b>`,
    };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map([['headroom', 'Headroom -42%']]),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const lines = renderer.render(80);

    expect(lines.length).toBe(2);
    
    // Line 1: Git branch, context usage, cumulative stats, and costs
    expect(lines[0]).toContain('[success]<b>⎇ main</b>');
    expect(lines[0]).toContain('[success]7.5%/200k'); // 15000 / 200000 = 7.5%
    expect(lines[0]).toContain('↑10k');
    expect(lines[0]).toContain('↓5k');
    expect(lines[0]).toContain('CH:33.3%'); // cacheRead (5000) / prompt (10000 + 5000) = 33.3%
    expect(lines[0]).toContain('$0.150');
    expect(lines[0]).not.toContain('⚡ med');
    expect(mockPi.getThinkingLevel).not.toHaveBeenCalled();

    // Line 2: Extension status
    expect(lines[1]).toContain('Headroom -42%');

    // Verify mathematical padding size
    const totalVisibleWidth = visibleWidth(lines[0]);
    expect(totalVisibleWidth).toBe(80);
  });

  it('should render context usage with threshold-specific emphasis', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = {
      fg: (token: string, text: string) => `[${token}]${text}`,
      bold: (text: string) => `<b>${text}</b>`,
    };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map(),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);

    // Scenario A: <50% context usage (Success)
    mockCtx.getContextUsage.mockReturnValue({ percent: 45, contextWindow: 200000 });
    const linesSuccess = renderer.render(80);
    expect(linesSuccess[0]).toContain('[success]45.0%/200k');

    // Scenario B: 50-70% context usage (Accent)
    mockCtx.getContextUsage.mockReturnValue({ percent: 60, contextWindow: 200000 });
    const linesAccent = renderer.render(80);
    expect(linesAccent[0]).toContain('[accent]60.0%/200k');

    // Scenario C: 70-90% context usage (Warning)
    mockCtx.getContextUsage.mockReturnValue({ percent: 75, contextWindow: 200000 });
    const linesWarn = renderer.render(80);
    expect(linesWarn[0]).toContain('[warning]75.0%/200k');

    // Scenario D: >90% context usage (Bold Error)
    mockCtx.getContextUsage.mockReturnValue({ percent: 95, contextWindow: 200000 });
    const linesErr = renderer.render(80);
    expect(linesErr[0]).toContain('[error]<b>95.0%/200k</b>');
  });

  it('should render unknown percentage when context usage is missing or null', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
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
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
      // Unsorted map with dangerous control characters, unclosed ESCs, CSIs, disallowed SGR, colon CSIs, tabs, C1 8-bit controls, C1 ST, C1 SOS, embedded ESC payloads, and OSC exploits
      getExtensionStatuses: () => new Map([
        ['z-ext', 'Z-Status\twith\tcontrol\x07chars and unclosed \x1b raw ESC \u009b2JC1CSI \u009d2;C1OSCWithST\u009cSAFE \u0098DangerousC1SosPayload\u009c'],
        ['a-ext', '\x1b[31mA-Status\x1b[39m with \x1b[2JCSIs \x1b[0 qintermediateSpace \x1b[200~private \x1b[2@finalbyte \x1b[>0cintermediates \x1b[38:2::255mcolonCSI \x1b[38;5;999999munboundedSGR \x1b[5mblink \x1b[8mhidden \x1b]2;incomplete OSC with spaces \x1bP1$rDangerousDcsPayload\x1b[2JEmbeddedESC\x1b\\SAFE \x1b(0charset'],
      ]),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const lines = renderer.render(200);

    // Line 2 should be sorted alphabetically:
    // a-ext first: SGR color code \x1b[31m and \x1b[39m are preserved. CSI, DCS (+payload with embedded ESC), OSC, other ESC families (charset), disallowed SGR are stripped.
    // z-ext next: \x07 (BEL), \t (tab 0x09), raw \x1b, C1 controls (+payload up to C1 ST) are replaced with spaces or sanitized.
    expect(lines[1]).toContain('\x1b[31mA-Status\x1b[39m with CSIs intermediateSpace private finalbyte intermediates colonCSI unboundedSGR blink hidden SAFE charset\x1b[0m');
    expect(lines[1]).toContain('Z-Status with control chars and unclosed aw ESC C1CSI SAFE\x1b[0m');
    
    // Negative security assertions: Verifying all dangerous payloads were stripped completely
    expect(lines[1]).not.toContain('2JC1CSI');
    expect(lines[1]).not.toContain('C1OSCWithST');
    expect(lines[1]).not.toContain('DangerousC1SosPayload');
    expect(lines[1]).not.toContain('EmbeddedESC');
    expect(lines[1]).not.toContain('DangerousDcsPayload');
    
    // Verify style reset is appended to prevent leaks
    expect(lines[1].endsWith('\x1b[0m')).toBe(true);
  });

  it('should inspect status entries for invalidation but reuse cached status line when contents are unchanged', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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

    class CountingStatusMap extends Map<string, string> {
      entriesCalls = 0;

      entries(): MapIterator<[string, string]> {
        this.entriesCalls += 1;
        return super.entries();
      }
    }

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const statuses = new CountingStatusMap([
      ['z-ext', 'z status'],
      ['a-ext', 'a status'],
    ]);
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => statuses,
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);

    const firstLines = renderer.render(120);
    const entriesCallsAfterFirstRender = statuses.entriesCalls;
    const secondLines = renderer.render(120);

    expect(firstLines[1]).toBe(secondLines[1]);
    expect(entriesCallsAfterFirstRender).toBe(2); // signature + sort on first render
    expect(statuses.entriesCalls).toBe(entriesCallsAfterFirstRender + 1); // signature only on unchanged render
  });

  it('should reuse cached sanitized extension status line when status snapshot is unchanged', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const statuses = new Map([['headroom', 'cache-probe\x1b[31m stable\x1b[39m']]);
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => statuses,
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    const originalReplace = String.prototype.replace;
    let statusSanitizeCalls = 0;
    const replaceSpy = vi.spyOn(String.prototype, 'replace').mockImplementation(function (...args: any[]) {
      if (String(this).includes('cache-probe')) {
        statusSanitizeCalls += 1;
      }
      return originalReplace.apply(this, args as [any, any]);
    });

    try {
      const firstLines = renderer.render(120);
      const callsAfterFirstRender = statusSanitizeCalls;
      const secondLines = renderer.render(120);

      expect(firstLines[1]).toBe(secondLines[1]);
      expect(callsAfterFirstRender).toBeGreaterThan(0);
      expect(statusSanitizeCalls).toBe(callsAfterFirstRender);
    } finally {
      replaceSpy.mockRestore();
    }
  });

  it('should invalidate cached extension status line when status snapshot changes', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const statuses = new Map([['headroom', 'cache-probe\x1b[31m stable\x1b[39m']]);
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => statuses,
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    renderer.render(120);

    statuses.set('z-new', 'new-status appeared');
    const changedLines = renderer.render(120);

    expect(changedLines[1]).toContain('cache-probe\x1b[31m stable\x1b[39m\x1b[0m');
    expect(changedLines[1]).toContain('new-status appeared\x1b[0m');
  });

  it('should invalidate cached extension status line when same status Map changes value without changing size', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const statuses = new Map([['headroom', 'old status']]);
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => statuses,
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    renderer.render(120);

    statuses.set('headroom', 'new status');
    const changedLines = renderer.render(120);

    expect(changedLines[1]).toContain('new status\x1b[0m');
    expect(changedLines[1]).not.toContain('old status');
  });

  it('should invalidate cached extension status line when same status Map changes key without changing size and preserve sorted order', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const statuses = new Map([
      ['b-ext', 'B status'],
      ['z-ext', 'Z status'],
    ]);
    const mockFooterData = {
      getGitBranch: () => '',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => statuses,
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    renderer.render(120);

    statuses.delete('z-ext');
    statuses.set('a-ext', 'A status');
    const changedLines = renderer.render(120);

    expect(changedLines[1]).toContain('A status\x1b[0m  B status\x1b[0m');
    expect(changedLines[1]).not.toContain('Z status');
  });

  it('should handle narrow terminal widths safely without overflowing maximum width', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
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
    expect(lines[0]).not.toContain('⚡ med');
    expect(lines[0]).toContain('...'); // Left segment is truncated

    // Test extreme narrowness. The output MUST be strictly truncated to exactly 3 columns.
    const extremeLines = renderer.render(3);
    expect(visibleWidth(extremeLines[0])).toBe(3);
  });

  it('should cache cumulative usage outside render while history is unchanged', () => {
    vi.mocked(readEffectiveSettings).mockReturnValue({
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
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
    const mockFooterData = {
      getGitBranch: () => 'main',
      onBranchChange: () => vi.fn(),
      getExtensionStatuses: () => new Map(),
    };

    const renderer = footerRendererFactory(mockTui, mockTheme, mockFooterData);
    mockCtx.sessionManager.getEntries.mockClear();

    renderer.render(80);
    renderer.render(80);

    expect(mockCtx.sessionManager.getEntries).not.toHaveBeenCalled();
  });

  it('should handle live streaming usage and request render on message updates', () => {
    let agentStartHandler: Function = () => {};
    let messageUpdateHandler: Function = () => {};
    let messageEndHandler: Function = () => {};
    let sessionShutdownHandler: Function = () => {};

    mockPi.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'session_start') {
        sessionStartHandler = handler;
      } else if (event === 'agent_start') {
        agentStartHandler = handler;
      } else if (event === 'message_update') {
        messageUpdateHandler = handler;
      } else if (event === 'message_end') {
        messageEndHandler = handler;
      } else if (event === 'session_shutdown') {
        sessionShutdownHandler = handler;
      }
    });

    vi.mocked(readEffectiveSettings).mockReturnValue({
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

    // Mock events.on unsubscribe
    const unsubMock = vi.fn();
    mockPi.events.on.mockReturnValue(unsubMock);

    registerFooter(mockPi);
    sessionStartHandler({}, mockCtx);

    const mockTui = { requestRender: vi.fn() };
    const mockTheme = { fg: (token: string, text: string) => text, bold: (text: string) => text };
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

    mockCtx.sessionManager.getEntries.mockClear();

    // Render footer during message update and verify live streaming tokens are accumulated
    const lines = renderer.render(80);
    // Cumulative (15k + 5k input/output) + Live (2k + 1k input/output) = 23k total tokens
    expect(lines[0]).toContain('11.5%/200k'); // 23000 / 200000 = 11.5%
    expect(lines[0]).toContain('↑12k'); // Cumulative 10k + Live 2k = 12k
    expect(lines[0]).toContain('↓6k'); // Cumulative 5k + Live 1k = 6k
    expect(lines[0]).toContain('$0.200'); // Cumulative 0.15 + Live 0.05 = 0.20
    expect(mockCtx.sessionManager.getEntries).not.toHaveBeenCalled();

    // Trigger message_end
    messageEndHandler();
    expect(mockTui.requestRender).toHaveBeenCalledTimes(3);

    // Trigger dispose and verify safe cleanup
    renderer.dispose();

    // Trigger session shutdown and verify unsubscribe is called
    sessionShutdownHandler({}, mockCtx);
    expect(unsubMock).toHaveBeenCalled();
  });
});
