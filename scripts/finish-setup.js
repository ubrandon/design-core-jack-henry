#!/usr/bin/env node
// Finalizes a company repo after it is published to GitHub (run once, step 2 of 2).
// Rewrites GETTING_STARTED.md with joining-only instructions and the real repo URL,
// fills .designer.example, wires the upstream remote, and syncs the public site URL.
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  root,
  CORE_HTTPS_URL,
  classifyRepo,
  upstreamPushDisabled,
  readJsonSafe,
  readDesigner,
  sh,
} from "./lib/repo-info.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const companyFlagIdx = args.indexOf("--company");
const companyFlag = companyFlagIdx !== -1 ? args[companyFlagIdx + 1] : null;

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

function resolveCompanyName() {
  if (companyFlag && companyFlag.trim()) return companyFlag.trim();
  const designer = readDesigner();
  if (designer?.company?.trim()) return designer.company.trim();
  const example = readJsonSafe(resolve(root, ".designer.example"));
  const fromExample = example.ok ? example.data?.company?.trim() : "";
  if (fromExample && fromExample !== "Your Company") return fromExample;
  return null;
}

function gettingStartedFor(company, owner, repoName) {
  const cloneUrl = `https://github.com/${owner}/${repoName}.git`;
  const repoSlug = `${owner}/${repoName}`;
  const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repoName}/`;
  return `# Getting Started with Design Core at ${company}

Welcome! Your team already has Design Core set up. You never need a terminal: install one app, paste one prompt, and the AI does everything else for you.

> **Before you start:** ask your admin to invite you to the GitHub repo (\`${repoSlug}\`) with **write** access, and accept the email invite. Without it you cannot open the repo or save your work.

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

\`\`\`
I'm joining my team's Design Core repo: ${cloneUrl}
I'm not technical: run every command for me, explain things simply, and tell me exactly what to click when you can't click it yourself.
If the repo folder is NOT open in this editor yet: walk me through cloning it with the editor's built-in "Git: Clone" (Cmd+Shift+P or Ctrl+Shift+P), including the GitHub sign-in, then tell me to paste this same prompt again once the folder is open.
If the folder IS open: run npm install if needed, then read .cursor/rules/setup.mdc and walk me through the designer joining flow.
\`\`\`

(When the cloned folder opens in a new window, paste the same prompt again and it continues from there.)

### In the Claude desktop app

Open the **Code** tab and paste:

\`\`\`
I'm joining my team's Design Core repo: ${cloneUrl}
I'm not technical: run every command for me, explain things simply, and tell me exactly what to click when you can't click it yourself.
Clone the repo for me (use the GitHub CLI with browser sign-in if this computer isn't connected to GitHub yet), open the folder, run npm install, then read .cursor/rules/setup.mdc and walk me through the designer joining flow.
\`\`\`

That's it. The AI asks for your name, starts the preview, and shows you around.

---

## Everyday use: just ask the AI

- **"Start the tool"** -- it starts the preview at http://localhost:3000
- **"Save my work and share it with the team"** -- it commits and pushes for you (the Sync button in Cursor/VSCode does the same)
- **"Get the latest"** -- it pulls teammates' designs and tool updates together
- **"Something looks broken"** -- it runs the health check (\`npm run doctor\`) and fixes what it reports
- **Share a prototype** -- click **Copy link** in the tool; links point at the team's published site: ${pagesUrl}
`;
}

function main() {
  console.log(`Design Core: finish setup${dryRun ? " (dry run, nothing will be written)" : ""}\n`);
  const repo = classifyRepo();

  if (repo.kind === "core") fail("This is the public template itself; finish-setup only runs in a company repo. If you are mid-company-setup, publish the repo to GitHub first.");
  if (repo.kind === "mid-setup") fail("Almost there, but the repo is not on GitHub yet. Publish it first (Source Control, then Publish Branch in your editor), then run this again.");
  if (repo.kind !== "company" || !repo.originInfo) fail("Could not read a GitHub origin remote. Publish the repo to GitHub first, then run this again. (npm run doctor explains the current state.)");

  const company = resolveCompanyName();
  if (!company) fail('Could not find your company name. Run again as: npm run finish-setup -- --company "Your Company Name"');

  const { owner, repo: repoName } = repo.originInfo;
  const gettingStarted = gettingStartedFor(company, owner, repoName);
  const designerExample = JSON.stringify(
    { name: "Your Name", company, team: [{ name: "Your Name" }] },
    null,
    2,
  ) + "\n";

  if (dryRun) {
    console.log(`Would rewrite GETTING_STARTED.md with joining-only instructions for ${owner}/${repoName}.`);
    console.log(`Would set the company in .designer.example to "${company}".`);
    console.log("Would make sure the upstream connection to the public tool exists and is push-protected.");
    console.log("Would run: npm run sync-public-url");
    return;
  }

  writeFileSync(resolve(root, "GETTING_STARTED.md"), gettingStarted, "utf8");
  console.log("[ok] GETTING_STARTED.md rewritten: joining instructions only, real repo link baked in.");

  writeFileSync(resolve(root, ".designer.example"), designerExample, "utf8");
  console.log(`[ok] .designer.example set up for ${company}.`);

  if (!repo.upstream) {
    sh(`git remote add upstream ${CORE_HTTPS_URL}`);
    console.log("[ok] Connected to the public tool repo for future updates (read-only).");
  }
  if (!upstreamPushDisabled(classifyRepo().remotes)) {
    sh("git remote set-url --push upstream no-push-allowed");
  }
  console.log("[ok] Pushes to the public tool repo are blocked (seatbelt).");

  const sync = spawnSync(process.execPath, [resolve(root, "scripts/sync-public-site-url.js")], {
    cwd: root,
    stdio: "inherit",
  });
  if (sync.status !== 0) {
    console.log("[note] Could not set the public share-link URL automatically. After enabling GitHub Pages, run: npm run sync-public-url");
  }

  console.log("\nDone. Commit these files so your team gets them (Source Control in your editor):");
  console.log("  GETTING_STARTED.md, .designer.example, public/data/site.json");
  console.log(`\nShare this link with designers joining: https://github.com/${owner}/${repoName}/blob/main/GETTING_STARTED.md`);
}

main();
