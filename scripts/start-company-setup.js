#!/usr/bin/env node
// Wires a fresh clone of the public template into a company repo (run once, right after cloning).
// Replaces the old hand-typed git steps: rename origin to upstream, unset tracking, block pushes.
import { basename } from "node:path";
import {
  root,
  CORE_SLUG,
  classifyRepo,
  shOrThrow,
  sh,
} from "./lib/repo-info.js";

const force = process.argv.includes("--force");

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

function main() {
  console.log("Design Core: company setup (step 1 of 2)\n");
  const repo = classifyRepo();

  if (repo.kind === "no-git") fail("This folder is not a git repository. Clone the template first:\n  git clone https://github.com/" + CORE_SLUG + ".git design-core-yourcompany");
  if (repo.kind === "mid-setup") fail("Already done. This repo is wired to the template. Next: publish it through your editor (Source Control, then Publish Branch), then run: npm run finish-setup");
  if (repo.kind === "company") fail("This is already a company repo, nothing to set up here. If you are joining a team, you are all set; ask the AI to continue with the designer joining flow.");
  if (repo.kind === "double-remote") fail("This clone has both an origin and an upstream remote, so setup was half-applied. Run npm run doctor for the fix.");
  if (repo.kind !== "core") fail("Could not recognize this repo. Run npm run doctor for details.");

  if (basename(root) === "design-core" && !force) {
    fail(
      "This folder is named design-core, which is what the tool's own development copy is called.\n" +
        "Company clones should be named design-core-yourcompany (the clone command in GETTING_STARTED.md does this).\n" +
        "If you really mean to convert THIS folder into a company repo, run again with --force.",
    );
  }

  try {
    shOrThrow("git remote rename origin upstream");
    sh("git branch --unset-upstream main");
    shOrThrow("git remote set-url --push upstream no-push-allowed");
  } catch (e) {
    fail(`Could not rewire the git remotes: ${e.message}`);
  }

  console.log("[ok] This clone is now disconnected from the public template (read-only updates stay available).");
  console.log("[ok] Accidental pushes to the public template are blocked.\n");
  console.log("Next steps:");
  console.log("  1. Open this folder in your editor (Cursor, VSCode, or the Claude desktop app).");
  console.log("  2. Tell the AI: \"Continue my Design Core company setup\" (it reads .cursor/rules/setup.mdc).");
  console.log("  3. The AI will collect your company info, help you publish to GitHub, then run: npm run finish-setup");
}

main();
