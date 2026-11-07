# 0013 — Private student-view recordings

## Scope and user agreement

The user chose private S3 storage in the first recording increment. A lesson is
recorded as the student's study view: teacher content large, teacher face upper
right, student face below, with both voices. This release adds recording requests,
consent, browser composition, incremental upload, a private download library and
owner deletion. It does not send email; a verified sending domain/SES delivery
configuration and notification retry workflow are separate work.

## Identity and consent

Guests can still attend a lesson. Recording requires two distinct verified
accounts admitted and present in that lesson. Both explicitly consent to a new
request. The request snapshots their account subjects and current socket IDs.
The server checks that exact pair remains present before starting. A later
replacement student cannot consent on behalf of the original or download their
recording. Names and browser-supplied emails never authorize access.

The student explicitly starts the recorder after both consents. Either side can
stop it; previously captured content is finalized, not erased. Recording status
is polled every three seconds; remote stop visibility depends on network latency.
A failed status request stops local capture. Missing recorder heartbeat changes
the server status after 20 seconds. A stuck finalization becomes failed after two
minutes without heartbeat. Unstarted requests expire after five minutes.

## Browser composition versus server recording

Canvas produces a 1280x720 study layout at 15 fps, encoded as VP8/Opus WebM. Main
content is contained; faces use square crops. The student viewing rotation,
mirroring and zoom are applied in addition to the already transformed outgoing
pixels. Labels use current participant names. Camera loss yields placeholders;
screen/camera switches are picked up from existing lesson video elements.

Web Audio mixes unique, currently enabled live microphone tracks into a media
stream destination with a compressor. It never connects this mix to speakers and
never reacquires microphones. Recorder cleanup stops only generated tracks.
A browser compositor avoids desktop capture of private applications and avoids
an SFU/media server. The tradeoff is that recording depends on the student's
machine, browser, foreground tab and upload connection. Hiding the student tab
stops and finalizes recording. Disconnect waits for saving; closing the browser
can still lose unfinished data. There is no crash-resume promise.

## Private storage and upload

A separate S3 bucket blocks all public access, enforces HTTPS and encrypts objects
with SSE-S3. It has no public CloudFront origin. Uploaded recordings expire after
30 days; unfinished multipart uploads are aborted after one day. The bucket is
retained if the stack is removed. Database metadata remains durable; recordings
past their application expiry cannot be downloaded even before S3 lifecycle runs.

Eight-MiB parts upload directly from the student browser via five-minute signed
URLs. The signature binds object, multipart upload, part number and content length.
Only that consenting student's authenticated account can request upload URLs.
There is a 256-part/two-GiB ceiling and a four-hour upload authorization window.
The client bounds pending upload memory at 64 MiB and retries parts three times.
An overload fails explicitly instead of claiming success. Unfinished chunks are
not a playable recording and are not shown in the library.

Completion lists actual S3 parts rather than trusting client ETags/byte counts.
If object completion succeeds but metadata finalization fails, a retry can detect
the completed object and retry the database transaction. The library entries for
both snapshotted participants are written atomically with ready status.

## Authorization and deployment

A separate HTTPS Lambda API verifies Cognito ID JWT signatures and verified email
on every operation, then checks participant ownership. Public transport does not
mean anonymous recording access. Function invocation permission is restricted
to the function URL. CORS permits only the existing site origin. IAM scopes S3 to
recording objects and DynamoDB to recording/user-list keys and required room keys.
No browser AWS credentials are issued. Tokens, signed URLs and media are not logged.

Downloads require a ready, unexpired recording and membership in its original
pair. The resulting five-minute S3 URL is a bearer capability: someone who obtains
that URL can use it until expiry. A downloaded file can also be copied by its
recipient. This is access control, not DRM. Owners can delete a finished recording
for both participants. The first library lists the latest 100 recording references;
large-history pagination is future work.

## Testing and known limits

Tests cover identity rejection, guest rejection, consent, participant replacement,
teacher upload denial, bounded part signing, private download checks, heartbeat,
completion and library authorization. Browser tests encode and decode a real
WebM, sample layout pixels, verify decoded audio energy, and exercise consent,
explicit start, stop and saved feedback. Cloud transport is mocked in these tests.
A deployment check separately exercises real S3 presigned multipart transport.

A full two-account recording on real devices remains a manual acceptance check.
Synthetic decoded audio does not prove the previously reported mechanical sound
has been fixed. Recordings faithfully include the audio received in the lesson.

## References

- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode/stream
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPart.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/abort-mpu.html
