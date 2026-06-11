// Shared helpers for the setup/maintenance CLIs (doctor, finish-setup, update-tool).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo root is two levels up from scripts/lib/.
export const root = resolve(__dirname, "../..");

// The public template repo every company repo descends from.
export const CORE_SLUG = "ubrandon/design-core";
export const CORE_HTTPS_URL = `https://github.com/${CORE_SLUG}.git`;
export const UPSTREAM_PUSH_BLOCK = "no-push-allowed";

// Runs a command, returns trimmed stdout, or null on any failure.
export function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

// Like sh() but throws with the command's stderr so callers can show real errors.
export function shOrThrow(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message || "").toString().trim();
    throw new Error(detail || `Command failed: ${cmd}`);
  }
}

// Parses a GitHub remote URL (SSH or HTTPS) into { owner, repo }, else null.
export function parseGithubRemote(raw) {
  if (!raw) return null;
  const url = raw.trim().replace(/\.git$/i, "");
  let m = url.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

// True when the URL points at the public template repo.
export function isCoreRemote(url) {
  const p = parseGithubRemote(url);
  return !!p && `${p.owner}/${p.repo}`.toLowerCase() === CORE_SLUG;
}

// Reads all remotes into { origin: {fetch, push}, upstream: {...}, ... }.
export function getRemotes() {
  const out = sh("git remote -v");
  if (out === null) return null;
  const remotes = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    remotes[m[1]] = remotes[m[1]] || {};
    remotes[m[1]][m[3]] = m[2];
  }
  return remotes;
}

// True when the upstream remote exists and cannot be pushed to.
export function upstreamPushDisabled(remotes) {
  const push = remotes?.upstream?.push;
  return !!push && !/^(https?:\/\/|git@)/i.test(push);
}

// Classifies the repo so every script speaks about it the same way.
// kinds: no-git | core | mid-setup | company | double-remote | unknown
export function classifyRepo() {
  if (sh("git rev-parse --is-inside-work-tree") !== "true") {
    return { kind: "no-git", remotes: {} };
  }
  const remotes = getRemotes() || {};
  const origin = remotes.origin?.fetch || null;
  const upstream = remotes.upstream?.fetch || null;
  const originInfo = parseGithubRemote(origin);

  if (origin && isCoreRemote(origin) && upstream) {
    return { kind: "double-remote", remotes, origin, upstream, originInfo };
  }
  if (origin && isCoreRemote(origin)) {
    return { kind: "core", remotes, origin, upstream, originInfo };
  }
  if (!origin && upstream && isCoreRemote(upstream)) {
    return { kind: "mid-setup", remotes, origin, upstream, originInfo };
  }
  if (origin) {
    return { kind: "company", remotes, origin, upstream, originInfo };
  }
  return { kind: "unknown", remotes, origin, upstream, originInfo };
}

// Reads + parses JSON, returning { ok, data } or { ok: false, error }.
export function readJsonSafe(absPath) {
  if (!existsSync(absPath)) return { ok: false, error: "missing" };
  try {
    return { ok: true, data: JSON.parse(readFileSync(absPath, "utf8")) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Reads the local designer identity file if present and valid.
export function readDesigner() {
  const r = readJsonSafe(resolve(root, ".designer"));
  return r.ok ? r.data : null;
}

// Company-owned paths: everything else counts as tool files for the drift check.
export const COMPANY_OWNED_PATHS = [
  "public/data",
  "GETTING_STARTED.md",
  ".designer.example",
];
