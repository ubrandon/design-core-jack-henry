# Design Core

A lightweight, file-based design tool for UI ideation, interactive prototyping, and design system reference. Built with vanilla HTML/CSS/JS + Vite, stored as files in a Git repo — no backend, no database, no framework.

## Overview

The tool provides five workspaces:

1. **Home** — Project list (create, browse)
2. **Canvas** — Per-project screen ideation (pan/zoom, drag, arrange)
3. **Prototypes** — Self-contained interactive prototypes built by prompting Cursor's AI
4. **Design System** — Global component reference page
5. **Captures** — Screenshot flows from live URLs onto an infinite canvas (Playwright-backed; see `docs/captures.md`)

## Tech Stack

- **Vite** — Dev server with live reload, builds for GitHub Pages
- **Vanilla HTML/CSS/JS** — No framework. Pages are plain HTML files with `<script>` tags.
- **Git** — Version control for designs (branch, diff, merge)
- **GitHub Pages** — Free hosting for shareable prototype URLs
- **Playwright** (dev) — Used by the capture pipeline (`npm run capture` and the Captures UI)

No React, no TypeScript, no build-time compilation. Vite is used only for dev server (live reload when files change) and production build (asset hashing + deploy).

## Paths: disk vs browser

Vite serves everything under **`public/`** at the **site root**. When editing files, use disk paths that include `public/`. In HTML `fetch()` URLs, `href`, and `src`, **omit** the `public/` prefix.

| Role | Example disk path | Example URL / fetch path |
| ---- | ----------------- | ------------------------- |
| Project metadata | `public/data/projects/index.json` | `data/projects/index.json` |
| Screen file | `public/data/projects/my-app/screens/home.html` | loaded via canvas APIs |
| Shared CSS | `public/styles/shared.css` | `styles/shared.css` (from root HTML pages) |

Root tool pages (`index.html`, `canvas.html`, etc.) live at the **repo root** (not inside `public/`). They reference `styles/...` and `scripts/...`, which resolve to **`public/styles/`** and **`public/scripts/`** so CSS/JS are included in **`vite build`** output (GitHub Pages). Node-only CLIs stay in repo-root **`scripts/`** (e.g. `capture-screens.js`, `sync-public-site-url.js`).

## Pages

| File                 | URL                                                   | Description                                      |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `index.html`         | `/`                                                   | Home — all projects                              |
| `design-system.html` | `/design-system.html`                                 | Design system reference                          |
| `project.html`       | `/project.html?id=<project>`                          | Project hub — canvas + prototype list            |
| `canvas.html`        | `/canvas.html?project=<project>`                      | Screen ideation canvas                           |
| `prototype.html`     | `/prototype.html?project=<project>&proto=<prototype>` | Prototype preview in phone frame                 |
| `captures.html`      | `/captures.html`                                      | Live app captures — scout, run, canvas results   |

## File Structure

```
design-core/
├── index.html                  # Home page
├── project.html                # Project hub
├── canvas.html                 # Infinite canvas workspace (screens)
├── captures.html               # Capture workspace (screenshots from URLs)
├── prototype.html              # Phone frame prototype viewer
├── design-system.html          # Design system reference
├── scripts/                    # Node-only (not copied by Vite from public/)
│   ├── capture-screens.js      # Playwright capture CLI + child process for Captures UI
│   └── sync-public-site-url.js # Writes publicBaseUrl into site.json
├── public/
│   ├── scripts/                # Served as /scripts/* — bundled into dist for Pages
│   │   ├── shared.js           # URL helpers, toast, fetchJSON, share links
│   │   ├── nav.js              # Top navigation
│   │   ├── canvas-pan-zoom.js  # Pan, zoom, drag for canvas-style pages
│   │   └── debug-dom.js        # Optional DOM debugging helper
│   ├── styles/                 # Served as /styles/*
│   │   ├── shared.css          # Design tokens (colors, fonts, spacing)
│   │   ├── ds.css              # Design system component classes
│   │   ├── app.css             # Tool UI styles (nav, cards, phone frame)
│   │   ├── canvas-space.css    # Infinite canvas surface layout
│   │   └── zoom-controls.css   # Zoom/pan control chrome
│   └── data/                   # Served as /data/* — all user-editable design data
│       ├── projects/
│       │   ├── index.json      # List of projects for the home page
│       │   └── <project-id>/
│       │       ├── project.json    # Name, description, createdBy
│       │       ├── canvas.json     # Screen layout: files, x/y, width
│       │       ├── screens/        # Static screen HTML for canvas ideation
│       │       └── prototypes/
│       │           ├── index.json  # Prototype list for project hub
│       │           └── <prototype-id>/
│       │               ├── meta.json   # Name, description
│       │               └── index.html  # Self-contained interactive prototype
│       ├── design-system/
│       │   ├── registry.json       # Groups, categories, component files
│       │   ├── company.css         # (Optional, esp. company repos) Brand overrides
│       │   └── components/         # Component HTML fragments
│       └── captures/
│           ├── config.json         # App URL, viewport, discover, screens, etc.
│           └── manifest.json       # Capture run output / canvas layout (tool-managed)
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages deploy on push to main
├── vite.config.js              # Dev middleware: JSON PUT/DELETE under /data/, capture API
└── package.json
```

