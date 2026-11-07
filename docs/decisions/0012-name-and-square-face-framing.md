# Name and face framing correction — 2026-11-07

## Names

The name form previously committed only on explicit Save name. A user could type
a name and join with the old value. Blurring the input now commits it as well;
the explicit save action remains. The footer uses the participant name rather
than a hard-coded teacher/student role. Display names remain presentation data,
never identity or authorization claims.

## Square face video

Dedicated face-camera tracks are center-cropped in the existing outgoing canvas
processor. Rotation and mirroring still happen before transmission. The crop uses
the smaller source dimension, without stretching. Selection previews and received
face tiles also show a centered square, including when locally rotating a view.

When face and document share one physical camera, preserve its full outgoing
frame and crop only the face tile. Cropping the shared track would remove document
edges; making a second sender would violate the single-camera transmission rule.
The document and screen-share tiles continue to fit the full content.

Canvas processing adds work and may be throttled in background tabs. Existing
frame callbacks limit drawing to actual camera frames. Real-device audio and
background behavior remain acceptance checks; a square face is not an audio fix.

## Recording status

The current release still has no recorder. The existing identity and participation
records prepare for private recording access; they do not store media. The pending
product choice is a local student download first, or private S3 storage in the
same increment. Do not show a functioning Record button until consent, composition,
audio mixing, finalization and recovery are implemented and tested.
