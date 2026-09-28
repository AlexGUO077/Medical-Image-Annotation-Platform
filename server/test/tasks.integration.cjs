// Real HTTP/auth/PostgreSQL; all fixtures and migrations live in a disposable schema.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: process.env.MIAP_ENV_FILE ?? path.resolve(__dirname, '../../.env.local'), quiet: true });
if (!process.env.POSTGRES_DB?.includes('synthetic')) throw new Error('Requires a synthetic test database');
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const { Test } = require('@nestjs/testing');
const { JwtModule } = require('@nestjs/jwt');
const { TasksService } = require('../dist/modules/tasks/tasks.service');
const { TasksController } = require('../dist/modules/tasks/tasks.controller');
const { AccessTokenGuard } = require('../dist/modules/auth/access-token.guard');
const { AdminGuard } = require('../dist/modules/auth/admin.guard');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { DATABASE_SOURCE } = require('../dist/modules/database/database.tokens');
const { ApiExceptionFilter } = require('../dist/common/api-exception.filter');
const connection = { host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB };
const schema = `wp06_test_${randomBytes(8).toString('hex')}`;
(async () => {
  const admin = new Client(connection);
  let db, app;
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({ type: 'postgres', host: connection.host, port: connection.port, username: connection.user,
      password: connection.password, database: connection.database, schema,
      extra: { options: `-c search_path=${schema}` }, synchronize: false, logging: false,
      migrations: [path.resolve(__dirname, '../dist/database/migrations/*.js')] });
    await db.initialize(); await db.runMigrations();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: randomBytes(32).toString('hex') })],
      controllers: [TasksController], providers: [TasksService, AccessTokenGuard, AdminGuard, AuthTokenService,
        { provide: DATABASE_SOURCE, useValue: db }],
    }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const users = [];
    for (const role of ['admin', 'member']) {
      const id = randomUUID();
      const [user] = await db.query(`INSERT INTO users (id, username, password_hash, real_name, role, status, expire_at, must_change_password, mfa_secret_encrypted)
        VALUES ($1,$2,'synthetic-unused','合成验证',$3,'active','2099-12-31',false,'synthetic-mfa') RETURNING *, expire_at::text`, [id, `wp06-${id}`, role]);
      users.push(user);
    }
    const token = app.get(AuthTokenService).signAccess(users[0]);
    const memberToken = app.get(AuthTokenService).signAccess(users[1]);
    const makeCase = async ({ source = 'synthetic', system = 'resp', status = '已录入', confirmed = true, deleted = false, action = 'case_import.deidentification_confirmed' } = {}) => {
      const id = randomUUID();
      await db.query(`INSERT INTO cases (id, case_no, status, source, system_code, confirm_method, deleted_at)
        VALUES ($1,$2,$3,$4,$5,'临床综合诊断',$6)`, [id, `SYN-${id}`, status, source, system, deleted ? new Date() : null]);
      if (confirmed) await db.query(`INSERT INTO audit_logs (actor, action, target, detail, ip) VALUES ($1,$2,$3,'{}','127.0.0.1')`, [users[0].id, action, `cases:${id}`]);
      return id;
    };
    const body = (ids) => ({ name: '合成任务', source: 'synthetic', system_code: 'resp', review_mode: 'peer', priority: 0, case_ids: ids });
    const req = (payload, auth = token) => fetch(`${base}/api/tasks`, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    }, body: JSON.stringify(payload) });
    const totals = async () => (await db.query(`SELECT (SELECT count(*)::int FROM tasks) tasks, (SELECT count(*)::int FROM task_cases) links,
      (SELECT count(*)::int FROM audit_logs WHERE action='tasks.created') audits`))[0];
    assert.equal((await req(body([randomUUID()]), '')).status, 401);
    assert.equal((await req(body([randomUUID()]), memberToken)).status, 403);
    for (const change of [{ status: 'disabled' }, { expire_at: '2000-01-01' }, { mfa_secret_encrypted: null }, { must_change_password: true }]) {
      const [key, value] = Object.entries(change)[0];
      await db.query(`UPDATE users SET "${key}"=$2 WHERE id=$1`, [users[0].id, value]);
      assert.equal((await req(body([randomUUID()]))).status, 403);
      await db.query(`UPDATE users SET "${key}"=$2 WHERE id=$1`, [users[0].id, users[0][key]]);
    }
    await db.query(`UPDATE users SET updated_at=updated_at + interval '1 second' WHERE id=$1`, [users[0].id]);
    assert.equal((await req(body([randomUUID()]))).status, 401);
    await assert.rejects(app.get(TasksService).create(users[0], body([randomUUID()]), '127.0.0.1'), /会话已失效/);
    await db.query('UPDATE users SET updated_at=$2 WHERE id=$1', [users[0].id, users[0].updated_at]);
    const cases = [await makeCase(), await makeCase({ action: 'case_manual.confirmed' })];
    const response = await req(body(cases)); assert.equal(response.status, 201);
    const created = await response.json(); assert.equal(created.status, '进行中'); assert.deepEqual(created.case_ids, cases.sort());
    assert.deepEqual(await totals(), { tasks: 1, links: 2, audits: 1 });
    assert.equal((await db.query('SELECT status FROM cases WHERE id=ANY($1::uuid[])', [cases])).every(c => c.status === '待分配'), true);
    assert.equal((await req(body(cases))).status, 409);
    for (const fixture of [{ source: 'teacher_provided_teaching' }, { system: 'bone' }, { status: '标注中' },
      { status: '待审核' }, { status: '审核中' }, { status: '已发布' }, { status: '已下线' }, { confirmed: false }, { deleted: true }]) {
      const good = await makeCase(); const bad = await makeCase(fixture); const before = await totals();
      assert.equal((await req(body([good, bad]))).status, fixture.deleted ? 404 : 409);
      assert.deepEqual(await totals(), before);
      assert.equal((await db.query('SELECT status FROM cases WHERE id=$1', [good]))[0].status, '已录入');
    }
    assert.equal((await req(body([randomUUID()]))).status, 404);
    // No hidden default max of 5/10: creating a task is independent of assignment capacity.
    const many = await Promise.all(Array.from({ length: 12 }, () => makeCase()));
    assert.equal((await req(body(many))).status, 201);
    const concurrent = await makeCase(); const beforeRace = await totals();
    const race = await Promise.all([req(body([concurrent])), req(body([concurrent]))]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
    const afterRace = await totals();
    assert.equal(afterRace.tasks, beforeRace.tasks + 1); assert.equal(afterRace.links, beforeRace.links + 1);
    assert.equal(afterRace.audits, beforeRace.audits + 1);
    // The database also prevents direct insertion of a second active association.
    await assert.rejects(db.query('INSERT INTO task_cases (task_id, case_id) VALUES ($1,$2)', [created.id, concurrent]), e => e.code === '23505');
    // Inject an audit failure in this disposable schema: no partial task/state may survive.
    await db.query(`CREATE FUNCTION fail_task_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='tasks.created' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER fail_task_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_task_audit()`);
    const rollbackCase = await makeCase(); const beforeFailure = await totals();
    assert.equal((await req(body([rollbackCase]))).status, 500);
    assert.deepEqual(await totals(), beforeFailure);
    assert.equal((await db.query('SELECT status FROM cases WHERE id=$1', [rollbackCase]))[0].status, '已录入');
    await db.query('DROP TRIGGER fail_task_audit ON audit_logs'); await db.query('DROP FUNCTION fail_task_audit()');
    await db.undoLastMigration();
    assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='task_cases_case_active_uq'`, [schema])).length, 0);
    await db.runMigrations();
    assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='task_cases_case_active_uq'`, [schema])).length, 1);
    console.log('PASS: task HTTP authorization, input isolation, deidentification gate, atomic state/audit, concurrency, unique index and migration rollback');
  } finally {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
