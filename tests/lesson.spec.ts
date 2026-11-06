import { test, expect, type Page } from "@playwright/test";

// Instrument only the test browser. Production never exposes peers or tracks.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = { peers: [] as RTCPeerConnection[], streams: [] as MediaStream[], failAudioOnce: false, delayAudio: false, blockPlayback: false,
      displayMode: "normal", displays: [] as MediaStream[], displayOptions: null as unknown };
    (window as any).__mediaTest = state;
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(config?: RTCConfiguration) { super({ ...config, iceServers: [] }); state.peers.push(this); }
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    // Mock only the native screen picker, not the WebRTC sender/receiver path.
    // Never expose a real desktop or personal window to an automated test.
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      state.displayOptions = options;
      if (state.displayMode === "cancel") throw new DOMException("Test picker cancellation", "NotAllowedError");
      if (state.displayMode === "delay") await new Promise((resolve) => setTimeout(resolve, 1200));
      const canvas = document.createElement("canvas");
      canvas.width = 800; canvas.height = 450;
      const context = canvas.getContext("2d")!;
      const paint = () => { context.fillStyle = "#1c3452"; context.fillRect(0, 0, 800, 450); context.fillStyle = "white"; context.font = "36px sans-serif"; context.fillText(`Shared document ${Date.now()}`, 30, 70); };
      paint();
      const stream = canvas.captureStream(15);
      const timer = setInterval(paint, 70);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      state.displays.push(stream);
      return stream;
    };
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

test("screen sharing replaces only the document source and restores the shared camera", async ({ page: teacher, browser }, info) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await context.newPage();
  try {
    await joinPair(teacher, student);
    await teacher.getByRole("button", { name: "Unmute", exact: true }).click();
    await expect.poll(() => inboundPackets(student)).toBeGreaterThan(20);
    const microphone = await teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().find((sender: RTCRtpSender) => sender.track?.kind === "audio").track.id);
    await teacher.getByRole("button", { name: "Settings", exact: true }).click();
    await teacher.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(teacher.getByRole("button", { name: "Stop sharing", exact: true })).toBeVisible();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().filter((sender: RTCRtpSender) => sender.track?.kind === "video").length)).toBe(2);
    await expect.poll(() => student.locator('section[aria-label="Document"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(800);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.displayOptions.audio)).toBe(false);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().find((sender: RTCRtpSender) => sender.track?.kind === "audio").track.id)).toBe(microphone);
    expect(await teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getTransceivers().length)).toBe(4);
    await teacher.keyboard.press("Escape");
    await teacher.setViewportSize({ width: 390, height: 844 });
    await expect(teacher.getByRole("button", { name: "Stop sharing", exact: true })).toBeInViewport();
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await teacher.screenshot({ path: info.outputPath("screen-sharing-phone.png") });

    // The browser's own Stop sharing action emits ended. Programmatic stop()
    // does not, so explicitly dispatch that event when simulating the browser.
    await teacher.evaluate(() => {
      const track = (window as any).__mediaTest.displays.at(-1).getVideoTracks()[0];
      track.stop(); track.dispatchEvent(new Event("ended"));
    });
    await expect(teacher.getByRole("button", { name: "Stop sharing", exact: true })).toBeHidden();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().filter((sender: RTCRtpSender) => sender.track?.kind === "video").length)).toBe(1);
    await expect.poll(() => student.locator('section[aria-label="Document"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(800);
    const packets = await inboundPackets(student);
    await expect.poll(() => inboundPackets(student)).toBeGreaterThan(packets + 20);
  } finally { await context.close(); }
});

test("screen picker cancellation and late resolution do not leak a display capture", async ({ page: teacher, browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await context.newPage();
  try {
    await joinPair(teacher, student, false);
    await teacher.getByRole("button", { name: "Settings", exact: true }).click();
    await teacher.evaluate(() => { (window as any).__mediaTest.displayMode = "cancel"; });
    await teacher.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(teacher.getByText(/Screen sharing was cancelled or denied/)).toBeVisible();
    await expect(teacher.getByRole("button", { name: "Stop sharing", exact: true })).toBeHidden();
    await teacher.evaluate(() => { (window as any).__mediaTest.displayMode = "delay"; });
    await teacher.getByRole("button", { name: "Share screen", exact: true }).click();
    await teacher.keyboard.press("Escape");
    await teacher.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.displays.length)).toBe(1);
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.displays[0].getVideoTracks()[0].readyState)).toBe("ended");
  } finally { await context.close(); }
});

test("a rejected screen sender swap releases the display and restores the camera", async ({ page: teacher, browser }) => {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const student = await context.newPage();
  try {
    await joinPair(teacher, student);
    await teacher.evaluate(() => {
      const state = (window as any).__mediaTest;
      for (const sender of state.peers.at(-1).getSenders() as RTCRtpSender[]) {
        const replace = sender.replaceTrack.bind(sender);
        sender.replaceTrack = async (track) => {
          if (track && state.displays.some((stream: MediaStream) => stream.getVideoTracks().includes(track))) {
            throw new DOMException("Test unsupported format", "InvalidModificationError");
          }
          return replace(track);
        };
      }
    });
    await teacher.getByRole("button", { name: "Settings", exact: true }).click();
    await teacher.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(teacher.getByText(/This screen could not be attached/)).toBeVisible();
    await expect(teacher.getByRole("button", { name: "Stop sharing", exact: true })).toBeHidden();
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.displays[0].getVideoTracks()[0].readyState)).toBe("ended");
    await expect.poll(() => teacher.evaluate(() => (window as any).__mediaTest.peers.at(-1).getSenders().filter((sender: RTCRtpSender) => sender.track?.kind === "video").length)).toBe(1);
    await expect.poll(() => student.locator('section[aria-label="Document"] video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  } finally { await context.close(); }
});
