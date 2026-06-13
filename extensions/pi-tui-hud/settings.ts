import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface HudSettings {
  enabled: boolean;
  breadcrumb: 'hide' | 'top' | 'inner';
  footer: boolean;
  header: boolean;
  'header-info': boolean;
}

export const DEFAULT_SETTINGS: HudSettings = {
  enabled: true,
  breadcrumb: 'inner',
  footer: true,
  header: true,
  'header-info': false,
};

export function readSettings(cwd: string): HudSettings {
  const globalPath = join(homedir(), '.pi', 'agent', 'hud', 'settings.json');
  const localPath = join(cwd, '.pi', 'hud.json');

  let config = { ...DEFAULT_SETTINGS };

  if (existsSync(globalPath)) {
    try {
      const globalData = JSON.parse(readFileSync(globalPath, 'utf8'));
      config = { ...config, ...globalData };
    } catch {}
  }

  if (existsSync(localPath)) {
    try {
      const localData = JSON.parse(readFileSync(localPath, 'utf8'));
      config = { ...config, ...localData };
    } catch {}
  }

  return config;
}

export function writeSetting(cwd: string, key: keyof HudSettings, value: any): void {
  const localDir = join(cwd, '.pi');
  const localPath = join(localDir, 'hud.json');

  const current = readSettings(cwd);
  current[key] = value as never;

  try {
    mkdirSync(localDir, { recursive: true });
    writeFileSync(localPath, JSON.stringify(current, null, 2), 'utf8');
  } catch {}
}
