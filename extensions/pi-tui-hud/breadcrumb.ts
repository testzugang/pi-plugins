import { basename } from 'node:path';
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { hasNerdFonts, hexFg, withIcon } from './utils';

const NERD = hasNerdFonts();
export const ICON_MODEL = NERD ? '\uF4BC' : '';
export const ICON_FOLDER = NERD ? '\uF115' : '';
export const SEP = NERD ? '\uf054' : '/';

export interface BreadcrumbData {
  modelName: string;
  folder: string;
  modelText: string;
  folderText: string;
}

export function sanitizePlainText(text: string): string {
  return text
    .replace(/\x1b/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export function getBreadcrumbData(ctx: ExtensionContext | null): BreadcrumbData {
  const cwd = ctx?.cwd ?? process.cwd();
  const folder = sanitizePlainText(basename(cwd) || cwd);
  const modelName = sanitizePlainText(ctx?.model?.name || ctx?.model?.id || 'no-model');

  return {
    modelName,
    folder,
    modelText: withIcon(ICON_MODEL, modelName),
    folderText: withIcon(ICON_FOLDER, folder),
  };
}

export function renderBreadcrumbInfo(data: BreadcrumbData, theme: Theme): string {
  return (
    hexFg('#d787af', data.modelText) +
    theme.fg('dim', ` ${SEP} `) +
    hexFg('#00afaf', data.folderText)
  );
}
