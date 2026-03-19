# Getting Started with Design Core

## Step 1: Download Cursor

**[Download Cursor](https://www.cursor.com)** (Mac, Windows, or Linux)

Install it and open it. Default settings are fine -- just click through.

---

## Step 2: Paste a prompt into Cursor

Open Cursor, press **Cmd+L** (Mac) or **Ctrl+L** (Windows) to open the AI chat, and paste one of the prompts below.

### Setting up for your company (first time)

```
I want to set up Design Core for my company. Before you have access to any repo files, follow these steps exactly:

1. Clone via SSH: git clone git@github.com:ubrandon/design-core.git design-core-MYCOMPANY (replace MYCOMPANY with my company name, lowercase and hyphenated)
2. cd into the cloned folder
3. Rename the remote: git remote rename origin upstream
4. Unset branch tracking: git branch --unset-upstream main
5. Disable push to upstream: git remote set-url --push upstream no-push-allowed
6. Install dependencies: npm install
7. Tell me to open the folder in Cursor (File → Open Folder) and to add it to my workspace

Once I have the folder open in Cursor, read the .cursor/rules/setup.mdc file and follow the company setup flow to walk me through the rest (identity, team info, publishing to GitHub, etc.)
```

### Joining your team (someone shared this with you)

```
I'm joining my team's Design Core repo. Please:

1. Clone the repo from https://github.com/YOUR_ORG/YOUR_REPO.git
2. Tell me to open the cloned folder in Cursor
3. Once open, read the .cursor/rules/setup.mdc file and follow the designer joining flow to walk me through the rest
```

> **Note:** Replace `YOUR_ORG` and `YOUR_REPO` with your company's GitHub org and repo name -- your admin can tell you this.

---

That's it. The AI handles everything else. You'll publish your company's repo to GitHub using Cursor's built-in Source Control panel -- no extra tools needed.

---

## Sharing prototypes (you in Cursor, them in a browser)

You work in **Cursor** with **`npm run dev`** (localhost). People you share with **do not** use Cursor — they open a normal link in Chrome, Safari, etc.

That link must be your **deployed** site on **GitHub Pages** (after you enable Pages and push). To make **Copy link** in the tool paste the public Pages URL while you're still on localhost, run **once** from your repo folder (after `origin` points at your GitHub repo):

```bash
npm run sync-public-url
```

That updates `public/data/site.json` with `publicBaseUrl` (derived from `git remote get-url origin`). Commit that file so everyone on the team gets the same behavior.

While you use **`npm run dev`**, the dev server usually **infers the same URL from `origin` automatically** (no `site.json` needed). If **Copy link** still shows localhost, you don’t have a standard GitHub `origin` remote yet — run `sync-public-url` or set the URL explicitly:

If your remote isn’t GitHub or parsing fails, set the URL explicitly:

```bash
DESIGN_CORE_PUBLIC_URL=https://your-org.github.io/your-repo/ npm run sync-public-url
```

See also `public/data/site.example.json` and the **Sharing** section in `README.md`.
