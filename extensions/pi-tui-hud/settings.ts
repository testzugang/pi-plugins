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

const BOOLEAN_KEYS: Array<keyof HudSettings> = ['enabled', 'footer', 'header', 'header-info'];
const BREADCRUMB_VALUES: HudSettings['breadcrumb'][] = ['hide', 'top', 'inner'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSettingValue(key: keyof HudSettings, value: unknown): value is HudSettings[keyof HudSettings] {
  if (BOOLEAN_KEYS.includes(key)) {
    return typeof value === 'boolean';
  }

  return BREADCRUMB_VALUES.includes(value as HudSettings['breadcrumb']);
}

export function validateSettings(settings: unknown, source = 'HUD settings'): Partial<HudSettings> {
  if (!isRecord(settings)) {
    console.warn(`${source} must be a JSON object. Ignoring settings.`);
    return {};
  }

  const validated: Partial<HudSettings> = {};

  for (const key of [...BOOLEAN_KEYS, 'breadcrumb'] as Array<keyof HudSettings>) {
    if (!(key in settings)) {
      continue;
    }

    const value = settings[key];
    if (isValidSettingValue(key, value)) {
      validated[key] = value as never;
    } else {
      console.warn(`Invalid HUD setting ${String(key)} in ${source}. Ignoring value.`);
    }
  }

  return validated;
}

function readSettingsFile(path: string): Partial<HudSettings> {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return validateSettings(JSON.parse(readFileSync(path, 'utf8')), path);
  } catch (error) {
    console.warn(`Could not read HUD settings from ${path}. Ignoring file.`, error);
    return {};
  }
}

export function readSettings(cwd: string): HudSettings {
  const globalPath = join(homedir(), '.pi', 'agent', 'hud', 'settings.json');
  const localPath = join(cwd, '.pi', 'hud.json');

  return {
    ...DEFAULT_SETTINGS,
    ...readSettingsFile(globalPath),
    ...readSettingsFile(localPath),
  };
}

export function writeSetting(
  cwd: string,
  key: keyof HudSettings,
  value: HudSettings[keyof HudSettings],
): void {
  if (!isValidSettingValue(key, value)) {
    throw new TypeError(`Invalid HUD setting value for ${String(key)}`);
  }

  const localDir = join(cwd, '.pi');
  const localPath = join(localDir, 'hud.json');
  const current = readSettingsFile(localPath);

  current[key] = value as never;

  mkdirSync(localDir, { recursive: true });
  writeFileSync(localPath, JSON.stringify(current, null, 2), 'utf8');
}