## Data Models

### projects/index.json

Home page source of truth — list of projects with stable `id` (folder name under `public/data/projects/`).

```json
{
  "projects": [
    {
      "id": "sample-mobile-banking",
      "name": "Sample Mobile Banking",
      "description": "…",
      "createdBy": "Ben",
      "createdAt": "2026-03-15T00:00:00Z"
    }
  ]
}
```

### project.json

```json
{
  "name": "Sample App",
  "description": "Main app UI exploration",
  "createdBy": "Ben",
  "createdAt": "2026-03-15T00:00:00Z"
}
```

### canvas.json

Defines which screen files appear on the canvas and their frame geometry.

```json
{
  "screens": [
    { "file": "home-overview.html", "x": 0, "y": 0, "width": 390 }
  ]
}
```

### prototypes/\<prototype-id\>/meta.json

Minimal metadata. The prototype itself is `index.html`.

```json
{
  "name": "Onboarding Flow",
  "description": "Signup, interest selection, and first home screen"
}
```

### prototypes/index.json

Project-level list of prototypes shown on the project page. Supports optional `device` so the UI can label the prototype as mobile, desktop, or responsive.

```json
{
  "prototypes": [
    {
      "id": "onboarding",
      "name": "Onboarding Flow",
      "description": "Signup, interest selection, and first home screen",
      "device": "mobile"
    }
  ]
}
```

### prototypes/\<prototype-id\>/index.html

A self-contained interactive prototype. This is a real working mini web app — HTML, CSS, and JavaScript. The designer prompts Cursor to build it, and it handles its own state, transitions, form validation, animations, etc.

From `public/data/projects/<project>/prototypes/<prototype>/index.html`, design system CSS is typically linked with **relative** paths up to `public/styles/` (five levels: `../../../../../styles/`).

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../../../../../styles/shared.css" />
    <link rel="stylesheet" href="../../../../../styles/ds.css" />
    <!-- Optional in company repos: ../../../../../data/design-system/company.css -->
  </head>
  <body>
    <!-- Full interactive prototype -->
    <div id="app">...</div>
    <script>
      // Real interactive logic: form state, navigation, animations
    </script>
  </body>
