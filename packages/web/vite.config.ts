// @summary Vite config for React client build with dev proxy to backend RPC
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEFAULT_PROJECT_NAME = "Diligent";

export default defineConfig({
  plugins: [
    {
      name: "raw-md",
      transform(code, id) {
        if (id.endsWith(".md")) {
          return `export default ${JSON.stringify(code)};`;
        }
      },
    },
    {
      name: "app-project-name",
      transformIndexHtml(html) {
        const projectName = process.env.VITE_APP_PROJECT_NAME?.trim() || DEFAULT_PROJECT_NAME;
        return html.replace(/%VITE_APP_PROJECT_NAME%/g, projectName);
      },
    },
    react(),
    legacy({
      targets: ["chrome >= 90"],
    }),
  ],
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 5174,
    proxy: {
      "/rpc": {
        target: "ws://localhost:7433",
        ws: true,
      },
    },
  },
});
