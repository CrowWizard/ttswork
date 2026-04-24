import { Client } from "minio";

const endpoint = process.env.MINIO_ENDPOINT ?? "127.0.0.1";
const port = Number(process.env.MINIO_PORT ?? "9000");
const useSSL = (process.env.MINIO_USE_SSL ?? "false") === "true";
const accessKey = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const secretKey = process.env.MINIO_SECRET_KEY ?? "minioadmin";
const bucket = process.env.MINIO_BUCKET ?? "voice-mvp";

const client = new Client({
  endPoint: endpoint,
  port,
  useSSL,
  accessKey,
  secretKey,
});

export type MinioStoredObject = {
  bucket: string;
  objectKey: string;
  minioUri: string;
};

export function buildMinioUri(objectKey: string) {
  return `minio://${bucket}/${objectKey}`;
}

export async function ensureBucketExists() {
  const exists = await client.bucketExists(bucket);

  if (!exists) {
    await client.makeBucket(bucket);
  }
}

export async function uploadBuffer(params: {
  objectKey: string;
  buffer: Buffer;
  contentType: string;
}) {
  await ensureBucketExists();
  await client.putObject(bucket, params.objectKey, params.buffer, params.buffer.length, {
    "Content-Type": params.contentType,
  });

  return {
    bucket,
    objectKey: params.objectKey,
    minioUri: buildMinioUri(params.objectKey),
  } satisfies MinioStoredObject;
}

export async function getObjectBuffer(objectKey: string) {
  const stream = await client.getObject(bucket, objectKey);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function statObject(objectKey: string) {
  return client.statObject(bucket, objectKey);
}

export async function checkMinioHealth() {
  try {
    await ensureBucketExists();
    return { ok: true, bucket };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown minio error";
    return { ok: false, message, bucket };
  }
}
