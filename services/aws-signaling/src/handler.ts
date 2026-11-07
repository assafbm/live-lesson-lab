import { randomUUID } from "node:crypto";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { isInvitationOpen, INVITATION_LIFETIME_MS, PROTOCOL_VERSION, parseClientMessage } from "@live-lesson-lab/shared";
import type { ClientMessage, ParticipantRole, ServerMessage } from "@live-lesson-lab/shared";
import { createIdentityVerifier, type LessonIdentity } from "@live-lesson-lab/shared/identity";

type WebSocketEvent = {
  requestContext: {
    routeKey: string;
    connectionId: string;
    domainName: string;
    stage: string;
  };
  body?: string;
};

type Membership = {
  userId: string;
  pk: string;
  sk: "MEMBERSHIP";
  roomId: string;
  role: ParticipantRole;
  expiresAt: number;
};

type Room = {
  ownerUserId: string;
  locked: boolean;
  joinExpiresAt: number;
  pk: string;
  sk: "ROOM";
  roomId: string;
  teacherConnectionId: string;
  teacherEntered: boolean;
  studentConnectionId?: string;
  studentEntered: boolean;
  expiresAt: number;
};

const tableName = process.env.ROOMS_TABLE;
if (!tableName) throw new Error("ROOMS_TABLE must be configured for the AWS signaling handler.");
const lessonsTable = process.env.LESSONS_TABLE;
const verifyIdentity = process.env.AUTH_USER_POOL_ID && process.env.AUTH_CLIENT_ID
  ? createIdentityVerifier(process.env.AUTH_USER_POOL_ID, process.env.AUTH_CLIENT_ID) : null;

const identityKey = (connectionId: string) => ({ pk: `AUTH#${connectionId}`, sk: "IDENTITY" });
const lessonKey = (roomId: string) => ({ pk: `LESSON#${roomId}`, sk: "METADATA" });
function participantItem(roomId: string, identity: LessonIdentity, role: ParticipantRole) {
  return { pk: `LESSON#${roomId}`, sk: `PARTICIPANT#${identity.userId}`, userId: identity.userId,
    ...("email" in identity ? { verifiedEmail: identity.email, identityType: "verified" } : { identityType: "guest" }),
    role, admittedAt: new Date().toISOString() };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

// Lambda may reuse a warm execution environment. Reusing these clients avoids
// creating a new HTTP connection pool for every signaling message.
const managementClients = new Map<string, ApiGatewayManagementApiClient>();
const ROOM_TTL_SECONDS = 8 * 60 * 60;

function roomKey(roomId: string): Pick<Room, "pk" | "sk"> {
  return { pk: `ROOM#${roomId}`, sk: "ROOM" };
}

function membershipKey(connectionId: string): Pick<Membership, "pk" | "sk"> {
  return { pk: `CONNECTION#${connectionId}`, sk: "MEMBERSHIP" };
}

function expiresAt() {
  return Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;
}

function apiClient(event: WebSocketEvent) {
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  let client = managementClients.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApiClient({ endpoint });
    managementClients.set(endpoint, client);
  }
  return client;
}

async function sendTo(event: WebSocketEvent, connectionId: string, message: ServerMessage) {
  try {
    await apiClient(event).send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message))
    }));
    return true;
  } catch (error) {
    // API Gateway reports a 410 Gone when the browser has already disconnected.
    // Stale room cleanup is handled by the connection's disconnect event and TTL.
    if (error instanceof Error && error.name === "GoneException") return false;
    throw error;
  }
}

function sendError(event: WebSocketEvent, message: string) {
  return sendTo(event, event.requestContext.connectionId, { type: "room-error", message });
}

async function getMembership(connectionId: string) {
  const result = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: membershipKey(connectionId),
    ConsistentRead: true
  }));
  const membership = result.Item as Membership | undefined;
  return membership && membership.expiresAt > Math.floor(Date.now() / 1000) ? membership : undefined;
}

async function getRoom(roomId: string) {
  const result = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: roomKey(roomId),
    ConsistentRead: true
  }));
  const room = result.Item as Room | undefined;
  // DynamoDB TTL removal is asynchronous, so enforce expiry in application code too.
  return room && room.expiresAt > Math.floor(Date.now() / 1000) ? room : undefined;
}

