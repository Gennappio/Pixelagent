import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const server = process.env.PIXELAGENTS_SERVER ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: server, ws: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  test: { environment: "node" },
});
