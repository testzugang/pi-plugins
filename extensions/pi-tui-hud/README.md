# pi-tui-hud 🗜️

Secure, high-fidelity HUD status bar for Pi. Real-time token tracking, cumulative cost accounting, model/thinking/folder breadcrumbs, memoized gradient logo header.

`pi-tui-hud` is a transparent TypeScript alternative to the quarantined `pi-powerline` extension. It runs inside the Pi process and uses no external binary or network dependencies.

## ✨ Features

- **Memoized gradient logo header**: Smooth Pink `#d787af` → Cyan `#00afaf` per-grapheme interpolation. Uses `Intl.Segmenter` to preserve complex Unicode emoji/grapheme boundaries and caches repeated `text/start/end` gradient renders.
- **Segmented TUI footer**: Displays git branch, context usage, cumulative input/output tokens, cache hit rate (`CH:XX.X%`) and cumulative session costs (`$X.XXX`). Context usage colors: success `<50%`, accent `50–69.9%`, warning `70–90%`, bold error `>90%`.
- **Render-hotpath caches**: Settings, cumulative usage, sanitized extension status output, and repeated live-usage updates avoid unnecessary work during frequent TUI renders.
- **Reactive settings changes**: Toggles (`/hud footer:off`, `/hud header:off`, etc.) apply instantly in the active TUI without filesystem reads during render.
- **Model ➜ Thinking ➜ Folder breadcrumbs**: Draws dimmed model name, accent thinking level, and bold highlighted folder either inside the editor top border (`inner`) or above the editor as a widget (`top`).
- **Headless safety**: Lifecycle handlers use `isExtensionContext` guards. Shutdown/disabling restores native Pi header/footer/editor components.
- **Terminal-control sanitization**: Extension status strings and breadcrumb/header plaintext fields strip unsafe control sequences before rendering.

## 🛠️ Usage

Inside Pi, use the `/hud` slash command:

- `/hud` — Toggle HUD on/off.
- `/hud info` — Show active HUD settings.
- `/hud breadcrumb:<hide|top|inner>` — Set breadcrumb placement.
- `/hud footer:<on|off>` — Toggle footer.
- `/hud header:<on|off>` — Toggle header.
- `/hud header-info:<on|off>` — Toggle diagnostic header line.

## ⚙️ Configuration

Global config:

```text
~/.pi/agent/hud/settings.json
```

Project-local override:

```text
.pi/hud.json
```

Example:

```json
{
  "enabled": true,
  "breadcrumb": "inner",
  "footer": true,
  "header": true,
  "header-info": false
}
```

If Pi launches with `--hud=false`, runtime settings force the HUD off without changing persisted config.

## ✅ Verification

```bash
npx vitest run tests/pi-tui-hud
npm run validate
```