async function refreshSession(connectionId: string, membership: Membership) {
  const expiry = expiresAt();
  const now = Math.floor(Date.now() / 1000);
  // TTL deletion is delayed. A heartbeat must never revive an expired room,
  // extend someone else's slot, or update just one half of the membership.
  await documentClient.send(new TransactWriteCommand({ TransactItems: [
    { Update: {
      TableName: tableName, Key: roomKey(membership.roomId),
      UpdateExpression: "SET expiresAt = :expiry",
      ConditionExpression: "#connection = :connection AND expiresAt > :now",
      ExpressionAttributeNames: { "#connection": membership.role === "teacher" ? "teacherConnectionId" : "studentConnectionId" },
      ExpressionAttributeValues: { ":connection": connectionId, ":expiry": expiry, ":now": now }
    } },
    { Update: {
      TableName: tableName, Key: membershipKey(connectionId),
      UpdateExpression: "SET expiresAt = :expiry",
      ConditionExpression: "roomId = :room AND expiresAt > :now",
      ExpressionAttributeValues: { ":room": membership.roomId, ":expiry": expiry, ":now": now }
    } }
  ] }));
}

async function createRoom(event: WebSocketEvent, identity: LessonIdentity) {
  if ("guest" in identity) {
    await sendTo(event, event.requestContext.connectionId, { type: "authentication-error", message: "Teachers must sign in with a verified email." });
    return;
  }
  if (!lessonsTable) throw new Error("Lesson storage is not configured");
  const connectionId = event.requestContext.connectionId;
  if (await getMembership(connectionId)) {
    await sendError(event, "Leave the current room before creating another one.");
    return;
  }

  const roomId = randomUUID();
  const expiry = expiresAt();
  const room: Room = {
    ownerUserId: identity.userId,
    ...roomKey(roomId),
    roomId,
    teacherConnectionId: connectionId,
    teacherEntered: false,
    studentEntered: false,
    locked: false,
    joinExpiresAt: Date.now() + INVITATION_LIFETIME_MS,
    expiresAt: expiry
  };
  const membership: Membership = {
    userId: identity.userId,
    ...membershipKey(connectionId),
    roomId,
    role: "teacher",
    expiresAt: expiry
  };

  await documentClient.send(new TransactWriteCommand({
    TransactItems: [
      { Put: { TableName: tableName, Item: room, ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: tableName, Item: membership, ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: lessonsTable, Item: { ...lessonKey(roomId), ownerUserId: identity.userId,
        createdAt: new Date().toISOString(), status: "open" }, ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: lessonsTable, Item: participantItem(roomId, identity, "teacher"), ConditionExpression: "attribute_not_exists(pk)" } }
    ]
  }));
  await sendTo(event, connectionId, { type: "room-created", roomId });
  await sendTo(event, connectionId, { type: "room-access", roomId, locked: room.locked, joinExpiresAt: room.joinExpiresAt });
}

