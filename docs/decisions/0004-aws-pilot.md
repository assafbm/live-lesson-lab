# Decision 0004: AWS pilot deployment

## Status

Superseded by [Decision 0005](0005-domain-free-aws-pilot.md). This EC2 design was not deployed. It assumed a custom DNS name and Kinesis Video Streams, so it does not match the current no-domain AWS Free plan constraints.

## Context

The project should become usable by a teacher and student outside localhost while remaining a learning project. The current signaling service keeps rooms in process memory, the web app and signaling protocol already share one origin, and WebRTC media is peer-to-peer. There is no TURN relay or teacher authentication yet.

## Decisions

- Use one EC2 host for the first pilot. It will run the existing Node.js process, which serves the built React app and the `/signal` WebSocket endpoint.
- Use Caddy in front of the app for automatic HTTPS and secure WebSockets. A DNS name pointing to a stable public address is required for a useful browser experience.
- Use Amazon Kinesis Video Streams for managed TURN credentials and relay. The Node.js server will call `GetIceServerConfig` with its EC2 instance role and return only temporary ICE credentials to admitted room participants.
- Keep the existing Node.js WebSocket service as the app's signaling service. Do not use Kinesis Video Streams for app signaling or media storage; WebRTC remains peer-to-peer when possible, and TURN relays only when direct connectivity fails.
- Keep one signaling process while rooms live in memory. Do not add multiple app instances until room state is moved to a shared store or managed session service.
- Use AWS CDK in TypeScript to describe repeatable cloud resources. Use Systems Manager for host administration instead of opening SSH to the internet. Grant the instance role only the Kinesis Video Streams actions needed to fetch TURN credentials, scoped to this pilot's signaling channel.
- Keep lesson rooms and live media temporary. Do not add a database until persistent schedules, profiles, or lesson history are in scope.
- Treat the first deployment as a closed pilot. Before inviting unrelated teachers, add teacher authentication, authorization for room creation, expiring or revocable student invitations, rate limits, and operational alerts.
- Keep the existing Render Blueprint only as historical/alternative configuration; AWS is the current target.

## Why start with one host

This is the smallest deployment that exercises DNS, HTTPS, Linux services, firewall rules, WebSockets, managed TURN, deployment automation, and cloud monitoring while preserving the current application shape. It is not highly available: an instance restart ends active lessons. TURN relay minutes and data transfer can incur AWS charges, so usage must be monitored. That is acceptable for a controlled pilot, not for a public service with an uptime promise.

## Rollout

1. Confirm the AWS account plan, remaining credits, and billing limits; select the region and a DNS name.
2. Prepare the CDK stack with a least-privilege instance role, Systems Manager access, a web-only security group, a Kinesis Video Streams signaling channel for TURN credentials, and a stable public address.
3. Prepare the deployable app and Caddy configuration. Provide temporary TURN credentials only after room admission.
4. Deploy only after reviewing the CloudFormation change set and the account's service eligibility and estimated charges.
5. Validate HTTPS, `/health`, WebSocket signaling, camera permission, audio/video in both directions, and TURN relay from separate networks.
6. Add authentication and invitation lifecycle controls before broadening access beyond the closed pilot.

## Consequences

- The app can use one origin for the page and signaling, so `VITE_SIGNALING_URL` can remain unset.
- Managed TURN improves reachability without maintaining a public coturn server, but relay minutes and outbound data transfer can cost money. Temporary credentials must be scoped to admitted participants and rate-limited.
- EC2 operations become part of the learning scope: patching, logs, restarts, monitoring, and deployment rollback must be documented.
- The AWS Free plan is time-limited. The deployment must be reviewed before its credits or plan duration end; do not assume the service will remain available indefinitely at no cost.
