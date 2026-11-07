# Decision 0010: Guest students, names and lesson controls

- Status: Implemented; deployment pending AWS CLI reauthentication.
- Protocol: 8. Release the client and signaling service together.

## Invitation access

The owner explicitly requested that students can join without an account when
they have a lesson invitation. This supersedes decision 0009's requirement that
both participants verify email. Teachers still require verified email to create
a room. Signed-in students can use their account or select **Continue as guest**
in the lobby; visitors without an account go straight to the student lobby.

The link is a bearer capability: anyone holding it may attempt to join. Existing
server-side invitation expiry, lock, capacity and room isolation still apply.
The URL's role is never permission to create or administer a room.

AWS creates a guest identity and attendance row only in the successful admission
transaction, alongside the student slot and membership. The identity is scoped
to a connection, expires after eight hours, and has no verified email. It cannot
create rooms, end lessons or change admission controls. Refreshing creates a new
connection and requires admission again. Guests are explicitly marked in durable
records. They must not automatically receive future private recording access;
that requires a separate verified-email claim flow and consent design.

## Names

Names are entered in the lobby after registration or when joining as a guest,
and can be changed under Settings during the lesson. They are not Cognito signup
attributes in this increment. Account names persist in this browser per subject;
guest names persist for the browser tab. Cross-device account profile syncing is
not implemented. This avoids adding an account-profile API to a presentation change.

Bounded, validated name messages travel through the existing authorized room
relay. Each side announces its name when the media connection becomes connected
and whenever its own name changes. Changing a name never rebuilds the media
connection. React renders names as text. Display names are self-selected labels,
not proof of identity or eligibility for a recording.

## Controls and layout

- Shared content has no visible "Document" label.
- Face tiles show the participant's name instead of "You · Face" or "Student · Face".
- General Settings contains name, microphone, account, diagnostics and teacher room controls.
- Video settings contains camera selection, rotation, mirroring and local viewing controls.
- Screen sharing has a direct toolbar action and a stop-sharing state.
- Toolbar icons have accessible names plus hover and keyboard-focus tooltips.
  Secondary form actions remain text so they are easy to understand.
- Stable accessible region names identify the main content and camera roles for
  assistive technology and tests, even when display names change.

## Controlling a shared tab

The screen-capture stream is video, not a remote-control connection. Chrome's
Captured Surface Control API can provide permission-gated scrolling and zooming
for supported shared tabs. It does not grant arbitrary click/keyboard control
over another page or a PowerPoint window. No remote-control feature is implemented
in this increment; operate slides in the original tab/application while sharing.
An explicit presentation viewer or source integration would be a later feature.

Source: [Chrome's Captured Surface Control documentation](https://developer.chrome.com/docs/web-platform/captured-surface-control).

## Validation and release limits

Automated tests cover guest admission/rejection, lack of teacher privileges,
absence of verified email on guest records, validated names, live name updates,
separate panels, icon accessibility, production guest entry and blocked teacher
setup without identity configuration. Existing two-way media and sharing tests
remain in the suite. Screenshots are reviewed at desktop and phone widths.

AWS adapter tests mock transport; they do not establish live transaction behavior.
Synthetic audio tests do not resolve the reported mechanical voice quality.
The previous identity release was uploaded to AWS, but its cache invalidation
was interrupted by an approval-review usage limit. Current AWS CLI credentials
expired before that invalidation could be resumed. Do not claim this new UI or
guest flow is live until deployment and public checks complete.