async function joinRoom(event: WebSocketEvent, roomId: string, identity: LessonIdentity, newGuest = false) {
  if (!lessonsTable) throw new Error("Lesson storage is not configured");
  const connectionId = event.requestContext.connectionId;
  if (await getMembership(connectionId)) {
    await sendError(event, "Leave the current room before joining another one.");
    return;
  }

  const room = await getRoom(roomId);
  if (!room) {
    await sendError(event, "This lesson link is invalid or the room has ended.");
    return;
  }
  if (room.ownerUserId === identity.userId) {
    await sendError(event, "Use a different verified account for the student role.");
    return;
  }
  if (room.studentConnectionId) {
    await sendError(event, "This lesson already has a student connected.");
    return;
  }
  // Legacy rows without access fields fail closed. Invitation expiry is fixed
  // and separate from sliding routing TTL; heartbeats never extend invitations.
  if (!isInvitationOpen(room)) {
    await sendError(event, "This invitation is locked or expired. Ask the teacher to reopen access.");
    return;
  }

  const expiry = expiresAt();
  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: roomKey(roomId),
            UpdateExpression: "SET studentConnectionId = :connectionId, studentEntered = :entered, expiresAt = :expiresAt",
            ConditionExpression: "attribute_not_exists(studentConnectionId) AND expiresAt > :now AND #locked = :unlocked AND joinExpiresAt > :nowMs",
            ExpressionAttributeNames: { "#locked": "locked" },
            ExpressionAttributeValues: {
              ":connectionId": connectionId,
              ":entered": true,
              ":expiresAt": expiry,
              ":now": Math.floor(Date.now() / 1000),
              ":nowMs": Date.now(),
              ":unlocked": false
            }
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: { ...membershipKey(connectionId), userId: identity.userId, roomId, role: "student", expiresAt: expiry } satisfies Membership,
            ConditionExpression: "attribute_not_exists(pk)"
          }
        },
        { Put: { TableName: lessonsTable, Item: participantItem(roomId, identity, "student") } },
        // A guest gets credentials only when admission succeeds. An invalid,
        // expired, locked or occupied link cannot manufacture a guest session.
        ...(newGuest ? [{ Put: { TableName: tableName, Item: { ...identityKey(connectionId), ...identity },
          ConditionExpression: "attribute_not_exists(pk) OR expiresAt <= :now",
          ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) } } }] : [])
      ]
    }));
  } catch {
    await sendError(event, "This lesson already has a student connected or the room has ended.");
    return;
  }

  await sendTo(event, connectionId, { type: "room-joined", roomId });
  const joinedRoom = await getRoom(roomId);
  if (joinedRoom?.teacherEntered) {
    await sendTo(event, joinedRoom.teacherConnectionId, { type: "peer-joined", roomId });
  }
}

async function setMeetingPresence(event: WebSocketEvent, membership: Membership, room: Room, entering: boolean) {
  const isTeacher = membership.role === "teacher";
  const connectionAttribute = isTeacher ? "teacherConnectionId" : "studentConnectionId";
  const enteredAttribute = isTeacher ? "teacherEntered" : "studentEntered";
  const connectionId = event.requestContext.connectionId;

  try {
    await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: roomKey(room.roomId),
      UpdateExpression: "SET #entered = :entered, expiresAt = :expiresAt",
      ConditionExpression: "#connection = :connectionId AND expiresAt > :now",
      ExpressionAttributeNames: { "#entered": enteredAttribute, "#connection": connectionAttribute },
      ExpressionAttributeValues: {
        ":entered": entering,
        ":connectionId": connectionId,
        ":expiresAt": expiresAt(),
        ":now": Math.floor(Date.now() / 1000)
      }
    }));
  } catch {
    await sendError(event, "This lesson has ended.");
    return;
  }

  await sendTo(event, connectionId, {
    type: entering ? "room-entered" : "room-exited",
    roomId: room.roomId
  });

  // Re-read after the write: both participants may enter concurrently.
  const latestRoom = await getRoom(room.roomId);
  if (!latestRoom) return;
  const peerConnectionId = isTeacher ? latestRoom.studentConnectionId : latestRoom.teacherConnectionId;
  const peerEntered = isTeacher ? latestRoom.studentEntered : latestRoom.teacherEntered;
  if (!peerConnectionId || !peerEntered) return;

  if (entering) {
    // The teacher is the WebRTC offerer, so only the teacher needs this signal.
    await sendTo(event, room.teacherConnectionId, { type: "peer-joined", roomId: room.roomId });
  } else {
    await sendTo(event, peerConnectionId, { type: "peer-left", roomId: room.roomId });
  }
}

