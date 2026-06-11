#!/usr/bin/env node
// Pulls the latest Design Core tool improvements into a company repo (admin task).
// Adds the read-only upstream link if missing, fetches, merges, reinstalls, and
// auto-resolves conflicts on company-owned files in the company's favor.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  root,
  CORE_HTTPS_URL,
  classifyRepo,
  upstreamPushDisabled,
  readDesigner,
  sh,
  shOrThrow,
  COMPANY_OWNED_PATHS,
} from "./lib/repo-info.js";

const dryRun = process.argv.includes("--dry-run");

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

function isCompanyOwned(file) {
  return COMPANY_OWNED_PATHS.some((p) => file === p || file.startsWith(p + "/"));
}

function main() {
  console.log(`Design Core: update tool${dryRun ? " (dry run, nothing will change)" : ""}\n`);
  const repo = classifyRepo();

  if (repo.kind === "core") fail("This IS the tool's own repo; updates flow FROM here to company repos, so there is nothing to pull.");
  if (repo.kind === "mid-setup") fail("Finish the company setup first (publish to GitHub, then npm run finish-setup). Updates come later.");
  if (repo.kind !== "company") fail("This does not look like a company Design Core repo. Run npm run doctor for details.");

  if (!repo.upstream) {
    if (!dryRun) {
      sh(`git remote add upstream ${CORE_HTTPS_URL}`);
      sh("git remote set-url --push upstream no-push-allowed");
    }
    console.log("[ok] Connected this clone to the public tool repo (read-only). Any teammate with write access can now run updates, not just the original admin.");
  } else if (!upstreamPushDisabled(repo.remotes) && !dryRun) {
    sh("git remote set-url --push upstream no-push-allowed");
    console.log("[ok] Re-applied the push protection on the upstream link.");
  }

  console.log("Checking GitHub for tool updates...");
  if (sh("git fetch upstream", { timeout: 60000 }) === null) {
    fail("Could not reach GitHub to check for updates. Check your internet connection and try again.");
  }

  const incoming = sh("git log --oneline HEAD..upstream/main") || "";
  const lines = incoming.split("\n").filter(Boolean);
  if (!lines.length) {
    console.log("\nAlready up to date. No new tool changes.");
    return;
  }

  console.log(`\n${lines.length} tool update(s) available:`);
  for (const l of lines.slice(0, 15)) console.log(`  ${l}`);
  if (lines.length > 15) console.log(`  ...and ${lines.length - 15} more`);

  if (dryRun) {
    console.log("\nDry run: stopping before the merge. Run npm run update-tool to apply.");
    return;
  }

  const dirty = sh("git status --porcelain --untracked-files=no") || "";
  if (dirty.trim()) {
    fail("You have unsaved (uncommitted) work. Commit it first (Source Control in your editor), then run the update again so your work cannot get tangled up in it.");
  }

  console.log("\nMerging updates...");
  const merge = sh("git merge upstream/main --no-edit");
  if (merge === null) {
    const conflicted = (sh("git diff --name-only --diff-filter=U") || "").split("\n").filter(Boolean);
    if (conflicted.length && conflicted.every(isCompanyOwned)) {
      for (const f of conflicted) {
        shOrThrow(`git checkout --ours -- "${f}"`);
        shOrThrow(`git add -- "${f}"`);
      }
      if (sh("git commit --no-edit") === null) fail("Could not finish the merge automatically. Ask the AI to resolve the merge, or run git merge --abort to undo and try again later.");
      console.log(`[ok] Kept your company's version of: ${conflicted.join(", ")}`);
    } else if (conflicted.length) {
      console.error("\nThe update conflicts with changes made in this repo on these tool files:");
      for (const f of conflicted) console.error(`  ${f}`);
      console.error("\nThis usually means tool files were edited in this company repo (they should not be).");
      console.error("Options: ask the AI to resolve the conflicts keeping the official tool's version,");
      console.error("or run git merge --abort to undo the update and deal with it later.");
      process.exit(1);
    } else {
      fail("The merge failed for an unexpected reason. Run git status to see the state, or git merge --abort to undo.");
    }
  }

  const gs = resolve(root, "GETTING_STARTED.md");
  const placeholders = existsSync(gs) && (readFileSync(gs, "utf8").includes("YOUR_ORG") || readFileSync(gs, "utf8").includes("Setting up for your company"));
  if (placeholders && readDesigner()?.company) {
    console.log("Refreshing the company GETTING_STARTED.md...");
    spawnSync(process.execPath, [resolve(root, "scripts/finish-setup.js")], { cwd: root, stdio: "inherit" });
  }

  console.log("Updating dependencies (npm install)...");
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) console.log("[note] npm install hit an error; run it again manually before npm run dev.");

  console.log("\n[ok] Tool updated. Now push (the Sync button in your editor) so your whole team gets it on their next pull.");
  console.log("If the dev server was running, restart it: npm run dev");
}

main();
