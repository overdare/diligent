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