async function leaveRoom(event: WebSocketEvent, connectionId: string, reason = "The teacher connection closed. Ask for a new lesson link.") {
  const membership = await getMembership(connectionId);
  if (!membership) return;

  const room = await getRoom(membership.roomId);
  if (membership.role === "teacher") {
    const deletes = [
      { Delete: { TableName: tableName, Key: roomKey(membership.roomId) } },
      { Delete: { TableName: tableName, Key: membershipKey(connectionId) } }
    ];
    if (room?.studentConnectionId) {
      deletes.push({ Delete: { TableName: tableName, Key: membershipKey(room.studentConnectionId) } });
    }
    // Close durable metadata in the same transaction as the routing deletion.
    const closeRecord = lessonsTable ? [{ Update: { TableName: lessonsTable, Key: lessonKey(membership.roomId),
        UpdateExpression: "SET #status = :closed, endedAt = :ended", ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":closed": "closed", ":ended": new Date().toISOString() } } }] : [];
    await documentClient.send(new TransactWriteCommand({ TransactItems: [...deletes, ...closeRecord] }));
    if (room?.studentConnectionId && room.studentConnectionId !== connectionId) {
      await sendTo(event, room.studentConnectionId, { type: "room-closed", roomId: membership.roomId, reason });
    }
    return;
  }

  if (!room) {
    await documentClient.send(new DeleteCommand({ TableName: tableName, Key: membershipKey(connectionId) }));
    return;
  }

  await documentClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: roomKey(membership.roomId),
          UpdateExpression: "REMOVE studentConnectionId, studentEntered",
          ConditionExpression: "studentConnectionId = :connectionId",
          ExpressionAttributeValues: { ":connectionId": connectionId }
        }
      },
      { Delete: { TableName: tableName, Key: membershipKey(connectionId) } }
    ]
  }));
  if (room.teacherEntered) {
    await sendTo(event, room.teacherConnectionId, { type: "peer-left", roomId: membership.roomId });
  }
}

async function relay(event: WebSocketEvent, membership: Membership, room: Room, message: ClientMessage) {
  if (!room.teacherEntered || !room.studentEntered) return;
  const isTeacher = membership.role === "teacher";
  const peerConnectionId = isTeacher ? room.studentConnectionId : room.teacherConnectionId;
  if (!peerConnectionId) {
    await sendError(event, "The other participant is not connected yet.");
    return;
  }

  if (message.type === "video-role-state" && !isTeacher) {
    await sendError(event, "Only the teacher can update video role mapping.");
    return;
  }
  if (message.type === "offer" && !isTeacher) {
    await sendError(event, "Only the teacher can initiate the WebRTC offer.");
    return;
  }
  if (message.type === "answer" && isTeacher) {
    await sendError(event, "Only the student can answer the WebRTC offer.");
    return;
  }

  if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate"
    || message.type === "audio-state" || message.type === "video-role-state" || message.type === "participant-name") {
    await sendTo(event, peerConnectionId, message);
  }
}

async function handleMessage(event: WebSocketEvent, message: ClientMessage, identity: LessonIdentity) {
  const connectionId = event.requestContext.connectionId;
  const membership = await getMembership(connectionId);
  if (membership && membership.userId !== identity.userId) {
    await sendError(event, "This connection belongs to a different account. Sign in again.");
    return;
  }
  if (message.type === "heartbeat") {
    if (membership) await refreshSession(connectionId, membership);
    await sendTo(event, connectionId, { type: "server-ready", protocolVersion: PROTOCOL_VERSION, authenticationRequired: true });
    return;
  }
  if (message.type === "create-room") return createRoom(event, identity);
  if (message.type === "join-room") return joinRoom(event, message.roomId, identity);
  if (message.type === "authenticate") return;
  if (message.type === "leave-room") return leaveRoom(event, connectionId);

  if (!membership || message.roomId !== membership.roomId) {
    await sendError(event, "Join a lesson before sending WebRTC messages.");
    return;
  }

  const room = await getRoom(membership.roomId);
  if (!room || (membership.role === "teacher" ? room.teacherConnectionId : room.studentConnectionId) !== connectionId
    || (membership.role === "teacher" && room.ownerUserId !== identity.userId)) {
    await sendError(event, "This lesson has ended.");
    return;
  }

  if (message.type === "enter-room" || message.type === "exit-room") {
    await setMeetingPresence(event, membership, room, message.type === "enter-room");
    return;
  }

  if (message.type === "set-room-locked" || message.type === "renew-invitation" || message.type === "end-room") {
    if (membership.role !== "teacher") {
      await sendError(event, "Only the room's teacher can change access or end the lesson.");
      return;
    }
    if (message.type === "end-room") {
      const reason = "The teacher ended this lesson.";
      await leaveRoom(event, connectionId, reason);
      await sendTo(event, connectionId, { type: "room-closed", roomId: room.roomId, reason });
      return;
    }
    const attribute = message.type === "set-room-locked" ? "locked" : "joinExpiresAt";
    const value = message.type === "set-room-locked" ? message.locked : Date.now() + INVITATION_LIFETIME_MS;
    const result = await documentClient.send(new UpdateCommand({
      TableName: tableName, Key: roomKey(room.roomId),
      UpdateExpression: "SET #access = :value",
      ConditionExpression: "teacherConnectionId = :teacher AND expiresAt > :now",
      ExpressionAttributeNames: { "#access": attribute },
      ExpressionAttributeValues: { ":value": value, ":teacher": connectionId, ":now": Math.floor(Date.now() / 1000) },
      ReturnValues: "ALL_NEW"
    }));
    const updated = result.Attributes as Room;
    await sendTo(event, connectionId, { type: "room-access", roomId: room.roomId, locked: updated.locked, joinExpiresAt: updated.joinExpiresAt });
    return;
  }

  await relay(event, membership, room, message);
}

