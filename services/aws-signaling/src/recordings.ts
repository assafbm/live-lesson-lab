import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createIdentityVerifier, type VerifiedIdentity } from "@live-lesson-lab/shared/identity";

type Event = { headers: Record<string, string | undefined>; body?: string; isBase64Encoded?: boolean; requestContext: { http: { method: string } } };
type Recording = { pk: string; sk: string; id: string; roomId: string; teacher: string; student: string; teacherSocket: string; studentSocket: string;
  state: string; teacherConsent?: boolean; studentConsent?: boolean; createdAt: number; expiresAt: number; uploadId?: string; bytes?: number; heartbeatAt?: number };
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const verifier = process.env.AUTH_USER_POOL_ID && process.env.AUTH_CLIENT_ID ? createIdentityVerifier(process.env.AUTH_USER_POOL_ID, process.env.AUTH_CLIENT_ID) : null;
const key = (id: string) => ({ pk: `RECORDING#${id}`, sk: "METADATA" });
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const requireThat = (condition: unknown, status: number, message: string) => { if (!condition) throw new ApiError(status, message); };

/** Dependency injection keeps authorization tests off the real AWS account. */
export function createRecordingHandler(deps: { db: typeof db; s3: typeof s3; verify: typeof verifier; sign: typeof getSignedUrl }) {
  return async (event: Event) => {
    const table = process.env.LESSONS_TABLE!;
    const rooms = process.env.ROOMS_TABLE!;
    const bucket = process.env.RECORDINGS_BUCKET!;
    const reply = (statusCode: number, value: unknown) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(value) });
    const get = async (TableName: string, Key: object) => (await deps.db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
    const read = async (id: string) => await get(table, key(id)) as Recording | undefined;
    const publicRecord = (record: Recording) => ({ id: record.id, roomId: record.roomId, state: record.state, createdAt: record.createdAt,
      expiresAt: record.expiresAt, teacherConsent: !!record.teacherConsent, studentConsent: !!record.studentConsent, bytes: record.bytes });
    const objectKey = (record: Recording) => `lessons/${record.roomId}/${record.id}.webm`;
    async function update(record: Recording, expression: string, values: Record<string, unknown>, condition = "#state = :previous") {
      await deps.db.send(new UpdateCommand({ TableName: table, Key: key(record.id), UpdateExpression: expression,
        ConditionExpression: condition, ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":previous": record.state, ...values } }));
    }
    async function present(record: Recording) {
      const room = await get(rooms, { pk: `ROOM#${record.roomId}`, sk: "ROOM" });
      return room && room.expiresAt > Date.now() / 1000 && room.teacherEntered && room.studentEntered
        && room.teacherConnectionId === record.teacherSocket && room.studentConnectionId === record.studentSocket;
    }
    try {
      requireThat(event.requestContext.http.method === "POST", 405, "Use POST.");
      requireThat(table && rooms && bucket && deps.verify, 503, "Recording service is not configured.");
      requireThat(!event.isBase64Encoded && (event.body?.length ?? 0) <= 4096, 400, "Invalid request.");
      const token = event.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      requireThat(token, 401, "Sign in with a verified email to use recordings.");
      let identity: VerifiedIdentity;
      try { identity = await deps.verify!(token!); } catch { throw new ApiError(401, "Please sign in again."); }
      let input: Record<string, unknown>;
      try { input = JSON.parse(event.body ?? "{}"); } catch { throw new ApiError(400, "Invalid JSON."); }
      requireThat(input && typeof input === "object" && !Array.isArray(input), 400, "Invalid request.");
      const action = input.action;
      if (action === "list") {
        const result = await deps.db.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": `RECORDINGS_USER#${identity.userId}` }, Limit: 100, ScanIndexForward: false, ConsistentRead: true }));
        const records = await Promise.all((result.Items ?? []).map(item => read(item.recordingId)));
        return reply(200, { recordings: records.filter((r): r is Recording => !!r && r.state === "ready" && r.expiresAt > Date.now() && [r.teacher, r.student].includes(identity.userId)).map(r => ({ ...publicRecord(r), canDelete: r.teacher === identity.userId })) });
      }
      if (action === "request" || action === "room") {
        requireThat(validId(input.roomId), 400, "Invalid room.");
        const room = await get(rooms, { pk: `ROOM#${input.roomId}`, sk: "ROOM" });
        requireThat(room && room.expiresAt > Date.now() / 1000, 404, "The lesson has ended.");
        const [teacher, student] = await Promise.all([get(rooms, { pk: `AUTH#${room!.teacherConnectionId}`, sk: "IDENTITY" }), get(rooms, { pk: `AUTH#${room!.studentConnectionId}`, sk: "IDENTITY" })]);
        requireThat([teacher?.userId, student?.userId].includes(identity.userId), 403, "You are not a current participant.");
        const current = room!.recordingId ? await read(room!.recordingId) : undefined;
        if (action === "room") return reply(200, { recording: current && [current.teacher, current.student].includes(identity.userId) ? publicRecord(current) : null });
        requireThat(room!.teacherEntered && room!.studentEntered && teacher?.email && student?.email && teacher.userId !== student.userId
          && teacher.expiresAt > Date.now() / 1000 && student.expiresAt > Date.now() / 1000, 409, "Both participants must join with verified accounts before recording.");
        requireThat(!current || ["ready", "failed", "cancelled", "deleted"].includes(current.state), 409, "A recording request already exists for this lesson.");
        const id = randomUUID(); const now = Date.now();
        const record: Recording = { ...key(id), id, roomId: String(input.roomId), teacher: teacher!.userId, student: student!.userId,
          teacherSocket: room!.teacherConnectionId, studentSocket: room!.studentConnectionId, state: "pending", createdAt: now, expiresAt: now + 30 * 86400000 };
        // Snapshot exactly these two identities. A later guest or replacement
        // participant cannot inherit their consent or download authorization.
        await deps.db.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: table, Item: record, ConditionExpression: "attribute_not_exists(pk)" } },
          { Update: { TableName: rooms, Key: { pk: `ROOM#${input.roomId}`, sk: "ROOM" }, UpdateExpression: "SET recordingId = :id",
            ConditionExpression: `teacherConnectionId = :teacher AND studentConnectionId = :student AND teacherEntered = :yes AND studentEntered = :yes AND expiresAt > :now AND ${room!.recordingId ? "recordingId = :old" : "attribute_not_exists(recordingId)"}`,
            ExpressionAttributeValues: { ":id": id, ":teacher": record.teacherSocket, ":student": record.studentSocket, ":yes": true, ":now": now / 1000, ...(room!.recordingId ? { ":old": room!.recordingId } : {}) } } }
        ] }));
        return reply(200, { recording: publicRecord(record) });
      }
      requireThat(validId(input.id), 400, "Invalid recording.");
      const record = await read(String(input.id));
      requireThat(record && [record.teacher, record.student].includes(identity.userId), 404, "Recording not found.");
      const r = record!; const student = identity.userId === r.student;
      requireThat(r.expiresAt > Date.now(), 410, "This recording has expired.");
      if (action === "status") {
        if (["pending", "approved", "initializing"].includes(r.state) && Date.now() - r.createdAt > 5 * 60000) {
          await update(r, "SET #state = :next", { ":next": "cancelled" }); r.state = "cancelled";
        }
        if (r.state === "stopping" && Date.now() - (r.heartbeatAt ?? r.createdAt) > 120000) {
          if (r.uploadId) await deps.s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: objectKey(r), UploadId: r.uploadId })).catch(() => undefined);
          await update(r, "SET #state = :next", { ":next": "failed" }); r.state = "failed";
        }
        // No heartbeat from the recorder means no reliable recording. Stop the
        // indicator rather than imply that a closed/background tab is recording.
        if (["pending", "approved", "initializing", "recording"].includes(r.state) && (!(await present(r)) || (r.state === "recording" && Date.now() - (r.heartbeatAt ?? r.createdAt) > 20000))) {
          await update(r, "SET #state = :next", { ":next": r.state === "recording" ? "stopping" : "cancelled" });
          r.state = r.state === "recording" ? "stopping" : "cancelled";
        }
        return reply(200, { recording: publicRecord(r) });
      }
      if (action === "consent") {
        requireThat(r.state === "pending" && await present(r), 409, "This request is no longer active.");
        const field = student ? "studentConsent" : "teacherConsent";
        await update(r, `SET ${field} = :yes`, { ":yes": true });
        const latest = (await read(r.id))!;
        if (latest.teacherConsent && latest.studentConsent && latest.state === "pending") {
          try { await update(latest, "SET #state = :next", { ":next": "approved" }); } catch (error) { if ((error as Error).name !== "ConditionalCheckFailedException") throw error; }
        }
        return reply(200, { recording: publicRecord((await read(r.id))!) });
      }
      if (action === "stop") {
        if (["pending", "approved", "initializing", "recording"].includes(r.state)) await update(r, "SET #state = :next", { ":next": r.state === "recording" ? "stopping" : "cancelled" });
        return reply(200, { ok: true });
      }
      if (action === "download") {
        requireThat(r.state === "ready" && r.teacherConsent && r.studentConsent, 409, "Recording is not available.");
        return reply(200, { url: await deps.sign(deps.s3, new GetObjectCommand({ Bucket: bucket, Key: objectKey(r), ResponseContentDisposition: `attachment; filename="lesson-${r.id}.webm"` }), { expiresIn: 300 }) });
      }
      if (action === "delete") {
        requireThat(identity.userId === r.teacher && ["ready", "failed"].includes(r.state), 403, "Only the lesson owner can delete a finished recording.");
        await update(r, "SET #state = :next", { ":next": "deleted" });
        await deps.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(r) }));
        return reply(200, { ok: true });
      }
      if (action === "complete" && student && r.state === "ready") return reply(200, { ok: true });
      requireThat(student, 403, "Only the consenting student browser can upload this recording.");
      requireThat(r.teacherConsent && r.studentConsent, 403, "Both participants must consent.");
      requireThat(Date.now() - r.createdAt < 4 * 3600000, 410, "The upload window has expired.");
      if (action === "start") {
        requireThat(r.state === "approved" && await present(r), 409, "Recording is not approved or participants changed.");
        await update(r, "SET #state = :next", { ":next": "initializing" });
        let upload;
        try { upload = await deps.s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: objectKey(r), ContentType: "video/webm", ServerSideEncryption: "AES256" })); }
        catch (error) { await update({ ...r, state: "initializing" }, "SET #state = :next", { ":next": "failed" }); throw error; }
        try { await update({ ...r, state: "initializing" }, "SET #state = :next, uploadId = :upload, heartbeatAt = :now", { ":next": "recording", ":upload": upload.UploadId!, ":now": Date.now() }); }
        catch (error) { await deps.s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: objectKey(r), UploadId: upload.UploadId })); throw error; }
        return reply(200, { ok: true });
      }
      if (action === "pulse") {
        requireThat(r.state === "recording" && await present(r), 409, "Recording must stop.");
        await update(r, "SET heartbeatAt = :now", { ":now": Date.now() }); return reply(200, { ok: true });
      }
      if (action === "abort") {
        requireThat(["initializing", "recording", "stopping", "failed"].includes(r.state), 409, "Recording is already finalized.");
        if (r.uploadId) await deps.s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: objectKey(r), UploadId: r.uploadId }));
        await update(r, "SET #state = :next", { ":next": "failed" }); return reply(200, { ok: true });
      }
      requireThat(["recording", "stopping"].includes(r.state) && r.uploadId, 409, "There is no active upload.");
      if (action === "part") {
        requireThat(Number.isInteger(input.part) && Number(input.part) >= 1 && Number(input.part) <= 256
          && Number.isInteger(input.bytes) && Number(input.bytes) >= 1 && Number(input.bytes) <= 8 * 1024 * 1024, 400, "Invalid upload part.");
        return reply(200, { url: await deps.sign(deps.s3, new UploadPartCommand({ Bucket: bucket, Key: objectKey(r), UploadId: r.uploadId,
          PartNumber: Number(input.part), ContentLength: Number(input.bytes) }), { expiresIn: 300, signableHeaders: new Set(["content-length"]) }) });
      }
      if (action === "complete") {
        // If S3 completion succeeded but its response or the database write was
        // lost, a retry finds the immutable object and finishes the metadata.
        let bytes = 0;
        try {
          const head = await deps.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(r) }));
          bytes = head.ContentLength ?? 0;
        } catch (error) {
          if (!["NotFound", "NoSuchKey"].includes((error as Error).name)) throw error;
        }
        if (!bytes) {
          const parts = await deps.s3.send(new ListPartsCommand({ Bucket: bucket, Key: objectKey(r), UploadId: r.uploadId, MaxParts: 1000 }));
          const list = parts.Parts ?? []; bytes = list.reduce((sum, part) => sum + (part.Size ?? 0), 0);
          requireThat(!parts.IsTruncated && list.length > 0 && list.length <= 256 && bytes > 0 && bytes <= 2 * 1024 ** 3
            && list.every((part, index) => part.PartNumber === index + 1 && (part.Size ?? 0) <= 8 * 1024 * 1024), 400, "Invalid or oversized upload.");
          await deps.s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: objectKey(r), UploadId: r.uploadId,
            MultipartUpload: { Parts: list.map(part => ({ ETag: part.ETag, PartNumber: part.PartNumber })) } }));
        }
        requireThat(bytes > 0 && bytes <= 2 * 1024 ** 3, 400, "Invalid recording size.");
        await deps.db.send(new TransactWriteCommand({ TransactItems: [
          { Update: { TableName: table, Key: key(r.id), UpdateExpression: "SET #state = :ready, bytes = :bytes", ConditionExpression: "#state IN (:recording, :stopping)", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":ready": "ready", ":bytes": bytes, ":recording": "recording", ":stopping": "stopping" } } },
          ...[r.teacher, r.student].map(userId => ({ Put: { TableName: table, Item: { pk: `RECORDINGS_USER#${userId}`, sk: `${r.createdAt}#${r.id}`, recordingId: r.id } } }))
        ] }));
        return reply(200, { ok: true });
      }
      throw new ApiError(400, "Unknown recording action.");
    } catch (error) {
      if (error instanceof ApiError) return reply(error.status, { error: error.message });
      if ((error as Error).name === "ConditionalCheckFailedException" || (error as Error).name === "TransactionCanceledException") return reply(409, { error: "The lesson changed. Refresh the recording status and try again." });
      // Never log tokens, email addresses, signed object URLs or request bodies.
      console.error("Recording operation failed", (error as Error).name);
      return reply(500, { error: "Recording operation failed. Please retry." });
    }
  };
}
export const handler = createRecordingHandler({ db, s3, verify: verifier, sign: getSignedUrl });
