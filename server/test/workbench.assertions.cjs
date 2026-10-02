const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async ({ db, get, caseId, actor, assignment, taskId, seriesId, studyId, otherToken, adminToken }) => {
  const url = `/api/workbench/${caseId}`;
  assert.equal((await get(url, '')).status, 401);
  assert.equal((await get(url)).status, 403); // Explicit deidentification confirmation required.
  await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','system-test')", [actor.id, `cases:${caseId}`]);
  await db.query("INSERT INTO reports(case_id,raw_text,sentences,mask_map_id) VALUES($1,'synthetic-private-raw',$2,$3)", [caseId, JSON.stringify([{ idx: 1, text: '合成报告第二句', ignored: 'private-extra' }, { idx: 0, text: '合成报告第一句' }]), randomUUID()]);
  for (const confirmed of [true, false]) await db.query("INSERT INTO attachments(case_id,kind,object_key,filename,size,deid_confirmed) VALUES($1,'其他','synthetic-private-key',$2,'1',$3)", [caseId, confirmed ? '已确认合成附件' : '未确认附件', confirmed]);
  let response = await get(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const body = await response.json();
  assert.equal(body.case.id, caseId);
  assert.deepEqual(body.sentences, [{ idx: 0, text: '合成报告第一句' }, { idx: 1, text: '合成报告第二句' }]);
  assert.equal(body.series[0].id, seriesId);
  assert.equal(body.attachments.length, 1);
  assert(!/orthanc_id|object_key|raw_text|mask_map_id|private-extra|未确认附件/.test(JSON.stringify(body)));
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='workbench.viewed'"))[0].n, 1);
  assert.equal((await get(url, otherToken)).status, 403);
  assert.equal((await get(url, adminToken)).status, 403);
  assert.equal((await get('/api/workbench/not-a-uuid')).status, 400);
  const attachmentId=body.attachments[0].id;
  await db.query('UPDATE attachments SET object_key=$2 WHERE id=$1',[attachmentId,`cases/${caseId}/synthetic-preview`]);
  const preview=`${url}/attachments/${attachmentId}/preview`;
  assert.equal((await get(preview,'')).status,401);
  assert.equal((await get(preview,otherToken)).status,403);assert.equal((await get(preview,adminToken)).status,403);
  for(const suffix of ['?page=0','?page=3','?page=1.2','?page=1&page=2','?download=true'])assert.equal((await get(preview+suffix)).status,400);
  response=await get(preview+'?page=2');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/png/);
  assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(response.headers.get('x-page-count'),'2');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='workbench.attachment_viewed'"))[0].n,1);
  for(const field of ['deid_confirmed=false','deleted_at=now()']){await db.query(`UPDATE attachments SET ${field} WHERE id=$1`,[attachmentId]);assert.equal((await get(preview)).status,404);await db.query('UPDATE attachments SET deid_confirmed=true,deleted_at=NULL WHERE id=$1',[attachmentId]);}
  assert.equal((await get(`/api/workbench/${randomUUID()}/attachments/${attachmentId}/preview`)).status,403);
  await db.query(`CREATE FUNCTION fail_attachment_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='workbench.attachment_viewed' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_attachment BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_attachment_audit()');
  response=await get(preview);assert.equal(response.status,500);assert(!response.headers.get('content-type').includes('image/'));
  await db.query('DROP TRIGGER fail_attachment ON audit_logs');
  for (const [sql, args, restore] of [
    ["UPDATE task_assignments SET state='released' WHERE id=$1", [assignment.id], "UPDATE task_assignments SET state='active' WHERE id=$1"],
    ["UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1", [assignment.id], 'UPDATE task_assignments SET due_at=NULL WHERE id=$1'],
    ["UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1", [caseId], "UPDATE cases SET source='synthetic' WHERE id=$1"],
    ["UPDATE users SET quals='{}' WHERE id=$1", [actor.id], `UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE id=$1`],
    ["UPDATE tasks SET deleted_at=now() WHERE id=$1", [taskId], 'UPDATE tasks SET deleted_at=NULL WHERE id=$1'],
  ]) { await db.query(sql, args); assert.equal((await get(url)).status, 403); assert.equal((await get(preview)).status,403); await db.query(restore, args); }
  for (const [table, id] of [['series', seriesId], ['studies', studyId]]) {
    await db.query(`UPDATE ${table} SET deleted_at=now() WHERE id=$1`, [id]);
    assert.deepEqual((await (await get(url)).json()).series, []);
    await db.query(`UPDATE ${table} SET deleted_at=NULL WHERE id=$1`, [id]);
  }
  await db.query(`CREATE FUNCTION fail_workbench_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='workbench.viewed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_workbench BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_workbench_audit()');
  response = await get(url); assert.equal(response.status, 500); assert(!(await response.text()).includes('合成报告'));
  await db.query('DROP TRIGGER fail_workbench ON audit_logs');
  console.log('PASS: workbench live assignment/source/confirmation boundaries, minimal report/attachment output, deleted series and fail-closed audit');
};
