import { test, expect, type Page } from "@playwright/test";

// Instrument only the test browser. Production never exposes peers or tracks.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = { peers: [] as RTCPeerConnection[], streams: [] as MediaStream[], failAudioOnce: false, delayAudio: false, blockPlayback: false };
    (window as any).__mediaTest = state;
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(config?: RTCConfiguration) { super({ ...config, iceServers: [] }); state.peers.push(this); }
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.tagName === "AUDIO" && state.blockPlayback) return Promise.reject(new DOMException("Test autoplay block", "NotAllowedError"));
      return play.call(this);
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio && state.failAudioOnce) {
        state.failAudioOnce = false;
        throw new DOMException("Test permission denial", "NotAllowedError");
      }
      if (constraints?.audio && state.delayAudio) await new Promise((resolve) => setTimeout(resolve, 1500));
      const stream = await capture(constraints);
      state.streams.push(stream);
      return stream;
    };
  });
}

async function joinPair(teacher: Page, student: Page, camera = true) {
  await instrument(teacher);
  await instrument(student);
  await teacher.goto("/");
  if (camera) {
    await teacher.getByRole("button", { name: "Enable cameras", exact: true }).click();
    await expect(teacher.locator("#face-device option")).not.toHaveCount(1);
    const device = await teacher.locator("#face-device option").nth(1).getAttribute("value");
    await teacher.locator("#face-device").selectOption(device!);
    await teacher.locator("#document-device").selectOption(device!);
  }
  await teacher.getByRole("button", { name: "Create lesson link" }).click();
  await expect(teacher.locator("#student-link")).toBeVisible();
  const link = await teacher.locator("#student-link").inputValue();
  await teacher.getByRole("button", { name: "Join lesson" }).click();
  await student.goto(link);
  if (camera) await student.getByRole("button", { name: "Enable my camera" }).click();
  await student.getByRole("button", { name: "Join lesson" }).click();
  await expect(teacher.getByText("The lesson connection is live.", { exact: true })).toBeVisible();
  await expect(student.getByText("The lesson connection is live.", { exact: true })).toBeVisible();
}

async function inboundPackets(page: Page) {
  return page.evaluate(async () => {
    const peer = (window as any).__mediaTest.peers.at(-1) as RTCPeerConnection;
    const report = await peer.getStats();
    return [...report.values()].filter((row) => row.type === "inbound-rtp" && row.kind === "audio")
      .reduce((sum, row) => sum + row.packetsReceived, 0);
  });
}

