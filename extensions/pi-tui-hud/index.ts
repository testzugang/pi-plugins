import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerEditor } from './editor';
import { registerHeader } from './header';
import { registerFooter } from './footer';
import { readEffectiveSettings, readSettings, writeSetting } from './settings';

export default function (pi: ExtensionAPI) {

  pi.registerFlag('hud', {
    description: 'Enable custom pi-tui-hud status bar, header, and breadcrumbs',
    type: 'boolean',
    default: true,
  });

  registerEditor(pi);
  registerHeader(pi);
  registerFooter(pi);

  pi.registerCommand('hud', {
    description: 'Configure HUD layout and features. Usage: /hud <info|breadcrumb:<hide|top|inner>|footer:<on|off>|header:<on|off>|header-info:<on|off>>',
    handler: async (args, ctx) => {
      if (!ctx || !ctx.hasUI || !ctx.ui) return;
      const arg = args?.trim().toLowerCase();

      if (!arg) {
        const cliEnabled = pi.getFlag('hud') !== false;
        if (!cliEnabled) {
          ctx.ui.notify('HUD is forced off by the --hud command-line flag.', 'warning');
          return;
        }

        const config = readSettings(ctx.cwd);
        const next = !config.enabled;
        
        try {
          writeSetting(ctx.cwd, 'enabled', next);
          pi.events.emit('hud_settings_changed', ctx);
          ctx.ui.notify(`HUD enabled → ${next ? 'on' : 'off'}`, 'info');
        } catch (err) {
          ctx.ui.notify(`Failed to save HUD settings: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        return;
      }

      if (arg === 'info') {
        const cliEnabled = pi.getFlag('hud') !== false;
        const c = readEffectiveSettings(ctx.cwd, { hudEnabled: cliEnabled });
        ctx.ui.notify(
          `HUD Settings:\n` +
            `• Enabled: ${c.enabled ? 'yes' : 'no'}${cliEnabled ? '' : ' (forced off by CLI --hud=false)'}\n` +
            `• Breadcrumb: ${c.breadcrumb}\n` +
            `• Footer: ${c.footer ? 'on' : 'off'}\n` +
            `• Header: ${c.header ? 'on' : 'off'}\n` +
            `• Header-Info: ${c['header-info'] ? 'on' : 'off'}`,
          'info',
        );
        return;
      }

      const colonIdx = arg.indexOf(':');
      if (colonIdx === -1) {
        ctx.ui.notify('Invalid command format. Use /hud <info|breadcrumb:<hide|top|inner>|footer:<on|off>|header:<on|off>|header-info:<on|off>>', 'error');
        return;
      }

      const key = arg.slice(0, colonIdx);
      const val = arg.slice(colonIdx + 1);

      if (key === 'breadcrumb') {
        if (!['hide', 'top', 'inner'].includes(val)) {
          ctx.ui.notify('Breadcrumb mode must be: hide, top, or inner', 'warning');
          return;
        }
        try {
          writeSetting(ctx.cwd, 'breadcrumb', val as 'hide' | 'top' | 'inner');
          pi.events.emit('hud_settings_changed', ctx);
          ctx.ui.notify(`Breadcrumb set to: ${val}`, 'info');
        } catch (err) {
          ctx.ui.notify(`Failed to save HUD settings: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        return;
      }

      if (key === 'footer' || key === 'header' || key === 'header-info') {
        if (val !== 'on' && val !== 'off') {
          ctx.ui.notify('Value must be: on or off', 'warning');
          return;
        }
        const state = val === 'on';
        try {
          writeSetting(ctx.cwd, key, state);
          pi.events.emit('hud_settings_changed', ctx);
          ctx.ui.notify(`${key} turned ${val}`, 'info');
        } catch (err) {
          ctx.ui.notify(`Failed to save HUD settings: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
        return;
      }

      ctx.ui.notify('Unknown sub-command.', 'error');
    },
  });
}
