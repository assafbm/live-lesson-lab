# Decision 0001: Monorepo and lightweight signaling server

- Status: Accepted
- Date: 2026-11-02

## Context

The project has a web client, a WebSocket server, and a shared message contract. It is also a learning project, so it should be easy to run and understand.

## Decision

Use npm workspaces in one repository, separating code into `apps/web`, `services/signaling`, and `packages/shared`. A single `npm run dev` command will start the client and signaling server. The server relays connection and control messages only; WebRTC carries media between browsers.

Physical camera IDs remain local. Each captured source gets an application-level identity, and roles map to those sources. When two roles share one camera, capture and transmission happen once, and both roles can reference the same track.

## Rationale

- Changes to the shared protocol can be checked alongside both consumers.
- One development command reduces setup friction while learning.
- A database, separate services, and an SFU are unnecessary for the current scope.
- Mapping roles to logical sources avoids relying on track arrival order and prevents duplicate transmission of a shared camera.

## Consequences

- Rooms are temporary and held in server memory; they disappear when the server stops.
- One room with two participants fits the current product scope. Supporting multiple students will require revisiting P2P load and whether to use an SFU.
- Localhost checks do not replace testing on real networks with TURN.

## Alternatives considered

- A separate repository for each component: rejected because it adds versioning and coordination overhead to this learning project.
- A media-relay server: rejected because P2P WebRTC is sufficient to start, and the signaling server does not need to decode media.
- Sending the same source once per role: rejected to avoid uploading the same video twice.
