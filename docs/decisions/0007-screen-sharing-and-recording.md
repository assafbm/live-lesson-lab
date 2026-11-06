# Decision 0007: Release stabilization, then screen sharing, then recording

- Date: 2026-11-06
- Status: Sequencing decision; neither feature is implemented in this release.

Follow-up: the owner authorized isolated feature work while postponing audio
acceptance. Screen sharing is now implemented on `codex/screen-sharing`, without
merging or deploying it. See [branch notes](../screen-sharing.md). The production
stabilization release and recording deferral remain unchanged.

## Decision

Release the reviewed audio/video/security fixes first and validate natural voice
on two separate devices. Add teacher screen sharing as the next bounded feature.
Defer recording until audio acceptance and an explicit consent/access/retention
design exist. Authentication and abuse controls remain prerequisites for opening
the pilot to unrelated teachers and students.

## Why screen sharing fits the next increment

The document role already maps to a negotiated video sender. A display capture
can replace its camera source while the face camera and microphone continue.
This needs no S3 storage, extra video section or SFU. It still needs an explicit
capture-source abstraction: a display stream must not be disguised as a physical
camera ID or leased through CameraSourceManager.

Proposed UI: a Document source control with Off, Camera and Share screen, a clear
sharing indicator, and Stop sharing. The browser chooses which screen/window/tab
the user shares after a direct button click. Cancelling must preserve the current
camera. Browser Stop sharing, source ending, disconnect and component cleanup
must release capture and restore the previously selected document camera (or Off).
If face/document previously shared a camera, screen sharing splits them into two
sources without duplicating the face capture.

Start with teacher video-only screen sharing; retain the separate microphone
path and do not implicitly capture system audio. Test switching both directions,
shared versus distinct cameras, cancellation, ended events, text readability,
source resolution changes and browser support. `replaceTrack` can reject a
change outside negotiated limits; handle that failure rather than assuming every
display resolution is accepted.

## Why recording waits

Recording the call means defining exactly what is saved: the document, both
faces, both voices and their layout. A browser MediaRecorder can record a stream,
but composing multiple videos and mixing voices adds CPU work and lifecycle
handling. That complicates investigation of an unresolved audio-quality issue.
Long recordings also need bounded memory, partial-file recovery and supported
format checks. A local-download prototype is simpler than cloud recording but
still needs a visible recording state and informed participant consent.

Cloud recording should use a separate private S3 bucket, authenticated ownership,
server-authorized upload/download URLs, retention/deletion rules, upload limits,
encryption, cost monitoring, and incomplete-upload cleanup. Never reuse the
publicly served website assets as recording storage. Decide who can record and
who can access/delete the result before implementing uploads. Current ephemeral
room membership is insufficient durable recording authorization.

## Alternatives

- Add both immediately: faster feature breadth, but increases CPU, privacy and
  debugging scope before the ordinary lesson has audio acceptance.
- Add screen sharing to this stabilization release: technically feasible, but
  makes it harder to compare the new audio behavior with the previous release.
- Server/SFU recording: can centralize composition but adds media infrastructure,
  operational cost and privacy responsibilities; unnecessary for this increment.
- Local recording first: reasonable future prototype after audio acceptance,
  explicit consent/UI and a bounded recording design; not automatically equivalent
  to a reliable cloud recording service.

## References

- [W3C Screen Capture](https://www.w3.org/TR/screen-capture/): user activation,
  capture selection and lifecycle requirements.
- [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/):
  recording streams and checking supported formats.
