import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function writeJsonPlugin() {
  return {
    name: "write-json",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "PUT") return next();
        const url = req.url.split("?")[0];
        if (!url.startsWith("/data/") || !url.endsWith(".json")) return next();
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
    writeJsonPlugin(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        project: resolve(__dirname, "project.html"),
        canvas: resolve(__dirname, "canvas.html"),
        prototype: resolve(__dirname, "prototype.html"),
        "design-system": resolve(__dirname, "design-system.html"),
      },
    },
  },
});
