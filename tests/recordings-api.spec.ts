import { test, expect } from "@playwright/test";
let createRecordingHandler: typeof import("../services/aws-signaling/src/recordings").createRecordingHandler;
test.beforeAll(async () => { ({ createRecordingHandler } = await import("../services/aws-signaling/src/recordings")); });

function fixture() {
  process.env.LESSONS_TABLE = "records"; process.env.ROOMS_TABLE = "rooms"; process.env.RECORDINGS_BUCKET = "private-recordings";
  const now = Date.now();
  const record = { pk: "RECORDING#record", sk: "METADATA", id: "record", roomId: "room", teacher: "teacher", student: "student", teacherSocket: "t", studentSocket: "s", state: "recording", teacherConsent: true, studentConsent: true, createdAt: now, heartbeatAt: now, expiresAt: now + 86400000, uploadId: "upload" };
  const rows: Record<string, any> = { "RECORDING#record": record, "ROOM#room": { teacherConnectionId: "t", studentConnectionId: "s", teacherEntered: true, studentEntered: true, expiresAt: now / 1000 + 1000, recordingId: "record" },
    "AUTH#t": { userId: "teacher", email: "teacher@example.test", expiresAt: now / 1000 + 1000 }, "AUTH#s": { userId: "student", email: "student@example.test", expiresAt: now / 1000 + 1000 } };
  const writes: any[] = []; const objects: any[] = []; const signs: any[] = [];
  const handler = createRecordingHandler({
    verify: async token => { if (token === "bad") throw Error("invalid"); return { userId: token, email: `${token}@example.test`, expiresAt: now / 1000 + 1000 }; },
    db: { send: async (command: any) => {
      const input = command.input;
      if (command.constructor.name === "GetCommand") return { Item: structuredClone(rows[input.Key.pk]) };
      if (command.constructor.name === "QueryCommand") return { Items: [{ recordingId: "record" }] };
      writes.push(input);
      if (command.constructor.name === "UpdateCommand") {
        const row = rows[input.Key.pk]; const values = input.ExpressionAttributeValues;
        if (input.UpdateExpression.includes("teacherConsent")) row.teacherConsent = true;
        if (input.UpdateExpression.includes("studentConsent")) row.studentConsent = true;
        if (values[":next"]) row.state = values[":next"];
      }
      return {};
    } } as any,
    s3: { send: async (command: any) => {
      objects.push({ command: command.constructor.name, input: command.input });
      if (command.constructor.name === "ListPartsCommand") return { Parts: [{ PartNumber: 1, ETag: "etag", Size: 1000 }] };
      if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "upload" };
      return {};
    } } as any,
    sign: (async (_client: any, command: any, options: any) => { signs.push({ input: command.input, options }); return "https://private.example.test/temporary"; }) as any
  });
  const call = async (body: object, user = "student") => {
    const response = await handler({ headers: user ? { authorization: `Bearer ${user}` } : {}, requestContext: { http: { method: "POST" } }, body: JSON.stringify(body) });
    return { status: response.statusCode, data: JSON.parse(response.body) };
  };
  return { call, record, rows, writes, objects, signs };
}

test("recording API requires verified identity and denies outsiders and teacher uploads", async () => {
  const f = fixture();
  expect((await f.call({ action: "list" }, "")).status).toBe(401);
  expect((await f.call({ action: "list" }, "bad")).status).toBe(401);
  expect((await f.call({ action: "download", id: "record" }, "stranger")).status).toBe(404);
  expect((await f.call({ action: "part", id: "record", part: 1, bytes: 100 }, "teacher")).status).toBe(403);
  expect(f.signs).toHaveLength(0);
});

test("recording requests reject guests and snapshot two current verified participants atomically", async () => {
  const f = fixture(); f.record.state = "ready";
  delete f.rows["AUTH#s"].email;
  expect((await f.call({ action: "request", roomId: "room" }, "teacher")).status).toBe(409);
  expect(f.writes).toHaveLength(0);
  f.rows["AUTH#s"].email = "student@example.test";
  expect((await f.call({ action: "request", roomId: "room" }, "teacher")).status).toBe(200);
  const transaction = f.writes[0].TransactItems;
  expect(transaction[0].Put.Item).toMatchObject({ teacher: "teacher", student: "student", state: "pending" });
  expect(transaction[1].Update.ConditionExpression).toContain("studentConnectionId = :student");
  expect(transaction[1].Update.ConditionExpression).toContain("recordingId = :old");
});

test("both consents and unchanged live participants are required before capture", async () => {
  const f = fixture(); Object.assign(f.record, { state: "pending", teacherConsent: false, studentConsent: false });
  expect((await f.call({ action: "start", id: "record" })).status).toBe(403);
  await f.call({ action: "consent", id: "record" }, "teacher");
  expect(f.record.state).toBe("pending");
  await f.call({ action: "consent", id: "record" });
  expect(f.record.state).toBe("approved");
  f.rows["ROOM#room"].studentConnectionId = "replacement";
  expect((await f.call({ action: "start", id: "record" })).status).toBe(409);
  expect(f.objects).toHaveLength(0);
});

test("part signing is bounded and downloads remain private until completion", async () => {
  const f = fixture();
  expect((await f.call({ action: "download", id: "record" })).status).toBe(409);
  for (const part of [0, 257, 1.5]) expect((await f.call({ action: "part", id: "record", part, bytes: 100 })).status).toBe(400);
  expect((await f.call({ action: "part", id: "record", part: 1, bytes: 9 * 1024 ** 2 })).status).toBe(400);
  expect((await f.call({ action: "part", id: "record", part: 1, bytes: 100 })).status).toBe(200);
  expect(f.signs[0].input).toMatchObject({ Bucket: "private-recordings", Key: "lessons/room/record.webm", UploadId: "upload", ContentLength: 100 });
  expect(f.signs[0].options.signableHeaders.has("content-length")).toBe(true);
  f.record.state = "ready";
  expect((await f.call({ action: "download", id: "record" }, "teacher")).status).toBe(200);
  expect(f.signs[1].options.expiresIn).toBe(300);
  f.record.expiresAt = 1;
  expect((await f.call({ action: "download", id: "record" })).status).toBe(410);
});

test("either participant stops capture; completed objects get only snapshot participant library entries", async () => {
  const f = fixture();
  expect((await f.call({ action: "stop", id: "record" }, "teacher")).status).toBe(200);
  expect(f.record.state).toBe("stopping");
  expect((await f.call({ action: "complete", id: "record" })).status).toBe(200);
  expect(f.objects.map(item => item.command)).toContain("CompleteMultipartUploadCommand");
  const tx = f.writes.at(-1).TransactItems;
  expect(tx.slice(1).map((item: any) => item.Put.Item.pk)).toEqual(["RECORDINGS_USER#teacher", "RECORDINGS_USER#student"]);
  expect(tx[0].Update.ConditionExpression).toContain(":stopping");
});

test("lost recorder heartbeat stops the indicator and library filters unauthorized records", async () => {
  const f = fixture(); f.record.heartbeatAt = Date.now() - 30000;
  expect((await f.call({ action: "status", id: "record" }, "teacher")).data.recording.state).toBe("stopping");
  f.record.state = "ready";
  expect((await f.call({ action: "list" }, "stranger")).data.recordings).toEqual([]);
  expect((await f.call({ action: "list" }, "student")).data.recordings).toHaveLength(1);
});
