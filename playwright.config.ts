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
    { command: "npm run dev --workspace @live-lesson-lab/web -- --host 127.0.0.1 --port 4173", url: "http://127.0.0.1:4173", env: { SIGNALING_PORT: "4301" } }
  ]
});
