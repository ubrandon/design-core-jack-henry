#!/usr/bin/env node
// Health check for Design Core repos. Run with: npm run doctor
// Explains in plain language which repo this is, what is broken, and how to fix it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  root,
  CORE_SLUG,
  classifyRepo,
  upstreamPushDisabled,
  readJsonSafe,
  sh,
  COMPANY_OWNED_PATHS,
} from "./lib/repo-info.js";

const oks = [];
const notes = [];
const problems = [];
const ok = (msg) => oks.push(msg);
const note = (msg) => notes.push(msg);
const problem = (msg, fix) => problems.push({ msg, fix });

function checkNode() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 18) ok(`Node ${major} is new enough`);
  else
    problem(
      `Node ${process.versions.node} is too old for the dev server`,
      "Install the current Node from nodejs.org (or on a Mac: brew install node), then reopen your editor.",
    );
}

function checkIdentityFiles(repo) {
  if (repo.kind !== "company" && repo.kind !== "mid-setup") return;
  const p = resolve(root, ".designer");
  if (!existsSync(p)) {
    note("No .designer file yet. The AI creates it during your setup conversation, so this is normal mid-setup.");
    return;
  }
  const r = readJsonSafe(p);
  if (!r.ok) {
    problem(
      ".designer exists but is not valid JSON, so the tool cannot read your name",
      "Ask the AI to recreate .designer, or copy .designer.example to .designer and fill in your name.",
    );
  } else if (!r.data.name) {
    note(".designer has no name set. Ask the AI to finish your identity setup.");
  } else {
    ok(`.designer found (${r.data.name})`);
  }
}

function checkPlaceholders(repo) {
  if (repo.kind !== "company") return;
  const p = resolve(root, "GETTING_STARTED.md");
  if (!existsSync(p)) {
    note("GETTING_STARTED.md is missing, so teammates have no joining instructions. Run: npm run finish-setup");
    return;
  }
  const text = readFileSync(p, "utf8");
  if (text.includes("YOUR_ORG") || text.includes("Setting up for your company")) {
    problem(
      "GETTING_STARTED.md still has the template's placeholder instructions. New teammates following it will clone the wrong repo",
      "Run: npm run finish-setup (it writes joining instructions with your company's real repo link).",
    );
  } else {
    ok("GETTING_STARTED.md is customized for your company");
  }
}

function checkRemoteWiring(repo) {
  if (repo.kind === "company" && repo.upstream) {
    if (upstreamPushDisabled(repo.remotes)) {
      ok("Connected to the tool's update source (upstream), push-protected");
    } else {
      problem(
        "The upstream connection to the public tool repo allows pushes. An accidental push could send company work to the public repo (GitHub would likely refuse it, but keep the seatbelt on)",
        "Run: git remote set-url --push upstream no-push-allowed",
      );
    }
  } else if (repo.kind === "company") {
    note("No upstream link to the public tool repo on this computer. That is fine for designers; npm run update-tool adds it when someone wants tool updates.");
  }
  if (repo.kind === "mid-setup") {
    if (upstreamPushDisabled(repo.remotes)) ok("Upstream remote is wired correctly and push-protected");
    else
      problem(
        "The upstream remote allows pushes",
        "Run: git remote set-url --push upstream no-push-allowed",
      );
  }
}

