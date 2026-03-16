# Screen Capture Tool

Automatically screenshot every screen of a web app. The tool logs in, crawls navigation links, and saves full-page screenshots to `public/data/captures/`. View the results on the **Captures** page in the Design Core nav.

## Quick start

1. Copy the example config:

   ```
   cp .app-screens.example.json .app-screens.json
   ```

2. Edit `.app-screens.json` with your app's URL and login credentials.

3. Install Playwright browsers (first time only):

   ```
   npx playwright install chromium
   ```

4. Run the capture:

   ```
   npm run capture
   ```

5. Open Design Core (`npm run dev`) and click **Captures** in the nav.

## Configuration

The `.app-screens.json` file controls everything. It is gitignored since it contains credentials.

### Required

| Field | Description |
|-------|-------------|
| `appUrl` | Base URL of the app to capture (e.g. `https://your-app.com`) |

### Optional

| Field | Default | Description |
|-------|---------|-------------|
| `login` | — | Login configuration (see below) |
| `viewport` | `{ width: 390, height: 844 }` | Browser viewport size. Width also sets the screenshot width. |
| `discover` | `false` | When `true`, automatically finds screens by crawling navigation links |
| `screens` | `[]` | Explicit list of screens to capture (used when `discover` is `false`) |
| `dismissSelectors` | `[]` | Extra CSS selectors for app-specific close/dismiss buttons |

### Login

If your app requires authentication, add a `login` block:

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

#### Login step actions

| Action | Fields | Description |
|--------|--------|-------------|
| `fill` | `selector`, `value` | Type text into a form field |
| `click` | `selector` | Click an element |
| `submit` | — | Press Enter |
| `wait` | `ms` | Wait a number of milliseconds |
| `waitForUrl` | `pattern`, `timeout` | Wait for the URL to match a glob pattern |

If the script detects the URL still contains `/login` after running the steps, it pauses and waits for you to complete login manually (useful for MFA). The browser window stays open — just finish logging in and the script continues automatically.

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

The entire `public/data/captures/` directory is gitignored since screenshots contain environment-specific data.

## Captures page

The **Captures** page in the Design Core nav displays all captured screenshots on an infinite canvas. Screenshots are grouped by their `group` field (derived from URL path segments by default).

Each card shows the screenshot at the configured viewport width, capped at the viewport height. If a screenshot is taller than one screen (scrollable pages), an **Expand** button appears at the bottom to reveal the full page. Click **Collapse** to shrink it back.

Use the zoom controls and space+drag to navigate the canvas, just like the project canvas and design system pages.
