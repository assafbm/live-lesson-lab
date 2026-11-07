import { test, expect } from "@playwright/test";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";

// Adapter tests replace SDK transport only; they exercise the actual handler
// without AWS credentials, network calls, or changes to the deployed table.
const databaseSend = DynamoDBDocumentClient.prototype.send;
const managementSend = ApiGatewayManagementApiClient.prototype.send;
let rows: Record<string, any>;
let writes: any[];
let delivered: any[];
test.beforeEach(() => {
  process.env.ROOMS_TABLE = "test-rooms";
  process.env.LESSONS_TABLE = "test-lessons";
  rows = Object.fromEntries(["teacher", "student"].map((role) => [`AUTH#${role}`, {
    userId: role, email: `${role}@example.test`, expiresAt: Math.floor(Date.now() / 1000) + 3600
  }]));
  writes = [];
  delivered = [];
  DynamoDBDocumentClient.prototype.send = (async (command: any) => {
    if (command.constructor.name === "GetCommand") {
      expect(command.input.ConsistentRead).toBe(true);
      return { Item: rows[command.input.Key.pk] };
    }
    writes.push(command.input);
    if (command.input.ReturnValues === "ALL_NEW") {
      const row = rows[command.input.Key.pk];
      return { Attributes: { ...row, [command.input.ExpressionAttributeNames["#access"]]: command.input.ExpressionAttributeValues[":value"] } };
    }
    return {};
  }) as any;
  ApiGatewayManagementApiClient.prototype.send = (async (command: any) => {
    delivered.push(JSON.parse(Buffer.from(command.input.Data).toString()));
    return {};
  }) as any;
});
test.afterEach(() => {
  DynamoDBDocumentClient.prototype.send = databaseSend;
  ApiGatewayManagementApiClient.prototype.send = managementSend;
});
async function handle(message: object, connectionId = "student") {
  const { handler } = await import("../services/aws-signaling/src/handler");
  return handler({ requestContext: { routeKey: "$default", connectionId, domainName: "example.invalid", stage: "test" }, body: JSON.stringify(message) });
}
function seed(expiresAt = Math.floor(Date.now() / 1000) + 300) {
  rows["CONNECTION#student"] = { roomId: "room", userId: "student", role: "student", expiresAt };
  rows["ROOM#room"] = { roomId: "room", ownerUserId: "teacher", teacherConnectionId: "teacher", studentConnectionId: "student", teacherEntered: true, studentEntered: true, expiresAt };
}
test("AWS handler rejects expired memberships and cross-room traffic", async () => {
  seed(1);
  await handle({ type: "audio-state", roomId: "room", enabled: true });
  expect(delivered.at(-1).type).toBe("room-error");
  seed();
  await handle({ type: "audio-state", roomId: "someone-else", enabled: true });
  expect(delivered.at(-1).type).toBe("room-error");
  expect(writes).toHaveLength(0);
});
test("AWS heartbeat refresh is atomic and cannot revive expired room rows", async () => {
  seed();
  await handle({ type: "heartbeat" });
  const items = writes[0].TransactItems;
  expect(items).toHaveLength(2);
  for (const item of items) expect(item.Update.ConditionExpression).toContain("expiresAt > :now");
  expect(items[0].Update.ConditionExpression).toContain("#connection = :connection");
  expect(delivered.at(-1).type).toBe("server-ready");
});
test("AWS relay rejects stale slot ownership and student offers", async () => {
  seed();
  rows["ROOM#room"].studentConnectionId = "new-student";
  await handle({ type: "audio-state", roomId: "room", enabled: true });
  expect(delivered.at(-1).type).toBe("room-error");
  seed();
  await handle({ type: "offer", roomId: "room", sdp: "untrusted" });
  expect(delivered.at(-1).message).toContain("Only the teacher");
});

test("AWS admission rejects expired or locked invitations and enforces access atomically", async () => {
  rows["ROOM#room"] = { roomId: "room", teacherConnectionId: "teacher", teacherEntered: false,
    expiresAt: Math.floor(Date.now() / 1000) + 300, locked: false, joinExpiresAt: 1 };
  await handle({ type: "join-room", roomId: "room" });
  expect(delivered.at(-1).message).toContain("locked or expired");
  expect(writes).toHaveLength(0);
  rows["ROOM#room"].joinExpiresAt = Date.now() + 60000;
  rows["ROOM#room"].locked = true;
  await handle({ type: "join-room", roomId: "room" });
  expect(writes).toHaveLength(0);
  rows["ROOM#room"].locked = false;
  await handle({ type: "join-room", roomId: "room" });
  const update = writes[0].TransactItems[0].Update;
  expect(update.ConditionExpression).toContain("#locked = :unlocked");
  expect(update.ConditionExpression).toContain("joinExpiresAt > :nowMs");
  expect(update.ExpressionAttributeValues[":unlocked"]).toBe(false);
});

test("AWS students cannot renew invitations, lock joins, or end rooms", async () => {
  seed();
  for (const message of [{ type: "renew-invitation", roomId: "room" }, { type: "end-room", roomId: "room" }, { type: "set-room-locked", roomId: "room", locked: false }]) {
    await handle(message);
    expect(delivered.at(-1).message).toContain("Only the room's teacher");
  }
  expect(writes).toHaveLength(0);
});