function diskProjectDirs() {
  const dir = resolve(root, "public/data/projects");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// Projects the tool actually shows: the ones listed in projects/index.json.
function listedProjects() {
  const r = readJsonSafe(resolve(root, "public/data/projects/index.json"));
  if (!r.ok || !Array.isArray(r.data.projects)) return [];
  return r.data.projects.map((p) => p.id).filter(Boolean);
}

function checkDataJson() {
  const targets = [];
  const add = (rel, required) => targets.push({ rel, required });
  add("public/data/projects/index.json", true);
  add("public/data/design-system/registry.json", false);
  add("public/data/site.json", false);
  for (const id of listedProjects()) {
    add(`public/data/projects/${id}/project.json`, true);
    add(`public/data/projects/${id}/canvas.json`, true);
    add(`public/data/projects/${id}/prototypes/index.json`, false);
  }
  const listed = new Set(listedProjects());
  for (const id of diskProjectDirs()) {
    if (listed.has(id)) continue;
    const hasFiles = readdirSync(resolve(root, `public/data/projects/${id}`)).length > 0;
    if (hasFiles)
      note(`Project folder "${id}" exists on disk but is not on the home page list, so it is invisible in the tool. Ask the AI to re-add it to public/data/projects/index.json (or delete the folder if it is old).`);
    else note(`Empty leftover project folder "${id}" (safe to delete).`);
  }
  let checked = 0;
  let bad = 0;
  for (const t of targets) {
    const abs = resolve(root, t.rel);
    if (!existsSync(abs)) {
      if (t.required)
        problem(
          `${t.rel} is missing, so part of the tool will show nothing`,
          "Ask the AI to recreate it (it can rebuild the file from the project folder contents).",
        );
      continue;
    }
    checked++;
    const r = readJsonSafe(abs);
    if (!r.ok) {
      bad++;
      problem(
        `${t.rel} has broken JSON (${r.error}). Anything that reads it will show nothing`,
        `Ask the AI to fix the JSON in ${t.rel} (usually a missing or extra comma).`,
      );
    }
  }
  if (checked && !bad) ok(`All ${checked} design data files are valid JSON`);
}

function checkCanvasScreens() {
  let missing = 0;
  let orphans = 0;
  let screensTotal = 0;
  for (const id of listedProjects()) {
    const canvasPath = resolve(root, `public/data/projects/${id}/canvas.json`);
    const screensDir = resolve(root, `public/data/projects/${id}/screens`);
    const r = readJsonSafe(canvasPath);
    if (!r.ok || !Array.isArray(r.data.screens)) continue;
    const onDisk = existsSync(screensDir)
      ? readdirSync(screensDir).filter((f) => f.endsWith(".html"))
      : [];
    const inCanvas = new Set(r.data.screens.map((s) => s.file));
    screensTotal += inCanvas.size;
    for (const s of r.data.screens) {
      if (!s.file || !onDisk.includes(s.file)) {
        missing++;
        problem(
          `Project "${id}": canvas.json lists "${s.file}" but that screen file does not exist, so the canvas shows a broken card`,
          `Ask the AI to either create the screen file or remove its entry from canvas.json in project "${id}".`,
        );
      }
    }
    for (const f of onDisk) {
      if (!inCanvas.has(f)) orphans++;
    }
  }
  if (screensTotal && !missing) ok("All canvas screens point to files that exist");
  if (orphans)
    note(
      `${orphans} screen file(s) exist on disk but are not on any canvas. If a design "disappeared", ask the AI to add it back to that project's canvas.json.`,
    );
}

function checkDrift(repo) {
  if (repo.kind !== "company" || !repo.upstream) return;
  const fetched = sh("git fetch upstream --quiet", { timeout: 20000 });
  const hasRef = sh("git rev-parse --verify upstream/main") !== null;
  if (!hasRef) {
    note("Could not reach GitHub to compare against the official tool, so the tool-files check was skipped this time.");
    return;
  }
  if (fetched === null) {
    note("Could not reach GitHub just now; comparing tool files against the last downloaded copy of the official tool.");
  }
  const excludes = COMPANY_OWNED_PATHS.map((p) => `":(exclude)${p}"`).join(" ");
  // Real drift = changed on the company side AND still different from the official tip.
  const changedHere = sh(`git diff --name-only upstream/main...HEAD -- . ${excludes}`);
  const differsNow = sh(`git diff --name-only upstream/main HEAD -- . ${excludes}`);
  if (changedHere === null || differsNow === null) {
    note("Tool-files comparison could not run (git diff failed).");
    return;
  }
  const stillDifferent = new Set(differsNow.split("\n").filter(Boolean));
  const files = changedHere.split("\n").filter(Boolean).filter((f) => stillDifferent.has(f));
  if (!files.length) {
    ok("No tool files modified in this repo (design work only, as intended)");
    return;
  }
  problem(
    `These tool files were changed in this company repo and now differ from the official tool:\n      ${files.join("\n      ")}\n   Changed tool files conflict with future updates and can break the tool for the whole team`,
    `If the changes were not intentional, restore each file with: git checkout upstream/main -- <file>\n   If a tool change is genuinely needed, it belongs in the core repo: contact Brandon Unglaub.`,
  );
}

function describeRepo(repo) {
  switch (repo.kind) {
    case "no-git":
      problem(
        "This folder is not a git repository, so there is no history, sharing, or updates",
        "Re-clone your repo following GETTING_STARTED.md (cloning through your editor's Clone Repository flow handles GitHub sign-in for you).",
      );
      return "not a git repository";
    case "core":
      note(
        `This is the public Design Core template (${CORE_SLUG}), the tool itself. If you are developing the tool, all good. If you meant to USE Design Core: designers joining a team should clone their company's repo instead (ask your admin for the link); first-time company setup should follow the company prompt in GETTING_STARTED.md.`,
      );
      return "the public Design Core template (core repo)";
    case "mid-setup":
      note("Company setup is in progress: the repo is wired to the template but not yet published to GitHub. Next step: publish it (Source Control, then Publish Branch), then run npm run finish-setup.");
      return "a company repo mid-setup (not published yet)";
    case "company": {
      const where = repo.originInfo ? `${repo.originInfo.owner}/${repo.originInfo.repo}` : repo.origin;
      return `a company repo (${where})`;
    }
    case "double-remote":
      problem(
        "This clone points at the public template as origin AND has an upstream remote. The setup steps were only half-applied",
        "If this should be a company repo: run git remote remove origin, then publish through your editor (Source Control, Publish Branch). If unsure, ask the AI to run the company setup checks from .cursor/rules/setup.mdc.",
      );
      return "a half-configured clone";
    default:
      note("This repo has no origin remote and no recognizable upstream, so the doctor cannot tell what it is. If you just cloned, something went wrong; re-clone following GETTING_STARTED.md.");
      return "unrecognized";
  }
}

function main() {
  console.log("Design Core doctor\n");
  const repo = classifyRepo();
  const label = describeRepo(repo);
  console.log(`Repo: ${label}\n`);

  checkNode();
  checkRemoteWiring(repo);
  checkPlaceholders(repo);
  checkIdentityFiles(repo);
  checkDataJson();
  checkCanvasScreens();
  checkDrift(repo);

  for (const m of oks) console.log(`[ok] ${m}`);
  for (const m of notes) console.log(`[note] ${m}`);
  for (const p of problems) {
    console.log(`\n[problem] ${p.msg}`);
    console.log(`   Fix: ${p.fix}`);
  }

  console.log("");
  if (problems.length) {
    console.log(`${problems.length} problem(s) found. Fixes are listed above; your AI assistant can apply them for you.`);
    process.exit(1);
  }
  console.log("Everything looks good.");
}

main();
