// Copy into /app/server only for the isolated local restoration drill.
// This fixture deliberately stays out of the runtime image. No real inputs.
'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const https = require('node:https');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { JwtService } = require('@nestjs/jwt');
const { S3Client, ListBucketsCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
const { AppDataSource: db } = require('./dist/database/data-source');
const { AuthTokenService } = require('./dist/modules/auth/auth-token.service');
const { AttachmentObjectService } = require('./dist/modules/cases/attachment-object.service');
const { MaskMapService } = require('./dist/modules/cases/mask-map.service');
const { ElasticService } = require('./dist/modules/search/elastic.service');
const { SearchSyncService } = require('./dist/modules/search/search-sync.service');

async function main() {
  assert.equal(process.env.POSTGRES_DB, 'miap_synthetic');
  assert.equal(process.env.POSTGRES_HOST, 'postgres');
  assert.ok(['seed', 'verify'].includes(process.argv[2]));
  const ca = await fs.readFile('/tmp/wp16-test-ca.pem');
  const objects = new AttachmentObjectService();
  const maps = new MaskMapService();
  await db.initialize();
  try {
    if (process.argv[2] === 'seed') {
      assert.equal(Number((await db.query('SELECT count(*) FROM cases'))[0].count), 0, 'Seed only an empty synthetic database');
      const [actor] = await db.query(`INSERT INTO users(username,password_hash,real_name,role,quals,status,expire_at,must_change_password)
        VALUES('synthetic-restoration-reviewer','synthetic-unused','合成恢复验证','member','{"resp":["annotate","review"]}','active','2099-12-31',false) RETURNING *`);
      await fs.mkdir(process.env.IMPORT_QUARANTINE_DIR, { recursive: true });
      const temporary = await fs.mkdtemp(`${process.env.IMPORT_QUARANTINE_DIR}/wp16-`);
      try {
        for (let index = 1; index <= 3; index++) {
          const id = randomUUID(), attachment = randomUUID();
          const pixels = Buffer.from(Array.from({ length: 256 * 256 }, (_, value) => (value + index * 11) % 256));
          const png = await sharp(pixels, { raw: { width: 256, height: 256, channels: 1 } }).toColourspace('b-w').png().toBuffer();
          const orthanc = async (path, body) => {
            const response = await fetch(`http://orthanc:8042${path}`, {
              method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString('base64')}`,
                'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
              redirect: 'error', signal: AbortSignal.timeout(30_000),
            });
            assert.ok(response.ok, 'Synthetic Orthanc operation');
            return response.json();
          };
          const created = await orthanc('/tools/create-dicom', {
            Tags: { PatientID: `SYN-WP16-${index}`, PatientName: 'SYNTHETIC^RESTORE', Modality: 'DX',
              PixelSpacing: '0.8\\0.6', SeriesDescription: 'SYNTHETIC RESTORATION TEST', WindowCenter: '128', WindowWidth: '256' },
            Content: `data:image/png;base64,${png.toString('base64')}`,
          });
          const instance = await orthanc(`/instances/${created.ID}`);
          const series = await orthanc(`/series/${instance.ParentSeries}`);
          const study = await orthanc(`/studies/${series.ParentStudy}`);
          await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method) VALUES($1,$2,'已发布','synthetic','resp','临床综合诊断')", [id, `SYN-WP16-${index}`]);
          const studyId = randomUUID();
          await db.query('INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,$4)', [studyId, id, study.MainDicomTags.StudyInstanceUID, '2026-10-08']);
          await db.query("INSERT INTO series(study_id,series_uid,modality,orthanc_id,frame_count,default_window) VALUES($1,$2,'DX',$3,1,$4)",
            [studyId, series.MainDicomTags.SeriesInstanceUID, instance.ParentSeries, JSON.stringify({ center: 128, width: 256 })]);
          await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','synthetic-test'),($1,'cases.published',$2,'{\"version\":0}','synthetic-test')", [actor.id, `cases:${id}`]);
          const key = `cases/${id}/attachments/${attachment}/key-image.png`;
          await fs.writeFile(`${temporary}/image.png`, png);
          const size = await objects.storePng(key, `${temporary}/image.png`);
          await db.query("INSERT INTO attachments(id,case_id,kind,object_key,filename,size,deid_confirmed) VALUES($1,$2,'其他',$3,'key-image.png',$4,true)", [attachment, id, key, String(size)]);
          await fs.writeFile(`${temporary}/mapping.json`, JSON.stringify([{ original: 'SYNTHETIC', replacement: 'SYNTHETIC-MASK' }]));
          const mapping = await maps.storeFromFile(`${temporary}/mapping.json`);
          await db.query("INSERT INTO reports(case_id,raw_text,sentences,mask_map_id) VALUES($1,'合成恢复病例',$2,$3)", [id, JSON.stringify([{ idx: 0, text: '合成恢复病例。' }]), mapping]);
        }
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
      await new SearchSyncService(db, new ElasticService()).runOnce(true);
    }
    const [actor] = await db.query("SELECT *,expire_at::text FROM users WHERE username='synthetic-restoration-reviewer'");
    assert.ok(actor);
    const token = new AuthTokenService(new JwtService({ secret: process.env.JWT_SECRET })).signAccess(actor);
    const request = (path, body, authenticated = true) => new Promise((resolve, reject) => {
      const request = https.request({ hostname: 'nginx', servername: 'localhost', port: 8443, ca, path,
        method: body ? 'POST' : 'GET', headers: { ...(authenticated ? { Authorization: `Bearer ${typeof authenticated === 'string' ? authenticated : token}` } : {}), 'Content-Type': 'application/json' } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.setTimeout(30_000, () => request.destroy(Error('HTTPS preview timeout')));
      request.end(body ? JSON.stringify(body) : undefined);
    });
    const cases = await db.query(`SELECT c.id,c.annotation_version,s.series_uid,a.id AS attachment_id,r.mask_map_id FROM cases c
      JOIN studies st ON st.case_id=c.id JOIN series s ON s.study_id=st.id JOIN attachments a ON a.case_id=c.id JOIN reports r ON r.case_id=c.id
      WHERE c.case_no IN ('SYN-WP16-1','SYN-WP16-2','SYN-WP16-3') ORDER BY c.case_no`);
    assert.equal(cases.length, 3);
    try {
      const prior = await fs.readFile('/tmp/wp16-prior-access.token', 'utf8');
      assert.equal((await request(`/api/library/${cases[0].id}`, undefined, prior)).status, 401, 'Original deployment session must not survive restoration');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.writeFile('/tmp/wp16-test-access.token', token, { mode: 0o600 });
    for (const item of cases) {
      const detail = await request(`/api/library/${item.id}`);
      assert.equal(detail.status, 200, 'Authenticated library detail through HTTPS');
      assert.equal((await request(`/api/library/${item.id}`, undefined, false)).status, 401);
      const issued = await request('/api/frames/ticket', { case_id: item.id, series_uid: item.series_uid, frame_index: 0,
        access_mode: 'library', expected_version: item.annotation_version });
      assert.equal(issued.status, 201, 'Authorized frame ticket');
      const url = JSON.parse(issued.bytes).url;
      assert.equal((await request(url, undefined, false)).status, 401, 'Ticket alone grants no image access');
      const frame = await request(url);
      const attachment = await request(`/api/library/${item.id}/attachments/${item.attachment_id}/preview?version=${item.annotation_version}`);
      for (const response of [frame, attachment]) {
        assert.equal(response.status, 200);
        assert.match(response.headers['content-type'], /^image\/png/);
        assert.equal(response.headers['cache-control'], 'no-store, private');
        assert.equal(response.headers['x-content-type-options'], 'nosniff');
        assert.equal(response.headers['x-frame-options'], 'DENY');
        const metadata = await sharp(response.bytes).metadata();
        assert.equal(metadata.width, 256);
        assert.equal(metadata.height, 256);
      }
      assert.deepEqual(await maps.read(item.mask_map_id), [{ original: 'SYNTHETIC', replacement: 'SYNTHETIC-MASK' }]);
    }
    const [privileges] = await db.query(`SELECT current_user AS name,
      has_table_privilege(current_user,'audit_logs','DELETE') AS audit_delete,
      has_table_privilege(current_user,'typeorm_migrations','SELECT') AS migration_read,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`);
    assert.deepEqual(privileges, { name: 'miap_runtime', audit_delete: false, migration_read: false, superuser: false });
    const minio = new S3Client({ endpoint: 'http://minio:9000', region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY, secretAccessKey: process.env.MINIO_SECRET_KEY } });
    const visible = await minio.send(new ListBucketsCommand({}));
    assert.ok((visible.Buckets ?? []).every(bucket => ['miap-mask-maps', 'miap-attachments'].includes(bucket.Name)));
    await assert.rejects(minio.send(new CreateBucketCommand({ Bucket: `miap-forbidden-${randomUUID()}` })), error => error.$metadata?.httpStatusCode === 403);
    minio.destroy();
    const adminSearch = await fetch('http://elasticsearch:9200/_security/user', { headers: { Authorization:
      `Basic ${Buffer.from(`${process.env.SEARCH_ELASTIC_USERNAME}:${process.env.SEARCH_ELASTIC_PASSWORD}`).toString('base64')}` } });
    assert.equal(adminSearch.status, 403);
    console.log('PASS: 3 synthetic cases, 3 HTTPS frames, 3 HTTPS attachments, 3 encrypted mappings; unauthorized requests denied and runtime privileges restricted.');
  } finally {
    await db.destroy();
  }
}
void main().catch(error => {
  const location = error.stack?.split('\n').find(line => /test-restore\.cjs:\d+:\d+/.test(line));
  console.error('Synthetic restoration verification failed; no acceptance recorded.', { code: error.code, location });
  process.exitCode = 1;
});