test("AWS teacher access updates condition on ownership and expiry and return acknowledged state", async () => {
  seed();
  rows["CONNECTION#teacher"] = { ...rows["CONNECTION#student"], userId: "teacher", role: "teacher" };
  rows["ROOM#room"].locked = true;
  rows["ROOM#room"].joinExpiresAt = 1;
  await handle({ type: "renew-invitation", roomId: "room" }, "teacher");
  expect(writes[0].ConditionExpression).toContain("teacherConnectionId = :teacher");
  expect(writes[0].ConditionExpression).toContain("expiresAt > :now");
  expect(writes[0].ExpressionAttributeNames["#access"]).toBe("joinExpiresAt");
  expect(delivered.at(-1).locked).toBe(true);
  expect(delivered.at(-1).joinExpiresAt).toBeGreaterThan(Date.now());
  await handle({ type: "set-room-locked", roomId: "room", locked: false }, "teacher");
  expect(delivered.at(-1).locked).toBe(false);
  expect(delivered.at(-1).joinExpiresAt).toBe(1);
});

test("AWS room creation requires an unexpired authenticated identity", async () => {
  delete rows["AUTH#student"];
  await handle({ type: "create-room" });
  expect(delivered.at(-1).type).toBe("authentication-error");
  expect(writes).toHaveLength(0);
  rows["AUTH#student"] = { userId: "student", expiresAt: 1 };
  await handle({ type: "create-room" });
  expect(delivered.at(-1).type).toBe("authentication-error");
  expect(writes).toHaveLength(0);
});

test("AWS creation records the verified owner, ignoring browser-supplied email", async () => {
  await handle({ type: "create-room", email: "attacker@example.test", ownerUserId: "attacker" }, "teacher");
  const items = writes[0].TransactItems;
  expect(items).toHaveLength(4);
  expect(items[0].Put.Item.ownerUserId).toBe("teacher");
  expect(items[2].Put.TableName).toBe("test-lessons");
  expect(items[3].Put.Item.verifiedEmail).toBe("teacher@example.test");
  expect(items[3].Put.Item.userId).toBe("teacher");
});

test("AWS admission records the participant atomically and rejects the owner's student account", async () => {
  rows["ROOM#room"] = { roomId: "room", ownerUserId: "teacher", teacherConnectionId: "teacher",
    expiresAt: Date.now() / 1000 + 300, locked: false, joinExpiresAt: Date.now() + 60000 };
  await handle({ type: "join-room", roomId: "room" }, "teacher");
  expect(delivered.at(-1).message).toContain("different verified account");
  expect(writes).toHaveLength(0);
  await handle({ type: "join-room", roomId: "room" });
  expect(writes[0].TransactItems[2].Put).toMatchObject({ TableName: "test-lessons",
    Item: { userId: "student", role: "student", verifiedEmail: "student@example.test" } });
});

test("AWS teacher rights require account ownership as well as socket membership", async () => {
  seed();
  rows["CONNECTION#teacher"] = { ...rows["CONNECTION#student"], role: "teacher", userId: "teacher" };
  rows["AUTH#teacher"].userId = "different-account";
  await handle({ type: "end-room", roomId: "room" }, "teacher");
  expect(delivered.at(-1).type).toBe("room-error");
  expect(writes).toHaveLength(0);
});

test("AWS fails closed when identity service configuration is absent", async () => {
  await handle({ type: "authenticate", token: "not-a-token" });
  expect(delivered.at(-1).type).toBe("authentication-error");
  expect(writes).toHaveLength(0);
});

test("AWS invitation admits an unsigned student atomically without verified email or teacher rights", async () => {
  delete rows["AUTH#student"];
  rows["ROOM#room"] = { roomId: "room", ownerUserId: "teacher", teacherConnectionId: "teacher",
    expiresAt: Date.now() / 1000 + 300, locked: false, joinExpiresAt: Date.now() + 60000 };
  await handle({ type: "join-room", roomId: "room" });
  expect(delivered.at(-1).type).toBe("room-joined");
  const items = writes[0].TransactItems;
  expect(items).toHaveLength(4);
  expect(items[2].Put.Item.identityType).toBe("guest");
  expect(items[2].Put.Item.verifiedEmail).toBeUndefined();
  const guest = items[3].Put.Item;
  expect(guest.guest).toBe(true);
  rows["AUTH#student"] = guest;
  rows["CONNECTION#student"] = items[1].Put.Item;
  rows["ROOM#room"].studentConnectionId = "student";
  writes = [];
  await handle({ type: "create-room" });
  expect(delivered.at(-1).type).toBe("authentication-error");
  await handle({ type: "end-room", roomId: "room" });
  expect(delivered.at(-1).message).toContain("Only the room's teacher");
  await handle({ type: "audio-state", roomId: "other-room", enabled: true });
  expect(delivered.at(-1).type).toBe("room-error");
  expect(writes).toHaveLength(0);
});

test("AWS rejected guest invitations create neither identity nor attendance", async () => {
  delete rows["AUTH#student"];
  await handle({ type: "join-room", roomId: "missing" });
  expect(delivered.at(-1).type).toBe("room-error");
  for (const state of [{ locked: true }, { joinExpiresAt: 1 }, { studentConnectionId: "someone" }]) {
    rows["ROOM#room"] = { roomId: "room", ownerUserId: "teacher", teacherConnectionId: "teacher",
      expiresAt: Date.now() / 1000 + 300, locked: false, joinExpiresAt: Date.now() + 60000, ...state };
    await handle({ type: "join-room", roomId: "room" });
    expect(delivered.at(-1).type).toBe("room-error");
  }
  expect(writes).toHaveLength(0);
});
