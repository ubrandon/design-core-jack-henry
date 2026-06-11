# Design Core: Setup & Accessibility Plan

**Goal:** anyone can get Design Core running in one sitting, in Cursor, VSCode, or the Claude desktop app, without touching a terminal or knowing git.

**Success looks like:**

- A new designer goes from "received a link" to "first screen on the canvas" in under 10 minutes with zero manual terminal commands.
- It is impossible to accidentally end up in the wrong repo (the public template instead of the company repo).
- The same AI guidance works in Cursor, VSCode, and the Claude desktop app, from one source of truth.

---

## What the audit found

### Why the test user ended up in the wrong repo

Three things stack up against a new joiner today:

1. **Company repos ship the template's GETTING_STARTED.md unless the admin remembered to edit it.** The MixedRoutes copy was never customized: it still has the placeholder `YOUR_ORG/YOUR_REPO` URL, and it still shows the "set up for my company" prompt first. A joining designer who pastes the first prompt they see clones the public template (`ubrandon/design-core`) instead of their company repo. No company projects, wrong remotes, "wrong repo installed."
2. **The company-setup prompt clones via SSH.** Fresh machines have no SSH keys, so step 1 fails and the AI improvises from there.
3. **Private company repos cannot be cloned by a plain terminal `git clone`** without GitHub credentials. Non-devs have none set up, so the clone fails or the AI falls back to something public. Cursor's built-in clone UI handles auth, but our prompt routes around it.

The fix is not a different update model. It is making the existing model impossible to get wrong (Phase 1).

### Should designers clone from upstream so they get updates?

No, and this is the key point to keep straight:

