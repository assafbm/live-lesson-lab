# Decision 0008: Expiring invitations and teacher access controls

- Date: 2026-11-07
- Status: Implemented on `codex/room-access`; not merged or deployed.
- Base: `codex/screen-sharing` at `971c8fa`; includes that branch's feature.

## Context

The owner chose room security before recording. The existing pilot admits anyone
holding the room link, subject to the single-student limit. A heartbeat extends
routing state, so routing TTL alone cannot express an invitation deadline.
Teachers also need a way to stop new arrivals and explicitly end a room.

## Decisions

1. A new invitation permits new membership for 30 minutes from room creation.
   The server owns the deadline. Client clocks only display it.
2. A teacher may lock or unlock new joins. Locking does not remove an already
   admitted student. An admitted participant can leave the meeting and re-enter
   through the same WebSocket membership even while access is locked or expired.
   Refreshing the page creates a new membership attempt and is subject to access
   checks again. This distinction is visible in the UI.
3. Renewal sets the deadline to 30 minutes from the server's current time. It
   preserves the lock. Unlocking preserves the deadline. Teachers must renew and
   unlock an invitation that is both expired and locked.
4. Renewal extends the SAME link. It is not a new token, revocation, or a new
   identity. Anyone holding that link can try again when access is reopened.
5. End lesson for everyone requires an explicit confirmation in the product UI.
   The server deletes the room membership and informs both participants. Their
   peer connections, microphone captures, camera previews and screen sharing are
   released; the ended link cannot admit new participants.
6. These actions require the current room's teacher membership. Merely putting
   `role=teacher` in a URL or sending a control message is insufficient. This is
   authorization against a socket-owned room, not authenticated teacher identity.
7. Use protocol version 6 for the new commands and acknowledged access state.
   Client and server updates need a coordinated release; use fresh rooms after
   upgrading. Existing AWS rows without access fields deny new joins by default.

## Why enforce the same condition twice in AWS?

A strong read provides a useful rejection message, but the teacher could lock
the room immediately after that read. The DynamoDB join transaction therefore
also checks `locked`, `joinExpiresAt`, room TTL, and the empty student slot.
The write is the point where admission is decided. A lock that commits after a
successful join does not retroactively eject that newly admitted participant.

Teacher access updates condition on both teacher connection ownership and room
expiry, and return the acknowledged updated state. Heartbeats extend only the
routing TTL, never the fixed invitation deadline. DynamoDB TTL deletion remains
asynchronous cleanup rather than permission enforcement.

## Alternatives and limits

- Client-only timers: rejected because a modified browser can bypass them.
- Reuse room TTL: rejected because heartbeat renewal would silently reopen or
  extend invitations.
- Lock by immediately disconnecting the student: rejected because a teacher may
  want to prevent new arrivals while continuing the current lesson.
- Renewal that implicitly unlocks: rejected because it changes two independent
  access settings and could unexpectedly reopen a deliberately locked room.
- Per-student approval/waiting room and independently revocable invite tokens:
  useful subsequent increments, but not represented as implemented here.
- Teacher accounts, distributed abuse controls, TURN and robust reconnect remain
  outstanding. This milestone does not make the pilot ready for unrestricted
  student use or replace the pending real-device audio acceptance test.

## Verification

The regression suite passes 20 tests, including:

- Exact invitation expiry boundary and missing-field rejection.
- Local WebSocket teacher-only controls, lock/unlock, renewal without unlocking,
  admitted participant re-entry, and terminal room closure.
- AWS adapter rejection of expired/locked invitations, conditional join writes,
  teacher-only updates and acknowledged state. These SDK tests use mocks; they
  do not substitute for AWS transaction/concurrency integration testing.
- Browser retry after a denied join, confirmation cancellation, ending a live
  lesson and release of camera/display captures on both sides.
- Existing two-way media, microphone processing, screen sharing and responsive
  layout regressions.

Type checks and production build are part of branch validation. No live AWS
deployment is performed for this milestone. The production baseline remains
commit `6f449d6`, tagged `pilot-baseline-2026-11-06`.
