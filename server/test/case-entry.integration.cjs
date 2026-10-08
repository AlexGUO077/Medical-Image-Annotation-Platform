// Explicit local integration test: real HTTP/DB/Redis/MinIO; the OCR/NER boundary is mocked.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: process.env.MIAP_ENV_FILE ?? path.resolve(__dirname, '../../.env.local'), quiet: true });
if (!process.env.POSTGRES_DB?.includes('synthetic')) throw new Error('Integration test requires a synthetic development database');
for (const key of ['JWT_SECRET', 'DICOM_UID_SECRET']) process.env[key] ||= randomBytes(32).toString('hex');
for (const key of ['MASK_MAP_ENCRYPTION_KEY', 'AUTH_MFA_ENCRYPTION_KEY']) process.env[key] ||= randomBytes(32).toString('base64');
process.env.IMPORT_QUARANTINE_DIR = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'miap-wp05-integration-'));
require('reflect-metadata');
const sharp = require('sharp');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { DeidWorkerService } = require('../dist/modules/cases/deid-worker.service');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { DATABASE_SOURCE } = require('../dist/modules/database/database.tokens');
const { REDIS_CLIENT } = require('../dist/modules/redis/redis.module');
const { AttachmentObjectService } = require('../dist/modules/cases/attachment-object.service');
const { MaskMapService } = require('../dist/modules/cases/mask-map.service');
const { ApiExceptionFilter } = require('../dist/common/api-exception.filter');
(async () => {
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: 'white' } }).png().toBuffer();
  const worker = {
    processManual: async (_report, _image, out) => {
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, 'key-image.png'), png);
      await fs.writeFile(path.join(out, 'masked-report.txt'), '患者：某，45岁。合成报告。');
      await fs.writeFile(path.join(out, 'mask-map.json'), '[{"original":"合成人名","replacement":"某"}]');
      return { masked_report: '患者：某，45岁。合成报告。', masked_count: 1, image_redaction_count: 0 };
    },
    processText: async (input, out) => {
      const fields = JSON.parse(await fs.readFile(input, 'utf8')).map(v => v.replaceAll('合成人名', '某'));
      await fs.writeFile(path.join(out, 'mask-map.json'), '[]');
      return { fields, masked_count: 1 };
    },
    processAttachment: async (_input, out) => { await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'page-1.png'), png); return { page_count: 1 }; },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DeidWorkerService).useValue(worker).compile();
  const app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalFilters(new ApiExceptionFilter());
  const db = app.get(DATABASE_SOURCE), redis = app.get(REDIS_CLIENT);
  const ids = [], caseIds = [];
  let base;
  try {
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    const tokens = [];
    for (const role of ['admin', 'admin', 'member']) {
      const id = randomUUID(); ids.push(id);
      const [user] = await db.query(`INSERT INTO users (id, username, password_hash, real_name, role, status, expire_at, must_change_password, mfa_secret_encrypted) VALUES ($1,$2,'synthetic-unused','合成验证',$3,'active','2099-12-31',false,'synthetic-mfa') RETURNING *`, [id, `wp05-${id}`, role]);
      tokens.push(app.get(AuthTokenService).signAccess(user));
    }
    const req = (url, token = tokens[0], options = {}) => fetch(`${base}/api/cases${url}`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
    const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await req('/manual/prepare', undefined, { method: 'POST' })).status, 400);
    assert.equal((await req('/manual/prepare', '', { method: 'POST' })).status, 401);
    assert.equal((await req('/manual/prepare', tokens[2], { method: 'POST' })).status, 403);
    const form = new FormData(); form.set('source', 'synthetic'); form.set('report_text', '患者：合成人名，45岁'); form.set('image', new Blob([png], { type: 'image/png' }), 'image.png');
    const prepared = await req('/manual/prepare', tokens[0], { method: 'POST', body: form });
    assert.equal(prepared.status, 201, "manual prepare"); const draft = await prepared.json();
    assert.equal(draft.masked_count, 1);
    assert.equal((await req(`/manual/${draft.draft_id}/preview`, tokens[1])).status, 404);
    const preview = await req(`/manual/${draft.draft_id}/preview`); assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store, private');
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
    const confirm = await req(`/manual/${draft.draft_id}/confirm`, tokens[0], json('POST', { confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' }));
    assert.equal(confirm.status, 201, "manual confirm"); const made = await confirm.json(); caseIds.push(made.case_id);
    assert.equal((await db.query('SELECT 1 FROM studies WHERE case_id=$1', [made.case_id])).length, 0);
    const detailResponse = await req(`/${made.case_id}`); const detail = await detailResponse.json(); assert.equal(detail.attachments.length, 1); assert.equal(JSON.stringify(detail).includes('object_key'), false);
    assert.equal((await req(`/${made.case_id}`, tokens[2])).status, 403);
    const clinical = await req(`/${made.case_id}/clinical`, tokens[0], json('PUT', { clinical_text: '合成人名，45岁', age_band: '40–49', sex: '男', confirm_method: '病理证实' }));
    assert.equal(clinical.status, 200); assert.equal((await clinical.json()).clinical_text, '某，45岁');
    await require('./case-disease.assertions.cjs')({ db, req, json, caseId: made.case_id, tokens });
    const teaching = await req(`/${made.case_id}/teaching`, tokens[0], json('PATCH', { difficulty: '简单', applicable_level: '本科', sign_points: ['合成人名'] }));
    assert.equal(teaching.status, 200); assert.deepEqual((await teaching.json()).sign_points, ['某']);
    const chunk = new FormData(); for (const [k,v] of Object.entries({ part_index: '0', part_count: '1', file_size: String(png.length), format: 'png' })) chunk.set(k,v);
    chunk.set('chunk', new Blob([png], { type: 'image/png' }), 'chunk.png');
    const uploadRes = await req(`/${made.case_id}/attachments`, tokens[0], { method: 'POST', body: chunk }); assert.equal(uploadRes.status, 201, "attachment upload"); const upload = await uploadRes.json();
    assert.equal((await req(`/${made.case_id}/attachments/uploads/${upload.upload_id}`, tokens[1])).status, 404);
    for (let i=0;i<30;i++) { const progress = await (await req(`/${made.case_id}/attachments/uploads/${upload.upload_id}`)).json(); if (progress.status==='pending_confirmation') break; await new Promise(r=>setTimeout(r,100)); }
    assert.equal((await req(`/${made.case_id}/attachments/uploads/${upload.upload_id}/preview?page=2`)).status, 404);
    const attached = await req(`/${made.case_id}/attachments/uploads/${upload.upload_id}/confirm`, tokens[0], json('POST', { confirmed: true, kind: '其他' })); assert.equal(attached.status, 201, "attachment confirm"); const attachment = await attached.json();
    const finalPreview = await req(`/${made.case_id}/attachments/${attachment.attachment_id}/preview?page=1`); assert.equal(finalPreview.status,200); assert.equal(finalPreview.headers.get('x-preview-page-count'),'1');
    await db.query('UPDATE cases SET status=\'已发布\' WHERE id=$1', [made.case_id]);
    assert.equal((await req(`/${made.case_id}/clinical`, tokens[0], json('PUT', { clinical_text: '', age_band:'', sex:'', confirm_method:'病理证实' }))).status,409);
    await db.query('UPDATE users SET status=\'disabled\' WHERE id=$1', [ids[0]]);
    assert.equal((await req(`/${made.case_id}`)).status,403);
    console.log('PASS: actual HTTP guards, PostgreSQL transactions/audits, Redis ownership, MinIO objects, manual -> clinical/teaching -> chunk upload -> confirmation -> watermarked preview (OCR/NER mocked in this integration layer).');
  } finally {
    for (const id of caseIds) {
      for (const row of await db.query('SELECT object_key, filename FROM attachments WHERE case_id=$1',[id])) { const objects=app.get(AttachmentObjectService); if (row.filename==='key-image.png') await objects.remove(row.object_key); else await objects.removePages(row.object_key,1); }
      for (const row of await db.query('SELECT mask_map_id FROM reports WHERE case_id=$1',[id])) await app.get(MaskMapService).remove(row.mask_map_id);
      await db.query('DELETE FROM attachments WHERE case_id=$1',[id]); await db.query('DELETE FROM reports WHERE case_id=$1',[id]); await db.query('DELETE FROM cases WHERE id=$1',[id]);
    }
    for (const id of ids) { await db.query("UPDATE users SET status='disabled', deleted_at=now() WHERE id=$1",[id]); }
    await fs.rm(process.env.IMPORT_QUARANTINE_DIR, { recursive: true, force: true });
    await app.close(); if (redis.isOpen) await redis.quit(); if(db.isInitialized) await db.destroy();
  }
})().catch(error => { console.error(error.name, error.message); process.exit(1); });