export async function handler(event: WebSocketEvent) {
  const { routeKey, connectionId } = event.requestContext;
  try {
    if (routeKey === "$connect") return { statusCode: 200, body: "Connected" };
    if (routeKey === "$disconnect") {
      await leaveRoom(event, connectionId);
      await documentClient.send(new DeleteCommand({ TableName: tableName, Key: identityKey(connectionId) }));
      return { statusCode: 200, body: "Disconnected" };
    }

    const message = parseClientMessage(event.body ?? "");
    if (!message) {
      await sendError(event, "The signaling message is invalid or unsupported.");
      return { statusCode: 200, body: "Ignored invalid message" };
    }

    if (message.type === "authenticate") {
      try {
        if (!verifyIdentity) throw new Error("Identity service unavailable");
        const identity = await verifyIdentity(message.token);
        const membership = await getMembership(connectionId);
        if (membership && membership.userId !== identity.userId) throw new Error("Account cannot change during a lesson");
        // Reauthentication may refresh expiry but may not change the account
        // behind an existing socket. Tokens are never stored or logged.
        await documentClient.send(new PutCommand({ TableName: tableName,
          Item: { ...identityKey(connectionId), ...identity },
          ConditionExpression: "attribute_not_exists(pk) OR userId = :user",
          ExpressionAttributeValues: { ":user": identity.userId } }));
        await sendTo(event, connectionId, { type: "authenticated" });
      } catch {
        await sendTo(event, connectionId, { type: "authentication-error", message: "Sign in with a verified email to continue." });
      }
      return { statusCode: 200, body: "Authentication processed" };
    }
    const identityResult = await documentClient.send(new GetCommand({ TableName: tableName, Key: identityKey(connectionId), ConsistentRead: true }));
    const identity = identityResult.Item as LessonIdentity | undefined;
    if (!identity || identity.expiresAt <= Math.floor(Date.now() / 1000)) {
      if (message.type === "join-room") {
        await joinRoom(event, message.roomId, { userId: `guest-${connectionId}`, guest: true, expiresAt: expiresAt() }, true);
        return { statusCode: 200, body: "Guest admission processed" };
      }
      await sendTo(event, connectionId, message.type === "heartbeat"
        ? { type: "server-ready", protocolVersion: PROTOCOL_VERSION, authenticationRequired: true }
        : { type: "authentication-error", message: "Sign in with a verified email to continue." });
      return { statusCode: 200, body: "Authentication required" };
    }
    await handleMessage(event, message, identity);
    return { statusCode: 200, body: "Message handled" };
  } catch (error) {
    // Never log SDP or ICE payloads; log only a safe error name for diagnosis.
    console.error("Signaling request failed", error instanceof Error ? error.name : "UnknownError");
    await sendError(event, "The lesson service could not process that message.");
    return { statusCode: 200, body: "Message failed safely" };
  }
}
