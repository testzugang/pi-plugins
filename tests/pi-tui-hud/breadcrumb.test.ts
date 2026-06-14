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
});
