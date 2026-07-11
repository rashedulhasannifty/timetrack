import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

  /** Short-lived presigned GET — never a public bucket (PRD §8). */
  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }), {
      expiresIn: this.env.PRESIGNED_URL_TTL_SECONDS,
    });
  }

  deleteObject(key: string): Promise<unknown> {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}
