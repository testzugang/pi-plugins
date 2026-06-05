---
name: browser-tools
description: Use when testing, inspecting, or interacting with web pages through the browser tools extension in the pi-plugins package.
---

# Browser Tools

Use the browser tools when a task needs a real Chrome session: frontend testing, JavaScript-heavy pages, login-dependent pages, DOM inspection, or visual verification.

## Available Commands

- `/browser` - Master-Befehl zur Steuerung und Interaktion mit dem Browser. Wird er ohne Argumente aufgerufen, öffnet sich ein interaktives Konfigurationsmenü. Unterstützt folgende Subcommands:
  - `start [profile]` – Browser starten (optional mit bestimmtem Profil)
  - `profile [name]` – Chrome-Profil als Standard festlegen (`clear` zum Löschen)
  - `executable [path]` – Browser-Executable als Standard festlegen (`clear` zum Löschen)
  - `nav <url>` – URL aufrufen
  - `eval <code>` – JavaScript ausführen
  - `screenshot` – Screenshot aufnehmen

Die alten Einzelbefehle stehen weiterhin als direkte Aliase zur Verfügung:

- `/browser-start` – entspricht `/browser start`
- `/browser-profile` – entspricht `/browser profile`
- `/browser-executable` – entspricht `/browser executable`
- `/browser-nav` – entspricht `/browser nav`
- `/browser-eval` – entspricht `/browser eval`
- `/browser-screenshot` – entspricht `/browser screenshot`

## Available Tools

- `browser_start({ profile?: boolean | string })` - start Chrome with remote debugging.
- `browser_nav({ url: string, newTab?: boolean })` - navigate the active tab.
- `browser_eval({ code: string })` - evaluate JavaScript in the active tab.
- `browser_screenshot({})` - capture the current viewport and return an image path.

## Session Startup

If no browser session is running, start one first:

```text
browser_start({})
```

Use profile mode only when the user needs existing cookies, logins, or browser state:

```text
browser_start({ profile: true })
```

Use a named Chrome profile when the user asks for a specific profile:

```text
browser_start({ profile: "Profile 2" })
```

Use `/browser-profile` when the user wants to choose from available Chrome profiles and persist the project default.

Project defaults can also be set manually in `.pi/browser-tools.json`:

```json
{
  "profile": "Profile 2",
  "executablePath": "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
}
```

Or configure via environment variable `PI_CHROME_PATH`:

```bash
export PI_CHROME_PATH="/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
```

Prefer a fresh session for ordinary frontend testing so state is reproducible.

## Navigation

Open a page with:

```text
browser_nav({ url: "https://example.com" })
```

Use `newTab: true` when the existing tab should be preserved.

## Inspect Before Interacting

Prefer `browser_eval` for page state and DOM inspection before taking screenshots or clicking around.

Start with a compact structure query:

```javascript
(function () {
  return JSON.stringify(
    {
      title: document.title,
      url: location.href,
      buttons: Array.from(
        document.querySelectorAll('button, [role="button"]'),
      ).map((el) => ({
        text: el.textContent?.trim(),
        id: el.id,
        className: el.className,
        disabled: el instanceof HTMLButtonElement ? el.disabled : undefined,
      })),
      inputs: Array.from(
        document.querySelectorAll("input, textarea, select"),
      ).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        placeholder: el.getAttribute("placeholder"),
        id: el.id,
      })),
    },
    null,
    2,
  );
})();
```

## Batch Work

Prefer one `browser_eval` call with a batched script over many small calls.

Good:

```javascript
(function () {
  document.querySelector("#email").value = "user@example.com";
  document.querySelector("#password").value = "secret";
  document.querySelector('button[type="submit"]').click();
  return "submitted";
})();
```

Avoid separate tool calls for each field or click unless you need to observe intermediate state.

## Screenshots

Use `browser_screenshot` for visual questions: layout, rendering, screenshots for the user, or verifying something that cannot be reliably checked from DOM state.

Do not use screenshots as the first step for ordinary DOM or form state. Inspect with `browser_eval` first.

## Waiting for Updates

After navigation or interactions that trigger async rendering, wait by polling DOM state in `browser_eval` instead of guessing from screenshots. A small delay is acceptable only when the page has no observable readiness signal.

## Safety

- Do not use profile mode unless authentication state is required.
- Avoid destructive actions on production sites unless the user explicitly asks.
- Prefer read-only DOM inspection when unsure.
