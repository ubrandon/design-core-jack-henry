import { defineConfig, loadEnv } from "vite";
import { resolve, dirname, sep, relative } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { spawn, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_CREDS_PATH = resolve(__dirname, ".app-screens.json");
const DESIGNER_PATH = resolve(__dirname, ".designer");
const PUBLIC_DATA_ROOT = resolve(__dirname, "public/data");

/** True if Vite is about to full-reload the browser because a file under public/data changed. */
function isPublicDataFullReloadPayload(payload) {
  if (!payload || payload.type !== "full-reload") return false;
  const norm = (s) => String(s || "").replace(/\\/g, "/");
  const tb = norm(payload.triggeredBy);
  if (tb.includes("/public/data/")) return true;
  const p = norm(payload.path);
  if (p !== "*" && p !== "") {
    if (p.includes("/public/data/")) return true;
    if (p.replace(/^\//, "").startsWith("public/data/")) return true;
  }
  return false;
}

/** Vite 8+ may send HMR through server.ws, server.hot, or environment.hot — patch every channel. */
function patchHotChannelsPublicDataReloadFilter(server) {
  const patched = new WeakSet();
  function wrap(hot) {
    if (!hot || typeof hot.send !== "function" || patched.has(hot)) return;
    patched.add(hot);
    const orig = hot.send.bind(hot);
    hot.send = (payload) => {
      if (isPublicDataFullReloadPayload(payload)) return;
      return orig(payload);
    };
  }
  wrap(server.ws);
  if (server.hot) wrap(server.hot);
  if (server.environments) {
    for (const env of Object.values(server.environments)) {
      if (env && env.hot) wrap(env.hot);
    }
  }
}

function safePublicDataFilePath(urlPath) {
  const pathOnly = (urlPath || "").split("?")[0];
  if (pathOnly.includes("..") || pathOnly.includes("\0")) return null;
  const rel = pathOnly.replace(/^\/+/, "");
  if (!rel.startsWith("data/")) return null;
  const abs = resolve(__dirname, "public", rel);
  if (abs !== PUBLIC_DATA_ROOT && !abs.startsWith(PUBLIC_DATA_ROOT + sep)) return null;
  return abs;
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseGithubRemoteForPages(raw) {
  if (!raw) return null;
  const url = raw.trim().replace(/\.git$/i, "");
  let m = url.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

function inferGithubPagesRootFromGit(cwd) {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const p = parseGithubRemoteForPages(remote);
    if (!p) return null;
    return `https://${p.owner.toLowerCase()}.github.io/${p.repo}/`;
  } catch {
    return null;
  }
}

function normalizePublicBaseUrl(s) {
  if (s == null || !String(s).trim()) return null;
  try {
    const t = String(s).trim();
    const raw = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, "")}`;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let path = u.pathname || "/";
    if (!path.endsWith("/")) path += "/";
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

/** Dev only: serve merged data/site.json so Copy link uses GitHub Pages while on localhost. */
function siteJsonDevPlugin(viteEnv) {
  return {
    name: "site-json-dev-merge",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET") return next();
        const pathOnly = req.url.split("?")[0];
        if (pathOnly !== "/data/site.json") return next();

        const fp = resolve(__dirname, "public/data/site.json");
        let disk = {};
        if (existsSync(fp)) {
          try {
            disk = JSON.parse(readFileSync(fp, "utf8"));
          } catch {
            disk = {};
          }
        }

        const fromDisk = normalizePublicBaseUrl(disk.publicBaseUrl);
        const fromEnv = normalizePublicBaseUrl(
          viteEnv.DESIGN_CORE_PUBLIC_URL || process.env.DESIGN_CORE_PUBLIC_URL,
        );
        const inferred = normalizePublicBaseUrl(inferGithubPagesRootFromGit(__dirname));
        const effective = fromDisk || fromEnv || inferred;

        const out = { ...disk };
        if (effective) out.publicBaseUrl = effective;

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      });
    },
  };
}

function dataFilesPlugin() {
  return {
    name: "data-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url.split("?")[0];
        if (!url.startsWith("/data/")) return next();

        if (req.method === "PUT" && url.endsWith(".json")) {
          const filePath = safePublicDataFilePath(url);
          if (!filePath) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end('{"error":"Forbidden"}');
            return;
          }
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              JSON.parse(body);
              mkdirSync(dirname(filePath), { recursive: true });
              writeFileSync(filePath, body, "utf-8");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: e.message || "Invalid JSON" }));
            }
          });
          return;
        }

        if (req.method === "DELETE") {
          const filePath = safePublicDataFilePath(url);
          if (!filePath) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end('{"error":"Forbidden"}');
            return;
          }
          try {
            if (existsSync(filePath)) unlinkSync(filePath);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        next();
      });
    },
  };
}

function localDevDataApiPlugin() {
  function readProjectsIndex() {
    const p = resolve(PUBLIC_DATA_ROOT, "projects/index.json");
    if (!existsSync(p)) return { projects: [] };
    const raw = readFileSync(p, "utf8");
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Refuse to silently overwrite a corrupt index — that wipes every other
      // project entry on the next write. Surface the error so the user can fix it.
      throw new Error(
        "projects/index.json is not valid JSON: " + e.message,
      );
    }
  }

  function writeProjectsIndex(data) {
    const p = resolve(PUBLIC_DATA_ROOT, "projects/index.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  const protoStubHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prototype</title>
  <link rel="stylesheet" href="../../../../../styles/shared.css">
  <link rel="stylesheet" href="../../../../../styles/ds.css">
</head>
<body style="margin:0;padding:24px;background:var(--bg-1);font-family:var(--font-body);color:var(--text);">
  <p style="color:var(--muted);">New prototype — describe the flow you want and ask the AI to build it out here.</p>
</body>
</html>
`;

  return {
    name: "local-dev-data-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || "").split("?")[0];

        if (pathOnly === "/api/tool-env" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ local: true }));
          return;
        }

        if (pathOnly === "/api/designer" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          try {
            if (existsSync(DESIGNER_PATH)) {
              res.end(readFileSync(DESIGNER_PATH, "utf8"));
            } else {
              res.end(JSON.stringify({ name: "", company: "", team: [] }));
            }
          } catch {
            res.end(JSON.stringify({ name: "", company: "", team: [] }));
          }
          return;
        }

        if (pathOnly === "/api/designer" && req.method === "POST") {
          try {
            const data = await readJsonBody(req);
            const name = typeof data.name === "string" ? data.name.trim() : "";
            const company = typeof data.company === "string" ? data.company.trim() : "";
            let team = [];
            if (Array.isArray(data.team)) {
              team = data.team
                .filter((t) => t && typeof t.name === "string" && t.name.trim())
                .map((t) => ({ name: t.name.trim() }));
            }
            if (!team.length && name) team = [{ name }];
            const out = { name, company, team };
            writeFileSync(DESIGNER_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message || "Bad JSON" }));
          }
          return;
        }

        if (pathOnly === "/api/project-admin" && req.method === "POST") {
          res.setHeader("Content-Type", "application/json");
          let body;
          try {
            body = await readJsonBody(req);
          } catch {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const action = body.action;
          try {
            if (action === "create-project") {
              const id = typeof body.id === "string" ? body.id.trim() : "";
              const name = typeof body.name === "string" ? body.name.trim() : "";
              if (!SLUG_RE.test(id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Project id must be lowercase letters, numbers, and hyphens (e.g. my-feature)." }));
                return;
              }
              if (!name) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Project name is required." }));
                return;
              }
              const base = resolve(PUBLIC_DATA_ROOT, "projects", id);
              if (existsSync(base)) {
                res.writeHead(409);
                res.end(JSON.stringify({ error: "A project with that id already exists." }));
                return;
              }
              const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() : "";
              const description = typeof body.description === "string" ? body.description.trim() : "";
              const createdAt = new Date().toISOString();
              // Read the current index before any disk writes so a parse failure
              // surfaces as a clean error instead of leaving an orphan folder.
              const idx = readProjectsIndex();
              try {
                mkdirSync(resolve(base, "screens"), { recursive: true });
                mkdirSync(resolve(base, "prototypes"), { recursive: true });
                const projectJson = {
                  name,
                  description,
                  ...(createdBy ? { createdBy } : {}),
                  createdAt,
                  updatedAt: createdAt,
                };
                writeFileSync(resolve(base, "project.json"), JSON.stringify(projectJson, null, 2) + "\n", "utf8");
                writeFileSync(resolve(base, "canvas.json"), JSON.stringify({ screens: [] }, null, 2) + "\n", "utf8");
                writeFileSync(
                  resolve(base, "prototypes/index.json"),
                  JSON.stringify({ prototypes: [] }, null, 2) + "\n",
                  "utf8",
                );
                const projects = Array.isArray(idx.projects) ? idx.projects : [];
                projects.push({
                  id,
                  name,
                  description,
                  ...(createdBy ? { createdBy } : {}),
                  createdAt,
                });
                writeProjectsIndex({ projects });
              } catch (writeErr) {
                // Roll back the folder so the id isn't stuck behind a 409 on retry.
                try { rmSync(base, { recursive: true, force: true }); } catch {}
                throw writeErr;
              }
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, id }));
              return;
            }

            if (action === "delete-project") {
              const id = typeof body.id === "string" ? body.id.trim() : "";
              if (!SLUG_RE.test(id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid project id." }));
                return;
              }
              const base = resolve(PUBLIC_DATA_ROOT, "projects", id);
              if (!base.startsWith(resolve(PUBLIC_DATA_ROOT, "projects") + sep)) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
              }
              // Read and compute the new index BEFORE removing the folder so a
              // corrupt-index throw doesn't leave the project half-deleted.
              const idx = readProjectsIndex();
              const projects = (Array.isArray(idx.projects) ? idx.projects : []).filter((p) => p.id !== id);
              if (existsSync(base)) rmSync(base, { recursive: true, force: true });
              writeProjectsIndex({ projects });
              res.writeHead(200);
              res.end('{"ok":true}');
              return;
            }

            if (action === "create-prototype") {
              const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
              const id = typeof body.id === "string" ? body.id.trim() : "";
              const name = typeof body.name === "string" ? body.name.trim() : "";
              if (!SLUG_RE.test(projectId) || !SLUG_RE.test(id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Project and prototype ids must be lowercase slug format." }));
                return;
              }
              if (!name) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Prototype name is required." }));
                return;
              }
              const protoRoot = resolve(PUBLIC_DATA_ROOT, "projects", projectId, "prototypes", id);
              if (!protoRoot.startsWith(resolve(PUBLIC_DATA_ROOT, "projects") + sep)) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
              }
              if (existsSync(protoRoot)) {
                res.writeHead(409);
                res.end(JSON.stringify({ error: "A prototype with that id already exists in this project." }));
                return;
              }
              const projectDir = resolve(PUBLIC_DATA_ROOT, "projects", projectId);
              if (!existsSync(projectDir)) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: "Project not found." }));
                return;
              }
              let device = typeof body.device === "string" ? body.device.toLowerCase() : "mobile";
              if (!["mobile", "desktop", "online", "responsive"].includes(device)) device = "mobile";
              const description = typeof body.description === "string" ? body.description.trim() : "";
              // Read the prototypes index BEFORE any disk writes. A corrupt file
              // here used to be silently reset to []; instead fail fast so the
              // user can fix the file without losing other prototype entries.
              const indexPath = resolve(projectDir, "prototypes/index.json");
              let list = { prototypes: [] };
              if (existsSync(indexPath)) {
                const rawList = readFileSync(indexPath, "utf8");
                try {
                  list = JSON.parse(rawList);
                } catch (e) {
                  throw new Error(
                    "prototypes/index.json is not valid JSON for project " + projectId + ": " + e.message,
                  );
                }
              }
              try {
                mkdirSync(protoRoot, { recursive: true });
                writeFileSync(
                  resolve(protoRoot, "meta.json"),
                  JSON.stringify({ name, description }, null, 2) + "\n",
                  "utf8",
                );
                writeFileSync(resolve(protoRoot, "index.html"), protoStubHtml, "utf8");
                const protos = Array.isArray(list.prototypes) ? list.prototypes : [];
                protos.push({ id, name, description, device });
                writeFileSync(indexPath, JSON.stringify({ prototypes: protos }, null, 2) + "\n", "utf8");
              } catch (writeErr) {
                try { rmSync(protoRoot, { recursive: true, force: true }); } catch {}
                throw writeErr;
              }
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, id }));
              return;
            }

            if (action === "delete-prototype") {
              const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
              const id = typeof body.id === "string" ? body.id.trim() : "";
              if (!SLUG_RE.test(projectId) || !SLUG_RE.test(id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid ids." }));
                return;
              }
              const protoRoot = resolve(PUBLIC_DATA_ROOT, "projects", projectId, "prototypes", id);
              if (!protoRoot.startsWith(resolve(PUBLIC_DATA_ROOT, "projects") + sep)) {
                res.writeHead(403);
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
              }
              // Read and filter the index BEFORE deleting. If the file is corrupt
              // we want a clear error, not a silent wipe of the other prototypes.
              const indexPath = resolve(PUBLIC_DATA_ROOT, "projects", projectId, "prototypes/index.json");
              let nextProtos = null;
              if (existsSync(indexPath)) {
                const rawList = readFileSync(indexPath, "utf8");
                let list;
                try {
                  list = JSON.parse(rawList);
                } catch (e) {
                  throw new Error(
                    "prototypes/index.json is not valid JSON for project " + projectId + ": " + e.message,
                  );
                }
                nextProtos = (Array.isArray(list.prototypes) ? list.prototypes : []).filter((p) => p.id !== id);
              }
              if (existsSync(protoRoot)) rmSync(protoRoot, { recursive: true, force: true });
              if (nextProtos !== null) {
                writeFileSync(indexPath, JSON.stringify({ prototypes: nextProtos }, null, 2) + "\n", "utf8");
              }
              res.writeHead(200);
              res.end('{"ok":true}');
              return;
            }

            res.writeHead(400);
            res.end(JSON.stringify({ error: "Unknown action." }));
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message || "Server error" }));
          }
          return;
        }

        next();
      });
    },
  };
}

