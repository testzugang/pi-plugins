import { describe, it, expect } from 'vitest';
import { getBreadcrumbData, renderBreadcrumbInfo } from '../../extensions/pi-tui-hud/breadcrumb';

describe('breadcrumb calculations', () => {
  it('should correctly format breadcrumb object structure', () => {
    const mockCtx = { cwd: '/workspace/my-project', model: { name: 'claude-3-5', id: 'claude' } };
    const data = getBreadcrumbData(mockCtx as any);
    expect(data.folder).toBe('my-project');
    expect(data.modelName).toBe('claude-3-5');
    expect(data.modelText).toContain('claude-3-5');
    expect(data.folderText).toContain('my-project');
  });

  it('should render breadcrumb info with correct color and styling', () => {
    const mockTheme = {
      fg: (token: string, text: string) => `[${token}]${text}`
    };
    const mockData = {
      modelName: 'claude',
      folder: 'project',
      modelText: 'claude',
      folderText: 'project'
    };
    const info = renderBreadcrumbInfo(mockData, mockTheme as any);
    expect(info).toContain('project');
    expect(info).toContain('claude');
    expect(info).toContain('[dim]');
  });
});