- **Only the company repo tracks upstream.** The admin's clone keeps a fetch-only `upstream` remote pointing at the public template. Pulling tool updates is an admin job: fetch upstream, merge, push to the company repo.
- **Designers clone the company repo only** and get tool updates automatically with a normal `git pull` (or the editor's Sync button) after the admin merges.
- A designer cloning upstream directly is exactly the wrong-repo failure above: they get the empty template and no path to the company's work.

What is missing is not a new model, it is tooling and docs: a one-command way for admins to pull tool updates, and a check that tells anyone instantly which kind of repo they are sitting in.

Why not alternatives:

- **GitHub fork button:** forks of public repos cannot be made private. Company design work must be private. Rejected.
- **GitHub template repo:** copies have no shared git history, so future tool updates cannot be merged in cleanly. Rejected.
- **Keep clone + rename remote:** correct, just needs to be scripted and verified instead of pasted as 7 manual steps.

### Other fragile bits worth fixing while we are in here

- All tool guidance lives in `.cursor/rules/`, which only Cursor reads. Claude Code (desktop app, VSCode extension, CLI) gets zero guidance today.
- The dev server port is not pinned, so it can drift (5173, 5174, ...) and links stop matching.
- Several silent failures: new screens not appearing when `canvas.json` is updated in the wrong order, prototypes breaking when the CSS path depth is off by one, hand-edited JSON with a typo loading as nothing.

---

## Phase 1: Make setup fail-proof (do this first)

The theme: every step that currently relies on someone (human or AI) remembering to do the right thing becomes a script or a hard check.

- [x] **1.1 Switch all clone instructions from SSH to HTTPS.** The public template clones over HTTPS with no auth at all. Update the company-setup prompt in `GETTING_STARTED.md`.
- [x] **1.2 Route private clones through the editor, not the terminal.** The "joining your team" prompt should tell the user to use the editor's Clone Repository flow (which signs into GitHub for them), then continue with the AI. Terminal `git clone` of a private repo is the auth trap.
- [x] **1.3 Add `npm run finish-setup`.** A script the AI runs at the end of company setup. It reads the real org and repo name from the `origin` remote, then rewrites the company repo's `GETTING_STARTED.md`: removes the "set up for my company" section entirely and bakes the real clone URL into the joining instructions. Joiners can no longer pick the wrong prompt because the wrong prompt is not there. Also updates `.designer.example` and runs `sync-public-url`. One command replaces three honor-system steps.
- [x] **1.4 Add `npm run doctor`.** A health check the AI runs at the start of any setup or whenever something seems off. It reports in plain language:
  - Which repo this is: public template, properly set up company repo, or misconfigured (e.g. origin still points at `ubrandon/design-core`, or upstream is missing or pushable).
  - Whether `GETTING_STARTED.md` still contains placeholders (means finish-setup never ran).
  - Whether `.designer` exists, node version is OK, and all project JSON files parse.
  - For each problem: the exact fix, phrased so the AI can just do it.
- [x] **1.5 Pin the dev server port** in `vite.config.js` so links and docs always match. Pick one port and document it everywhere.
- [x] **1.6 Make `setup.mdc` verification-first.** The setup rule already verifies remotes mid-flow; move that to the top: step zero of every setup conversation is "run doctor, fix what it reports, then continue." The AI should never proceed on a misconfigured repo.
- [x] **1.7 Guardrails against tool-file edits in company repos.** Today the "never edit tool files" rule is instruction text only, and only Cursor loads it. Two light layers, warnings only, no hard blocks:
  - (a) Strengthen the warning and ship it in `CLAUDE.md` too (with 2.1), so Claude in VSCode, the desktop app, and the CLI all get the same "these files are off limits in company repos" message Cursor users get.
  - (b) Teach `doctor` to detect drift: fetch upstream and compare the tool files; if they differ, report "this repo has modified tool files: <list>" with the plain fix (restore them from upstream). Changes that came from a normal upstream merge match upstream, so the admin's update flow never trips this.
  - Deliberately skipped: hard blocks of any kind (AI edit denies, git commit blocking, required pull requests). Admins work in these repos too, including on Claude, and a warning plus drift detection covers the realistic failure. Revisit only if doctor keeps reporting drift.

**Outcome:** the failure your test user hit cannot happen again, and when anything is off, the AI diagnoses it in one command instead of improvising.

---

## Phase 2: First-class Claude and VSCode support

The theme: stop being a Cursor-only tool. One canonical rules file, every client reads it. VSCode is a requirement, not a nice-to-have: the supported clients are Cursor, VSCode (with an AI extension), and the Claude desktop app.

- [x] **2.1 Create `CLAUDE.md` and `AGENTS.md` at the repo root as thin shims.** They should point at (or import) the existing `.cursor/rules/design-tool.mdc` and `setup.mdc` content so there is exactly one source of truth. `CLAUDE.md` covers Claude Code everywhere (VSCode extension, desktop app, CLI); `AGENTS.md` covers Copilot agent mode and most other AI editors. Decide the exact import mechanism at implementation time; the requirement is: one canonical body of rules, thin pointers for each tool, no drift.
- [x] **2.2 Make the setup flow editor-agnostic.** `setup.mdc` currently says things like "open the Source Control tab in Cursor and click Publish Branch." Add the equivalent for Claude desktop app users. The known hard part outside Cursor is GitHub auth (cloning a private repo, creating and pushing the company repo). Recommended approach: the AI installs the GitHub CLI and uses its device login, where the user just types a short code into their browser. No tokens, no SSH keys. Spike this first; it is the riskiest piece of the phase.
- [x] **2.3 Add a "Claude desktop app" path to `GETTING_STARTED.md`.** For non-devs: download the Claude app (Mac or Windows), sign in with a Claude subscription, open the Code tab, paste the setup prompt. Claude checks for git and node and installs what is missing, walks through identity setup, starts the dev server, and the built-in preview shows the canvas. No terminal, no IDE.
- [x] **2.4 Update `README.md` and `GETTING_STARTED.md` to present three supported clients.** Cursor (Pro, ~$20/mo), VSCode with an AI extension (Claude Code extension on a Claude subscription, or Copilot), or the Claude desktop app (Pro/Max subscription). Same repo, same rules, same result. Rewrite the pricing section accordingly and change "Download Cursor" to a short "pick your editor" step.
- [ ] **2.5 VSCode verification pass.** Run the complete joiner flow end to end in VSCode: clone via the editor's sign-in, setup conversation, first screen on the canvas, push. Once with the Claude Code extension, once with Copilot agent mode. Fix whatever breaks; do not call VSCode supported until this passes.

**Outcome:** "download one app and sign in" becomes a real setup path for non-developers, and Cursor stops being a hard requirement: Cursor, VSCode, and the Claude desktop app are all first-class.

---

## Phase 3: Docs that route people correctly

The theme: a person should always know which instructions are for them.

- [x] **3.1 Restructure `GETTING_STARTED.md` around one question at the top:** "Are you setting up Design Core for your company, or joining a team that already has it?" Two clearly separated sections follow. In company repos, finish-setup (1.3) strips this down to joining-only.
- [x] **3.2 Rewrite the README landing.** First screen of the README answers: what this is, who it is for, the one link to click next. Move comparisons and architecture further down. Also set the GitHub repo About description and link so people landing on GitHub know where to start.
- [x] **3.3 Add an updating guide plus `npm run update-tool`.** One short doc: admins run `update-tool` (fetch upstream, merge, install, push) when they want the latest tool improvements; everyone else just pulls. The script should add the fetch-only `upstream` remote automatically if it is missing, so updating is not tied to the original admin's laptop: anyone with write access to the company repo can run it from a fresh clone. Include what to do if the merge reports conflicts (in practice: only happens if someone edited tool files in a company repo, which the rules forbid).
- [x] **3.4 Add a troubleshooting page** covering the known silent failures in plain language: cloned the wrong repo (run doctor), screen not appearing on canvas (creation order), prototype unstyled (path depth), icons invisible (icon weights), "Copy link" shows localhost (sync-public-url), port already in use.

**Outcome:** docs match reality, and each audience has exactly one path to follow.

---

## Phase 4: Bigger swings (later, optional)

- [ ] **4.1 One-command company setup**, e.g. `npm create design-core@latest`, replacing the pasted multi-step prompt entirely: asks for the company name, clones, wires remotes, installs, opens instructions. The pasted-prompt flow keeps working as a fallback.
- [ ] **4.2 Automated checks in CI** on company repos: validate all JSON, check prototype CSS path depth, fail the GitHub Pages deploy with a readable message instead of shipping a broken prototype.
- [ ] **4.3 Revisit the no-install story.** Claude Code on the web (runs the dev server in the cloud, preview in the browser) is parked by decision for now. A hosted Design Core with subscription sign-in is not allowed under Anthropic's current terms without becoming a pre-approved partner; only revisit if Design Core becomes a product.

---

## Decisions made (so we do not relitigate)

| Decision | Why |
| --- | --- |
| Keep the clone + upstream-remote model | Forks cannot be private; template copies cannot merge updates. The model works, it just needs scripts and checks. |
| Designers never clone or track upstream | Updates reach them through the company repo. Direct upstream clones are the wrong-repo bug. |
| One canonical AI rules source with per-tool shims | Cursor rules, CLAUDE.md, and AGENTS.md must not drift apart. |
| Claude Code on the web is out of scope for now | Desktop app covers the non-dev case; revisit later. |
| Setup steps become scripts, not instructions | Every honor-system step in the current flow has already failed at least once. |

## Suggested order and effort

| Step | Effort | Unblocks |
| --- | --- | --- |
| 1.1, 1.2 prompt fixes | Small (text only) | Stops the active failure today |
| 1.4 doctor script | Medium | Everything else; diagnosis for support |
| 1.3 finish-setup script | Medium | Correct company repos forever after |
| 1.5, 1.6 port pin + verification-first setup rule | Small | Stable links, safer setup convos |
| 2.1 CLAUDE.md shim | Small | All Claude clients |
| 2.2 editor-agnostic setup + GitHub auth spike | Medium/Large | Non-dev desktop path |
| 2.3, 2.4 docs for the Claude path | Small | Launchable non-dev story |
| Phase 3 docs pass | Medium | Self-serve onboarding |
| Phase 4 | Large | Nice-to-have polish |

Start with Phase 1 in the core repo, merge it downstream into company repos (`git fetch upstream && git merge upstream/main`), then verify by re-running the exact joiner setup that failed before.