</html>
```

Key rules for prototype HTML:

- **JavaScript is allowed and expected** — unlike canvas ideation screens which are static
- **Uses the design system** — imports `shared.css` and `ds.css` for tokens and components
- **Self-contained** — all state, logic, and transitions live in this one file (or a small set of files in the same folder)
- **No external dependencies** — no npm packages, no CDN scripts unless the designer explicitly asks

### design-system/registry.json

```json
{
  "groups": [
    { "id": "foundations", "name": "Foundations" },
    { "id": "cards", "name": "Cards" }
  ],
  "categories": [
    {
      "group": "cards",
      "name": "Cards",
      "layout": "row",
      "components": [
        { "id": "plan-card", "file": "plan-card.html", "label": "Plan Card" }
      ]
    }
  ]
}
```

The design system page uses an **infinite canvas**: main sections (groups) stack **vertically**; under each, sub-categories are laid out **horizontally** in one row so the canvas uses width. Groups appear in the order listed in `groups`. A category can set `"layout": "row"` so that section’s components sit side by side.

## Features

### Home — Project List

- Grid of project cards (name, description, creator)
- Each card links to `project.html?id=<project>`
- Link to Design System page

### Canvas — Screen Ideation

The fast-creation workspace. Static screens, no interactivity — purely for visual exploration.

- **Infinite canvas**: Pan (drag background), zoom (scroll wheel)
- **Draggable screen cards**: Each screen rendered in an iframe, drag by header
- **Palette sidebar**: Click to add screens from the project's `screens/` folder
- **Auto-layout**: Screens placed in a grid; "Tidy" button re-snaps

Screen HTML files are static (no JavaScript). They're edited directly in Cursor. The canvas is for arrangement and overview only.

### Prototypes — Interactive Features

A prototype is a **self-contained interactive HTML file** that the designer builds by prompting Cursor's AI. It's not a slideshow of static screens — it's a working feature.

**How it works:**

1. Designer creates a new prototype folder: `public/data/projects/<project>/prototypes/<name>/`
2. Opens the prototype's `index.html` in Cursor
3. Prompts: "Build a signup flow with email validation, password strength meter, and a success animation"
4. Cursor writes the full interactive HTML/CSS/JS using the design system
5. Designer iterates: "Add a forgot password link", "Make the button animate on hover"
6. Preview appears in `prototype.html` inside a phone frame
7. Push to `main` → live on GitHub Pages → share the URL

**What makes prototypes different from canvas screens:**

- JavaScript is allowed and expected
- They handle their own state (form inputs, toggles, navigation between views)
- They can have transitions, animations, validation, conditional rendering
- They feel like a real app feature, not a mockup

**Prototype list** on the project page:

- Grid of prototype cards (name, description)
- Optional device metadata (`device`: `mobile`, `desktop`, `responsive`) for icon/label context
- Each card links to `prototype.html?project=<project>&proto=<prototype>`
- "Copy link" button for sharing

### Design System — Reference Page

- Infinite-canvas style layout: groups stack vertically; categories flow horizontally (`canvas-pan-zoom.js` + canvas-space styles)
- Each component rendered from its HTML file under `public/data/design-system/components/`
- Categories and groups from `registry.json`
- Shows colors, typography, buttons, cards, rows, tags, chips, forms, radii, shadows

**Company repos -- user content separation:**

All user-created content stays under `public/data/`. Tool files (`public/styles/`, `public/scripts/`, root HTML pages, repo-root `scripts/` CLIs) are not edited in company repos (except upstream merges).

- **Components**: Put in a company subfolder: `public/data/design-system/components/<company-slug>/` (e.g. `acme/`). Reference in registry as `"file": "acme/card-payment.html"`.
- **Brand overrides**: Create `public/data/design-system/company.css` for color, font, and spacing overrides. Auto-loaded after `shared.css` and `ds.css` when present.
- **Registry**: `registry.json` ships empty; the company fills it with their groups and categories.

This keeps company content separate from the tool, avoids merge conflicts on upstream pulls, and makes it clear what's "yours" vs "tool."

### Captures

- Configure a target app URL and optional login (local `.app-screens.json`; see `docs/captures.md`)
- Scout / discover / deep capture flows stream logs over SSE from `vite.config.js` middleware
- Outputs and manifest live under `public/data/captures/`

## Sharing & Deployment

### GitHub Pages

Prototypes deploy automatically on push to `main`.

**Prototype URLs:**

```
https://YOUR_ORG.github.io/design-core/prototype.html?project=sample-app&proto=onboarding
```

**Setup:**

1. GitHub Actions workflow builds with Vite, deploys to Pages
2. Vite `base` set for correct asset paths (`base: "./"` in `vite.config.js`)
3. Repo settings → Pages → Source: GitHub Actions

### How designers get links

- **Prototype list** on the project page has a "Copy link" button next to each prototype
- **Prototype viewer** has a "Copy link" button in the toolbar
- Copied URLs target the **deployed** GitHub Pages site (or `public/data/site.json` → `publicBaseUrl` when on localhost), not `localhost`

### Local sharing

- `npm run dev` starts Vite dev server on `localhost:3000` (see `vite.config.js`)
- **`npm run dev`** merges `publicBaseUrl` from `git remote get-url origin` when serving `data/site.json` (if the file omits it). Or run **`npm run sync-public-url`** / edit `site.json` so **Copy link** matches your live Pages URL on localhost — recipients only need a browser, not Cursor
- You can still pass around `http://localhost:3000/prototype.html?project=sample-app&proto=onboarding` on the same machine or network

