import { quarantinePath } from './cases-import.paths';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { requiredEnv } from '../../config/environment';

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class MaskMapService {
  private client?: S3Client;
  private bucketReady?: Promise<void>;

  async storeFromFile(path: string | null, id = randomUUID()): Promise<string | null> {
    if (!path) return null;
    const plaintext = await readFile(quarantinePath(path));
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new ServiceUnavailableException('脱敏映射格式无效');
    if (parsed.length === 0) return null;

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const body = Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
    await this.ensureBucket();
    await this.s3().send(new PutObjectCommand({
      Bucket: this.bucket(),
      Key: this.objectKey(id),
      Body: body,
      ContentType: 'application/octet-stream',
      Metadata: { format: 'aes-256-gcm-v1' },
    }));
    return id;
  }

  async read(id: string): Promise<unknown[]> {
    await this.ensureBucket();
    const response = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket(), Key: this.objectKey(id) }));
    if (!response.Body) throw new ServiceUnavailableException('脱敏映射对象为空');
    const encrypted = Buffer.from(await response.Body.transformToByteArray());
    if (encrypted.length <= 1 + IV_LENGTH + TAG_LENGTH || encrypted[0] !== VERSION) {
      throw new ServiceUnavailableException('脱敏映射对象格式无效');
    }
    const iv = encrypted.subarray(1, 1 + IV_LENGTH);
    const tag = encrypted.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = encrypted.subarray(1 + IV_LENGTH + TAG_LENGTH);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAuthTag(tag);
      const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed;
    } catch {
      throw new ServiceUnavailableException('脱敏映射解密失败');
    }
  }

  async remove(id: string | null): Promise<void> {
    if (!id) return;
    await this.ensureBucket();
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: this.objectKey(id) }));
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
    return process.env.MINIO_MASK_MAP_BUCKET ?? 'miap-mask-maps';
  }

  private objectKey(id: string): string {
    return `mask-maps/${id}.json.enc`;
  }

  private key(): Buffer {
    const value = requiredEnv('MASK_MAP_ENCRYPTION_KEY');
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) throw new Error('MASK_MAP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    return key;
  }
}
