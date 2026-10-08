import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { MaskMapService } from './mask-map.service';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(IMPORT_QUARANTINE_ROOT, 'unit-map-'));
  vi.stubEnv('MASK_MAP_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('MINIO_ACCESS_KEY', 'synthetic-access'); vi.stubEnv('MINIO_SECRET_KEY', 'synthetic-test-only');
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
function storage() {
  const h = { bytes: Buffer.alloc(0), empty: false };
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown) => {
    if (command instanceof PutObjectCommand) h.bytes = Buffer.from(command.input.Body as Uint8Array);
    if (command instanceof GetObjectCommand) return h.empty ? {} : { Body: { transformToByteArray: async () => h.bytes } };
    return {};
  }) as never);
  return { h, send, service: new MaskMapService() };
}
describe('encrypted deidentification map storage', () => {
  it('round-trips synthetic mappings through authenticated encryption without storing plaintext', async () => {
    const s = storage(), file = join(dir, 'map.json'); const mapping = [{ original: 'SYNTHETIC-PERSON', replacement: '某' }];
    await writeFile(file, JSON.stringify(mapping));
    expect(await s.service.storeFromFile(file, '00000000-0000-4000-8000-000000000009')).toBe('00000000-0000-4000-8000-000000000009');
    const first = Buffer.from(s.h.bytes);
    expect(first.includes(Buffer.from('SYNTHETIC-PERSON'))).toBe(false);
    expect(await s.service.read('00000000-0000-4000-8000-000000000009')).toEqual(mapping);
    await s.service.storeFromFile(file, '00000000-0000-4000-8000-000000000009'); expect(s.h.bytes).not.toEqual(first);
    await s.service.remove('00000000-0000-4000-8000-000000000009');
    expect(s.send.mock.calls.some(c => c[0].constructor.name === 'DeleteObjectCommand')).toBe(true);
  });
  it('rejects altered ciphertext, tags, version headers, empty objects and wrong keys', async () => {
    const s = storage(), file = join(dir, 'map.json'); await writeFile(file, '[{"original":"synthetic"}]');
    await s.service.storeFromFile(file, '00000000-0000-4000-8000-000000000009'); const original = Buffer.from(s.h.bytes);
    for (const offset of [14, original.length - 1, 0]) {
      s.h.bytes = Buffer.from(original); s.h.bytes[offset] = s.h.bytes[offset]! ^ 1;
      await expect(s.service.read('00000000-0000-4000-8000-000000000009')).rejects.toMatchObject({ status: 503 });
    }
    s.h.bytes = Buffer.from(original); vi.stubEnv('MASK_MAP_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    await expect(s.service.read('00000000-0000-4000-8000-000000000009')).rejects.toMatchObject({ status: 503 });
    s.h.empty = true; await expect(s.service.read('00000000-0000-4000-8000-000000000009')).rejects.toMatchObject({ status: 503 });
  });
  it('skips absent and empty maps and rejects invalid content or encryption configuration before writing', async () => {
    const s = storage(), file = join(dir, 'map.json');
    expect(await s.service.storeFromFile(null)).toBeNull(); await s.service.remove(null);
    await writeFile(file, '[]'); expect(await s.service.storeFromFile(file)).toBeNull();
    await writeFile(file, '{}'); await expect(s.service.storeFromFile(file)).rejects.toMatchObject({ status: 503 });
    await writeFile(file, '[{}]'); vi.stubEnv('MASK_MAP_ENCRYPTION_KEY', Buffer.alloc(8).toString('base64'));
    await expect(s.service.storeFromFile(file)).rejects.toThrow('32-byte');
    expect(s.send).not.toHaveBeenCalled();
  });
});
