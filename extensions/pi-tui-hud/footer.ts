import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { readEffectiveSettings, DEFAULT_SETTINGS } from './settings';
import { withIcon, isExtensionContext } from './utils';
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

function sortedStatusEntries(extensionStatuses: ReadonlyMap<string, string>): [string, string][] {
  return Array.from(extensionStatuses.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function buildStatusSignature(extensionStatuses: ReadonlyMap<string, string>): string {
  let signature = `${extensionStatuses.size}|`;
  for (const [key, value] of extensionStatuses.entries()) {
    signature += `${key.length}:${key}${value.length}:${value}`;
  }
  return signature;
}

function buildStatusCacheKey(sortedEntries: [string, string][]): string {
  return JSON.stringify(sortedEntries);
}

function renderStatusLine(sortedEntries: [string, string][]): string {
  return sortedEntries
    .map(([, text]) => sanitizeStatusText(text) + '\x1b[0m') // Append reset to each entry to isolate styles
    .join('  ');
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

function renderContextUsage(theme: Theme, ratio: number | null, text: string): string {
  if (ratio === null) return text;
  if (ratio > 90) return theme.fg('error', theme.bold(text));
  if (ratio >= 70) return theme.fg('warning', text);
  if (ratio >= 50) return theme.fg('accent', text);
  return theme.fg('success', text);
}

type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

function emptyUsageTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(totals: UsageTotals, usage: any): UsageTotals {
  if (!usage) return totals;
  return {
    input: totals.input + (usage.input || 0),
    output: totals.output + (usage.output || 0),
    cacheRead: totals.cacheRead + (usage.cacheRead || 0),
    cacheWrite: totals.cacheWrite + (usage.cacheWrite || 0),
    cost: totals.cost + (usage.cost?.total || 0),
  };
}

function collectAssistantUsage(ctx: ExtensionContext): UsageTotals {
  let totals = emptyUsageTotals();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      totals = addUsage(totals, (entry.message as any).usage);
    }
  }
  return totals;
}

export function registerFooter(pi: ExtensionAPI) {
  let isStreaming = false;
  let liveUsage: any = null;
  let liveTui: any = null;
  let unsubSettings: (() => void) | null = null;
  let cachedSettings = DEFAULT_SETTINGS;
  let footerEnabled = false;
  let activeCtx: ExtensionContext | null = null;
  let cumulativeUsage = emptyUsageTotals();

  function runtimeSettings() {
    return { hudEnabled: pi.getFlag('hud') !== false };
  }

  function enable(ctx: ExtensionContext) {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    footerEnabled = true;
    activeCtx = ctx;
    cachedSettings = readEffectiveSettings(ctx.cwd, runtimeSettings());
    cumulativeUsage = collectAssistantUsage(ctx);

    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      liveTui = tui;
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
      let statusCacheKey = '';
      let statusCacheLine = '';
      let statusCacheSignature = '';

      return {
        render(width: number): string[] {
          // Double-check active state using cached config without I/O
          if (!cachedSettings.enabled || !cachedSettings.footer) {
            return [];
          }

          // Read git branch
          const branch = footerData.getGitBranch() || '';
          const gitSegment = branch ? theme.fg('success', theme.bold(withIcon('⎇', branch))) : '';

          // Read cumulative stats (Input, Output, Cache, Costs)
          const totalUsage = isStreaming && liveUsage
            ? addUsage(cumulativeUsage, liveUsage)
            : cumulativeUsage;
          const totalInput = totalUsage.input;
          const totalOutput = totalUsage.output;
          const totalCacheRead = totalUsage.cacheRead;
          const totalCacheWrite = totalUsage.cacheWrite;
          const totalCost = totalUsage.cost;

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

          pctStr = renderContextUsage(theme, ratio, pctStr);

          // Build Cache Hit Rate
          const promptTokens = totalInput + totalCacheRead + totalCacheWrite;
          const cacheHitPercent = promptTokens > 0 ? (totalCacheRead / promptTokens) * 100 : 0;
          const cacheStr = totalCacheRead > 0 ? ` CH:${cacheHitPercent.toFixed(1)}%` : '';

          // Build Cost Segment
          const costStr = totalCost > 0 ? ` $${totalCost.toFixed(3)}` : '';

          const leftSegment = `${gitSegment ? gitSegment + ' ' : ''}${pctStr} ↑${formatTokenCount(totalInput)} ↓${formatTokenCount(totalOutput)}${cacheStr}${costStr}`;

          const leftWidth = visibleWidth(leftSegment);
          let statsLine = leftWidth <= width
            ? leftSegment + ' '.repeat(width - leftWidth)
            : truncateToWidth(leftSegment, width, '...');
          
          if (visibleWidth(statsLine) > width) {
            statsLine = truncateToWidth(statsLine, width, '');
          }

          const lines = [statsLine];

          // Line 2: Extension statuses
          const extensionStatuses = footerData.getExtensionStatuses() as ReadonlyMap<string, string>;
          if (extensionStatuses && extensionStatuses.size > 0) {
            const statusSignature = buildStatusSignature(extensionStatuses);
            if (statusSignature !== statusCacheSignature) {
              const sorted = sortedStatusEntries(extensionStatuses);
              const cacheKey = buildStatusCacheKey(sorted);
              if (cacheKey !== statusCacheKey) {
                statusCacheKey = cacheKey;
                statusCacheLine = renderStatusLine(sorted);
              }
              statusCacheSignature = statusSignature;
            }
            lines.push(truncateToWidth(statusCacheLine, width, theme.fg('dim', '...')) + '\x1b[0m');
          }

          return lines;
        },
        invalidate() {},
        dispose() {
          if (liveTui === tui) {
            liveTui = null;
          }
          unsubBranch();
        }
      };
    });
  }

  function disable(ctx: ExtensionContext) {
    footerEnabled = false;
    activeCtx = null;
    liveTui = null;
    if (ctx && ctx.hasUI && ctx.ui) {
      ctx.ui.setFooter(undefined);
    }
  }

  pi.on('session_start', (_event, ctx: ExtensionContext) => {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;

    const s = readEffectiveSettings(ctx.cwd, runtimeSettings());
    if (s.enabled && s.footer) {
      enable(ctx);
    } else {
      disable(ctx);
    }

    if (unsubSettings) {
      unsubSettings();
    }

    unsubSettings = pi.events.on('hud_settings_changed', (changeCtx) => {
      if (!isExtensionContext(changeCtx)) return;

      const updatedSettings = readEffectiveSettings(changeCtx.cwd, runtimeSettings());
      cachedSettings = updatedSettings;

      if (updatedSettings.enabled && updatedSettings.footer && !footerEnabled) {
        enable(changeCtx);
      } else if ((!updatedSettings.enabled || !updatedSettings.footer) && footerEnabled) {
        disable(changeCtx);
      } else if (footerEnabled) {
        liveTui?.requestRender();
      }
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

  pi.on('message_end', (event) => {
    isStreaming = false;
    if (event?.message?.usage) {
      cumulativeUsage = addUsage(cumulativeUsage, event.message.usage);
    } else if (activeCtx) {
      cumulativeUsage = collectAssistantUsage(activeCtx);
    }
    liveUsage = null;
    liveTui?.requestRender();
  });

  pi.on('thinking_level_select', () => {
    liveTui?.requestRender();
  });

  pi.on('session_shutdown', (_event, ctx) => {
    if (!ctx) return;
    if (footerEnabled) {
      disable(ctx);
    }
    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }
  });
}
