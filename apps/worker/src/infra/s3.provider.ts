import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadEnv } from '@timetrack/config';
import { chunk } from '../processors/retention.util.js';

/**
 * Worker-side S3 access (CLAUDE.md §3 — the worker owns its infra; apps never import each
 * other). Mirrors the API's MinioService client config. Prod is S3; MinIO is the local backend.
 */
@Injectable()
export class WorkerS3 {
  private readonly env = loadEnv();
  private readonly client = new S3Client({
    endpoint: this.env.S3_ENDPOINT,
    region: this.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: this.env.S3_ACCESS_KEY, secretAccessKey: this.env.S3_SECRET_KEY },
  });

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }

  /**
   * Batch-delete objects (≤1000 per S3 DeleteObjects call). Empty keys are skipped.
   * Throws if the backend reports any per-key error so the caller can defer the DB
   * drop/delete and retry next run (retention abort-and-retry policy).
   */
  async deleteObjects(keys: string[]): Promise<void> {
    const clean = keys.filter((k) => k.length > 0);
    for (const batch of chunk(clean, 1000)) {
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.env.S3_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (res.Errors && res.Errors.length > 0) {
        throw new Error(`deleteObjects: ${res.Errors.length} key(s) failed`);
      }
    }
  }
}
