# Screen sharing: feature branch and learning notes

## Release boundary

Work lives on `codex/screen-sharing`, based on deployed commit `6f449d6`.
The owner requested parallel feature work while the listening test is postponed.
`main` and the AWS site retain the stabilization release. Do not deploy this
branch merely because its automated tests pass. Recording remains deferred.

The baseline is also tagged `pilot-baseline-2026-11-06`. This tag means a known
deployed checkpoint, not that the unresolved real-device audio test has passed.
To inspect the previous source without deleting branch work, first commit any
local changes, then use `git switch main`. Avoid `reset --hard` as a rollback tool.
If this feature is merged later and must be undone, use a reviewed revert commit
and deploy the rebuilt previous release; changing a Git branch alone does not
change AWS.

## Teacher flow

1. Join a lesson, open Settings, and select Share screen.
2. Choose a screen, window or tab in the browser's own picker.
3. The chosen surface replaces the document camera in the large document view.
   Face video and the microphone remain independent. Screen audio is not captured.
4. Use Stop sharing in the toolbar, Return to document camera in Settings, or the
   browser's stop action. The remembered document camera/Off choice is restored.

The initial version is teacher-only. Document camera rotation/mirror controls
are disabled while the screen is shared; they retain their values for restoration.
The screen is sent upright, and the student retains local viewing controls.
Cancellation or denial leaves the current camera selection intact. The source
picker requires a direct user action and cannot be opened automatically by a peer.

## Why these pieces are separate

- `useScreenShare` owns the display stream and browser-picker lifecycle. It never
  pretends that a screen is a physical camera ID.
- `CameraSourceManager` still owns cameras. If face and document shared one
  camera, starting screen share keeps that single face capture and adds one display
  capture. A document-only camera can be released while the screen replaces it.
- `useLessonSession` attaches the screen to an existing teacher video sender and
  sends the normal role-to-MID mapping. No protocol, server, database, AWS resource
  or audio-path change is needed. Screen/document exclusivity is enforced in the
  session as well as the UI, so there are at most two teacher video tracks.
- Capture requests have a generation number. Disconnect/unmount invalidates the
  picker request; if it finishes later, its stream is immediately stopped.
- Browser Stop sharing emits `ended`. Programmatic `track.stop()` does not emit
  that event, so explicit cleanup handles both paths.
- `replaceTrack` may reject a display format outside negotiated limits. Failure
  releases the display, restores the camera, and reports the issue rather than
  leaving a screen capture running without a usable sender.

## Validation and remaining manual checks

Branch validation: `npm run check` and `npm run build` passed; `npm test` passed
all 14 tests (23 seconds). `git diff --check` passed. No AWS deployment was run
for this feature.

Automated tests replace the native display picker with a synthetic canvas stream;
the actual WebRTC senders, receivers and role mapping remain real. Coverage includes
shared-camera → screen → camera, independent microphone continuity, unchanged
transceiver count, picker cancellation, a delayed capture after disconnect, and
rejected sender attachment. The 390×844 layout keeps Stop sharing visible without
page overflow. Existing media/security regression tests remain in the suite.

Before merge/deployment, manually check a real browser picker with a window and
tab, browser Stop sharing, 4K/high-DPI text readability, source minimization,
multiple monitors, and camera restoration on two separate devices. A small
viewport test does not demonstrate mobile screen-capture API support. Unsupported
browsers show a message and preserve document-camera functionality.

Screen sharing must not delay the pending real-device audio acceptance test.
Recording and cloud storage are not part of this branch.
