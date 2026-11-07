import { test, expect } from "@playwright/test";

test("student-view compositor records real WebM video and mixed audio without capturing app UI", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // Import the actual browser compositor; only cloud transport is replaced.
    const { LessonRecorder } = await import("/src/recordings/LessonRecorder.ts");
    const calls: string[] = []; const blobs: Blob[] = [];
    const originalFetch = window.fetch;
    window.fetch = (async (url: any, options: any) => {
      if (url === "https://recording-upload.invalid/part") { blobs.push(options.body); return new Response("", { status: 200 }); }
      return originalFetch(url, options);
    }) as typeof fetch;
    const sources: MediaStream[] = [];
    const video = async (color: string) => {
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(15); sources.push(stream);
      const element = document.createElement("video"); element.srcObject = stream; element.muted = true; await element.play(); return element;
    };
    const [documentVideo, teacher, student] = await Promise.all([video("#00ff00"), video("#ff0000"), video("#0000ff")]);
    const audio = new AudioContext(); await audio.resume(); const destination = audio.createMediaStreamDestination();
    const oscillator = audio.createOscillator(); oscillator.connect(destination); oscillator.start();
    const sourcesBefore = destination.stream.getTracks().map(track => track.readyState);
    const recorder = new LessonRecorder("test", () => ({ document: { video: documentVideo, name: "" }, teacher: { video: teacher, name: "Teacher" }, student: { video: student, name: "Student" }, audio: destination.stream.getAudioTracks() }), (error: string) => { throw Error(error); }, async (input: any) => { calls.push(input.action); return input.action === "part" ? { url: "https://recording-upload.invalid/part" } : { ok: true }; });
    await recorder.start(); await new Promise(resolve => setTimeout(resolve, 1500)); await recorder.finish();
    const output = new Blob(blobs, { type: "video/webm" });
    const url = URL.createObjectURL(output); const playback = document.createElement("video"); playback.src = url; playback.muted = true; await playback.play();
    await new Promise<void>(resolve => playback.addEventListener("timeupdate", () => resolve(), { once: true }));
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720; const context = canvas.getContext("2d")!; context.drawImage(playback, 0, 0);
    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    const decoded = await audio.decodeAudioData(await output.arrayBuffer());
    const samples = decoded.getChannelData(0);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const result = { rms, calls, size: output.size, width: playback.videoWidth, height: playback.videoHeight, main: pixel(400, 350), teacher: pixel(1100, 150), student: pixel(1100, 450), sourceLive: destination.stream.getAudioTracks()[0].readyState, sourcesBefore };
    playback.pause(); URL.revokeObjectURL(url); oscillator.stop(); await audio.close(); sources.forEach(stream => stream.getTracks().forEach(track => track.stop())); window.fetch = originalFetch;
    return result;
  });
  expect(result.calls).toEqual(["start", "part", "complete"]);
  expect(result.rms).toBeGreaterThan(0.01);
  expect(result.size).toBeGreaterThan(10000);
  expect(result.width).toBe(1280); expect(result.height).toBe(720);
  expect(result.main[1]).toBeGreaterThan(230); expect(result.teacher[0]).toBeGreaterThan(230); expect(result.student[2]).toBeGreaterThan(230);
  expect(result.sourceLive).toBe("live");
});

test("recording UI requires consent, waits for student start and shows saving completion", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const reactModule = await import("/node_modules/.vite/deps/react.js");
    const React = reactModule.default ?? reactModule;
    const domModule = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = domModule.default ?? domModule;
    const { RecordingControlsSession } = await import("/src/recordings/RecordingControls.tsx");
    const host = document.createElement("div"); document.body.append(host);
    const record: any = { id: "record", roomId: "room", state: "pending", teacherConsent: true, studentConsent: false, createdAt: Date.now(), expiresAt: Date.now() + 86400000 };
    const api = async (input: any) => {
      if (input.action === "consent") { record.studentConsent = true; record.state = "approved"; }
      if (input.action === "start") record.state = "recording";
      if (input.action === "stop") record.state = "stopping";
      if (input.action === "complete") record.state = "ready";
      if (input.action === "part") return { url: "https://recording-upload.invalid/part" };
      return { recording: { ...record }, ok: true };
    };
    const nativeFetch = window.fetch;
    window.fetch = ((url: any, options: any) => url === "https://recording-upload.invalid/part" ? Promise.resolve(new Response("", { status: 200 })) : nativeFetch(url, options)) as typeof fetch;
    createRoot(host).render(React.createElement(RecordingControlsSession, { role: "student", roomId: "room", connected: true, authenticated: true, configured: true, api,
      sources: () => ({ document: { video: null, name: "" }, teacher: { video: null, name: "Teacher" }, student: { video: null, name: "Student" }, audio: [] }) }));
  });
  await page.getByRole("button", { name: "I consent to this recording", exact: true }).click();
  await page.getByRole("button", { name: "Start recording and upload", exact: true }).click();
  await expect(page.getByText("● Recording lesson · private · 30-day retention", { exact: false })).toBeVisible();
  await page.waitForTimeout(1200); // Produce a real MediaRecorder chunk before stopping.
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Record lesson", exact: true }).click();
  await expect(page.getByText("Recording saved. Find it in My recordings after the lesson.")).toBeVisible();
});
