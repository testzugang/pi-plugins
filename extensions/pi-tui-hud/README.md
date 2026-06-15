# pi-tui-hud 🗜️

> **Secure, high-fidelity HUD and Status Bar for Pi.** Real-time token tracking, cumulative cost accounting, model-to-folder breadcrumbs, and gradient logo headers.

`pi-tui-hud` is a 100% secure, transparent, and audited alternative to the quarantined `pi-powerline` extension. It is built purely in TypeScript, runs entirely inside your Pi process, and has zero external binary or network dependencies.

## ✨ Features

- **True Gradient Logo Header**: Smooth character-by-character color interpolation (Pink `#d787af` ➜ Cyan `#00afaf`) using `Intl.Segmenter` and `visibleWidth` to perfectly preserve complex Unicode emoji/grapheme boundaries.
- **Segmented TUI Footer**: Displays cumulative session costs (`$X.XXX`), cache hit rates (`CH:XX.X%`), cumulative tokens (↑/↓), and current context usage percentage with yellow (>70%) and red (>90%) warning thresholds.
- **Reactive Settings Changes**: Toggles (`/hud footer:off`, `/hud header:off`, etc.) are cached in-memory and applied instantly across the active TUI (no filesystem reads on render hot paths).
- **Model ➜ Folder Breadcrumbs**: Seamlessly draws the current model name and active folder path directly into the editor's top border frame (`inner`) or as an above-editor TUI widget (`top`).
- **Complete Headless Safety**: Includes strict, early `isExtensionContext` type-guarding on all EventBus and lifecycle handlers. Automatically shuts down and restores Pi's native headers and footers when disabled or on session exit.

## 🛠️ Usage

Inside Pi, use the `/hud` slash command:

- `/hud` — Toggles the HUD on or off.
- `/hud info` — Displays all current active HUD settings.
- `/hud breadcrumb:<hide|top|inner>` — Selects breadcrumb layout style.
- `/hud footer:<on|off>` — Toggles the custom token status footer.
- `/hud header:<on|off>` — Toggles the gradient logo header.
- `/hud header-info:<on|off>` — Toggles diagnostic system details in the header.

## 🔧 Configuration

Settings are stored globally in `~/.pi/agent/hud/settings.json` and can be overridden on a per-project basis in `.pi/hud.json`:

```json
{
  "enabled": true,
  "breadcrumb": "inner",
  "footer": true,
  "header": true,
  "header-info": false
}
```

If Pi is launched with the CLI flag `--hud=false` or has `--hud` omitted from package flags, the command toggle will safely prevent conflicts and inform you.