function captureApiPlugin() {
  let activeCapture = null;

  function ensureConfig(appUrl) {
    const capturesDir = resolve(__dirname, "public", "data", "captures");
    mkdirSync(capturesDir, { recursive: true });
    const configPath = resolve(capturesDir, "config.json");
    const defaults = {
      viewport: { width: 390, height: 844 },
      discover: true,
      dismissSelectors: [],
    };
    let existing = {};
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        existing = {};
      }
    }
    const merged = { ...defaults, ...existing, appUrl };
    writeFileSync(configPath, JSON.stringify(merged, null, 2));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Bad JSON")); }
      });
    });
  }

  function streamCapture(req, res, args, env) {
    if (activeCapture) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end('{"error":"A capture is already running"}');
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("status", { message: "Starting..." });

    const child = spawn("node", ["scripts/capture-screens.js", ...args], {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    activeCapture = child;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrOutput = "";
    let connectionOpen = true;

    req.on("close", () => {
      connectionOpen = false;
      if (child && !child.killed) {
        try { child.stdin.write("quit\n"); } catch {}
        setTimeout(() => {
          if (!child.killed) {
            try { child.kill("SIGTERM"); } catch {}
          }
        }, 3000);
      }
    });

    child.stdout.on("data", chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("__MANUAL_MODE__")) {
          try {
            const data = JSON.parse(line.slice("__MANUAL_MODE__".length));
            send("manual", data);
          } catch { send("manual", {}); }
        } else if (line.startsWith("__MANUAL_CAPTURED__")) {
          try {
            const data = JSON.parse(line.slice("__MANUAL_CAPTURED__".length));
            send("manual_captured", data);
          } catch {}
        } else {
          send("log", { text: line.replace(/^\s+/, "") });
        }
      }
    });

    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderrOutput += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        send("log", { text: line.replace(/^\s+/, "") });
      }
    });

    child.on("close", (code, signal) => {
      if (stdoutBuffer.trim()) {
        if (stdoutBuffer.startsWith("__MANUAL_MODE__")) {
          try { send("manual", JSON.parse(stdoutBuffer.slice("__MANUAL_MODE__".length))); } catch { send("manual", {}); }
        } else if (stdoutBuffer.startsWith("__MANUAL_CAPTURED__")) {
          try { send("manual_captured", JSON.parse(stdoutBuffer.slice("__MANUAL_CAPTURED__".length))); } catch {}
        } else {
          send("log", { text: stdoutBuffer.replace(/^\s+/, "") });
        }
      }
      if (stderrBuffer.trim()) {
        send("log", { text: stderrBuffer.replace(/^\s+/, "") });
      }
      activeCapture = null;
      if (!connectionOpen) return;
      if (code === 0) {
        send("done", { success: true });
      } else {
        const detail = stderrOutput.trim().split("\n").pop() || "";
        send("error", {
          message: `Capture failed (code=${code}, signal=${signal})${detail ? ": " + detail : ""}`,
        });
      }
      res.end();
    });

    child.on("error", err => {
      activeCapture = null;
      if (!connectionOpen) return;
      send("error", { message: err.message });
      res.end();
    });
  }

  return {
    name: "capture-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/api/capture/launch" && req.method === "POST") {
          try {
            const params = await readBody(req);
            if (!params.url) { res.writeHead(400); res.end('{"error":"url required"}'); return; }
            ensureConfig(params.url);
            streamCapture(req, res, [], {});
          } catch (e) {
            res.writeHead(400); res.end(`{"error":"${e.message}"}`);
          }
          return;
        }

        if (req.url === "/api/capture/status" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ running: !!activeCapture, pid: activeCapture ? activeCapture.pid : null }));
          return;
        }

        if (req.url === "/api/capture/stop" && req.method === "POST") {
          if (!activeCapture) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true,"message":"No active capture"}');
            return;
          }
          try { activeCapture.stdin.write("quit\n"); } catch {}
          setTimeout(() => {
            if (activeCapture && !activeCapture.killed) {
              try { activeCapture.kill("SIGTERM"); } catch {}
            }
            setTimeout(() => {
              activeCapture = null;
            }, 1000);
          }, 2000);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true,"message":"Stopping capture"}');
          return;
        }

        if (req.url === "/api/capture/creds" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          try {
            if (existsSync(LOCAL_CREDS_PATH)) {
              const data = JSON.parse(readFileSync(LOCAL_CREDS_PATH, "utf-8"));
              const login = data.login || {};
              res.end(JSON.stringify({
                username: login.username || "",
                password: login.password || "",
              }));
            } else {
              res.end(JSON.stringify({ username: "", password: "" }));
            }
          } catch {
            res.end(JSON.stringify({ username: "", password: "" }));
          }
          return;
        }

        if (req.url === "/api/capture/creds" && req.method === "POST") {
          try {
            const params = await readBody(req);
            let data = {};
            if (existsSync(LOCAL_CREDS_PATH)) {
              try { data = JSON.parse(readFileSync(LOCAL_CREDS_PATH, "utf-8")); } catch {}
            }
            data.login = {
              ...(data.login || {}),
              username: params.username || "",
              password: params.password || "",
            };
            writeFileSync(LOCAL_CREDS_PATH, JSON.stringify(data, null, 2) + "\n");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(`{"error":"${e.message}"}`);
          }
          return;
        }

        if (req.url === "/api/capture/reset-session" && req.method === "POST") {
          const browserDataDir = resolve(__dirname, ".capture-browser-data");
          try {
            if (existsSync(browserDataDir)) {
              rmSync(browserDataDir, { recursive: true, force: true });
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(`{"error":"${e.message}"}`);
          }
          return;
        }

        next();
      });
    },
  };
}

