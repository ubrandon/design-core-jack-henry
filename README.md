# Design Core

**Build interactive prototypes by chatting with AI. No coding needed.**

Design Core is a design tool for teams. You describe what you want, AI builds it, and you share it with a link. It works alongside Figma, not instead of it: keep Figma for what it's great at, use this for fast AI-powered prototyping.

---

## Get Started

Setup takes about 10 minutes and the AI does most of it:

**[Get Started](GETTING_STARTED.md)**

---

## Pick your editor

Design Core is a normal folder of files plus an AI that edits them, so it works in any of these. Same repo, same rules, same result:

| Tool | Best for | What it costs |
| --- | --- | --- |
| **[Cursor](https://www.cursor.com)** | The original Design Core experience | Free Hobby tier to try it; Pro (~$20/mo) for real use. Auto mode gives near-unlimited fast usage |
| **[VSCode](https://code.visualstudio.com)** + **Claude Code** extension or **GitHub Copilot** | People who already live in VSCode | A Claude subscription or Copilot plan |
| **[Claude desktop app](https://claude.com/download)** (Mac/Windows) | Non-developers: no editor, no terminal | Claude Pro or Max subscription |

Each person needs their own account for whichever tool they pick. There is no separate Design Core license: the tool itself is **free and open source**.

### Who is it for?

- **Design teams** who want to prototype ideas quickly without waiting for developers
- **Product managers** who want to explore UI concepts and share them with stakeholders
- **Anyone** who can describe what they want in words -- the AI handles the code

### What can you build?

- **Screens** -- static UI mockups for exploring layouts, styles, and visual direction
- **Prototypes** -- fully interactive mini-apps with working forms, animations, navigation, and real behavior
- **Design systems** -- shared component libraries that keep everything consistent

> **Prototypes are fully functional, not link-navigation between mocked screens.**
> When you build a prototype, state is real: selecting people updates chips/counts/CTAs, toggling members updates "X of Y" labels, clearing resets state, etc. Static screens belong on the canvas — prototypes simulate the actual feature behavior. If you only need clickthroughs between fixed mocks, that's a canvas job, not a prototype.

### Example prompts

> "Build a signup flow with email, password, and confirm. Show inline validation and a success animation."

> "Create a settings page with toggles for notifications, dark mode, and location sharing."

> "Make a multi-step onboarding: welcome screen, pick interests, set profile photo, done."

---

## How a team uses it

1. **One person sets it up** ([Get Started](GETTING_STARTED.md)): a private company repo on GitHub, created from this public template.
2. **Designers join** by pasting one prompt; the AI clones the repo and walks each person through a 2-minute setup.
3. **Everyone works locally** at http://localhost:3000, and nobody needs a terminal: designers ask the AI to start the tool, save and share work, or grab the latest from teammates.
4. **Stakeholders just get links**: pushes deploy to GitHub Pages automatically.
5. **Tool updates** flow from this repo: any teammate asks the AI to update the tool, then pushes. Designs and the tool never fight, because design work lives entirely under `public/data/`.
6. **Something looks broken?** Ask the AI to run the health check; it explains the problem and the fix in plain language.

---

## Why not other AI design tools?

Figma Make, Google Stitch, and similar tools are expensive, slow, or produce mediocre results. Design Core is free and open source; the only cost is the AI subscription you probably already have. You also keep everything: it's your repo, your files, plain HTML/CSS that any developer can read.

## Features

- **AI-powered** -- describe what you want, get working HTML/CSS/JS
- **Interactive prototypes** -- not just mockups, real working UI with state, validation, transitions
- **Infinite canvas** -- arrange and explore static screen concepts spatially
- **Design system** -- shared tokens, components, and styles across all projects
- **Shareable links** -- push to Git and prototypes deploy to GitHub Pages automatically
- **Team-friendly** -- each designer gets their own identity, projects track who made what

## Workspaces

| Workspace         | What it does                                         |
| ----------------- | ---------------------------------------------------- |
| **Home**          | Project list -- see all your team's work             |
| **Project Hub**   | Jump to canvas or prototypes for a project           |
| **Canvas**        | Infinite canvas for arranging static screen ideation |
| **Prototypes**    | Interactive HTML/CSS/JS mini-apps built with AI      |
| **Design System** | Global component reference with tokens and styles    |

---

## Technical Details

Built with vanilla HTML/CSS/JS + Vite. No framework, no database, no backend. The dev server runs on **port 3000** (fixed, so links always match).

### File structure

Vite serves `public/` at the site root. On disk, design data lives under `public/data/`; in the browser, paths start with `data/` (no `public/` prefix).

```
public/
  styles/                 # Tool + design tokens (shared.css, ds.css, app.css, …)
  data/
    site.json             Public site URL for prototype "Copy link" (written by finish-setup)
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

Root HTML pages (`index.html`, `canvas.html`, …) sit at the repo root; browser JS lives in `public/scripts/` (so it ships with `vite build` / GitHub Pages). Node CLIs (`doctor.js`, `update-tool.js`, …) stay in repo-root `scripts/`. See `docs/DESIGN_TOOL_PLAN.md` for the full tree.

### Commands

Designers never need these directly: they ask the AI ("start the tool", "update the tool", "run the doctor") and the AI runs them. For reference:

```bash
npm run dev                  # start the tool at http://localhost:3000
npm run doctor               # health check with plain-language fixes
npm run update-tool          # (company repos) pull the latest tool improvements
npm run finish-setup         # (company repos) one-time setup finalizer
npm run sync-public-url      # re-sync the public share-link URL
npm run build                # production build (CI runs this for GitHub Pages)
```

### Sharing

Push to `main` and prototypes deploy to GitHub Pages automatically (enable once: **Settings → Pages → Source → GitHub Actions**).

Designers run the tool on **localhost**; stakeholders open **Copy link** URLs in a normal browser. Those links point at the deployed GitHub Pages site. `npm run finish-setup` configures this during company setup; run `npm run sync-public-url` again if the repo ever moves, or set the URL manually in `public/data/site.json`:

```json
{ "publicBaseUrl": "https://your-org.github.io/your-repo/" }
```

### More docs

- [Getting started](GETTING_STARTED.md)
- [Updating the tool](docs/UPDATING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Captures](docs/captures.md)

---

## License

MIT
