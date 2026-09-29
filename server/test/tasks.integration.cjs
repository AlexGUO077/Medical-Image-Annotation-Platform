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
const { TaskDispatchService } = require('../dist/modules/tasks/task-dispatch.service');
const { PermissionService } = require('../dist/modules/auth/permission.service');
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
      controllers: [TasksController], providers: [TasksService, TaskDispatchService, PermissionService, AccessTokenGuard, AdminGuard, AuthTokenService,
        { provide: DATABASE_SOURCE, useValue: db }],
    }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const users = [];
    for (const role of ['admin', 'member', 'admin']) {
      const id = randomUUID();
      const [user] = await db.query(`INSERT INTO users (id, username, password_hash, real_name, role, status, expire_at, must_change_password, mfa_secret_encrypted)
        VALUES ($1,$2,'synthetic-unused','合成验证',$3,'active','2099-12-31',false,'synthetic-mfa') RETURNING *, expire_at::text`, [id, `wp06-${id}`, role]);
      users.push(user);
    }
    const token = app.get(AuthTokenService).signAccess(users[0]);
    const memberToken = app.get(AuthTokenService).signAccess(users[1]);
    const otherAdminToken = app.get(AuthTokenService).signAccess(users[2]);
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
    const get = (suffix, auth = token) => fetch(`${base}/api/tasks${suffix}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    for (const suffix of ['', '/eligible-cases?source=synthetic&system_code=resp', `/${created.id}/cases`]) {
      assert.equal((await get(suffix, '')).status, 401);
      assert.equal((await get(suffix, memberToken)).status, 403);
    }
    for (const suffix of ['?page=0', '?pageSize=101', '?page=1.5', '?page=9007199254740991', '?source=unknown',
      '?source=synthetic&source=teacher_provided_teaching', '/eligible-cases', '/eligible-cases?source=synthetic&system_code=unknown', '/invalid/cases']) {
      assert.equal((await get(suffix)).status, 400, suffix);
    }
    assert.equal((await get(`/${randomUUID()}/cases`)).status, 404);
    const taskResponse = await get('?pageSize=1&source=synthetic&system_code=resp');
    assert.equal(taskResponse.headers.get('cache-control'), 'no-store, private');
    const listed = await taskResponse.json(); assert.equal(listed.items.length, 1); assert.equal(listed.total, (await totals()).tasks);
    assert.deepEqual(Object.keys(listed.items[0]).sort(), ['id','name','source','system_code','review_mode','priority','in_flight_limit','status','created_at','case_count'].sort());
    const contents = await (await get(`/${created.id}/cases?pageSize=1`)).json();
    const contents2 = await (await get(`/${created.id}/cases?pageSize=1&page=2`)).json();
    assert.equal(contents.total, 2); assert.equal(contents.items.length, 1); assert.equal(contents2.items.length, 1);
    assert.deepEqual([contents.items[0].id, contents2.items[0].id].sort(), cases);
    const hidden = [await makeCase({ confirmed: false }), await makeCase({ deleted: true }), await makeCase({ source: 'teacher_provided_teaching' }), await makeCase({ system: 'bone' })];
    const eligibleResponse = await get('/eligible-cases?source=synthetic&system_code=resp&pageSize=100');
    assert.equal(eligibleResponse.headers.get('cache-control'), 'no-store, private');
    const eligible = await eligibleResponse.json();
    assert(eligible.items.some(c => c.id === rollbackCase));
    assert(!eligible.items.some(c => [...cases, ...hidden, concurrent].includes(c.id)));
    assert(eligible.items.every(c => c.source === 'synthetic' && c.system_code === 'resp' && c.status === '已录入'));
    assert.deepEqual(Object.keys(eligible.items[0]).sort(), ['id','case_no','source','system_code','status'].sort());
    const page1 = await (await get('/eligible-cases?source=synthetic&system_code=resp&pageSize=1')).json();
    const page2 = await (await get('/eligible-cases?source=synthetic&system_code=resp&pageSize=1&page=2')).json();
    assert.equal(page1.total, page2.total); assert.notEqual(page1.items[0].id, page2.items[0].id);
    // A stale candidate selected by another admin must still fail the write-time check.
    assert.equal((await req(body([rollbackCase]))).status, 201);
    assert.equal((await req(body([rollbackCase]))).status, 409);
    await db.query('UPDATE tasks SET deleted_at=now() WHERE id=$1', [created.id]);
    assert.equal((await get(`/${created.id}/cases`)).status, 404);
    assert(!(await (await get('')).json()).items.some(t => t.id === created.id));
    await db.query('UPDATE tasks SET deleted_at=NULL WHERE id=$1', [created.id]);
    const longNameCase = await makeCase();
    assert.equal((await req({ ...body([longNameCase]), name: '名'.repeat(201) })).status, 400);
    assert.equal((await req({ ...body([longNameCase]), name: '名'.repeat(200) })).status, 201);
    const largeBatch = Array.from({ length: 2000 }, () => randomUUID());
    assert.equal((await req(body([...largeBatch, randomUUID()]))).status, 400);
    await db.query(`INSERT INTO cases (id, case_no, status, source, system_code, confirm_method)
      SELECT id, 'SYN-' || id::text, '已录入', 'synthetic', 'resp', '临床综合诊断' FROM unnest($1::uuid[]) AS id`, [largeBatch]);
    await db.query(`INSERT INTO audit_logs (actor, action, target, detail, ip)
      SELECT $1, 'case_manual.confirmed', 'cases:' || id::text, '{}', '127.0.0.1' FROM unnest($2::uuid[]) AS id`, [users[0].id, largeBatch]);
    const batchResult = await req(body(largeBatch)); assert.equal(batchResult.status, 201);
    const largeTask = await batchResult.json(); assert.equal(largeTask.case_ids.length, 2000);
    const batchAudit = (await db.query("SELECT detail FROM audit_logs WHERE target=$1 AND action='tasks.created'", [`tasks:${largeTask.id}`]))[0];
    assert.equal(batchAudit.detail.case_ids.length, 2000);
    const call = (route, payload, auth = token, method = 'POST') => fetch(`${base}/api/tasks${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(payload) });
    const dispatchBody = (task, ids, extra = {}) => ({ mode: 'manual', task_id: task.id, assignee_id: users[1].id, case_ids: ids, ...extra });
    const dispatchCases = await Promise.all(Array.from({ length: 3 }, () => makeCase()));
    const dispatchTask = await (await req(body(dispatchCases))).json();
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[0]]), memberToken)).status, 403);
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[0]]))).status, 403);
    await db.query(`UPDATE users SET quals='{"resp":["annotate"]}' WHERE id=$1`, [users[1].id]);
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [cases[0]]))).status, 409);
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [randomUUID()]))).status, 404);
    for (const change of [{ status: 'disabled' }, { expire_at: '2000-01-01' }, { must_change_password: true }]) {
      const [key, value] = Object.entries(change)[0];
      await db.query(`UPDATE users SET "${key}"=$2 WHERE id=$1`, [users[1].id, value]);
      assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[0]]))).status, 403);
      await db.query(`UPDATE users SET "${key}"=$2 WHERE id=$1`, [users[1].id, users[1][key]]);
    }
    const settingsPath = `/${dispatchTask.id}/settings`, limitPath = `/assignees/${users[1].id}/limit`;
    assert.equal((await call(settingsPath, { priority: 3 }, memberToken, 'PATCH')).status, 403);
    assert.equal((await call(limitPath, { in_flight_limit: 1 }, memberToken, 'PATCH')).status, 403);
    for (const invalid of [0, -1, 1.5, 2147483648, '1']) {
      assert.equal((await call(settingsPath, { in_flight_limit: invalid }, token, 'PATCH')).status, 400);
    }
    assert.equal((await call(settingsPath, { priority: 3, in_flight_limit: 1 }, token, 'PATCH')).status, 200);
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, dispatchCases.slice(0, 2)))).status, 409);
    assert.equal((await db.query('SELECT count(*)::int n FROM task_assignments'))[0].n, 0);
    assert.equal((await call(settingsPath, { in_flight_limit: null }, token, 'PATCH')).status, 200);
    assert.equal((await call(limitPath, { in_flight_limit: 1 }, token, 'PATCH')).status, 200);
    const anotherCase = await makeCase(), anotherTask = await (await req(body([anotherCase]))).json();
    const concurrentDispatch = await Promise.all([
      call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[0]])), call('/dispatch', dispatchBody(anotherTask, [anotherCase]), otherAdminToken),
    ]);
    assert.deepEqual(concurrentDispatch.map(r => r.status).sort(), [201, 409]);
    assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE state='active'"))[0].n, 1);
    const [activeAssignment] = await db.query("SELECT * FROM task_assignments WHERE state='active'");
    assert.equal(activeAssignment.due_at, null);
    const permissionUser = { ...users[1], quals: { resp: ['annotate'] } };
    await app.get(PermissionService).assertCaseAssignment(permissionUser, activeAssignment.case_id, 'resp', 'annotate');
    await db.query("UPDATE task_assignments SET state='released' WHERE id=$1", [activeAssignment.id]);
    await assert.rejects(app.get(PermissionService).assertCaseAssignment(permissionUser, activeAssignment.case_id, 'resp', 'annotate'));
    await db.query("UPDATE task_assignments SET state='active', due_at='2000-01-01' WHERE id=$1", [activeAssignment.id]);
    await assert.rejects(app.get(PermissionService).assertCaseAssignment(permissionUser, activeAssignment.case_id, 'resp', 'annotate'));
    await db.query('UPDATE task_assignments SET due_at=NULL WHERE id=$1', [activeAssignment.id]);
    await assert.rejects(db.query(`INSERT INTO task_assignments (case_id,assignee_id,task_role,state)
      VALUES ($1,$2,'annotate','active')`, [activeAssignment.case_id, users[1].id]), e => e.code === '23505');
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[1]], { due_at: '2000-01-01T00:00:00Z' }))).status, 400);
    assert.equal((await call(limitPath, { in_flight_limit: null }, token, 'PATCH')).status, 200);
    await db.query(`CREATE FUNCTION fail_dispatch_audit() RETURNS trigger AS $$ BEGIN
      IF NEW.action='tasks.dispatched' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query('CREATE TRIGGER fail_dispatch BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_dispatch_audit()');
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[1]]))).status, 500);
    assert.equal((await db.query('SELECT status FROM cases WHERE id=$1', [dispatchCases[1]]))[0].status, '待分配');
    assert.equal((await db.query('SELECT count(*)::int n FROM task_assignments WHERE case_id=$1', [dispatchCases[1]]))[0].n, 0);
    await db.query('DROP TRIGGER fail_dispatch ON audit_logs');
    assert.equal((await call('/dispatch', dispatchBody(dispatchTask, [dispatchCases[1]], { due_at: '2099-12-31T00:00:00Z' }))).status, 201);
    const selfCase = await makeCase(); const selfTask = await (await req({ ...body([selfCase]), review_mode: 'self' })).json();
    assert.equal((await call('/dispatch', dispatchBody(selfTask, [selfCase]))).status, 403);
    // Explicitly configured limits must not disappear on migration rollback.
    await call(settingsPath, { in_flight_limit: 1 }, token, 'PATCH');
    await assert.rejects(db.undoLastMigration(), /Clear configured capacity limits/);
    await call(settingsPath, { in_flight_limit: null }, token, 'PATCH');
    await db.query('DELETE FROM task_assignments');
    await db.undoLastMigration();
    // Unset deadlines remain NULL; rollback must fail without silently filling or deleting them.
    const [assignment] = await db.query(`INSERT INTO task_assignments (case_id, assignee_id, task_role, state)
      VALUES ($1,$2,'annotate','active') RETURNING id, due_at`, [cases[0], users[1].id]);
    assert.equal(assignment.due_at, null);
    await assert.rejects(db.undoLastMigration(), e => e.code === '23502');
    assert.equal((await db.query('SELECT due_at FROM task_assignments WHERE id=$1', [assignment.id]))[0].due_at, null);
    await db.query("UPDATE task_assignments SET due_at='2099-12-31T00:00:00Z' WHERE id=$1", [assignment.id]);
    await db.undoLastMigration();
    await assert.rejects(db.query('UPDATE task_assignments SET due_at=NULL WHERE id=$1', [assignment.id]), e => e.code === '23502');
    await db.runMigrations();
    assert.equal((await db.query('SELECT due_at FROM task_assignments WHERE id=$1', [assignment.id]))[0].due_at.toISOString(), '2099-12-31T00:00:00.000Z');
    await db.query('UPDATE task_assignments SET due_at=NULL WHERE id=$1', [assignment.id]);
    await db.query('DELETE FROM task_assignments WHERE id=$1', [assignment.id]);
    await db.undoLastMigration();
    await db.undoLastMigration();
    await db.undoLastMigration();
    assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='task_cases_case_active_uq'`, [schema])).length, 0);
    await db.runMigrations();
    assert.equal((await db.query(`SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='task_cases_case_active_uq'`, [schema])).length, 1);
    console.log('PASS: task HTTP authorization, input isolation, deidentification gate, atomic state/audit, manual dispatch and settings, cross-admin/global-capacity concurrency, inactive/expired assignment denial, unique indices and safe migration rollback, paginated admin reads, 200/2000 input boundaries');
  } finally {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
