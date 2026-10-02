const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { TaskMaintenanceService } = require('../dist/modules/tasks/task-maintenance.service');
const { TaskDispatchService } = require('../dist/modules/tasks/task-dispatch.service');
const { PermissionService } = require('../dist/modules/auth/permission.service');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { UsersService } = require('../dist/modules/users/users.service');
module.exports = async ({ db, app, base, token, users, makeCase, body, req, call }) => {
  await db.query("UPDATE tasks SET dispatch_mode='manual'");
  await db.query("UPDATE task_assignments SET state='released' WHERE state='active'");
  const fresh = async id => (await db.query('SELECT *,expire_at::text FROM users WHERE id=$1', [id]))[0];
  const [member] = await db.query(`INSERT INTO users (username,password_hash,real_name,role,status,expire_at,must_change_password,quals)
    VALUES ($1,'synthetic-unused','合成维护验证','member','active','2099-12-31',false,'{"resp":["annotate","review"],"bone":["annotate"]}') RETURNING *,expire_at::text`, [`maintenance-${randomUUID()}`]);
  const patch = payload => fetch(`${base}/api/users`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const assignment = async (reviewMode = 'peer', system = 'resp', assignee = member.id) => {
    const id = await makeCase({ system });
    const response = await req({ ...body([id]), review_mode: reviewMode, system_code: system }); assert.equal(response.status, 201);
    const task = await response.json();
    const sent = await call('/dispatch', { mode: 'manual', task_id: task.id, case_ids: [id], assignee_id: assignee }); assert.equal(sent.status, 201);
    const [a] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [id]);
    return { id, task, a };
  };
  const state = async item => (await db.query('SELECT a.state,c.status FROM task_assignments a JOIN cases c ON c.id=a.case_id WHERE a.id=$1', [item.a.id]))[0];
  const releaseCount = async item => (await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='tasks.assignment_released' AND detail->>'assignment_id'=$1", [item.a.id]))[0].n;
  const worker = () => {
    const service = new TaskMaintenanceService(db, app.get(TaskDispatchService));
    service.logger = { error: () => {} }; // Expected synthetic audit failure must not emit noisy output.
    return service;
  };
  const one = worker(), two = worker();
  const permission = app.get(PermissionService);
  const deadline = await assignment(), unlimited = await assignment();
  // PG now() has microsecond precision: a fresh Date-based account snapshot must remain valid.
  await permission.assertCaseAssignment(await fresh(member.id), unlimited.id, 'resp', 'annotate');
  await db.query("UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [deadline.a.id]);
  await assert.rejects(permission.assertCaseAssignment(await fresh(member.id), deadline.id, 'resp', 'annotate'));
  await Promise.all([one.runOnce(), two.runOnce()]);
  assert.deepEqual(await state(deadline), { state: 'released', status: '待分配' });
  assert.deepEqual(await state(unlimited), { state: 'active', status: '标注中' });
  assert.equal(await releaseCount(deadline), 1);
  const [systemAudit] = await db.query("SELECT actor,detail,ip FROM audit_logs WHERE action='tasks.assignment_released' AND detail->>'assignment_id'=$1", [deadline.a.id]);
  assert.equal(systemAudit.actor, null); assert.equal(systemAudit.ip, 'system'); assert.equal(systemAudit.detail.executor, 'task-worker');
  assert.equal(systemAudit.detail.reason, 'deadline_expired');
  // Losing review qualification releases self-review annotation, but not peer or other-system work.
  const self = await assignment('self'), otherSystem = await assignment('peer', 'bone');
  const oldMember = await fresh(member.id), oldToken = app.get(AuthTokenService).signAccess(oldMember);
  let response = await patch({ id: member.id, quals: { resp: ['annotate'], bone: ['annotate'] } });
  assert.equal(response.status, 200); assert.equal((await response.json()).released_assignments, 1);
  assert.deepEqual(await state(self), { state: 'released', status: '待分配' });
  assert.equal((await state(unlimited)).state, 'active'); assert.equal((await state(otherSystem)).state, 'active');
  await assert.rejects(permission.assertCaseAssignment(oldMember, self.id, 'resp', 'annotate'));
  assert.equal((await fetch(`${base}/api/tasks/mine`, { headers: { Authorization: `Bearer ${oldToken}` } })).status, 401);
  const [humanAudit] = await db.query("SELECT actor,detail FROM audit_logs WHERE action='tasks.assignment_released' AND detail->>'assignment_id'=$1", [self.a.id]);
  assert.equal(humanAudit.actor, users[0].id); assert.equal(humanAudit.detail.reason, 'qualification_removed'); assert.equal(humanAudit.detail.executor, undefined);
  // Audit failures roll back the account change as well as all releases and case states.
  await db.query(`CREATE FUNCTION fail_release_audit() RETURNS trigger AS $$ BEGIN
    IF NEW.action='tasks.assignment_released' THEN RAISE EXCEPTION 'synthetic release failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_release BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_release_audit()');
  const before = await fresh(member.id);
  assert.equal((await patch({ id: member.id, status: 'disabled' })).status, 500);
  assert.deepEqual(await fresh(member.id), before);
  assert.equal((await state(unlimited)).state, 'active'); assert.equal((await state(otherSystem)).status, '标注中');
  assert.equal(await releaseCount(unlimited), 0);
  await db.query("UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [unlimited.a.id]);
  await one.runOnce(); assert.equal((await state(unlimited)).state, 'active');
  await db.query('DROP TRIGGER fail_release ON audit_logs');
  await one.runOnce(); assert.equal((await state(unlimited)).state, 'released'); assert.equal(await releaseCount(unlimited), 1);
  response = await patch({ id: member.id, status: 'disabled' }); assert.equal(response.status, 200);
  assert.equal((await response.json()).released_assignments, 1); assert.equal((await state(otherSystem)).state, 'released');
  assert.equal((await patch({ id: member.id, status: 'active' })).status, 200);
  assert.equal((await state(otherSystem)).state, 'released'); // Restoring account never revives historical assignment.
  // Live qualification is denied before the worker catches up, including self-review's second qualification.
  const direct = await assignment('peer'); const snapshot = await fresh(member.id);
  await db.query("UPDATE users SET quals='{}' WHERE id=$1", [member.id]);
  await assert.rejects(permission.assertCaseAssignment(snapshot, direct.id, 'resp', 'annotate'));
  await one.runOnce(); assert.equal((await state(direct)).state, 'released');
  assert.equal((await patch({ id: member.id, quals: member.quals })).status, 200);
  const directSelf = await assignment('self'), selfSnapshot = await fresh(member.id);
  await db.query(`UPDATE users SET quals='{"resp":["annotate"]}' WHERE id=$1`, [member.id]);
  await assert.rejects(permission.assertCaseAssignment(selfSnapshot, directSelf.id, 'resp', 'annotate'));
  await one.runOnce(); assert.equal((await state(directSelf)).state, 'released');
  assert.equal((await patch({ id: member.id, quals: member.quals })).status, 200);
  // Claim and qualification revocation serialize on the same user: no active invalid assignment survives.
  const raceCase = await makeCase(); const pool = await (await req({ ...body([raceCase]), dispatch_mode: 'pool' })).json();
  const current = await fresh(member.id);
  const results = await Promise.allSettled([
    app.get(TaskDispatchService).dispatch(current, { mode: 'pool', task_id: pool.id, case_id: raceCase }, '127.0.0.1'),
    app.get(UsersService).update(await fresh(users[0].id), { id: member.id, quals: {} }, '127.0.0.1'),
  ]);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE case_id=$1 AND state='active'", [raceCase]))[0].n, 0);
  assert.equal((await patch({ id: member.id, quals: member.quals })).status, 200);
  // Releasing auto work follows its saved mode. No deadline is invented for a replacement.
  const automatic = await assignment();
  await db.query("UPDATE tasks SET dispatch_mode='auto' WHERE id=$1", [automatic.task.id]);
  await db.query("UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [automatic.a.id]);
  await one.runOnce();
  assert.equal((await state(automatic)).state, 'released');
  const [replacement] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [automatic.id]);
  assert(replacement); assert.notEqual(replacement.id, automatic.a.id); assert.equal(replacement.due_at, null);
  assert.equal((await state(deadline)).status, '待分配'); // Manual work stays unassigned.
  assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE case_id=$1 AND state='active'", [raceCase]))[0].n, 0); // Pool remains available.
  const [autoAudit] = await db.query("SELECT actor,detail,ip FROM audit_logs WHERE action='tasks.auto_dispatched' AND detail->>'case_id'=$1", [automatic.id]);
  assert.equal(autoAudit.actor, null); assert.equal(autoAudit.detail.executor, 'task-worker'); assert.equal(autoAudit.ip, 'system');
  // Natural account expiration and security setup invalidation are recovered by the same worker.
  const expired = await assignment();
  await db.query("UPDATE users SET expire_at='2000-01-01' WHERE id=$1", [member.id]);
  await one.runOnce(); assert.equal((await state(expired)).state, 'released');
  assert.equal((await patch({ id: member.id, expire_at: '2099-12-31' })).status, 200);
  await db.query(`UPDATE users SET quals='{"resp":["annotate"]}' WHERE id=$1`, [users[2].id]);
  const adminWork = await assignment('peer', 'resp', users[2].id);
  response = await patch({ id: users[2].id, reset_mfa: true }); assert.equal(response.status, 200);
  assert.equal((await response.json()).released_assignments, 1); assert.equal((await state(adminWork)).state, 'released');
  // Only the two named system events can omit actor; human FK and append-only history stay intact.
  for (const [action, detail, ip] of [
    ['users.updated', { executor: 'task-worker' }, 'system'],
    ['tasks.assignment_released', {}, 'system'],
    ['tasks.assignment_released', { executor: 'task-worker' }, '127.0.0.1'],
  ]) await assert.rejects(db.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES(NULL,$1,$2,$3,$4)', [action, 'synthetic', JSON.stringify(detail), ip]), e => e.code === '23514');
  await assert.rejects(db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'users.updated','synthetic','{}','system')", [randomUUID()]), e => e.code === '23503');
  await assert.rejects(db.query('UPDATE audit_logs SET actor=$1 WHERE actor IS NULL', [users[0].id]), /append-only/);
  await assert.rejects(db.query('DELETE FROM audit_logs WHERE actor IS NULL'), /append-only/);
  const { AllowTaskSystemAudit1790640000002 } = require('../dist/database/migrations/1790640000002-AllowTaskSystemAudit');
  await assert.rejects(db.transaction(manager => new AllowTaskSystemAudit1790640000002().down({ query: manager.query.bind(manager) })), e => e.code === '23502');
  assert.equal(await releaseCount(deadline), 1);
  await one.onModuleDestroy(); await two.onModuleDestroy();
  console.log('PASS: atomic account/qualification release, live permission invalidation, expiry without default deadlines, concurrent worker idempotence and revoke/claim serialization, audit rollback/retry, mode-aware auto refill, constrained system audit and safe migration refusal');
};
