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

  /**
   * A second client that exists ONLY to sign browser-bound URLs, bound to the public origin.
   *
   * SigV4 signs the host, so a presigned URL is valid only at the origin it was signed for —
   * rewriting the host afterwards invalidates the signature. Signing with `this.client` therefore
   * produced URLs pointing at S3_ENDPOINT, which in production is the compose service name
   * `http://minio:9000`: right for the API, unreachable for the browser, and every screenshot
   * rendered broken. This client issues no requests of its own, so it never dials that origin.
   *
   * Falls back to the same client when S3_PUBLIC_ENDPOINT is unset (local dev, where both are
   * http://localhost:9000).
   */
  private readonly presignClient =
    this.env.S3_PUBLIC_ENDPOINT === undefined ||
    this.env.S3_PUBLIC_ENDPOINT === this.env.S3_ENDPOINT
      ? this.client
      : new S3Client({
          endpoint: this.env.S3_PUBLIC_ENDPOINT,
          region: this.env.S3_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: this.env.S3_ACCESS_KEY,
            secretAccessKey: this.env.S3_SECRET_KEY,
          },
        });

  /** Create the screenshots bucket on boot if it does not yet exist. */
  async onModuleInit(): Promise<void> {
    await ensureBucket({
      head: () => this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET })),
      create: () => this.client.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET })),
    });
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

  /**
   * Short-lived presigned GET — never a public bucket (PRD §8). Signed against the PUBLIC
   * origin, because the browser is what follows this URL.
   */
  presignGet(key: string): Promise<string> {
    return getSignedUrl(
      this.presignClient,
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

/** What reconciling the bucket on boot actually did. */
export type EnsureBucketOutcome = 'present' | 'created' | 'raced';

/**
 * S3 and MinIO both report "someone already made this" rather than succeeding quietly.
 * `BucketAlreadyOwnedByYou` is the one that matters here: it is what the LOSER of a race gets
 * when two API instances create the same bucket, and it means the bucket exists and is ours —
 * the desired end state, not a failure.
 */
const ALREADY_EXISTS = new Set(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists']);

function status(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

function name(error: unknown): string | undefined {
  return (error as { name?: string } | null)?.name;
}

/**
 * Bring the bucket into existence, tolerating a concurrent creator.
 *
 * The previous shape was `try { HeadBucket } catch { CreateBucket }`, which had two faults and
 * crashed the API on boot for both:
 *
 * 1. **The race.** Two instances starting together — a rolling deploy, `docker compose up` with
 *    a replica, an API restarted beside a worker — both see no bucket and both create it. The
 *    loser gets `BucketAlreadyOwnedByYou`, which nothing caught, so `onModuleInit` rejected and
 *    took the process down. The bucket was fine; the API just refused to start.
 * 2. **The blanket catch.** A HeadBucket 403 from wrong credentials was answered by trying to
 *    CREATE the bucket, so the operator saw a confusing creation failure instead of the
 *    authentication error that actually happened.
 *
 * Anything that is not "missing" or "already there" still propagates and still fails the boot —
 * deliberately. An API that cannot reach its object store cannot serve screenshots, and starting
 * up to fail every upload is worse than not starting.
 */
export async function ensureBucket(bucket: {
  head: () => Promise<unknown>;
  create: () => Promise<unknown>;
}): Promise<EnsureBucketOutcome> {
  try {
    await bucket.head();
    return 'present';
  } catch (error) {
    // `NotFound` is the SDK's name for a 404 here. Anything else — 403, a connection refusal —
    // is not answered by creating a bucket.
    if (name(error) !== 'NotFound' && status(error) !== 404) {
      throw error;
    }
  }

  try {
    await bucket.create();
    return 'created';
  } catch (error) {
    if (ALREADY_EXISTS.has(name(error) ?? '') || status(error) === 409) {
      return 'raced';
    }

    throw error;
  }
}
