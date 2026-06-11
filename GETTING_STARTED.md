# Getting Started with Design Core

Design Core is set up **once per company**. After that, each designer joins in a few minutes.

## Which one are you?

- **Joining a team that already uses Design Core?** Stop here -- this is the public template, not your team's repo. Your company has its own copy with its own joining instructions: ask your admin for **your company's** repo link and follow the `GETTING_STARTED.md` there.
- **The first person setting this up for your company?** Continue below.

---

## Step 1: Pick your tool

Design Core works the same in all of these. If unsure, pick Cursor.

| Tool | What you need |
| --- | --- |
| **[Cursor](https://www.cursor.com)** (Mac/Windows/Linux) | Cursor account (Pro recommended) |
| **[VSCode](https://code.visualstudio.com)** + the **Claude Code** extension or **GitHub Copilot** | Claude subscription or Copilot |
| **[Claude desktop app](https://claude.com/download)** (Mac/Windows) | Claude Pro or Max subscription |

Install it, open it, and sign in. Default settings are fine.

---

## Step 2: Paste this prompt into the AI

Open the AI chat (Cursor: **Cmd+L** / **Ctrl+L**; VSCode: the Claude or Copilot panel; Claude app: the **Code** tab) and paste:

```
I want to set up Design Core for my company. Before you have access to any repo files, run these steps exactly:

1. git clone https://github.com/ubrandon/design-core.git design-core-MYCOMPANY   (replace MYCOMPANY with my company name, lowercase and hyphenated)
2. cd design-core-MYCOMPANY
3. npm install
4. npm run start-company-setup
5. Tell me to open the folder in my editor

Once I have the folder open, read .cursor/rules/setup.mdc and follow the company setup flow to walk me through the rest (identity, publishing to GitHub, finish-setup).
```

The AI handles everything else, and you never touch a terminal: it runs every command itself, checks that git and Node are installed (and helps install them if not), asks for your company info and name, walks you click-by-click through publishing a **private** company repo to GitHub, and then rewrites this very file in your repo into joining instructions with your company's real link.

If anything looks off at any point, tell the AI "something looks broken, run the doctor" -- it runs a health check that explains the problem and the fix in plain language.

---

## Step 3: Invite your team

Two parts, both matter:

1. **On GitHub:** invite each designer to your repo with **write** access (repo **Settings → Collaborators**). Without the invite they cannot open the repo (it's private) or save their work.
2. **Send them the joining guide:** `https://github.com/YOUR_ORG/YOUR_REPO/blob/main/GETTING_STARTED.md` -- after setup, that page contains your company's own instructions.

---

## Sharing prototypes (you in your editor, them in a browser)

You work locally with **`npm run dev`** (http://localhost:3000). People you share with do not need any of this -- they open a normal link in their browser.

That link is your **deployed** site on **GitHub Pages**. Enable it once: on GitHub, **Settings → Pages → Source → GitHub Actions**. After each push, prototypes are live at `https://YOUR_ORG.github.io/YOUR_REPO/`, and **Copy link** in the tool hands out that URL automatically (`finish-setup` configures this; `npm run sync-public-url` re-syncs it if your repo ever moves).
