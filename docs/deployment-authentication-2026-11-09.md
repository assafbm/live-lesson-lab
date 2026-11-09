# Authentication deployment — 2026-11-09

- Implementation commit: `309aa29` on `codex/verified-lesson-identity`, pushed to GitHub.
- Existing Cognito pool updated in place: minimum length 8, all four character-type requirements false. Confirmed with describe-user-pool.
- Public client enables SRP and refresh-token authentication; no client secret.
- Type checks, infrastructure build, production build and clean regression run passed: 47 tests.
- Earlier regression attempts overlapped edits/builds and had transient failures; the isolated final run passed all tests without changing lesson behavior.
- Production assets: `index-Bp_UkIn4.js`, `index-B8X43U__.css`.
- CloudFront invalidation `I24GFUW82TD1W484K3EV086OSB`: Completed.
- Live browser check: dialog opens on teacher page, URL unchanged, registration minimum 8, mobile width fits, no uncaught JavaScript errors. Mobile screenshot visually reviewed.
- Registration/verification/recovery browser test uses simulated Cognito responses. Real email delivery and existing-account sign-in remain manual acceptance checks; no real user account was created or password changed during testing.

Teacher entry: https://d14zq4wr2313jx.cloudfront.net/?role=teacher
