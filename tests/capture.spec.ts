import { test, expect } from "@playwright/test";

test("browser microphone processing capabilities", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const samples = [];
    for (const noiseSuppression of [true, false]) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression, echoCancellation: true, autoGainControl: true } });
      const track = stream.getAudioTracks()[0];
      samples.push({ requested: noiseSuppression, actual: track.getSettings().noiseSuppression, constraints: track.getConstraints().noiseSuppression });
      stream.getTracks().forEach((track) => track.stop());
    }
    return samples;
  });
  expect(result).toEqual([{ requested: true, actual: true, constraints: true }, { requested: false, actual: false, constraints: false }]);
});
