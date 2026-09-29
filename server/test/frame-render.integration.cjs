// Internal Orthanc rendering smoke with freshly generated synthetic pixels only.
// This does not exercise public frame authorization, rate limits or the SG-4 gate.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: process.env.MIAP_ENV_FILE ?? path.resolve(__dirname, '../../.env.local'), quiet: true });
if (!process.env.POSTGRES_DB?.includes('synthetic')) throw new Error('Requires the synthetic development environment');
require('reflect-metadata');
const sharp = require('sharp');
const { createClient } = require('redis');
const { OrthancService } = require('../dist/modules/cases/orthanc.service');
const { watermarkPreview } = require('../dist/modules/cases/case-preview');
const { FrameTicketService } = require('../dist/modules/frames/frame-ticket.service');
const { FrameRenderCacheService } = require('../dist/modules/frames/frame-render-cache.service');
const base = `${process.env.ORTHANC_USE_TLS === 'true' ? 'https' : 'http'}://${process.env.ORTHANC_HOST ?? '127.0.0.1'}:${process.env.ORTHANC_PORT ?? '8042'}`;
if (!process.env.ORTHANC_USERNAME || !process.env.ORTHANC_PASSWORD) throw new Error('Orthanc credentials required');
const authorization = `Basic ${Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString('base64')}`;
async function request(route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { authorization, 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error(`Synthetic Orthanc operation failed (${response.status})`);
  return response;
}
(async () => {
  const pixels = Buffer.from(Array.from({ length: 64 * 64 }, (_, index) => index % 256));
  const png = await sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } }).toColourspace('b-w').png().toBuffer();
  let instance;
  const cacheKeys = new Set();
  const redis = createClient({ socket: { host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379), reconnectStrategy: false }, password: process.env.REDIS_PASSWORD });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const created = await (await request('/tools/create-dicom', { method: 'POST', body: JSON.stringify({
      Tags: { PatientID: `SYN-WP07-${randomUUID()}`, PatientName: 'SYNTHETIC^FRAME', Modality: 'OT',
        SeriesDescription: 'SYNTHETIC INTERNAL RENDER TEST', WindowCenter: '128', WindowWidth: '256' },
      Content: `data:image/png;base64,${png.toString('base64')}`,
    }) })).json();
    assert.match(created.ID, /^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/); instance = created.ID;
    const service = new OrthancService();
    // Internal composition only: synthetic bearer/IDs are not a public authorization test.
    process.env.FRAME_TOKEN_SECRET = randomBytes(32).toString('hex');
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const tickets = new FrameTicketService();
    const session = { user_id: randomUUID(), access_token: randomBytes(32).toString('hex') };
    const ticket = tickets.issue(session, { case_id: randomUUID(), series_uid: '2.25.12345',
      frame_index: 0, window: { center: 64, width: 128 } });
    const token = ticket.url.slice('/api/frames/'.length);
    const bound = tickets.verify(token, session);
    assert.throws(() => tickets.verify(token, { ...session, access_token: 'another-session' }), /帧票据无效或已过期/);
    let renders = 0;
    const cache = new FrameRenderCacheService({ withTypeMapping: redis.withTypeMapping.bind(redis),
      set: async (key, bytes, options) => { cacheKeys.add(key); return redis.set(key, bytes, options); } },
      { renderInstanceFrame: (...args) => { renders++; return service.renderInstanceFrame(...args); } });
    const source = { ...bound, instance_id: instance };
    const [low, high, automatic] = await Promise.all([
      cache.render(source),
      cache.render({ ...source, window: { center: 192, width: 128 } }),
      cache.render({ ...source, window: null }),
    ]);
    assert.equal(renders, 3); assert.equal(cacheKeys.size, 3);
    assert.deepEqual(await cache.render(source), low); assert.equal(renders, 3);
    for (const key of cacheKeys) {
      const ttl = await redis.ttl(key); assert.ok(ttl > 1700 && ttl <= 1800);
    }
    for (const frame of [low, high, automatic]) {
      const meta = await sharp(frame).metadata();
      assert.equal(meta.format, 'png'); assert.equal(meta.width, 64); assert.equal(meta.height, 64);
      assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
    }
    assert.notDeepEqual(await sharp(low).raw().toBuffer(), await sharp(high).raw().toBuffer(), 'Window changes must change rendered pixel values');
    const marked = await watermarkPreview(automatic, { username: 'synthetic-render', real_name: '合成验证' });
    assert.notDeepEqual(await sharp(marked).raw().toBuffer(), await sharp(automatic).raw().toBuffer());
    const otherMarked = await watermarkPreview(await cache.render({ ...source, window: null }),
      { username: 'another-user', real_name: '另一个合成用户' });
    assert.notDeepEqual(await sharp(marked).raw().toBuffer(), await sharp(otherMarked).raw().toBuffer());
    assert.equal(renders, 3);
    await assert.rejects(service.renderInstanceFrame(instance, 1), /单帧渲染不可用/);
    console.log('PASS: internal ticket/session binding, real Redis cache hits and 1800s TTL, real Orthanc PNG/window rendering, metadata stripping, per-user watermark composition and invalid frame rejection');
  } finally {
    try {
      if (redis.isReady && cacheKeys.size) await redis.del([...cacheKeys]);
    } finally {
      if (redis.isOpen) redis.destroy();
      if (instance) await request(`/instances/${instance}`, { method: 'DELETE' });
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
