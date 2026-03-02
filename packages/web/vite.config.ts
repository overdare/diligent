// @summary Vite config for React client build with dev proxy to backend RPC
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
