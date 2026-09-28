// Linux-only M1 smoke: real OCR/NER through HTTP, PostgreSQL, Redis, MinIO and Orthanc.
// Every input is generated at runtime and wholly synthetic.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.MIAP_ENV_FILE ?? path.resolve(__dirname, '../../.env.local'), quiet: true });
if (!process.env.POSTGRES_DB?.includes('synthetic')) throw new Error('M1 smoke requires a synthetic development database');
for (const key of ['JWT_SECRET', 'DICOM_UID_SECRET']) process.env[key] ||= randomBytes(32).toString('hex');
for (const key of ['MASK_MAP_ENCRYPTION_KEY', 'AUTH_MFA_ENCRYPTION_KEY']) process.env[key] ||= randomBytes(32).toString('base64');
const root = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'miap-m1-'));
process.env.IMPORT_QUARANTINE_DIR = path.join(root, 'quarantine');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { DATABASE_SOURCE } = require('../dist/modules/database/database.tokens');
const { REDIS_CLIENT } = require('../dist/modules/redis/redis.module');
const { AttachmentObjectService } = require('../dist/modules/cases/attachment-object.service');
const { MaskMapService } = require('../dist/modules/cases/mask-map.service');
const { OrthancService } = require('../dist/modules/cases/orthanc.service');
const { ImportStoreService } = require('../dist/modules/cases/import-store.service');
const { ApiExceptionFilter } = require('../dist/common/api-exception.filter');

async function waitForItem(request, batchId) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await request(`/import/${batchId}`);
    assert.equal(response.status, 200);
    const progress = await response.json();
    const item = progress.items[0];
    if (item?.status === 'awaiting_confirmation') return item;
    if (item?.status === 'failed') throw new Error(`Synthetic ZIP failed: ${item.failure?.code ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Synthetic ZIP did not reach confirmation within 180 seconds');
}

(async () => {
  const python = process.env.DEID_WORKER_PYTHON ?? 'python3';
  const generated = spawnSync(python, [path.resolve(__dirname, '../workers/generate_synthetic_acceptance.py'), root], { stdio: 'inherit' });
  if (generated.status !== 0) throw new Error('Could not generate synthetic acceptance inputs');
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  const db = app.get(DATABASE_SOURCE);
  const redis = app.get(REDIS_CLIENT);
  const userId = randomUUID();
  const caseIds = [];
  const batchIds = [];
  let base;
  try {
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const [user] = await db.query(
      `INSERT INTO users (id, username, password_hash, real_name, role, status, expire_at, must_change_password, mfa_secret_encrypted)
       VALUES ($1,$2,'synthetic-unused','合成验证','admin','active','2099-12-31',false,'synthetic-mfa') RETURNING *`,
      [userId, `m1-${userId}`],
    );
    const token = app.get(AuthTokenService).signAccess(user);
    const request = (url, options = {}) => fetch(`${base}/api/cases${url}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
    const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const manualForm = new FormData();
    manualForm.set('source', 'synthetic');
    manualForm.set('report_text', '患者：张三，45岁。合成验证报告。');
    manualForm.set('image', new Blob([await fs.readFile(path.join(root, 'named-image.png'))], { type: 'image/png' }), 'named-image.png');
    const preparedResponse = await request('/manual/prepare', { method: 'POST', body: manualForm });
    assert.equal(preparedResponse.status, 201, 'manual prepare');
    const prepared = await preparedResponse.json();
    assert.ok(prepared.masked_count >= 1);
    assert.ok(prepared.image_redaction_count >= 1);
    assert.equal((await request(`/manual/${prepared.draft_id}/preview`)).status, 200);
    const manualResponse = await request(`/manual/${prepared.draft_id}/confirm`, json({ confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' }));
    assert.equal(manualResponse.status, 201, 'manual confirm');
    const manual = await manualResponse.json();
    caseIds.push(manual.case_id);
    assert.equal((await db.query('SELECT 1 FROM studies WHERE case_id=$1', [manual.case_id])).length, 0);
    const manualReport = await request(`/${manual.case_id}/report`);
    assert.equal(manualReport.status, 200);
    assert.ok(!JSON.stringify(await manualReport.json()).includes('张三'));

    const zipForm = new FormData();
    zipForm.set('source', 'synthetic');
    zipForm.set('file', new Blob([await fs.readFile(path.join(root, 'case.zip'))], { type: 'application/zip' }), 'case.zip');
    const uploadedResponse = await request('/import', { method: 'POST', body: zipForm });
    assert.equal(uploadedResponse.status, 202, 'ZIP import accepted');
    const uploaded = await uploadedResponse.json();
    batchIds.push(uploaded.batch_id);
    const item = await waitForItem(request, uploaded.batch_id);
    assert.ok(item.review.masked_count >= 1);
    assert.ok(item.review.ocr_hits.length >= 1);
    assert.ok(!item.review.masked_report.includes('张三'));
    assert.equal((await request(`/import/${uploaded.batch_id}/items/${item.item_id}/preview`)).status, 200);
    const confirmedResponse = await request(`/import/${uploaded.batch_id}/items/${item.item_id}/confirm`, json({ confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' }));
    assert.equal(confirmedResponse.status, 201, 'ZIP confirmation');
    const confirmed = await confirmedResponse.json();
    caseIds.push(confirmed.case_id);
    assert.equal((await db.query('SELECT 1 FROM studies WHERE case_id=$1', [confirmed.case_id])).length, 1);
    assert.equal((await db.query('SELECT 1 FROM series s JOIN studies st ON st.id=s.study_id WHERE st.case_id=$1', [confirmed.case_id])).length, 1);
    const importedReport = await request(`/${confirmed.case_id}/report`);
    assert.equal(importedReport.status, 200);
    assert.ok(!JSON.stringify(await importedReport.json()).includes('张三'));
    console.log('PASS: synthetic manual and ZIP/DICOM through real OCR/NER, HTTP, PostgreSQL, Redis, MinIO and Orthanc.');
  } finally {
    const orthanc = app.get(OrthancService);
    const objects = app.get(AttachmentObjectService);
    const maps = app.get(MaskMapService);
    for (const id of caseIds) {
      const series = await db.query('SELECT s.orthanc_id FROM series s JOIN studies st ON st.id=s.study_id WHERE st.case_id=$1', [id]);
      await orthanc.removeSeries(series.map((row) => row.orthanc_id));
      for (const row of await db.query('SELECT object_key, filename FROM attachments WHERE case_id=$1', [id])) {
        if (row.filename === 'key-image.png') await objects.remove(row.object_key);
        else await objects.removePages(row.object_key, 1);
      }
      for (const row of await db.query('SELECT mask_map_id FROM reports WHERE case_id=$1', [id])) await maps.remove(row.mask_map_id);
      await db.query('DELETE FROM attachments WHERE case_id=$1', [id]);
      await db.query('DELETE FROM reports WHERE case_id=$1', [id]);
      await db.query('DELETE FROM series WHERE study_id IN (SELECT id FROM studies WHERE case_id=$1)', [id]);
      await db.query('DELETE FROM studies WHERE case_id=$1', [id]);
      await db.query('DELETE FROM cases WHERE id=$1', [id]);
    }
    for (const id of batchIds) await app.get(ImportStoreService).remove(id);
    await db.query("UPDATE users SET status='disabled', deleted_at=now() WHERE id=$1", [userId]);
    await fs.rm(root, { recursive: true, force: true });
    await app.close();
    if (redis.isOpen) await redis.quit();
    if (db.isInitialized) await db.destroy();
  }
})().catch((error) => { console.error(error.name, error.message); process.exit(1); });
