import { defineConfig, loadEnv } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { spawn, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_CREDS_PATH = resolve(__dirname, ".app-screens.json");

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
          const filePath = resolve(__dirname, "public" + url);
          let body = "";
          req.on("data", chunk => { body += chunk; });
          req.on("end", () => {
            try {
              JSON.parse(body);
              writeFileSync(filePath, body, "utf-8");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"Invalid JSON"}');
            }
          });
          return;
        }

        if (req.method === "DELETE") {
          const filePath = resolve(__dirname, "public" + url);
          if (!filePath.startsWith(resolve(__dirname, "public/data/"))) {
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
            res.end('{"error":"' + e.message + '"}');
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

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, __dirname, "");

  return {
    base: "./",
    server: { port: 3000 },
    plugins: [
      siteJsonDevPlugin(viteEnv),
      {
        name: "suppress-public-reload",
        handleHotUpdate({ file }) {
          if (file.includes("/public/")) return [];
        },
      },
      dataFilesPlugin(),
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
