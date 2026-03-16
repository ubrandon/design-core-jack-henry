# Screen Capture Tool

Automatically screenshot every screen of a web app. The tool logs in, crawls navigation links, and saves full-page screenshots to `public/data/captures/`. View the results on the **Captures** page in the Design Core nav.

## Quick start

### From the UI (easiest)

1. Open Design Core (`npm run dev`) and click **Captures** in the nav.
2. Enter your app's URL and click **Capture**.
3. The tool opens a browser, discovers screens, and shows progress in real time.

### From the command line

1. Install Playwright browsers (first time only):

   ```
   npx playwright install chromium
   ```

2. Run the capture:

   ```
   npm run capture
   ```

## Configuration

Configuration is split into two files — shared settings that the whole team sees, and local credentials that stay on your machine.

### Shared config (committed to git)

**`public/data/captures/config.json`** — created automatically when you capture from the UI, or by the AI when you describe your app. Contains everything except login credentials.

```json
{
  "appUrl": "https://your-app.com",
  "viewport": { "width": 390, "height": 844 },
  "discover": true,
  "dismissSelectors": [],
  "screens": []
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `appUrl` | — | Base URL of the app to capture (required) |
| `viewport` | `{ width: 390, height: 844 }` | Browser viewport size |
| `discover` | `false` | Automatically find screens by crawling navigation links |
| `screens` | `[]` | Explicit list of screens to capture (used when `discover` is `false`) |
| `dismissSelectors` | `[]` | Extra CSS selectors for app-specific close/dismiss buttons |

### Local credentials (gitignored)

**`.app-screens.json`** — optional, only needed for apps behind login. Each designer creates their own copy with their credentials. Never committed to git.

**Simple format** (recommended) — just provide your username and password. The script auto-detects login fields, handles single-page and multi-step login flows, finds submit buttons, and waits for MFA if needed:

```json
{
  "login": {
    "username": "user@example.com",
    "password": "password123"
  }
}
```

You can optionally add `"url": "/login"` if the login page isn't at the default `/login` path.

Copy `.app-screens.example.json` and fill in your credentials, or ask the AI to set it up for you.

**Advanced format** — if auto-detection doesn't work for your app (custom login components, non-standard forms), use explicit steps with CSS selectors:

```json
{
  "login": {
    "url": "/login",
    "steps": [
      { "action": "fill", "selector": "input[name='username']", "value": "user@example.com" },
      { "action": "submit" },
      { "action": "fill", "selector": "input[type='password']", "value": "password123" },
      { "action": "submit" },
      { "action": "wait", "ms": 2000 }
    ]
  }
}
```

If `steps` are provided, the script uses them instead of auto-detection.

The local file is merged on top of the shared config, so you can also override any shared setting locally (e.g. a different viewport for testing).

### How merging works

The capture script loads both files and merges them: shared config first, then local overrides on top. This means:

- **Team lead** sets up `appUrl`, `viewport`, `screens`, `dismissSelectors` once → committed and shared via git
- **Each designer** only needs `.app-screens.json` with their `login` credentials (if the app requires auth)
- **Public apps** need no local file at all — the shared config is enough

### Login auto-detection

When you provide just `username` and `password` (no `steps`), the script automatically:

1. Navigates to the login URL (default `/login`, or specify with `"url"`)
2. Finds the username/email field by checking common selectors (`input[type="email"]`, `input[name="username"]`, `input[autocomplete="username"]`, etc.)
3. Fills the username and looks for a password field
4. If the password field is on the same page (single-page login), fills it and submits
5. If no password field yet (multi-step login like SSO), submits the username first, waits for the next step, then finds and fills the password field
6. Detects submit buttons by type, text content ("Sign in", "Log in", "Continue", etc.)
7. If still on a login page after submitting (MFA, CAPTCHA, etc.), pauses and waits for you to complete login manually in the browser window

### Login step actions (advanced)

| Action | Fields | Description |
|--------|--------|-------------|
| `fill` | `selector`, `value` | Type text into a form field |
| `click` | `selector` | Click an element |
| `submit` | — | Press Enter |
| `wait` | `ms` | Wait a number of milliseconds |
| `waitForUrl` | `pattern`, `timeout` | Wait for the URL to match a glob pattern |

### Discovery mode

Set `"discover": true` to let the script find screens automatically. It:

1. Captures the landing page
2. Finds all navigation links on the page
3. Looks for a hamburger menu (unlabeled button near top-left) and opens it for more links
4. Visits each link, captures it, and looks for sub-links
5. Skips UUID-based URLs, external links, and pages that redirect to login

### Explicit screens

When `discover` is `false` (or omitted), list screens manually:

```json
{
  "screens": [
    { "name": "dashboard", "path": "/dashboard" },
    { "name": "settings", "path": "/settings", "group": "settings" },
    { "name": "profile", "path": "/settings/profile", "group": "settings", "waitFor": ".profile-form", "delay": 1000 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Filename for the screenshot (becomes `name.png`) |
| `path` | Yes | URL path to navigate to |
| `group` | No | Group name for organizing on the Captures page. Auto-derived from the first path segment if omitted. |
| `waitFor` | No | CSS selector to wait for before capturing |
| `delay` | No | Extra milliseconds to wait after page load |

### Custom dismiss selectors

The script automatically tries to dismiss modals, popups, and toasts using common patterns (aria-labels, class names, dismiss-like button text). If your app has custom close buttons, add their selectors:

```json
{
  "dismissSelectors": ["jha-icon-close", "jha-icon-x", ".my-custom-close"]
}
```

## Output

Screenshots are saved to `public/data/captures/` along with a `manifest.json` that records:

- `viewport` — the viewport size used for capture
- `captures` — array of captured screens, each with:
  - `name` — screen name
  - `file` — screenshot filename
  - `group` — group name (for organizing on the Captures page)
  - `path` — URL path
  - `url` — full URL
  - `capturedAt` — ISO timestamp

Screenshots and the manifest are committed to git so the whole team can see them. The shared config (`config.json`) is also committed. Only `.app-screens.json` (credentials) is gitignored.

## Captures page

The **Captures** page in the Design Core nav displays all captured screenshots on an infinite canvas. Screenshots are grouped by their `group` field (derived from URL path segments by default).

Each card shows the screenshot at the configured viewport width, capped at the viewport height. If a screenshot is taller than one screen (scrollable pages), an **Expand** button appears at the bottom to reveal the full page. Click **Collapse** to shrink it back.

Use the zoom controls and space+drag to navigate the canvas, just like the project canvas and design system pages.
