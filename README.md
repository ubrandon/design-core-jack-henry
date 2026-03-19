# Design Core

**Build interactive prototypes by chatting with AI. No coding needed.**

Design Core is a design tool for teams. You describe what you want, AI builds it, and you share it with a link.

---

## Get Started

**New to Design Core?** Follow the setup guide -- it takes about 10 minutes:

**[Get Started](GETTING_STARTED.md)**

---

## What is this?

Design Core is a file-based design prototyping tool. Designers use [Cursor](https://cursor.com) (an AI-powered editor) to build UI screens and interactive prototypes by prompting AI in plain language.

No frameworks, no databases, no backend. Just HTML/CSS/JS served by Vite.

### Why not other AI design tools?

Design Core works **alongside** Figma, not instead of it. Keep using Figma for what it's great at -- this is for AI-powered prototyping.

The difference is cost and quality compared to other AI design tools. Figma Make, Google Stitch, and similar tools are expensive, slow, or produce mediocre results. Design Core is **free and open source** -- the only cost is a [Cursor](https://cursor.com) subscription:

- **Hobby (free)** -- limited requests, but enough to try it out
- **Pro ($20/mo per person)** -- the sweet spot for most designers

Cursor's **Auto mode** and **Composer 1.5** model give you near-unlimited usage at the Pro tier -- fast responses, high-quality output, and a fraction of the cost of dedicated AI design tools.

Each person on the team needs their own Cursor account. There's no separate Design Core license. Companies can use [Cursor Teams ($40/user/mo)](https://cursor.com/pricing) for centralized billing and admin controls, but individual Pro plans work fine too.

### Who is it for?

- **Design teams** who want to prototype ideas quickly without waiting for developers
- **Product managers** who want to explore UI concepts and share them with stakeholders
- **Anyone** who can describe what they want in words -- the AI handles the code

### What can you build?

- **Screens** -- static UI mockups for exploring layouts, styles, and visual direction
- **Prototypes** -- fully interactive mini-apps with working forms, animations, navigation, and real behavior
- **Design systems** -- shared component libraries that keep everything consistent

### Example prompts

> "Build a signup flow with email, password, and confirm. Show inline validation and a success animation."

> "Create a settings page with toggles for notifications, dark mode, and location sharing."

> "Make a multi-step onboarding: welcome screen, pick interests, set profile photo, done."

---

## Features

- **AI-powered** -- describe what you want, get working HTML/CSS/JS
- **Interactive prototypes** -- not just mockups, real working UI with state, validation, transitions
- **Infinite canvas** -- arrange and explore static screen concepts spatially
- **Design system** -- shared tokens, components, and styles across all projects
- **Shareable links** -- push to Git and prototypes deploy to GitHub Pages automatically
- **Team-friendly** -- each designer gets their own identity, projects track who made what

---

## Workspaces

| Workspace | What it does |
|---|---|
| **Home** | Project list -- see all your team's work |
| **Project Hub** | Jump to canvas or prototypes for a project |
| **Canvas** | Infinite canvas for arranging static screen ideation |
| **Prototypes** | Interactive HTML/CSS/JS mini-apps built with AI |
| **Design System** | Global component reference with tokens and styles |

---

## Technical Details

Built with vanilla HTML/CSS/JS + Vite. No framework, no database, no backend.

### File structure

Vite serves `public/` at the site root. On disk, design data lives under `public/data/`; in the browser, paths start with `data/` (no `public/` prefix).

```
public/
  styles/                 # Tool + design tokens (shared.css, ds.css, app.css, …)
  data/
    site.json             Optional public site URL for prototype “Copy link” (local dev); see Sharing
    projects/
      index.json
      <project-id>/
        project.json
        canvas.json
        screens/            Static HTML (no JS) for canvas ideation
        prototypes/
          index.json
          <prototype-id>/
            meta.json
            index.html      Interactive prototype (HTML/CSS/JS)
    design-system/
      registry.json         Ships empty; company fills with their groups/categories
      company.css           (Company repos) Brand overrides -- auto-loaded after shared.css/ds.css
      components/           Component HTML snippets
        <company-slug>/     Company repos put components here (e.g. acme/)
    captures/             Capture config + manifest (see docs/captures.md)
```

Root HTML pages (`index.html`, `canvas.html`, …) sit at the repo root; browser JS lives in `public/scripts/` (so it ships with `vite build` / GitHub Pages). Node CLIs (`capture-screens.js`, …) stay in repo-root `scripts/`. See `docs/DESIGN_TOOL_PLAN.md` for the full tree.

### Maintaining the tool

Improvement ideas for core contributors (architecture, dev API safety, testing, captures): [docs/core-improvements.md](docs/core-improvements.md).

### Local development

```bash
npm install
npm run dev
```

### Sharing

Push to `main` and prototypes deploy to GitHub Pages automatically.

**Typical flow:** designers run the tool on **localhost** in Cursor; stakeholders open **Copy link** in a normal browser — that must be the **GitHub Pages** URL, not `localhost`.

**Copy link** on the project hub and prototype preview uses your **deployed** URL, not `localhost`:

- On **`*.github.io`**, the base URL is taken from the current path (no config needed).
- On **`npm run dev` (localhost)**, Vite serves a merged `data/site.json`: it adds **`publicBaseUrl`** inferred from **`git remote get-url origin`** when your `public/data/site.json` doesn’t set it (standard `github.com` SSH/HTTPS remotes only). Restart dev if you change remotes.
- To override or persist for CI / `vite preview`, run **`npm run sync-public-url`** or edit `public/data/site.json` manually:

  ```json
  { "publicBaseUrl": "https://your-org.github.io/your-repo/" }
  ```

  Commit `site.json` so teammates get the same share links. You can also set `DESIGN_CORE_PUBLIC_URL` when running the sync script, or use `window.__DESIGN_CORE_PUBLIC_BASE__` / `<meta name="design-core-public-url" content="https://…/">` for edge cases.

---

## License

MIT
