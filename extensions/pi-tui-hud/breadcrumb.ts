import { basename } from 'node:path';
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { hasNerdFonts, withIcon } from './utils';

const NERD = hasNerdFonts();
export const ICON_MODEL = NERD ? '\uF4BC' : '';
export const ICON_FOLDER = NERD ? '\uF115' : '';
export const SEP = NERD ? '\uf054' : '/';

export interface BreadcrumbData {
  modelName: string;
  folder: string;
  thinkingLevel: string;
  modelText: string;
  thinkingText: string;
  folderText: string;
}

export function sanitizePlainText(text: string): string {
  return text
    .replace(/\x1b/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export function getBreadcrumbData(ctx: ExtensionContext | null, thinkingLevel = 'off'): BreadcrumbData {
  const cwd = ctx?.cwd ?? process.cwd();
  const folder = sanitizePlainText(basename(cwd) || cwd);
  const modelName = sanitizePlainText(ctx?.model?.name || ctx?.model?.id || 'no-model');
  const sanitizedThinkingLevel = sanitizePlainText(thinkingLevel || 'off');

  return {
    modelName,
    folder,
    thinkingLevel: sanitizedThinkingLevel,
    modelText: withIcon(ICON_MODEL, modelName),
    thinkingText: `⚡ ${sanitizedThinkingLevel}`,
    folderText: withIcon(ICON_FOLDER, folder),
  };
}

export function renderBreadcrumbInfo(data: BreadcrumbData, theme: Theme): string {
  return (
    theme.fg('dim', data.modelText) +
    ' ' +
    theme.fg('accent', data.thinkingText) +
    theme.fg('dim', ` ${SEP} `) +
    theme.fg('accent', theme.bold(data.folderText))
  );
}
