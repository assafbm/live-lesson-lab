import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// Explicit manual smoke check: creates one temporary room on the specified
// deployment. Only this script's browser/contexts are closed. Fake devices keep
// real cameras, microphones and conversations out of this automated check.
const target = process.env.LESSON_TEST_URL;
assert(target && new URL(target).protocol === "https:", "Set LESSON_TEST_URL to the deployed HTTPS origin.");
const browser = await chromium.launch({ channel: "chrome", args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required"
] });
const errors = [];
const contexts = [];
try {
  for (let participant = 0; participant < 2; participant += 1) {
    const context = await browser.newContext({ permissions: ["camera", "microphone"] });
    await context.addInitScript(() => {
      window.lessonTestPeers = [];
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(config) { super(config); window.lessonTestPeers.push(this); }
      };
    });
    contexts.push(context);
  }
  const teacher = await contexts[0].newPage();
  const student = await contexts[1].newPage();
  for (const page of [teacher, student]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy|Refused to/i.test(message.text())) errors.push(message.text());
    });
  }
  const response = await teacher.goto(target);
  assert.equal(response.status(), 200);
  const headers = await response.allHeaders();
  assert(headers["content-security-policy"]?.includes("frame-ancestors 'none'"));
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  await teacher.getByRole("button", { name: "Enable cameras", exact: true }).click();
  await expect(teacher.locator("#face-device option")).not.toHaveCount(1);
  const device = await teacher.locator("#face-device option").nth(1).getAttribute("value");
  await teacher.locator("#face-device").selectOption(device);
  await teacher.locator("#document-device").selectOption(device);
  await teacher.getByRole("button", { name: "Create lesson link" }).click();
  await expect(teacher.locator("#student-link")).toBeVisible({ timeout: 30000 });
  const link = await teacher.locator("#student-link").inputValue();
  await teacher.getByRole("button", { name: "Join lesson", exact: true }).click();
  await student.goto(link);
  await student.getByRole("button", { name: "Enable my camera", exact: true }).click();
  await student.getByRole("button", { name: "Join lesson", exact: true }).click();
  for (const page of [teacher, student]) {
    await expect(page.getByText("The lesson connection is live.", { exact: true })).toBeVisible({ timeout: 45000 });
  }
  await expect.poll(() => teacher.locator('section[aria-label="Student camera"] video')
    .evaluate((video) => video.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => student.locator('section[aria-label="Shared content"] video')
    .evaluate((video) => video.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  for (const page of [teacher, student]) await page.getByRole("button", { name: "Unmute", exact: true }).click();
  for (const page of [teacher, student]) {
    await expect.poll(() => page.evaluate(async () => {
      const stats = await window.lessonTestPeers.at(-1).getStats();
      return [...stats.values()].filter((row) => row.type === "inbound-rtp" && row.kind === "audio")
        .reduce((sum, row) => sum + row.packetsReceived, 0);
    }), { timeout: 30000 }).toBeGreaterThan(30);
  }
  await teacher.getByRole("button", { name: "Settings", exact: true }).click();
  await teacher.getByText("Connection diagnostics", { exact: true }).click();
  await expect(teacher.getByText(/Receiving audio/)).toBeVisible({ timeout: 15000 });
  await teacher.keyboard.press("Escape");
  await student.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(teacher.locator(".meeting-screen")).toBeVisible();
  await student.getByRole("button", { name: "Join lesson", exact: true }).click();
  await expect(student.getByText("The lesson connection is live.", { exact: true })).toBeVisible({ timeout: 30000 });
  assert.deepEqual(errors, [], "Browser runtime/CSP errors");
  console.log("PASS: deployed security headers, AWS room creation/join, two-way synthetic video/audio, diagnostics and re-entry.");
  console.log("This checks deployed signaling with same-computer media; it does not validate real voice quality or cross-network TURN.");
} finally {
  for (const context of contexts.reverse()) await context.close();
  await browser.close();
}
