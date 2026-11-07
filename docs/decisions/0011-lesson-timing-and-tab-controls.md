# 0011 — Lesson timing, shared-tab controls and visual refresh

## Decision

Teachers select 15–240 minutes before creating a lesson (default 60). The server
starts the deadline on the teacher's first entry. Exiting and returning does not
restart it. Both participants see a countdown and a reminder five minutes before
it ends. Only the teacher can add 15 minutes, up to eight planned hours. Overtime
never ends the call: the user explicitly chose an uninterrupted lesson.

## Why a server deadline?

Independent browser countdowns drift and restart on remount. A timestamp owned
by the signaling server gives both clients the same deadline. Heartbeats refresh
the estimated server clock offset. This is a planning aid, not a billing clock;
network round-trip latency is not corrected. DynamoDB updates check teacher
ownership, live membership and the previous deadline. Repeating a request cannot
add time twice. The local signaling implementation follows the same rule.

Invitation expiry and lesson duration are different: expiry gates new admissions;
it never revokes an already admitted participant. The selected duration replaces
the old fixed 30-minute invitation window. Starting or extending a lesson keeps
that window at least as long as the planned deadline, without unlocking the room.
An invitation can still be renewed separately. Room data remains temporary; this
is not scheduled-room booking or a persistent calendar.

## Shared-tab controls

The teacher may enable wheel forwarding and zoom on a captured browser tab when
CaptureController exposes the required methods. The browser owns the permission
prompt, triggered by a deliberate control click. Permission denial does not end
screen sharing. Ending capture removes forwarding and event listeners.

This provides neither arbitrary clicks nor typing nor control of a desktop
presentation application. Unsupported browsers, windows and monitor captures
show a clear instruction to use the original tab or application. We chose native
capability detection over an extension or remote-desktop service: those introduce
installation, permissions and a much larger security boundary.

Reference: https://developer.chrome.com/docs/web-platform/captured-surface-control

## Visual direction

Indigo actions, teal accents, light blue backgrounds and navy meeting surfaces
replace the muted palette. Video remains the main content. The timer fits in the
header; reminders overlay the lesson without forcing navigation or page scrolling.
Icons retain accessible labels and tooltips.

## Verification and limits

Regression tests cover protocol bounds, teacher-only extension, duplicate requests,
first-entry timing, re-entry, warning/overtime UI, and mocked native tab controls.
Mock controls verify our integration, not a real browser's native permission UI.
Synthetic media checks cannot certify microphone quality. The reported mechanical
sound still needs a real two-device listening test; these changes do not claim to
solve it. Recording and recording delivery remain separate work.
