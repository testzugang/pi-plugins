import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { HudCustomEditor, registerEditor } from '../../extensions/pi-tui-hud/editor';
import { readSettings } from '../../extensions/pi-tui-hud/settings';

vi.mock('node:fs');
vi.mock('../../extensions/pi-tui-hud/settings', () => ({
  readSettings: vi.fn(),
}));

function createRenderTheme() {
  return {
    borderColor: (text: string) => text,
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function createTaggedRenderTheme(tag: string) {
  return {
    borderColor: (text: string) => `[${tag}:border]${text}`,
    fg: (token: string, text: string) => `[${tag}:${token}]${text}`,
    bold: (text: string) => `[${tag}:bold]${text}`,
  };
}

function createRenderEditorState(ctxOverrides: Record<string, unknown>, thinkingLevel: string) {
  return {
    breadcrumbMode: 'inner',
    ctx: {
      cwd: '/workspaces/project-alpha',
      model: { name: 'Claude 3.5' },
      ...ctxOverrides,
    },
    theme: createRenderTheme(),
    thinkingLevel,
  };
}

function createRenderEditor(state: ReturnType<typeof createRenderEditorState>) {
  return new HudCustomEditor(
    { terminal: { rows: 24 }, requestRender: vi.fn() } as any,
    createRenderTheme() as any,
    { matches: vi.fn().mockReturnValue(false) } as any,
    state as any,
  );
}

describe('HudCustomEditor direct rendering', () => {
  it('renders inner breadcrumb with model, thinking level, and folder from instance state', () => {
    const editor = createRenderEditor(createRenderEditorState({}, 'high'));

    const [topLine] = editor.render(100);

    expect(topLine).toContain('Claude 3.5');
    expect(topLine).toContain('⚡ high');
    expect(topLine).toContain('project-alpha');
  });

  it('truncates inner breadcrumb safely when width is narrow', () => {
    const editor = createRenderEditor(createRenderEditorState({
      cwd: '/workspaces/project-with-a-very-long-name',
      model: { name: 'Very Long Model Name' },
    }, 'extreme'));

    const lines = editor.render(24);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(24);
  });

  it('keeps old editor instances isolated from newer editor state', () => {
    const oldEditor = createRenderEditor(createRenderEditorState({
      cwd: '/workspaces/old-folder',
      model: { name: 'Old Model' },
    }, 'low'));
    const newEditor = createRenderEditor(createRenderEditorState({
      cwd: '/workspaces/new-folder',
      model: { name: 'New Model' },
    }, 'high'));

    newEditor.render(100);
    const [oldTopLine] = oldEditor.render(100);

    expect(oldTopLine).toContain('Old Model');
    expect(oldTopLine).toContain('⚡ low');
    expect(oldTopLine).toContain('old-folder');
    expect(oldTopLine).not.toContain('New Model');
    expect(oldTopLine).not.toContain('⚡ high');
    expect(oldTopLine).not.toContain('new-folder');
  });

  it('keeps original breadcrumb output when the original context is mutated after construction', () => {
    const state = createRenderEditorState({}, 'low');
    const editor = createRenderEditor(state);

    state.ctx.cwd = '/workspaces/mutated-folder';
    state.ctx.model = { name: 'Mutated Model' };
    state.thinkingLevel = 'high';

    const [topLine] = editor.render(100);

    expect(topLine).toContain('Claude 3.5');
    expect(topLine).toContain('⚡ low');
    expect(topLine).toContain('project-alpha');
    expect(topLine).not.toContain('Mutated Model');
    expect(topLine).not.toContain('⚡ high');
    expect(topLine).not.toContain('mutated-folder');
  });
});

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
      getThinkingLevel: vi.fn().mockReturnValue('med'),
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
          bold: (text: string) => `<b>${text}</b>`,
        },
        setEditorComponent: vi.fn(),
        setWidget: vi.fn(),
        setHeader: vi.fn(),
        setFooter: vi.fn(),
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
    expect(mockPi.on).toHaveBeenCalledWith('thinking_level_select', expect.any(Function));
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

  it('should do nothing on hud_settings_changed if payload is invalid', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    // Call setting changed with invalid context (no .ui)
    const badCtx = { cwd: '/mock/cwd' };
    busHandlers['hud_settings_changed'](badCtx);

    // The handler should safely return early and not mutate or crash
    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledTimes(1); // Only from session_start
  });

  it('should remove editor component and top widget when breadcrumb is hide', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'hide',
      footer: true,
      header: true,
      'header-info': false,
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(undefined);
    expect(mockCtx.ui.setWidget).toHaveBeenCalledWith('hud-breadcrumb-widget', undefined);
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
    expect(mockCtx.ui.setWidget).toHaveBeenLastCalledWith('hud-breadcrumb-widget', undefined);
    expect(unsubMock).toHaveBeenCalled();
  });

  it('keeps a previously registered editor instance isolated after model_select creates newer state', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    const editors: HudCustomEditor[] = [];
    const mockTui = { terminal: { rows: 24 }, requestRender: vi.fn() };
    mockCtx.ui.theme = createRenderTheme();
    mockCtx.ui.setEditorComponent.mockImplementation((factory: any) => {
      if (factory) {
        editors.push(factory(mockTui, mockCtx.ui.theme, {}));
      }
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    const newerCtx = {
      ...mockCtx,
      cwd: '/mock/new-folder',
      model: { name: 'New Model' },
    };
    eventHandlers['model_select']({}, newerCtx);

    expect(editors).toHaveLength(2);
    const [oldTopLine] = editors[0].render(100);
    const [newTopLine] = editors[1].render(100);
    expect(oldTopLine).toContain('Claude 3.5');
    expect(oldTopLine).toContain('cwd');
    expect(oldTopLine).not.toContain('New Model');
    expect(oldTopLine).not.toContain('new-folder');
    expect(newTopLine).toContain('New Model');
    expect(newTopLine).toContain('new-folder');
  });

  it('keeps a delayed old editor factory isolated after model_select creates newer state', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    const factories: Function[] = [];
    const mockTui = { terminal: { rows: 24 }, requestRender: vi.fn() };
    mockCtx.ui.theme = createRenderTheme();
    mockCtx.ui.setEditorComponent.mockImplementation((factory: any) => {
      if (factory) {
        factories.push(factory);
      }
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    const newerCtx = {
      ...mockCtx,
      cwd: '/mock/new-folder',
      model: { name: 'New Model' },
    };
    eventHandlers['model_select']({}, newerCtx);

    expect(factories).toHaveLength(2);
    const delayedOldEditor = factories[0](mockTui, mockCtx.ui.theme, {});
    const delayedNewEditor = factories[1](mockTui, mockCtx.ui.theme, {});

    const [oldTopLine] = delayedOldEditor.render(100);
    const [newTopLine] = delayedNewEditor.render(100);
    expect(oldTopLine).toContain('Claude 3.5');
    expect(oldTopLine).toContain('cwd');
    expect(oldTopLine).not.toContain('New Model');
    expect(oldTopLine).not.toContain('new-folder');
    expect(newTopLine).toContain('New Model');
    expect(newTopLine).toContain('new-folder');
  });

  it('keeps two editor instances from the same factory isolated with different themes', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    let factory: Function | undefined;
    const mockTui = { terminal: { rows: 24 }, requestRender: vi.fn() };
    mockCtx.ui.setEditorComponent.mockImplementation((registeredFactory: any) => {
      factory = registeredFactory;
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    expect(factory).toEqual(expect.any(Function));
    const firstEditor = factory!(mockTui, createTaggedRenderTheme('first'), {});
    factory!(mockTui, createTaggedRenderTheme('second'), {});

    const [firstTopLine] = firstEditor.render(100);

    expect(firstTopLine).toContain('[first:dim]');
    expect(firstTopLine).toContain('Claude 3.5');
    expect(firstTopLine).toContain('[first:accent]');
    expect(firstTopLine).not.toContain('[second:dim]');
    expect(firstTopLine).not.toContain('[second:accent]');
  });

  it('should update state and request render on model_select', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    const mockTui = { requestRender: vi.fn() };
    mockCtx.ui.setEditorComponent.mockImplementation((factory: any) => {
      if (factory) {
        factory(mockTui, mockCtx.ui.theme, {});
      }
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    // Trigger model select
    eventHandlers['model_select']({}, mockCtx);

    expect(mockTui.requestRender).toHaveBeenCalled();
  });

  it('should update state and request render on thinking_level_select', () => {
    vi.mocked(readSettings).mockReturnValue({
      enabled: true,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    const mockTui = { requestRender: vi.fn() };
    mockCtx.ui.setEditorComponent.mockImplementation((factory: any) => {
      if (factory) {
        factory(mockTui, mockCtx.ui.theme, {});
      }
    });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);

    eventHandlers['thinking_level_select']({ level: 'high' }, mockCtx);

    expect(mockTui.requestRender).toHaveBeenCalled();
  });

  it('clears inner editor on model_select when current breadcrumb setting is top', () => {
    vi.mocked(readSettings)
      .mockReturnValueOnce({
        enabled: true,
        breadcrumb: 'inner',
        footer: true,
        header: true,
        'header-info': false,
      })
      .mockReturnValue({
        enabled: true,
        breadcrumb: 'top',
        footer: true,
        header: true,
        'header-info': false,
      });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);
    mockCtx.ui.setEditorComponent.mockClear();

    eventHandlers['model_select']({}, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(undefined);
  });

  it('clears inner editor on thinking_level_select when current breadcrumb setting is hide', () => {
    vi.mocked(readSettings)
      .mockReturnValueOnce({
        enabled: true,
        breadcrumb: 'inner',
        footer: true,
        header: true,
        'header-info': false,
      })
      .mockReturnValue({
        enabled: true,
        breadcrumb: 'hide',
        footer: true,
        header: true,
        'header-info': false,
      });

    registerEditor(mockPi);
    eventHandlers['session_start']({}, mockCtx);
    mockCtx.ui.setEditorComponent.mockClear();

    eventHandlers['thinking_level_select']({ level: 'high' }, mockCtx);

    expect(mockCtx.ui.setEditorComponent).toHaveBeenCalledWith(undefined);
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

    // Simulate settings changing back to disabled
    vi.mocked(readSettings).mockReturnValue({
      enabled: false,
      breadcrumb: 'inner',
      footer: true,
      header: true,
      'header-info': false,
    });

    busHandlers['hud_settings_changed'](mockCtx);
    expect(mockCtx.ui.setEditorComponent).toHaveBeenLastCalledWith(undefined);
  });
});
