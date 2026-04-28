import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 43128,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:43127",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
