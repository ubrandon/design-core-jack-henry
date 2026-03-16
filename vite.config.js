import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, unlinkSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
