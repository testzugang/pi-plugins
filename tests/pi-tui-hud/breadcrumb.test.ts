import { describe, it, expect } from 'vitest';
import { getBreadcrumbData, renderBreadcrumbInfo } from '../../extensions/pi-tui-hud/breadcrumb';

describe('breadcrumb calculations', () => {
  it('should correctly format breadcrumb object structure', () => {
    const mockCtx = { cwd: '/workspace/my-project', model: { name: 'claude-3-5', id: 'claude' } };
    const data = getBreadcrumbData(mockCtx as any, 'high');
    expect(data.folder).toBe('my-project');
    expect(data.modelName).toBe('claude-3-5');
    expect(data.thinkingLevel).toBe('high');
    expect(data.modelText).toContain('claude-3-5');
    expect(data.thinkingText).toContain('high');
    expect(data.folderText).toContain('my-project');
  });

  it('should render breadcrumb info with correct color and styling', () => {
    const mockTheme = {
      fg: (token: string, text: string) => `[${token}]${text}`,
      bold: (text: string) => `<b>${text}</b>`,
    };
    const mockData = {
      modelName: 'claude',
      folder: 'project',
      thinkingLevel: 'med',
      modelText: 'claude',
      thinkingText: '⚡ med',
      folderText: 'project'
    };
    const info = renderBreadcrumbInfo(mockData, mockTheme as any);
    expect(info).toContain('[accent]<b>project</b>');
    expect(info).toContain('[dim]claude');
    expect(info).toContain('[accent]⚡ med');
    expect(info).toContain('[dim]');
  });
});
