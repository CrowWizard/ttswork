import { Client } from "minio";
import type { AppConfig } from "./config";

const clients = new WeakMap<AppConfig, Client>();

export function getMinioClient(cfg: AppConfig["minio"]): Client {
  return new Client({
    endPoint: cfg.endpoint,
    port: cfg.port,
    useSSL: cfg.useSSL,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  });
}

export type MinioStoredObject = {
  bucket: string;
  objectKey: string;
  minioUri: string;
};

export function buildMinioUri(bucket: string, objectKey: string) {
  return `minio://${bucket}/${objectKey}`;
}

export async function ensureBucketExists(client: Client, bucket: string) {
  const exists = await client.bucketExists(bucket);

  if (!exists) {
    await client.makeBucket(bucket);
  }
}

export async function uploadBuffer(
  cfg: AppConfig["minio"],
  params: {
    objectKey: string;
    buffer: Buffer;
    contentType: string;
  },
) {
  const client = getMinioClient(cfg);
  await ensureBucketExists(client, cfg.bucket);
  await client.putObject(cfg.bucket, params.objectKey, params.buffer, params.buffer.length, {
    "Content-Type": params.contentType,
  });

  return {
    bucket: cfg.bucket,
    objectKey: params.objectKey,
    minioUri: buildMinioUri(cfg.bucket, params.objectKey),
  } satisfies MinioStoredObject;
}

export async function getObjectBuffer(cfg: AppConfig["minio"], objectKey: string) {
  const client = getMinioClient(cfg);
  const stream = await client.getObject(cfg.bucket, objectKey);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function checkMinioHealth(cfg: AppConfig["minio"]) {
  try {
    const client = getMinioClient(cfg);
    await ensureBucketExists(client, cfg.bucket);
    return { ok: true, bucket: cfg.bucket };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown minio error";
    return { ok: false, message, bucket: cfg.bucket };
  }
}
