import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readSettings } from './settings';
import { withIcon } from './utils';
import { visibleWidth, truncateToWidth } from '@earendil-works/pi-tui';

function isSafeSgr(paramsStr: string): boolean {
  const params = paramsStr.split(';').map((p) => parseInt(p, 10));
  if (params.length === 0 || (params.length === 1 && isNaN(params[0]))) {
    return true;
  }

  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (isNaN(p)) return false;

    if ([0, 1, 2, 22, 4, 24, 39, 49].includes(p)) continue;
    if (p >= 30 && p <= 37) continue;
    if (p >= 40 && p <= 47) continue;
    if (p >= 90 && p <= 97) continue;
    if (p >= 100 && p <= 107) continue;

    if ((p === 38 || p === 48) && i + 1 < params.length) {
      const mode = params[i + 1];
      if (mode === 5 && i + 2 < params.length) {
        const color = params[i + 2];
        if (color >= 0 && color <= 255) {
          i += 2;
          continue;
        }
      } else if (mode === 2 && i + 4 < params.length) {
        const r = params[i + 2];
        const g = params[i + 3];
        const b = params[i + 4];
        if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
          i += 4;
          continue;
        }
      }
    }

    return false;
  }
  return true;
}

function sanitizeStatusText(text: string): string {
  // 1. Translate 8-bit C1 controls to 7-bit ESC equivalents to ensure complete payload stripping
  let clean = text
    .replace(/\u009b/g, '\x1b[')
    .replace(/\u009d/g, '\x1b]')
    .replace(/\u0090/g, '\x1bP')
    .replace(/\u009e/g, '\x1b^')
    .replace(/\u009f/g, '\x1b_')
    .replace(/\u0098/g, '\x1bX')
    .replace(/\u009c/g, '\x1b\\');

  const sgrCodes: string[] = [];
  const tokenPrefix = `__HUD_SGR_SAFE_COLOR_TOKEN_${Math.random().toString(36).slice(2)}__`;
  
  // 2. Extract and mask ONLY approved SGR color and style formatting codes, discard blink/hidden/other SGRs
  clean = clean.replace(/\x1b\[([0-9;]*)m/g, (match, paramsStr) => {
    if (isSafeSgr(paramsStr)) {
      sgrCodes.push(match);
      return `${tokenPrefix}${sgrCodes.length - 1}__`;
    }
    return '';
  });

  // 3. Strip all other CSI sequences (like \x1b[2J or \x1b[?1049h or \x1b[0 q) including intermediate spaces and full parameter range
  clean = clean.replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '');

  // 4. Strip OSC sequences safely even if incomplete (supports embedded ESCs except ST, stops at next \x1b or end of string if no BEL/ST)
  clean = clean.replace(/\x1b\](?:[^\x07\x1b]|\x1b[^\\])*(?:\x07|\x1b\\)?/g, '');

  // 5. Strip DCS, SOS, PM, APC sequences (starts with ESC followed by [PX^_] and ends with ESC \) including arbitrary length payload
  clean = clean.replace(/\x1b[PX^_](?:[^\x1b]|\x1b[^\\])*(?:\x1b\\)?/g, '');

  // 6. Strip all other ESC sequences (SS2, SS3, charsets, etc.)
  clean = clean.replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '');

  // 7. Unconditionally strip all remaining ESC (0x1b) chars and other dangerous controls (0x00-0x1f, 0x7f, and C1 8-bit controls 0x80-0x9f) including tab (0x09)
  clean = clean.replace(/\x1b/g, ' ');
  clean = clean.replace(/[\x00-\x09\x0a-\x1a\x1c-\x1f\x7f\x80-\x9f]/g, ' ');

  // 8. Restore masked safe SGR color codes
  const restoreRegex = new RegExp(`${tokenPrefix}(\\d+)__`, 'g');
  clean = clean.replace(restoreRegex, (_, idx) => {
    return sgrCodes[parseInt(idx, 10)] || '';
  });

  // 9. Normalize whitespace
  return clean.replace(/ +/g, ' ').trim();
}

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
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      liveTui = tui;
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

      return {
        render(width: number): string[] {
          const s = readSettings(ctx.cwd);
          if (!s.enabled || !s.footer) {
            return [];
          }

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
          const maxWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 100000;
          let ratio: number | null = null;
          let pctStr = '';

          if (contextUsage && typeof contextUsage.percent === 'number') {
            ratio = contextUsage.percent;
            pctStr = `${ratio.toFixed(1)}%/${formatTokenCount(maxWindow)}`;
          } else {
            // Plan-aligned fallback: Calculate ratio from cumulative + live totals when contextUsage tokens are missing
            const tokens = contextUsage ? contextUsage.tokens : (totalInput + totalOutput + totalCacheRead);
            if (typeof tokens === 'number') {
              ratio = maxWindow > 0 ? (tokens / maxWindow) * 100 : 0;
              pctStr = `${ratio.toFixed(1)}%/${formatTokenCount(maxWindow)}`;
            } else {
              pctStr = `?%/${formatTokenCount(maxWindow)}`;
            }
          }

          if (ratio !== null) {
            if (ratio > 90) pctStr = theme.fg('error', pctStr);
            else if (ratio > 70) pctStr = theme.fg('warning', pctStr);
          }

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
          
          let statsLine: string;
          if (spaceNeeded >= 0) {
            statsLine = `${leftSegment}${' '.repeat(spaceNeeded)}${rightSegment}`;
          } else {
            const availLeft = Math.max(0, width - rightWidth - 2);
            const truncatedLeft = truncateToWidth(leftSegment, availLeft, '...');
            const padSize = Math.max(0, width - visibleWidth(truncatedLeft) - rightWidth);
            statsLine = `${truncatedLeft}${' '.repeat(padSize)}${rightSegment}`;
          }

          if (visibleWidth(statsLine) > width) {
            statsLine = truncateToWidth(statsLine, width, '');
          }

          const lines = [statsLine];

          // Line 2: Extension statuses
          const extensionStatuses = footerData.getExtensionStatuses() as Map<string, string>;
          if (extensionStatuses && extensionStatuses.size > 0) {
            const sorted = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => sanitizeStatusText(text) + '\x1b[0m'); // Append reset to each entry to isolate styles
            const statusLine = sorted.join('  ');
            lines.push(truncateToWidth(statusLine, width, theme.fg('dim', '...')) + '\x1b[0m');
          }

          return lines;
        },
        dispose() {
          if (liveTui === tui) {
            liveTui = null;
          }
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
    if (isStreaming && event?.message?.usage) {
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

  pi.events.on('hud_settings_changed', (changeCtx) => {
    if (changeCtx && liveTui) {
      liveTui.requestRender();
    }
  });
}
