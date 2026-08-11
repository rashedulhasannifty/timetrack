import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '@timetrack/config';
import type { Readable } from 'node:stream';

/**
 * PRD §7.4 — screenshots stream straight to MinIO; the API never buffers a full
 * image in Node memory. Objects are never public — the dashboard reads them through
 * short-lived presigned URLs (default 5 min TTL, PRD §8).
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly env = loadEnv();
  private readonly client = new S3Client({
    endpoint: this.env.S3_ENDPOINT,
    region: this.env.S3_REGION,
    forcePathStyle: true, // MinIO requires path-style addressing
    credentials: { accessKeyId: this.env.S3_ACCESS_KEY, secretAccessKey: this.env.S3_SECRET_KEY },
  });

  /** Create the screenshots bucket on boot if it does not yet exist. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET }));
    }
  }

  /**
   * Readiness probe (PRD §8): the bucket exists and our credentials can see it. HeadBucket
   * is a metadata call — no object listing, no data transfer.
   */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
  }

  putObject(key: string, body: Readable | Buffer, contentType: string): Promise<unknown> {
    return this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Stream an unknown-length body to S3/MinIO via multipart upload — never buffers the full
   * image in Node memory (PRD §7.4). Used by the screenshot upload path.
   */
  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType },
    });
    await upload.done();
  }

  /** Short-lived presigned GET — never a public bucket (PRD §8). */
  presignGet(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      {
        expiresIn: this.env.PRESIGNED_URL_TTL_SECONDS,
      },
    );
  }

  deleteObject(key: string): Promise<unknown> {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }

  /**
   * Delete every object under `prefix`, paginating the listing and batching the deletes (S3 caps
   * DeleteObjects at 1000 keys; ListObjectsV2 already returns at most 1000 per page). Returns the
   * number deleted. THROWS if S3 reports a per-key error — slice 4.3 erasure removes objects
   * BEFORE the rows that reference them, so a partial failure must abort the erase, never be
   * swallowed. Safe to re-run: an already-empty prefix returns 0.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.env.S3_BUCKET,
          Prefix: prefix,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === 'string' && k.length > 0);
      if (keys.length > 0) {
        const res = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.env.S3_BUCKET,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (res.Errors && res.Errors.length > 0) {
          throw new Error(`deleteByPrefix(${prefix}): ${res.Errors.length} object(s) failed`);
        }
        deleted += keys.length;
      }
      continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
  }
}