/**
 * Watches public/data/ for file changes and pushes events to connected
 * browsers via Vite's HMR WebSocket. Replaces the old suppress-public-reload
 * plugin: public/data changes no longer trigger a full page reload — instead
 * each page's live-reload.js handler decides what to refresh.
 */
function liveDataPlugin() {
  let debounceTimer = null;
  let pending = new Set();

  return {
    name: "live-data-watcher",
    transformIndexHtml: {
      order: "pre",
      handler(_html, ctx) {
        if (!ctx.server) return;
        const token = ctx.server.config.webSocketToken;
        const base = ctx.server.config.base || "/";
        return [
          {
            tag: "script",
            children: `window.__VITE_WS_TOKEN__=${JSON.stringify(token)};window.__VITE_HMR_BASE__=${JSON.stringify(base)};`,
            injectTo: "head-prepend",
          },
        ];
      },
    },
    configureServer(server) {
      if (server.__designCoreLiveDataHook) return;
      server.__designCoreLiveDataHook = true;

      patchHotChannelsPublicDataReloadFilter(server);

      const dataDir = resolve(__dirname, "public/data");
      if (!existsSync(dataDir)) return;

      const publicDir = resolve(__dirname, "public");

      function scheduleEmit() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const paths = Array.from(pending);
          pending.clear();
          if (
            paths.length &&
            server.ws &&
            typeof server.ws.send === "function"
          ) {
            server.ws.send({
              type: "custom",
              event: "design-core:data-changed",
              data: { paths },
            });
          }
        }, 300);
      }

      /** Use Vite's chokidar instance — Node fs.watch(recursive) misses many saves on macOS. */
      function onPublicDataFsEvent(filePath) {
        if (!filePath) return;
        const absFile = resolve(filePath);
        if (absFile !== dataDir && !absFile.startsWith(dataDir + sep)) return;
        let relFromPublic = relative(publicDir, absFile);
        if (
          relFromPublic.startsWith(".." + sep) ||
          relFromPublic === ".." ||
          relFromPublic.startsWith("../")
        ) {
          return;
        }
        pending.add(relFromPublic.split(sep).join("/"));
        scheduleEmit();
      }

      server.watcher.on("change", onPublicDataFsEvent);
      server.watcher.on("add", onPublicDataFsEvent);
      server.watcher.on("unlink", onPublicDataFsEvent);
    },
  };
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, __dirname, "");

  return {
    appType: "mpa",
    base: "./",
    server: { port: 3000 },
    plugins: [
      siteJsonDevPlugin(viteEnv),
      liveDataPlugin(),
      dataFilesPlugin(),
      localDevDataApiPlugin(),
      captureApiPlugin(),
    ],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          project: resolve(__dirname, "project.html"),
          canvas: resolve(__dirname, "canvas.html"),
          captures: resolve(__dirname, "captures.html"),
          prototype: resolve(__dirname, "prototype.html"),
          "design-system": resolve(__dirname, "design-system.html"),
        },
      },
    },
  };
});
