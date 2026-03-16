import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  server: { port: 3000 },
  plugins: [
    {
      name: "reload-on-data-change",
      handleHotUpdate({ file, server }) {
        if (file.includes("public/data/") || file.includes("public/styles/")) {
          server.ws.send({ type: "full-reload", path: "*" });
          return [];
        }
      },
    },
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
