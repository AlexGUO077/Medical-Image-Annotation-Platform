const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AuthTokenService } = require('../dist/modules/auth/auth-token.service');
const { PermissionService } = require('../dist/modules/auth/permission.service');
module.exports = async ({ db, app, base, token, memberToken, users, makeCase, body, req, call, get, largeTask, largeBatch }) => {
  const [modeColumn] = await db.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tasks' AND column_name='dispatch_mode'");
  assert.equal(modeColumn.data_type, 'character varying'); assert.equal(modeColumn.is_nullable, 'NO'); assert.match(modeColumn.column_default, /auto/);
  // Isolate load distribution from preceding manual-dispatch fixtures.
  await db.query("UPDATE cases SET status='待分配' WHERE id IN (SELECT case_id FROM task_assignments WHERE state='active')");
  await db.query("UPDATE task_assignments SET state='released' WHERE state='active'");
  const [second] = await db.query(`INSERT INTO users (username,password_hash,real_name,role,status,expire_at,must_change_password,quals)
    VALUES ($1,'synthetic-unused','合成领取人','member','active','2099-12-31',false,'{"resp":["annotate"]}') RETURNING *, expire_at::text`, [`pool-${randomUUID()}`]);
  const secondToken = app.get(AuthTokenService).signAccess(second);
  const create = async (mode, count = 1, extra = {}) => {
    const ids = await Promise.all(Array.from({ length: count }, () => makeCase()));
    const response = await req({ ...body(ids), dispatch_mode: mode, ...extra });
    assert.equal(response.status, 201); return { task: await response.json(), ids };
  };
  const claim = (task, id, auth = memberToken, extra = {}) => call('/dispatch', { mode: 'pool', task_id: task.id, case_id: id, ...extra }, auth);
  const queue = async (kind, auth = memberToken, suffix = '') => {
    const res = await fetch(`${base}/api/tasks/${kind}?pageSize=100${suffix}`, { headers: { Authorization: `Bearer ${auth}` } });
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store, private'); return res.json();
  };
  const defaults = await create(undefined);
  assert.equal(defaults.task.dispatch_mode, 'auto');
  assert.equal(defaults.task.auto_dispatch.status, 'completed');
  await db.query("UPDATE task_assignments SET state='released' WHERE case_id=$1", [defaults.ids[0]]);
  const pool = await create('pool', 4), manual = await create('manual');
  assert.equal((await claim(manual.task, manual.ids[0])).status, 409);
  assert.equal((await claim(pool.task, manual.ids[0])).status, 409);
  assert.equal((await claim(pool.task, pool.ids[0], memberToken, { assignee_id: second.id })).status, 400);
  assert.equal((await claim(pool.task, pool.ids[0], memberToken, { due_at: '2099-01-01T00:00:00Z' })).status, 400);
  assert.equal((await call('/dispatch', { mode: 'auto' }, memberToken)).status, 403);
  assert.equal((await call('/reclaim', { assignment_id: randomUUID(), reason: 'quality' }, memberToken)).status, 403);
  const listing = await queue('pool');
  assert(listing.items.some(row => row.case_id === pool.ids[0]));
  assert(!listing.items.some(row => row.case_id === manual.ids[0]));
  assert.deepEqual(Object.keys(listing.items[0]).sort(), ['task_id','task_name','priority','source','system_code','review_mode','case_id','case_no','status'].sort());
  const race = await Promise.all([claim(pool.task, pool.ids[0]), claim(pool.task, pool.ids[0], secondToken)]);
  assert.deepEqual(race.map(r => r.status).sort(), [201,409]);
  let [active] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [pool.ids[0]]);
  assert.equal(active.due_at, null);
  const winnerToken = active.assignee_id === second.id ? secondToken : memberToken;
  assert((await queue('mine', winnerToken)).items.some(row => row.assignment_id === active.id));
  const reclaim = (id, reason = 'quality') => call('/reclaim', { assignment_id: id, reason });
  assert.equal((await reclaim(active.id, 'overdue')).status, 409);
  await db.query(`CREATE FUNCTION fail_reclaim_audit() RETURNS trigger AS $$ BEGIN
    IF NEW.action='tasks.reclaimed' THEN RAISE EXCEPTION 'synthetic reclaim failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_reclaim BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_reclaim_audit()');
  assert.equal((await reclaim(active.id)).status, 500);
  assert.equal((await db.query('SELECT state FROM task_assignments WHERE id=$1', [active.id]))[0].state, 'active');
  assert.equal((await db.query('SELECT status FROM cases WHERE id=$1', [pool.ids[0]]))[0].status, '标注中');
  await db.query('DROP TRIGGER fail_reclaim ON audit_logs');
  assert.equal((await reclaim(active.id)).status, 201);
  assert.equal((await reclaim(active.id)).status, 409);
  const permissionUser = { ...users[1], id: active.assignee_id, quals: { resp: ['annotate'] } };
  await assert.rejects(app.get(PermissionService).assertCaseAssignment(permissionUser, pool.ids[0], 'resp', 'annotate'));
  assert.equal((await claim(pool.task, pool.ids[0])).status, 201);
  assert.equal((await reclaim(active.id)).status, 409); // stale ID cannot reclaim the new assignment
  [active] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [pool.ids[0]]);
  await db.query("UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [active.id]);
  assert(!(await queue('mine')).items.some(row => row.assignment_id === active.id));
  assert.equal((await reclaim(active.id, 'overdue')).status, 201);
  await db.query('UPDATE users SET in_flight_limit=1 WHERE id=$1', [users[1].id]);
  const otherPool = await create('pool');
  const capRace = await Promise.all([claim(pool.task, pool.ids[1]), claim(otherPool.task, otherPool.ids[0])]);
  assert.deepEqual(capRace.map(r => r.status).sort(), [201,409]);
  assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE assignee_id=$1 AND state='active'", [users[1].id]))[0].n, 1);
  // Removal of qualification / stale session after guard is rechecked under user lock.
  const { TaskDispatchService } = require('../dist/modules/tasks/task-dispatch.service');
  await db.query("UPDATE users SET quals='{}',updated_at=updated_at+interval '1 second' WHERE id=$1", [second.id]);
  await assert.rejects(app.get(TaskDispatchService).dispatch(second, { mode: 'pool', task_id: pool.task.id, case_id: pool.ids[2] }, '127.0.0.1'), /会话已失效/);
  await db.query('UPDATE users SET quals=$2,updated_at=$3 WHERE id=$1', [second.id, JSON.stringify(second.quals), second.updated_at]);
  // Reset loads, bound both accounts to one, and prove deterministic initial assignment plus reasons.
  await db.query("UPDATE cases SET status='待分配' WHERE id IN (SELECT case_id FROM task_assignments WHERE state='active')");
  await db.query("UPDATE task_assignments SET state='released' WHERE state='active'");
  await db.query('UPDATE users SET in_flight_limit=1 WHERE id=ANY($1::uuid[])', [[users[1].id, second.id]]);
  const auto = await create('auto', 4);
  assert.equal(auto.task.auto_dispatch.status, 'completed');
  assert.equal(auto.task.auto_dispatch.assigned.length, 2);
  assert.equal(auto.task.auto_dispatch.unassigned.length, 2);
  assert(auto.task.auto_dispatch.unassigned.every(item => item.reason === 'capacity_full'));
  assert.equal(auto.task.auto_dispatch.assigned[0].assignee_id, [users[1].id, second.id].sort()[0]);
  assert.equal(new Set(auto.task.auto_dispatch.assigned.map(a => a.assignee_id)).size, 2);
  const self = await create('auto', 1, { review_mode: 'self' });
  assert.equal(self.task.auto_dispatch.unassigned[0].reason, 'no_eligible_assignee');
  // A saved task remains successful even if the separate automatic transaction fails.
  await db.query('UPDATE users SET in_flight_limit=NULL WHERE id=ANY($1::uuid[])', [[users[1].id, second.id]]);
  await db.query('CREATE TRIGGER fail_dispatch BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_dispatch_audit()');
  const pending = await create('auto');
  assert.equal(pending.task.auto_dispatch.status, 'pending');
  assert.equal((await db.query('SELECT status FROM cases WHERE id=$1', [pending.ids[0]]))[0].status, '待分配');
  await db.query('DROP TRIGGER fail_dispatch ON audit_logs');
  const retry = await call('/dispatch', { mode: 'auto', task_id: pending.task.id }); assert.equal(retry.status, 201);
  assert.equal((await retry.json()).assigned.length, 1);
  // Mode switch does not preempt an existing assignment; automatic reclaim follows current mode.
  const [assigned] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [pending.ids[0]]);
  assert.equal((await reclaim(assigned.id)).status, 201);
  const [replacement] = await db.query("SELECT * FROM task_assignments WHERE case_id=$1 AND state='active'", [pending.ids[0]]);
  assert.notEqual(replacement.id, assigned.id);
  assert.equal((await call(`/${pending.task.id}/settings`, { dispatch_mode: 'manual' }, token, 'PATCH')).status, 200);
  assert.equal((await reclaim(replacement.id)).status, 201);
  assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE case_id=$1 AND state='active'", [pending.ids[0]]))[0].n, 0);
  assert.equal((await call('/dispatch', { mode: 'auto', task_id: pending.task.id })).status, 409);
  // Global automatic pass observes priority before creation order; capped capacity goes to high priority.
  await db.query("UPDATE task_assignments SET state='released' WHERE state='active'");
  await db.query('UPDATE users SET in_flight_limit=1 WHERE id=ANY($1::uuid[])', [[users[1].id, second.id]]);
  const low = await create('manual', 1, { priority: -10 }); const high = await create('manual', 2, { priority: 100 });
  await db.query("UPDATE tasks SET dispatch_mode='manual'");
  await db.query("UPDATE tasks SET dispatch_mode='auto' WHERE id=ANY($1::uuid[])", [[low.task.id, high.task.id]]);
  const ordered = await (await call('/dispatch', { mode: 'auto' })).json();
  assert(ordered.assigned.every(row => row.task_id === high.task.id)); assert.equal(ordered.assigned.length, 2);
  assert.equal(ordered.unassigned[0].case_id, low.ids[0]);
  await db.query('UPDATE users SET in_flight_limit=NULL WHERE id=ANY($1::uuid[])', [[users[1].id, second.id]]);
  // A full unassignable prefix must expose a cursor that progresses to later assignable work.
  await db.query("UPDATE tasks SET dispatch_mode='manual'");
  await db.query("UPDATE tasks SET dispatch_mode='auto',system_code='bone',priority=300 WHERE id=$1", [largeTask.id]);
  await db.query("UPDATE cases SET system_code='bone' WHERE id=ANY($1::uuid[])", [largeBatch]);
  const tail = await create('manual', 1, { priority: 200 });
  await db.query("UPDATE tasks SET dispatch_mode='auto' WHERE id=$1", [tail.task.id]);
  const prefix = await (await call('/dispatch', { mode: 'auto' })).json();
  assert.equal(prefix.assigned.length, 0); assert.equal(prefix.unassigned.length, 2000); assert(prefix.next_case_id);
  const continued = await (await call('/dispatch', { mode: 'auto', after_case_id: prefix.next_case_id })).json();
  assert.equal(continued.assigned.length, 1); assert.equal(continued.assigned[0].case_id, tail.ids[0]);
  assert.equal(continued.next_case_id, null);
  assert.equal((await call('/dispatch', { mode: 'auto', task_id: tail.task.id, after_case_id: prefix.next_case_id })).status, 400);
  console.log('PASS: modes, pool isolation, concurrent claim/global caps, qualification/session recheck, reclaim atomic audit and stale-ID protection, auto load/priority ordering, auto failure/retry, non-preemptive mode switch');
};
