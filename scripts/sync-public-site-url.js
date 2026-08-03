#!/usr/bin/env node
/**
 * Writes public/data/site.json → publicBaseUrl for GitHub project Pages:
 *   https://<owner>.github.io/<repo>/
 *
 * Uses `git remote get-url origin`, or DESIGN_CORE_PUBLIC_URL / GITHUB_PAGES_ROOT env.
 * Run from repo root after you have an `origin` remote (your company repo on GitHub).
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePublicBaseUrl, githubPagesRootFromRemote } from "./lib/repo-info.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sitePath = resolve(root, "public/data/site.json");

function main() {
  const fromEnv =
    process.env.DESIGN_CORE_PUBLIC_URL?.trim() ||
    process.env.GITHUB_PAGES_ROOT?.trim();
  let publicBaseUrl = fromEnv ? normalizePublicBaseUrl(fromEnv) : null;

  if (!publicBaseUrl) {
    let remote;
    try {
      remote = execSync("git remote get-url origin", {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      console.error(
        "Could not read git remote `origin`. Publish your repo first, then run again.\n" +
          "Or set DESIGN_CORE_PUBLIC_URL to your site root, e.g.\n" +
          "  DESIGN_CORE_PUBLIC_URL=https://myorg.github.io/my-repo/ npm run sync-public-url",
      );
      process.exit(1);
    }
    publicBaseUrl = githubPagesRootFromRemote(remote);
    if (!publicBaseUrl) {
      console.error(
        "Could not parse GitHub owner/repo from origin:\n  ",
        remote,
        "\nSet DESIGN_CORE_PUBLIC_URL to your GitHub Pages root instead.",
      );
      process.exit(1);
    }
  }

  let existing = {};
  if (existsSync(sitePath)) {
    try {
      existing = JSON.parse(readFileSync(sitePath, "utf8"));
    } catch {
      existing = {};
    }
  }

  const out = { ...existing, publicBaseUrl };
  writeFileSync(sitePath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Updated public/data/site.json");
  console.log("  publicBaseUrl:", publicBaseUrl);
  console.log(
    "\nCopy link in the tool (on localhost) will use this URL so people without Cursor can open prototypes after Pages deploys.",
  );
}

main();
