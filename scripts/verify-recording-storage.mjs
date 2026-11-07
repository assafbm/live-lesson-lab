/** Deployment smoke test: synthetic bytes only, deleted in finally.
 * Credentials stay in process memory and are never printed or written to disk. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, GetPublicAccessBlockCommand, GetBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const deployment = JSON.parse(readFileSync("infra/aws/cdk.out/deployed-outputs.json", "utf8")).LiveLessonLabServerlessStack;
if (!deployment.RecordingsBucketName) throw Error("Deploy recording infrastructure first.");
const auth = JSON.parse(execFileSync(process.env.AWS_CLI_PATH || "aws", ["configure", "export-credentials", "--format", "process"], { encoding: "utf8" }));
const s3 = new S3Client({ region: "eu-north-1", credentials: { accessKeyId: auth.AccessKeyId, secretAccessKey: auth.SecretAccessKey, sessionToken: auth.SessionToken }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const Bucket = deployment.RecordingsBucketName; const Key = `lessons/deployment-check/${randomUUID()}.webm`;
const bytes = Buffer.from("Live Lesson Lab synthetic storage verification. No lesson media.");
let UploadId; let completed = false;
try {
  const access = await s3.send(new GetPublicAccessBlockCommand({ Bucket }));
  if (!Object.values(access.PublicAccessBlockConfiguration).every(Boolean)) throw Error("Public access block is incomplete.");
  const lifecycle = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
  if (!lifecycle.Rules.some(rule => rule.Expiration?.Days === 30 && rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation === 1)) throw Error("Recording lifecycle policy missing.");
  ({ UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key, ContentType: "video/webm", ServerSideEncryption: "AES256" })));
  const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, ContentLength: bytes.length }), { expiresIn: 60, signableHeaders: new Set(["content-length"]) });
  const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: deployment.WebsiteUrl, "Access-Control-Request-Method": "PUT" } });
  if (preflight.headers.get("access-control-allow-origin") !== deployment.WebsiteUrl) throw Error("Upload CORS failed.");
  const upload = await fetch(url, { method: "PUT", body: bytes });
  if (!upload.ok) throw Error(`Signed part upload failed (${upload.status}).`);
  await s3.send(new CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: upload.headers.get("etag") }] } })); completed = true;
  const publicUrl = `https://${Bucket}.s3.eu-north-1.amazonaws.com/${Key}`;
  if ((await fetch(publicUrl)).status !== 403) throw Error("Recording object is publicly readable.");
  const download = await fetch(await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 60 }));
  if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(bytes)) throw Error("Private download verification failed.");
  const unauthenticated = await fetch(deployment.RecordingsApiUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
  if (unauthenticated.status !== 401) throw Error(`Recording API did not reject anonymous access (${unauthenticated.status}).`);
  console.log(JSON.stringify({ publicAccessBlocked: true, retentionDays: 30, multipartUpload: "passed", uploadCors: "passed", privateDownload: "passed", anonymousApiRejected: true }));
} finally {
  if (UploadId && !completed) await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
  await s3.send(new DeleteObjectCommand({ Bucket, Key }));
  s3.destroy();
  console.log("Synthetic storage-check data removed.");
}
