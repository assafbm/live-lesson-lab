# Decision 0005: Domain-free AWS pilot

## Status

Accepted as the current implementation direction. No AWS resources have been created.

## Context

The owner has an AWS Free account plan, does not own a domain, and created the `Fresh Deploy` project in `eu-north-1` using AWS's new account experience. The project identity has been checked against the signed-in AWS CLI account. The app should be reachable from separate teacher and student browsers without asking them to use `localhost`. The existing app uses a Node.js WebSocket signaling process with in-memory rooms. WebRTC carries lesson media directly between browsers when the network permits.

The previous EC2 proposal required a DNS name for automatic HTTPS. It also proposed Amazon Kinesis Video Streams for TURN, which AWS lists as outside the AWS Free Tier. That proposal is superseded and must not be deployed.

## Decisions

- Host the React/Vite build in a private S3 bucket behind CloudFront's AWS-managed HTTPS hostname. Host the signaling endpoint with API Gateway's generated secure WebSocket (`wss://`) hostname. This lets us start without buying a domain.
- Adapt the shared signaling protocol to API Gateway WebSocket routes and AWS Lambda handlers. The browser still exchanges offers, answers, ICE candidates, and room events; API Gateway holds the browser WebSocket connection while Lambda processes each message.
- Use DynamoDB only for temporary room membership and WebSocket connection IDs. Set a TTL so abandoned rooms and stale connections expire. This is operational state required by stateless Lambda invocations, not persistent lesson history.
- Keep audio and video on WebRTC peer connections. Do not store media in DynamoDB, S3, or the signaling service.
- Keep TURN unresolved for the initial remote test. STUN-only connectivity may fail on some networks. Do not enable Amazon Kinesis Video Streams under the Free plan without reviewing the plan's access and price; AWS states that Kinesis Video Streams is not part of AWS Free Tier.
- Do not invite unrelated teachers or use real student information until authentication, authorization, expiring/revocable student invitations, input validation, and rate limits are implemented.
- Make no AWS resource changes until the account region and Free plan/credit status are checked. Do not assume that a Free plan can create every AWS service or that credits cover every charge.

## Why DynamoDB is now in scope

The local Node.js process can keep room membership in memory because one long-running process handles each message. Lambda functions start and stop independently, so one invocation cannot rely on memory populated by an earlier invocation. A small DynamoDB table lets a message handler find the other browser's API Gateway connection ID and deliver the signaling message. TTL keeps this data temporary. Lesson schedules, user profiles, recordings, and history remain out of scope.

## Rollout

1. Confirm the AWS region, remaining credits, and which services the current Free account plan allows.
2. Build the API Gateway WebSocket adapter and DynamoDB TTL schema locally, with the local Node.js server retained for development.
3. Add infrastructure as code for the S3/CloudFront static host, WebSocket API, Lambda handler, table, and least-privilege IAM permissions.
4. Review the synthesized infrastructure and expected charges before deploying anything.
5. Deploy a private technical pilot and validate two-way signaling, role links, reconnects, and browser media permissions.
6. Add teacher identity and expiring student invitation controls before broader use.
7. Add TURN after measuring the network cases that fail and reviewing its cost and access requirements.

## Consequences

- Teacher and student links can use the same hosted frontend hostname with explicit role and room parameters; neither browser uses `localhost` outside local development.
- The architecture adds Lambda and DynamoDB concepts, but removes the need to keep one EC2 process alive just for signaling and avoids buying a domain at the start.
- WebSocket messages are routed through AWS, while WebRTC media remains peer-to-peer unless a future TURN relay is used.
- API Gateway, Lambda, DynamoDB, and static hosting have separate quotas and billing rules. Check the AWS console and current pricing before deployment; a Free account plan does not mean every service is available.
- The generated hostnames are suitable for a pilot but are less memorable and branded than a custom domain. A domain can be added later without changing room semantics.

## References

- [AWS Free Tier plans](https://docs.aws.amazon.com/us_en/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- [API Gateway WebSocket APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [API Gateway WebSocket chat with Lambda and DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/example_cross_ApiGatewayWebsocketChat_section.html)
- [Kinesis Video Streams FAQ](https://aws.amazon.com/kinesis/video-streams/faqs/)
