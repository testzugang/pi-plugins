import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readSettings } from './settings';
import { withIcon } from './utils';
import { visibleWidth, truncateToWidth } from '@earendil-works/pi-tui';

export function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1).replace('.0', '')}k`;
  return `${(count / 1000000).toFixed(1).replace('.0', '')}M`;
}

export function registerFooter(pi: ExtensionAPI) {
  let isStreaming = false;
  let liveUsage: any = null;
  let liveTui: any = null;

  pi.on('session_start', (_event, ctx: ExtensionContext) => {
    const s = readSettings(ctx.cwd);
    if (!s.enabled || !s.footer || !ctx.hasUI) return;

    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      liveTui = tui;
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

      return {
        render(width: number): string[] {
          // Read git branch
          const branch = footerData.getGitBranch() || '';
          const gitSegment = branch ? theme.fg('success', withIcon('⎇', branch)) : '';

          // Read cumulative stats (Input, Output, Cache, Costs)
          let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0;
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === 'message' && entry.message.role === 'assistant') {
              const m = entry.message as any;
              if (m.usage) {
                totalInput += m.usage.input || 0;
                totalOutput += m.usage.output || 0;
                totalCacheRead += m.usage.cacheRead || 0;
                totalCacheWrite += m.usage.cacheWrite || 0;
                totalCost += m.usage.cost?.total || 0;
              }
            }
          }

          if (isStreaming && liveUsage) {
            totalInput += liveUsage.input || 0;
            totalOutput += liveUsage.output || 0;
            totalCacheRead += liveUsage.cacheRead || 0;
            totalCacheWrite += liveUsage.cacheWrite || 0;
            totalCost += liveUsage.cost?.total || 0;
          }

          // Build context percentage
          const contextUsage = ctx.getContextUsage();
          const tokens = contextUsage?.tokens ?? (totalInput + totalOutput + totalCacheRead);
          const maxWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 100000;
          
          let ratio = maxWindow > 0 ? (tokens / maxWindow) * 100 : 0;
          if (contextUsage && typeof contextUsage.percent === 'number') {
            ratio = contextUsage.percent;
          }
          
          let pctStr = `${ratio.toFixed(1)}%/${formatTokenCount(maxWindow)}`;
          if (ratio > 90) pctStr = theme.fg('error', pctStr);
          else if (ratio > 70) pctStr = theme.fg('warning', pctStr);

          // Build Cache Hit Rate
          const promptTokens = totalInput + totalCacheRead + totalCacheWrite;
          const cacheHitPercent = promptTokens > 0 ? (totalCacheRead / promptTokens) * 100 : 0;
          const cacheStr = totalCacheRead > 0 ? ` CH:${cacheHitPercent.toFixed(1)}%` : '';

          // Build Cost Segment
          const costStr = totalCost > 0 ? ` $${totalCost.toFixed(3)}` : '';

          const leftSegment = `${gitSegment ? gitSegment + ' ' : ''}${pctStr} ↑${formatTokenCount(totalInput)} ↓${formatTokenCount(totalOutput)}${cacheStr}${costStr}`;
          
          // Thinking status (Right segment)
          const tl = pi.getThinkingLevel() || 'off';
          const rightSegment = tl !== 'off' ? theme.fg('accent', `⚡ ${tl}`) : '';

          const leftWidth = visibleWidth(leftSegment);
          const rightWidth = visibleWidth(rightSegment);
          const spaceNeeded = width - leftWidth - rightWidth;
          const padding = spaceNeeded > 0 ? ' '.repeat(spaceNeeded) : '  ';

          const lines = [`${leftSegment}${padding}${rightSegment}`];

          // Line 2: Extension statuses
          const extensionStatuses = footerData.getExtensionStatuses() as Map<string, string>;
          if (extensionStatuses && extensionStatuses.size > 0) {
            const statusLine = Array.from(extensionStatuses.values()).join('  ');
            lines.push(truncateToWidth(statusLine, width, theme.fg('dim', '...')));
          }

          return lines;
        },
        dispose() {
          liveTui = null;
          unsubBranch();
        }
      };
    });
  });

  pi.on('agent_start', () => { 
    isStreaming = true; 
    liveUsage = null; 
    liveTui?.requestRender();
  });
  
  pi.on('message_update', (event) => { 
    if (isStreaming) {
      liveUsage = event.message.usage; 
      liveTui?.requestRender();
    }
  });
  
  pi.on('message_end', () => { 
    isStreaming = false; 
    liveTui?.requestRender();
  });

  pi.on('thinking_level_select', () => {
    liveTui?.requestRender();
  });
}
