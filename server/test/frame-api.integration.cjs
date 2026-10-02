// Public HTTP + real PostgreSQL/Redis; upstream renderer is synthetic and observed.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: process.env.MIAP_ENV_FILE ?? path.resolve(__dirname, '../../.env.local'), quiet: true });
if (!process.env.POSTGRES_DB?.includes('synthetic')) throw new Error('Requires a synthetic database');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.FRAME_TOKEN_SECRET = randomBytes(32).toString('hex');
// Fixture-only budgets, never deployment defaults.
process.env.FRAME_RATE_WINDOW_SECONDS = '60';
for (const m of ['CR','DX','US']) process.env[`FRAME_RATE_${m}`] = '50';
for (const m of ['CT','MR']) process.env[`FRAME_RATE_${m}`] = '100';
require('reflect-metadata');
const sharp = require('sharp');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const { createClient } = require('redis');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { WorkbenchModule } = require('../dist/modules/workbench/workbench.module');
const { AnnotationsModule } = require('../dist/modules/annotations/annotations.module');
const { ReviewsModule } = require('../dist/modules/reviews/reviews.module');
const { CasesLifecycleModule } = require('../dist/modules/cases/cases-lifecycle.module');
const { TasksModule } = require('../dist/modules/tasks/tasks.module');
const { TaskMaintenanceService } = require('../dist/modules/tasks/task-maintenance.service');
const { FramesModule } = require('../dist/modules/frames/frames.module');
const { FrameRateService } = require('../dist/modules/frames/frame-rate.service');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { AttachmentObjectService } = require('../dist/modules/cases/attachment-object.service');
const { OrthancService } = require('../dist/modules/cases/orthanc.service');
const { UsersService } = require('../dist/modules/users/users.service');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { DATABASE_SOURCE } = require('../dist/modules/database/database.tokens');
const { REDIS_CLIENT } = require('../dist/modules/redis/redis.module');
const { ApiExceptionFilter } = require('../dist/common/api-exception.filter');
const connection = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB };
const schema = `frame_api_${randomBytes(8).toString('hex')}`;
(async () => {
  const admin = new Client(connection), keys = new Set();
  const redis = createClient({ socket: { host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379), reconnectStrategy: false }, password: process.env.REDIS_PASSWORD });
  redis.on('error', () => {});
  let db, app, renderHook, renders = 0;
  const raw = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#808080' } }).png().toBuffer();
  const upstream = {
    resolveSeriesFrame: async () => ({ instance_id: '11111111-22222222-33333333-44444444-55555555', frame_index: 0 }),
    frameGeometry: async () => ({width:640,height:480,row_spacing:1,column_spacing:1}),
    renderInstanceFrame: async () => { renders++; if (renderHook) await renderHook(); return raw; },
  };
  const instrumented = {
    withTypeMapping: redis.withTypeMapping.bind(redis),
    set: (key, ...args) => { keys.add(key); return redis.set(key, ...args); },
    eval: (script, options) => { options.keys.forEach(key => keys.add(key)); return redis.eval(script, options); },
  };
  await admin.connect();
  try {
    await redis.connect(); await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({ type: 'postgres', host: connection.host, port: connection.port, username: connection.user, password: connection.password,
      database: connection.database, schema, extra: { options: `-c search_path=${schema}` }, synchronize: false, logging: false,
      migrations: [path.resolve(__dirname, '../dist/database/migrations/*.js')] });
    await db.initialize(); await db.runMigrations();
    // The new version migration must round-trip before any annotation saves exist.
    await db.undoLastMigration(); await db.runMigrations();
    // Supply globals explicitly for this isolated Nest module graph.
    const { Global, Module } = require('@nestjs/common');
    class FixturesModule {}
    Global()(FixturesModule);
    Module({ providers: [AuditService, { provide: DATABASE_SOURCE, useValue: db }, { provide: REDIS_CLIENT, useValue: instrumented }], exports: [DATABASE_SOURCE, REDIS_CLIENT, AuditService] })(FixturesModule);
    const module = await Test.createTestingModule({ imports: [FixturesModule, FramesModule, WorkbenchModule, AnnotationsModule, TasksModule, ReviewsModule, CasesLifecycleModule] }).overrideProvider(TaskMaintenanceService).useValue({}).overrideProvider(OrthancService).useValue(upstream).overrideProvider(AttachmentObjectService).useValue({pageCount:async()=>2,readPng:async()=>raw}).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const fresh = async id => (await db.query('SELECT *,expire_at::text FROM users WHERE id=$1', [id]))[0];
    const makeUser = async role => (await db.query(`INSERT INTO users(username,password_hash,real_name,role,status,expire_at,must_change_password,mfa_secret_encrypted,quals)
      VALUES($1,'synthetic-unused','合成帧验证',$2,'active','2099-12-31',false,$3,'{"resp":["annotate","review"]}') RETURNING *,expire_at::text`, [randomUUID(), role, role === 'admin' ? 'synthetic-mfa' : null]))[0];
    const actor = await makeUser('member'), other = await makeUser('member'), administrator = await makeUser('admin');
    const sign = user => app.get(AuthTokenService).signAccess(user);
    const token = sign(actor), otherToken = sign(other), adminToken = sign(administrator);
    const caseId = randomUUID(), studyId = randomUUID(), seriesId = randomUUID(), taskId = randomUUID(), uid = `2.25.${BigInt('0x' + randomBytes(12).toString('hex'))}`;
    await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method) VALUES($1,$2,'标注中','synthetic','resp','临床综合诊断')", [caseId, randomUUID()]);
    await db.query("INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,'2026-09-30')", [studyId, caseId, uid+'.1']);
    await db.query("INSERT INTO series(id,study_id,modality,series_uid,orthanc_id,frame_count) VALUES($1,$2,'DX',$3,$4,1)", [seriesId, studyId, uid, '11111111-22222222-33333333-44444444-55555555']);
    await db.query("INSERT INTO tasks(id,name,source,system_code,review_mode,status,dispatch_mode,priority) VALUES($1,'合成帧任务','synthetic','resp','peer','进行中','manual',0)", [taskId]);
    await db.query('INSERT INTO task_cases(task_id,case_id) VALUES($1,$2)', [taskId, caseId]);
    const assign = async () => db.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,state) VALUES($1,$2,'annotate','active') RETURNING id", [caseId, actor.id]);
    let [assignment] = await assign();
    const payload = { case_id: caseId, series_uid: uid, frame_index: 0 };
    const issue = (body = payload, auth = token) => fetch(`${base}/api/frames/ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
    const get = (url, auth = token) => fetch(`${base}${url}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    await require('./workbench.assertions.cjs')({ db, get, caseId, actor, assignment, taskId, seriesId, studyId, otherToken, adminToken });
    await require('./annotations.assertions.cjs')({ db, base, get, caseId, actor, assignment, taskId, seriesId, token, otherToken, adminToken });
    await require('./submission.assertions.cjs')({db,base,get,actor,other,token,otherToken,adminToken,administrator});
    await require('./reviews.assertions.cjs')({db,app,base,get,actor,other,token,otherToken,adminToken});
    const ticket = async (auth = token) => { const response = await issue(payload, auth); assert.equal(response.status, 201); return response.json(); };
    assert.equal((await issue(payload, '')).status, 401);
    assert.equal((await issue(payload, otherToken)).status, 403);
    assert.equal((await issue(payload, adminToken)).status, 403); // No admin bypass.
    for (const change of [{ case_id: randomUUID() }, { frame_index: 1 }, { series_uid: '2.25.999' }]) assert.equal((await issue({ ...payload, ...change })).status, 403);
    for (const change of [{ frame_index: -1 }, { window: { center: 0, width: 0 } }, { orthanc_id: 'x' }, { window: { center: 0, width: 1, extra: true } }]) assert.equal((await issue({ ...payload, ...change })).status, 400);
    const issued = await ticket(); assert.equal(issued.expires_in, 300); assert(!issued.url.includes('11111111'));
    assert.equal((await get(issued.url, '')).status, 401);
    assert.equal((await get(issued.url, otherToken)).status, 403);
    assert.equal((await get(issued.url+'?frame_index=1')).status, 400);
    assert.equal((await get(issued.url.slice(0,-1)+'!')).status, 403);
    // Same user with another bearer/session cannot consume the old URL.
    const claims = app.get(AuthTokenService).verify(token, ['access']);
    const another = new JwtService({ secret: process.env.JWT_SECRET }).sign({ ...claims, iat: claims.iat-1 });
    assert.equal((await get(issued.url, another)).status, 403);
    const jwt = new JwtService({ secret: process.env.FRAME_TOKEN_SECRET });
    const bound = jwt.decode(issued.url.split('/').pop());
    const past = jwt.sign({ ...bound, iat: Math.floor(Date.now()/1000)-301, exp: Math.floor(Date.now()/1000)-1 });
    assert.equal((await get('/api/frames/'+past)).status, 403);
    let response = await get(issued.url); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/); assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const first = Buffer.from(await response.arrayBuffer()); assert.notDeepEqual(await sharp(first).raw().toBuffer(), await sharp(raw).raw().toBuffer());
    response = await get(issued.url); assert.equal(response.status, 200); assert.equal(renders, 1);
    const second = Buffer.from(await response.arrayBuffer()); assert.notDeepEqual(first, second); // response-time watermark, even on cached bytes
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='frames.viewed'"))[0].n, 2);
    await db.query(`CREATE FUNCTION fail_frame_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='frames.viewed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query('CREATE TRIGGER fail_frame BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_frame_audit()');
    response = await get(issued.url); assert.equal(response.status, 500); assert(!response.headers.get('content-type').includes('image'));
    await db.query('DROP TRIGGER fail_frame ON audit_logs');
    // Current assignment, expiry, source ownership and live qualifications are checked on cached reads.
    for (const [sql, args, restore] of [
      ["UPDATE task_assignments SET state='released' WHERE id=$1", [assignment.id], "UPDATE task_assignments SET state='active' WHERE id=$1"],
      ["UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [assignment.id], 'UPDATE task_assignments SET due_at=NULL WHERE id=$1'],
      ["UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1", [caseId], "UPDATE cases SET source='synthetic' WHERE id=$1"],
      ["UPDATE users SET quals='{}' WHERE id=$1", [actor.id], `UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE id=$1`],
    ]) { await db.query(sql,args); assert.equal((await get(issued.url)).status,403); await db.query(restore,args); }
    assert.equal(renders, 1);
    // Revocation during upstream rendering must be caught before writing bytes.
    for (const key of keys) if (key.startsWith('frames:render:')) await redis.del(key);
    renderHook = () => db.query("UPDATE task_assignments SET state='released' WHERE id=$1", [assignment.id]);
    assert.equal((await get(issued.url)).status, 403); renderHook = undefined;
    await db.query("UPDATE task_assignments SET state='active' WHERE id=$1", [assignment.id]);
    const originalEval = instrumented.eval;
    instrumented.eval = async () => { throw new Error('synthetic Redis failure'); };
    response = await get(issued.url); assert.equal(response.status, 503); instrumented.eval = originalEval;
    delete process.env.FRAME_RATE_WINDOW_SECONDS;
    assert.equal((await issue()).status, 503); assert.equal((await get(issued.url)).status, 503);
    process.env.FRAME_RATE_WINDOW_SECONDS = '60';
    // Exact threshold and concurrent excess commit only one lock audit and one release.
    await db.query("UPDATE users SET updated_at=updated_at+interval '1 second' WHERE id=$1", [actor.id]);
    let current = await fresh(actor.id), currentToken = sign(current);
    process.env.FRAME_RATE_DX = '2';
    const limited = await ticket(currentToken);
    assert.equal((await get(limited.url,currentToken)).status, 200);
    assert.equal((await get(limited.url,currentToken)).status, 200);
    await db.query(`CREATE FUNCTION fail_lock_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='frames.locked' THEN RAISE EXCEPTION 'synthetic lock failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query('CREATE TRIGGER fail_lock BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_lock_audit()');
    assert.equal((await get(limited.url,currentToken)).status,500);
    assert.equal((await fresh(actor.id)).status,'active');
    assert.equal((await db.query('SELECT state FROM task_assignments WHERE id=$1',[assignment.id]))[0].state,'active');
    await db.query('DROP TRIGGER fail_lock ON audit_logs');
    const race = await Promise.all([get(limited.url,currentToken), get(limited.url,currentToken)]);
    assert.deepEqual(race.map(r=>r.status).sort(), [403,429]);
    assert.equal((await fresh(actor.id)).status,'disabled');
    assert.equal((await db.query('SELECT state FROM task_assignments WHERE id=$1',[assignment.id]))[0].state,'released');
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='frames.locked'"))[0].n,1);
    const lockedVersion = (await fresh(actor.id)).updated_at.getTime();
    await new UsersService(db).update(await fresh(administrator.id), { id: actor.id, status: 'active' }, '127.0.0.1');
    current = await fresh(actor.id); assert.notEqual(current.updated_at.getTime(),lockedVersion);
    assert.equal((await issue(payload,currentToken)).status,401);
    currentToken = sign(current);
    assert.equal((await issue(payload,currentToken)).status,403); // Unlock does not revive old assignment.
    await db.query("UPDATE cases SET status='标注中' WHERE id=$1",[caseId]); [assignment] = await assign();
    const unlocked = await ticket(currentToken); assert.equal((await get(unlocked.url,currentToken)).status,200);
    assert.equal((await get(limited.url,currentToken)).status,403);
    assert.equal((await issue(payload,currentToken)).status,201);
    assert.equal((await issue(payload,currentToken)).status,429); // Ticket flood also locks, even without fetching pixels.
    // Redis TTL and concurrent fixed-window counting are real, not mocked.
    const standalone = new FrameRateService(instrumented);
    const unique = randomUUID();
    const admissions = await Promise.all(Array.from({ length: 8 }, () => standalone.allow(unique,caseId,new Date(0),'DX','ticket')));
    assert.equal(admissions.filter(Boolean).length,2);
    for (const key of keys) { const ttl = await redis.ttl(key); assert(ttl === -2 || ttl > 0); }
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE detail::text LIKE '%Bearer%' OR detail::text LIKE '%session_digest%'"))[0].n,0);
    console.log('PASS: public frame HTTP/session/assignment boundaries, post-render revocation, real Redis atomic quotas, lock/unlock and assignment release, cache-hit watermark/audit, fail-closed configuration/Redis/audit, no raw output');
  } finally {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (redis.isReady && keys.size) await redis.del([...keys]);
    if (redis.isOpen) redis.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
})().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