test("two-way media, one shared camera sender, transforms, microphone recovery, and cleanup", async ({ page: teacher, browser }, info) => {
  const studentContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await studentContext.newPage();
  const errors: string[] = [];
  teacher.on("pageerror", (error) => errors.push(error.message));
  student.on("pageerror", (error) => errors.push(error.message));
  try {
    await joinPair(teacher, student);
    await expect.poll(() => teacher.locator('section[aria-label="Student · Face"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await expect.poll(() => student.locator('section[aria-label="Document"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().filter((sender: RTCRtpSender) => sender.track?.kind === "video").length)).toBe(1);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.streams.filter((stream: MediaStream) => stream.getVideoTracks().some((track) => track.readyState === "live")).length)).toBe(1);

    await teacher.evaluate(() => { (window as any).__mediaTest.failAudioOnce = true; });
    await teacher.getByRole("button", { name: "Unmute", exact: true }).click();
    await expect(teacher.getByText(/Microphone access failed/)).toBeVisible();
    await teacher.getByRole("button", { name: "Unmute", exact: true }).click();
    await student.getByRole("button", { name: "Unmute", exact: true }).click();
    await expect.poll(() => inboundPackets(teacher)).toBeGreaterThan(20);
    await expect.poll(() => inboundPackets(student)).toBeGreaterThan(20);
    const initialPackets = await inboundPackets(teacher);
    await expect.poll(() => inboundPackets(teacher), { timeout: 15000 }).toBeGreaterThan(initialPackets + 100);

    // Two tabs in one Chromium process may share the capture backend. Release
    // the other tab's fake microphone before checking an effective change.
    await student.getByRole("button", { name: "Mute", exact: true }).click();

    await teacher.getByRole("button", { name: "Settings", exact: true }).click();
    const capturesBefore = await teacher.evaluate(() => (window as any).__mediaTest.streams.length);
    await teacher.getByLabel("Noise suppression", { exact: true }).uncheck();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().find((sender: RTCRtpSender) => sender.track?.kind === "audio").track.getSettings().noiseSuppression)).toBe(false);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.streams.length)).toBeLessThanOrEqual(capturesBefore + 1);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.streams.filter((stream: MediaStream) => stream.getAudioTracks().some((track) => track.readyState === "live")).length)).toBe(1);
    await teacher.getByRole("group", { name: "Document camera", exact: true }).getByLabel("Rotate before sending").selectOption("90");
    await expect.poll(() => student.locator('section[aria-label="Document"] video').evaluate((video: HTMLVideoElement) => video.videoHeight > video.videoWidth)).toBe(true);
    await teacher.getByText("Connection diagnostics", { exact: true }).click();
    await expect(teacher.getByText(/Receiving audio/)).toBeVisible();
    await teacher.screenshot({ path: info.outputPath("teacher-settings.png") });
    await teacher.keyboard.press("Escape");
    await expect(teacher.getByRole("button", { name: "Settings", exact: true })).toBeFocused();

    await student.getByRole("button", { name: "Unmute", exact: true }).click();
    await expect(teacher.getByText("Microphone on", { exact: true })).toBeVisible();
    await student.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(teacher.getByText("Microphone muted", { exact: true })).toBeVisible();
    await student.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect.poll(() => student.evaluate(() => (window as any).__mediaTest.streams.flatMap((stream: MediaStream) => stream.getTracks()).filter((track: MediaStreamTrack) => track.readyState === "live").length)).toBe(0);
    await expect(teacher.locator(".meeting-screen")).toBeVisible();
    await student.getByRole("button", { name: "Join lesson", exact: true }).click();
    await expect(student.getByText("The lesson connection is live.", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await studentContext.close(); }
});

test("camera can start after joining and blocked audio has a working recovery action", async ({ page: teacher, browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await context.newPage();
  try {
    await joinPair(teacher, student, false);
    await expect(teacher.getByText("Student face video will appear here.")).toBeVisible();
    await student.getByRole("button", { name: "Settings", exact: true }).click();
    await student.getByRole("button", { name: "Enable my camera", exact: true }).click();
    await expect.poll(() => teacher.locator('section[aria-label="Student · Face"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    expect(await student.evaluate(() => (window as any).__mediaTest.peers.at(-1).getTransceivers().length)).toBe(4);

    // A new receiver stream exercises the normal autoplay recovery path.
    await teacher.evaluate(() => { (window as any).__mediaTest.blockPlayback = true; });
    await student.keyboard.press("Escape");
    await student.getByRole("button", { name: "Disconnect", exact: true }).click();
    await student.getByRole("button", { name: "Join lesson", exact: true }).click();
    await expect(teacher.getByRole("button", { name: "Play audio", exact: true })).toBeVisible();
    await teacher.evaluate(() => { (window as any).__mediaTest.blockPlayback = false; });
    await teacher.getByRole("button", { name: "Play audio", exact: true }).click();
    await expect(teacher.getByRole("button", { name: "Play audio", exact: true })).toBeHidden();
  } finally { await context.close(); }
});

test("camera-free joining, late microphone cancellation, and responsive room", async ({ page: teacher, browser }, info) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await context.newPage();
  try {
    await joinPair(teacher, student, false);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
      await teacher.setViewportSize(viewport);
      await expect(teacher.getByRole("button", { name: "Disconnect", exact: true })).toBeInViewport();
      expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await teacher.screenshot({ path: info.outputPath(`meeting-${viewport.width}.png`) });
    }
    await teacher.evaluate(() => { (window as any).__mediaTest.delayAudio = true; });
    await teacher.getByRole("button", { name: "Unmute", exact: true }).click();
    await teacher.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.streams.length)).toBeGreaterThan(0);
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.streams.flatMap((stream: MediaStream) => stream.getTracks()).filter((track: MediaStreamTrack) => track.readyState === "live").length)).toBe(0);
  } finally { await context.close(); }
});