## Cursor Integration — AI-Scoped Design

The `.cursor/rules/design-tool.mdc` rule file tells Cursor's AI how to behave based on what the designer is editing.

### Context detection

| File path pattern (disk) | Detected context |
| ------------------------ | ---------------- |
| `public/data/projects/<project>/screens/*` | Canvas mode — static ideation screens, no JS |
| `public/data/projects/<project>/prototypes/<proto>/*` | Prototype mode — interactive HTML, JS allowed |
| `public/data/design-system/components/**` | Design system — editing shared components |

### Prototype mode behavior

When the AI detects the designer is inside a prototype folder:

1. It reads `meta.json` to understand the prototype's name and purpose
2. For new prototypes, it asks whether the prototype is `mobile`, `desktop`, or `responsive`, then saves that value in `prototypes/index.json`
3. It builds interactive HTML/CSS/JS in `index.html` using the design system
4. JavaScript is expected — form state, navigation, animations, validation
5. It uses design tokens from `public/styles/shared.css` and component classes from `public/styles/ds.css` (via correct relative links from the prototype file)
6. New styles go inline in the prototype file — the shared design system stays untouched
7. It never modifies files outside the active prototype folder unless explicitly asked

### How designers interact

Designers don't need to know about file structure. They just:

1. Open a prototype's `index.html` (or ask the AI to create one)
2. Prompt naturally: "Build a settings page with a dark mode toggle and notification preferences"
3. The AI writes the full interactive prototype using the design system
4. They preview it in the browser, iterate, and share

## Multi-Repo Distribution

The tool code is generic — it works for any project. To use it across multiple separate repos (e.g. different businesses) or share it publicly:

### For yourself (two separate repos)

1. Create a shared "core" repo on GitHub containing only the tool (no project data).
2. In each business repo, add it as a second remote:
   ```bash
   git remote add core git@github.com:youruser/design-tool-core.git
   ```
3. Push tool improvements from whichever repo you're working in:
   ```bash
   git push core main
   ```
4. Pull them into the other repo:
   ```bash
   git fetch core
   git merge core/main
   ```

### For others (public distribution)

Others clone or fork the core repo and get updates with standard Git:
- **Clone**: `git clone <repo-url>` then `git pull origin main` for updates.
- **Fork**: Fork on GitHub, then pull upstream changes:
  ```bash
  git remote add upstream git@github.com:youruser/design-tool-core.git
  git fetch upstream
  git merge upstream/main
  ```

### What's shared vs. what's local

| Shared (core repo -- never edit in company repos) | User content (each company repo) |
| ------------------------------------------------- | -------------------------------- |
| Root HTML pages, `public/scripts/`, `vite.config.js` | `public/data/projects/*` (projects, screens, protos) |
| `package.json`, `.github/` | `public/data/design-system/components/<slug>/*` |
| `public/styles/shared.css`, `public/styles/ds.css` | `public/data/design-system/registry.json` |
| `.cursor/rules/`, `docs/` | `public/data/design-system/company.css` |
| `GETTING_STARTED.md` (after initial setup) | `.designer` (gitignored) |

## Design Principles

- **Speed over polish**: Click and create. No modals, no config.
- **Files over databases**: Everything is an HTML or JSON file. Git is the backend.
- **Shareable by default**: Every prototype has a URL. Push to share.
- **Design system as source of truth**: Components live in one place, used everywhere.
- **No auth, no accounts**: Designer names are just tags. Trust the team.
- **No framework**: Vanilla HTML/CSS/JS. If a designer can read HTML, they can read the tool.
- **Prototypes are real**: Not mockups with hotspots — working interactive features built with AI.
