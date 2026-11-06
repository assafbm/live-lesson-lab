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
  rows = {};
  writes = [];
  delivered = [];
  DynamoDBDocumentClient.prototype.send = (async (command: any) => {
    if (command.constructor.name === "GetCommand") {
      expect(command.input.ConsistentRead).toBe(true);
      return { Item: rows[command.input.Key.pk] };
    }
    writes.push(command.input);
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
async function handle(message: object) {
  const { handler } = await import("../services/aws-signaling/src/handler");
  return handler({ requestContext: { routeKey: "$default", connectionId: "student", domainName: "example.invalid", stage: "test" }, body: JSON.stringify(message) });
}
function seed(expiresAt = Math.floor(Date.now() / 1000) + 300) {
  rows["CONNECTION#student"] = { roomId: "room", role: "student", expiresAt };
  rows["ROOM#room"] = { roomId: "room", teacherConnectionId: "teacher", studentConnectionId: "student", teacherEntered: true, studentEntered: true, expiresAt };
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
