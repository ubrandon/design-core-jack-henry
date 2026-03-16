# Design Core

**Build interactive prototypes by chatting with AI. No coding needed.**

Design Core is a design tool for teams. You describe what you want, AI builds it, and you share it with a link.

---

## Get Started

**New to Design Core?** Follow the setup guide -- it takes about 10 minutes:

**[Get Started](GETTING_STARTED.md)**

- **Setting up for your company?** [Company Setup](GETTING_STARTED.md#setting-up-for-your-company-first-time) -- fork the repo and onboard your team
- **Joining your team?** [Designer Setup](GETTING_STARTED.md#joining-your-team-someone-shared-this-with-you) -- clone and start building

---

## What is this?

Design Core is a file-based design prototyping tool. Designers use [Cursor](https://cursor.com) (an AI-powered editor) to build UI screens and interactive prototypes by prompting AI in plain language.

No frameworks, no databases, no backend. Just HTML/CSS/JS served by Vite.

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

```
data/
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
    registry.json
    components/           Component HTML snippets
```

### Local development

```bash
npm install
npm run dev
```

### Sharing

Push to `main` and prototypes deploy to GitHub Pages automatically.

---

## License

MIT
