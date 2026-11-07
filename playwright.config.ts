import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Use the installed Chrome locally and Playwright's pinned Chromium in CI.
    channel: process.env.CI ? undefined : "chrome",
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
    trace: "retain-on-failure"
  },
  webServer: [
    { command: "node services/signaling/dist/index.js", url: "http://127.0.0.1:4301/health", env: { SIGNALING_PORT: "4301" } },
    { command: "npm run dev --workspace @live-lesson-lab/web -- --host 127.0.0.1 --port 4173", url: "http://127.0.0.1:4173", env: { SIGNALING_PORT: "4301" } },
    // Exercise the real production AuthGate, where import.meta.env.DEV is false.
    // These settings belong only to the test build, never the deployed bundle.
    { command: "npm run build --workspace @live-lesson-lab/web && node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174", env: { VITE_SIGNALING_URL: "ws://127.0.0.1:4301/signal", VITE_AUTH_AUTHORITY: "", VITE_AUTH_CLIENT_ID: "", VITE_AUTH_DOMAIN: "" } }
  ]
});
