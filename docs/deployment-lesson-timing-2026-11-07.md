# Lesson timing and shared-tab release — 2026-11-07

## Published

- Application commit: `cf1b851`, branch `codex/verified-lesson-identity`, pushed to GitHub.
- Teacher: https://d14zq4wr2313jx.cloudfront.net/?role=teacher
- AWS stack: `LiveLessonLabServerlessStack`, account `072270723188`, region `eu-north-1`.
- CloudFormation: `UPDATE_COMPLETE`; reviewed diff changed only signaling Lambda code.
- Protocol: 9.
- Frontend: `index-BH-QoB43.js`, `index-VPU52p0i.css`.
- CloudFront invalidation: `IB3NJ89RXSS1GAR77MVPVWRQ3K`, `Completed`.
- Production configuration came from stack outputs. Hashed assets uploaded first,
  index last; prior assets preserved. Publication remains manual, not GitHub CI.

## Checks

All 38 automated tests passed, along with workspace type checks, production build
and infrastructure compilation. Desktop and 390px mobile overtime screenshots
were inspected. Tab-control tests simulate native capture and permission denial;
they do not certify the operating system picker or native permission dialog.

Live checks found HTTP 200, the expected JavaScript asset, CSP headers, no browser
page errors, a guest lobby without sign-in, and rejection of an invalid lesson.
The teacher page loaded. A direct WebSocket heartbeat returned protocol 9 and
unsigned teacher room creation was rejected. The initial probe timed out because
it omitted the required heartbeat; the corrected protocol probe passed.

## Manual acceptance still needed

Refresh both participants, create a new lesson, choose its duration, and add time
from the teacher. Test native browser-tab scrolling/zoom on a supported browser;
window/application control remains in its original application. Review the new
palette with real camera content. The five-minute notice and overtime behavior
were tested by injected test-only server messages, without waiting an hour.

Real two-device audio listening is still outstanding. Synthetic audio packet
checks passed but cannot establish that the reported mechanical sound is solved.
No recordings, email delivery, test users or new AWS services were created.

Design rationale: [ADR 0011](decisions/0011-lesson-timing-and-tab-controls.md).
