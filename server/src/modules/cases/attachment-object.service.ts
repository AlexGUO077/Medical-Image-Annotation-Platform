import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requiredEnv } from '../../config/environment';

@Injectable()
export class AttachmentObjectService {
  private client?: S3Client;
  private bucketReady?: Promise<void>;

  async storePng(key: string, path: string): Promise<number> {
    const body = await readFile(path);
    await this.ensureBucket();
    await this.s3().send(new PutObjectCommand({
      Bucket: this.bucket(), Key: key, Body: body, ContentType: 'image/png',
    }));
    return body.length;
  }

  async readPng(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const response = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }));
    if (!response.Body || response.ContentType !== 'image/png') {
      throw new ServiceUnavailableException('附件预览不可用');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.ensureBucket();
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }

  async storePages(key: string, directory: string, count: number): Promise<number> {
    let size = 0;
    for (let page = 1; page <= count; page++) size += await this.storePng(`${key}/page-${page}.png`, join(directory, `page-${page}.png`));
    await this.s3().send(new PutObjectCommand({ Bucket: this.bucket(), Key: `${key}/manifest.json`,
      Body: JSON.stringify({ page_count: count }), ContentType: 'application/json' }));
    return size;
  }

  async pageCount(key: string): Promise<number> {
    await this.ensureBucket();
    const response = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket(), Key: `${key}/manifest.json` }));
    const manifest = JSON.parse(await response.Body?.transformToString() ?? '{}') as { page_count?: number };
    if (!Number.isInteger(manifest.page_count) || manifest.page_count! < 1 || manifest.page_count! > 100) {
      throw new ServiceUnavailableException('附件预览不可用');
    }
    return manifest.page_count!;
  }

  async removePages(key: string, count: number): Promise<void> {
    const results = await Promise.allSettled([
      ...Array.from({ length: count }, (_, index) => this.remove(`${key}/page-${index + 1}.png`)),
      this.remove(`${key}/manifest.json`),
    ]);
    if (results.some((result) => result.status === 'rejected')) throw new ServiceUnavailableException('附件对象清理待重试');
  }

  private s3(): S3Client {
    this.client ??= new S3Client({
      endpoint: `${process.env.MINIO_USE_TLS === 'true' ? 'https' : 'http'}://${process.env.MINIO_HOST ?? '127.0.0.1'}:${process.env.MINIO_PORT ?? '9000'}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? requiredEnv('MINIO_ROOT_USER'),
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? requiredEnv('MINIO_ROOT_PASSWORD'),
      },
    });
    return this.client;
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.s3().send(new HeadBucketCommand({ Bucket: this.bucket() }));
      } catch {
        try {
          await this.s3().send(new CreateBucketCommand({ Bucket: this.bucket() }));
        } catch {
          await this.s3().send(new HeadBucketCommand({ Bucket: this.bucket() }));
        }
      }
    })();
    return this.bucketReady;
  }

  private bucket(): string {
    return process.env.MINIO_ATTACHMENT_BUCKET ?? 'miap-attachments';
  }
}
