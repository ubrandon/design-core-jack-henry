import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_CREDS_PATH = resolve(__dirname, ".app-screens.json");

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
    const config = {
      appUrl,
      viewport: { width: 390, height: 844 },
      discover: true,
      dismissSelectors: [],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
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
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    activeCapture = child;
    let stdoutBuffer = "";
    let stderrOutput = "";
    let connectionOpen = true;

    req.on("close", () => { connectionOpen = false; });

    child.stdout.on("data", chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("__SCOUT_RESULT__")) {
          try {
            const items = JSON.parse(line.slice("__SCOUT_RESULT__".length));
            send("scout", { items });
          } catch {}
        } else {
          send("log", { text: line.replace(/^\s+/, "") });
        }
      }
    });

    child.stderr.on("data", chunk => {
      stderrOutput += chunk.toString();
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        send("log", { text: line.replace(/^\s+/, "") });
      }
    });

    child.on("close", (code, signal) => {
      // Flush remaining stdout
      if (stdoutBuffer.trim()) {
        if (stdoutBuffer.startsWith("__SCOUT_RESULT__")) {
          try {
            const items = JSON.parse(stdoutBuffer.slice("__SCOUT_RESULT__".length));
            send("scout", { items });
          } catch {}
        } else {
          send("log", { text: stdoutBuffer.replace(/^\s+/, "") });
        }
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
        // Scout: find nav items without taking screenshots
        if (req.url === "/api/capture/scout" && req.method === "POST") {
          try {
            const params = await readBody(req);
            if (!params.url) { res.writeHead(400); res.end('{"error":"url required"}'); return; }
            ensureConfig(params.url);
            streamCapture(req, res, ["scout"], {});
          } catch (e) {
            res.writeHead(400); res.end(`{"error":"${e.message}"}`);
          }
          return;
        }

        // Deep capture: capture selected items deeply
        if (req.url === "/api/capture/deep" && req.method === "POST") {
          try {
            const params = await readBody(req);
            if ((!params.items || !params.items.length) && !params.includeHome) {
              res.writeHead(400); res.end('{"error":"items required"}'); return;
            }
            streamCapture(req, res, ["deep"], {
              CAPTURE_ITEMS: JSON.stringify(params.items || []),
              CAPTURE_INCLUDE_HOME: params.includeHome ? "1" : "0",
            });
          } catch (e) {
            res.writeHead(400); res.end(`{"error":"${e.message}"}`);
          }
          return;
        }

        // Full discover capture (original)
        if (req.url === "/api/capture" && req.method === "POST") {
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
          res.end(JSON.stringify({ running: !!activeCapture }));
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

export default defineConfig({
  base: "./",
  server: { port: 3000 },
  plugins: [
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
});
