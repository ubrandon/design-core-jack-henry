# Getting Started with Design Core at Jack Henry

Welcome! Your team already has Design Core set up. You never need a terminal: install one app, paste one prompt, and the AI does everything else for you.

> **Before you start:** ask your admin to invite you to the GitHub repo (`ubrandon/design-core-jack-henry`) with **write** access, and accept the email invite. Without it you cannot open the repo or save your work.

---

## Step 1: Pick your tool

Any of these work. If unsure, pick the one your team uses. Install it, open it, sign in. Default settings are fine.

| Tool | What you need |
| --- | --- |
| **[Cursor](https://www.cursor.com)** | Cursor account (Pro recommended) |
| **[VSCode](https://code.visualstudio.com)** + the **Claude Code** extension or **GitHub Copilot** | Claude subscription or Copilot |
| **[Claude desktop app](https://claude.com/download)** (Mac/Windows) | Claude Pro or Max subscription |

---

## Step 2: Paste this prompt

### In Cursor or VSCode

Open the AI chat (Cursor: **Cmd+L** / **Ctrl+L**; VSCode: the Claude Code or Copilot panel) and paste:

```
I'm joining my team's Design Core repo: https://github.com/ubrandon/design-core-jack-henry.git
I'm not technical: run every command for me, explain things simply, and tell me exactly what to click when you can't click it yourself.
If the repo folder is NOT open in this editor yet: walk me through cloning it with the editor's built-in "Git: Clone" (Cmd+Shift+P or Ctrl+Shift+P), including the GitHub sign-in, then tell me to paste this same prompt again once the folder is open.
If the folder IS open: run npm install if needed, then read .cursor/rules/setup.mdc and walk me through the designer joining flow.
```

(When the cloned folder opens in a new window, paste the same prompt again and it continues from there.)

### In the Claude desktop app

Open the **Code** tab and paste:

```
I'm joining my team's Design Core repo: https://github.com/ubrandon/design-core-jack-henry.git
I'm not technical: run every command for me, explain things simply, and tell me exactly what to click when you can't click it yourself.
Clone the repo for me (use the GitHub CLI with browser sign-in if this computer isn't connected to GitHub yet), open the folder, run npm install, then read .cursor/rules/setup.mdc and walk me through the designer joining flow.
```

That's it. The AI asks for your name, starts the preview, and shows you around.

---

## Everyday use: just ask the AI

- **"Start the tool"** -- it starts the preview at http://localhost:3000
- **"Save my work and share it with the team"** -- it commits and pushes for you (the Sync button in Cursor/VSCode does the same)
- **"Get the latest"** -- it pulls teammates' designs and tool updates together
- **"Something looks broken"** -- it runs the health check (`npm run doctor`) and fixes what it reports
- **Share a prototype** -- click **Copy link** in the tool; links point at the team's published site: https://ubrandon.github.io/design-core-jack-henry/
