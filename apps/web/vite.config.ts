import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Keep the browser on one origin while forwarding WebSocket upgrades
      // to the separate signaling process.
      "/signal": {
        target: "ws://localhost:3001",
        ws: true
      }
    }
  }
});
