// Black-box acceptance through the real local HTTPS deployment. No DB writes,
// mocked modules, signed fixture JWTs, raw response dumps, HAR or traces.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { generate } = require('otplib');
const { parse } = require('dotenv');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const strongPassword = () => 'Aa1!' + randomBytes(24).toString('hex');
let stage = 'configuration';

async function main() {
  assert(process.env.MIAP_M3_INSTANCE, 'Explicit private local instance required');
  const instance = await fs.realpath(process.env.MIAP_M3_INSTANCE);
  assert.equal((await fs.stat(instance)).mode & 0o077, 0);
  const marker = JSON.parse(await fs.readFile(path.join(instance, 'instance.json'), 'utf8'));
  assert.equal(marker.project, 'miap-synthetic-wp17');
  const envPath = path.join(instance, '.env');
  assert.equal((await fs.stat(envPath)).mode & 0o077, 0);
  const env = parse(await fs.readFile(envPath));
  assert.equal(env.DEPLOY_INSTANCE_DIR, instance);
  const base = `https://localhost:${env.DEPLOY_HTTPS_PORT}`;
  const ca = await fs.readFile(path.join(instance, 'certs/fullchain.pem'));
  const accountsPath = path.join(instance, 'acceptance-accounts.json');
  const accounts = await fs.readFile(accountsPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return { admin: { username: 'admin', password: env.SEED_ADMIN_PASSWORD } };
  });
  const retainAccounts = () => fs.writeFile(accountsPath, JSON.stringify(accounts), { mode: 0o600 });

  async function request(route, { token, method = 'GET', body, headers = {} } = {}) {
    const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request(base + route, { ca, method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}), ...headers,
      } }, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => {
          const data = Buffer.concat(parts);
          resolve({ status: res.statusCode, headers: res.headers, bytes: data,
            json: () => JSON.parse(data.toString('utf8')) });
        });
      });
      req.on('error', reject);
      req.setTimeout(180_000, () => req.destroy(Error('HTTPS request timeout')));
      req.end(bytes);
    });
  }
  async function json(route, body, token, status = 201, method = 'POST') {
    const res = await request(route, { body, token, method });
    assert.equal(res.status, status, route.startsWith('/api/frames/') ? 'frame response' : route);
    return res.json();
  }
  const get = (route, token) => json(route, undefined, token, 200, 'GET');
  async function login(account) {
    let session = await json('/api/auth/login', { username: account.username, password: account.password }, null, 200);
    if (session.next === 'change_password') {
      const password = strongPassword();
      session = await json('/api/auth/password', { current_password: account.password, new_password: password }, session.token, 200);
      account.password = password;
      await retainAccounts();
    }
    if (session.next === 'setup_2fa') {
      const setup = await json('/api/auth/2fa/setup', {}, session.token, 200);
      account.secret = setup.manual_key;
      await retainAccounts();
      session = { ...session, token: setup.token };
    }
    if (session.next !== 'authenticated') {
      assert(account.secret, 'Admin enrollment material must remain private');
      const step = Math.floor(Date.now() / 30_000);
      if (account.lastStep === step) await sleep(30_000 - Date.now() % 30_000 + 100);
      session = await json('/api/auth/2fa/verify', { code: await generate({ secret: account.secret }) }, session.token, 200);
      account.lastStep = Math.floor(Date.now() / 30_000);
      await retainAccounts();
    }
    assert.equal(session.next, 'authenticated');
    return session.token;
  }
  stage = 'real administrator login, password change and 2FA';
  const admin = await login(accounts.admin);
  for (const role of ['annotator', 'reviewer']) {
    if (accounts[role]) continue;
    const made = await json('/api/users', { real_name: `合成M3-${role}`, role: 'member',
      expire_at: '2099-12-31', quals: { resp: [role === 'annotator' ? 'annotate' : 'review'] } }, admin);
    accounts[role] = { id: made.id, username: made.username, password: made.initial_password };
    await retainAccounts();
  }
  const annotator = await login(accounts.annotator), reviewer = await login(accounts.reviewer);
  console.log('PASS actual admin password/2FA and member onboarding; credentials stay private');
  assert.equal((await request('/api/users', { token: annotator })).status, 403);
  assert.equal((await request('/api/audit', { token: annotator })).status, 403);
  assert.equal((await request('/api/cases/00000000-0000-4000-8000-000000000001')).status, 401);
  for (const route of ['/orthanc/system', '/minio/', '/api/instances', '/api/dicom']) {
    const response = await request(route, { token: annotator });
    assert(!String(response.headers['content-type']).includes('application/dicom'));
    assert(!response.bytes.includes(Buffer.from('DICM')));
    if (route.startsWith('/api/')) assert.equal(response.status, 404);
  }
  console.log('PASS member administration denials and guessed raw-image routes');

  const inputDir = path.join(instance, 'acceptance-inputs');
  await fs.mkdir(inputDir, { recursive: true, mode: 0o700 });
  const reuse = process.argv.includes('--reuse-imports');
  stage = 'generated DX and CT inputs';
  if (!reuse) execFileSync(process.env.MIAP_PYTHON || 'python3', [path.join(__dirname, 'generate-m3-synthetic.py'), inputDir], { stdio: 'pipe' });
  const cases = reuse ? JSON.parse(await fs.readFile(path.join(instance, 'acceptance-cases.json'), 'utf8')) : [];
  for (const modality of reuse ? [] : ['DX', 'CT']) {
    stage = `${modality} real ZIP deidentification and confirmation`;
    const boundary = 'miap-' + randomBytes(18).toString('hex');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nsynthetic\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${modality}.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      await fs.readFile(path.join(inputDir, modality + '.zip')), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await request('/api/cases/import', { token: admin, method: 'POST', body,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
    assert.equal(upload.status, 202, 'real ZIP upload');
    const batch = upload.json();
    let item;
    for (let attempt = 0; attempt < 300; attempt++) {
      const progress = await get(`/api/cases/import/${batch.batch_id}`, admin);
      item = progress.items[0];
      if (item?.status === 'awaiting_confirmation') break;
      assert.notEqual(item?.status, 'failed', 'real deidentification must succeed');
      await sleep(1000);
    }
    assert.equal(item?.status, 'awaiting_confirmation');
    assert(item.review.masked_count >= 1);
    assert(!item.review.masked_report.includes('张三'));
    const preview = await request(`/api/cases/import/${batch.batch_id}/items/${item.item_id}/preview`, { token: admin });
    assert.equal(preview.status, 200);
    assert.match(preview.headers['content-type'], /^image\/png/);
    const confirmed = await json(`/api/cases/import/${batch.batch_id}/items/${item.item_id}/confirm`, {
      confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断',
    }, admin);
    cases.push({ id: confirmed.case_id, modality });
    console.log(`PASS ${modality}: real ZIP, OCR/NER, safe preview and explicit confirmation`);
  }
  await fs.writeFile(path.join(instance, 'acceptance-cases.json'), JSON.stringify(cases), { mode: 0o600 });
  if (process.env.MIAP_PLAYWRIGHT_MODULE) {
    stage = 'deployed annotation and browser boundaries';
    for (const item of cases) {
      const detail = await get('/api/cases/' + item.id, admin);
      assert.equal(detail.source, 'synthetic');
      assert(['已录入', '待分配'].includes(detail.status));
    }
    const taskFile = path.join(instance, 'acceptance-task.json');
    const previous = await fs.readFile(taskFile, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    const task = previous && JSON.stringify(previous.case_ids) === JSON.stringify(cases.map(c => c.id)) ? previous : await json('/api/tasks', { name: '合成M3浏览器闭环', source: 'synthetic', system_code: 'resp',
      review_mode: 'peer', dispatch_mode: 'manual', priority: 0, case_ids: cases.map(c => c.id) }, admin);
    await fs.writeFile(taskFile, JSON.stringify({ id: task.id, case_ids: cases.map(c => c.id) }), { mode: 0o600 });
    await json('/api/tasks/dispatch', { mode: 'manual', task_id: task.id, case_ids: cases.map(c => c.id),
      assignee_id: accounts.annotator.id, task_role: 'annotate' }, admin);
    try {
      for (const item of cases) {
        const workbench = await get('/api/workbench/' + item.id, annotator);
        const series = workbench.series[0];
        const common = { series_id: series.id, frame_start: 0, frame_end: 0, key_frame_index: 0,
          window_preset: item.modality === 'CT' ? 'lung' : null,
          part_id: '11000000-0000-4000-8000-000000000003', sign_tag_ids: ['20000000-0000-4000-8000-000000000003'],
          confidence: 'typical', report_sent_ids: workbench.sentences.map(s => s.idx) };
        const annotations = [
          { tool: 'box', geometry: { x: 50, y: 50, w: 90, h: 90 } },
          { tool: 'point', geometry: { x: 240, y: 240 } },
          { tool: 'polygon', geometry: { points: [[280, 280], [320, 280], [300, 320]] } },
          { tool: 'brush', geometry: { width: 512, height: 512, rle: [0, 4, 262140] } },
        ].map(shape => ({ ...common, ...shape }));
        const before = await get(`/api/cases/${item.id}/annotations`, annotator);
        await json(`/api/cases/${item.id}/annotations`, { expected_version: before.current_version, annotations }, annotator, 200, 'PUT');
        item.version = before.current_version + 1;
        const ticket = await json('/api/frames/ticket', { case_id: item.id, series_uid: series.series_uid, frame_index: 0 }, annotator);
        assert.equal((await request(ticket.url)).status, 401);
        assert.equal((await request(ticket.url, { token: reviewer })).status, 403);
        const image = await request(ticket.url, { token: annotator });
        assert.equal(image.status, 200);
        assert.equal(image.headers['cache-control'], 'no-store, private');
        assert.match(image.headers['content-type'], /^image\/png/);
      }
      await require('./m3-deployed.browser.cjs')({ base, ca, account: accounts.annotator, cases,
        artifacts: process.env.MIAP_M3_ARTIFACT_DIR || path.resolve(__dirname, '../../reports/wp17-local') });
    } finally {
      const queue = await get('/api/tasks/mine?task_role=annotate', annotator);
      for (const item of queue.items.filter(item => cases.some(c => c.id === item.case_id))) {
        await json('/api/tasks/reclaim', { assignment_id: item.assignment_id, reason: 'quality' }, admin);
      }
    }
  }
  stage = 'case diagnosis required for real review/publication';
  for (const item of cases) {
    const detail = await get('/api/cases/' + item.id, admin);
    assert(detail.disease_tag_id, 'D-45: actual imported case needs an authorized diagnosis write path; never seed this by SQL');
  }
  console.log('PASS deployed import preparation');
}

main().catch(error => {
  // Never print response bodies, login challenges, request URLs containing tickets,
  // private environment or browser/worker logs. Only the safe stage and source line.
  const line = String(error.stack || '').split('\n').find(value => value.includes('m3-deployed.'));
  console.error('FAIL stage:', stage, '; code:', error.code || error.name, '; status:', typeof error.actual === 'number' ? error.actual : 'n/a', ';', line?.trim() || 'no source line');
  if (String(error.message).startsWith('browserType.')) console.error(String(error.message).split('\n')[0].slice(0, 240));
  process.exitCode = 1;
});
