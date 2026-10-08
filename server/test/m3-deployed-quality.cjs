'use strict';
const assert = require('node:assert/strict');
module.exports = async ({ get, json, request, admin, annotator, reviewer, accounts, cases, task }) => {
  const checks = { kind: 'checks', deidentification: true, confirmation_basis: true, disease_label: true };
  const users = await get('/api/users?pageSize=100', admin);
  assert(users.total <= 100, 'Quality fixture requires a bounded local test account set');
  const retired = users.items.filter(user => user.id !== accounts.reviewer.id && user.status === 'active' && user.quals.resp?.includes('review'));
  assert(retired.every(user => user.role === 'member' && user.real_name === '合成M3-reviewer'), 'Never change unrelated user qualifications for a fixture');
  const restored = [];
  try {
    // Only earlier accounts created by this exact local fixture; restore in finally.
    for (const user of retired) {
      await json('/api/users', { id: user.id, quals: {} }, admin, 200, 'PATCH');
      restored.push(user);
    }
    const sample = await json(`/api/tasks/${task.id}/spotchecks`, {}, admin);
    assert.equal(sample.candidate_count, 2); assert.equal(sample.sampled_count, 1); assert.equal(sample.assigned_count, 1);
    const repeat = await json(`/api/tasks/${task.id}/spotchecks`, {}, admin);
    assert.equal(repeat.candidate_count, 0, 'Same candidate versions cannot enter another round');
    const find = async kind => (await get('/api/tasks/mine?task_role=review&pageSize=100', reviewer)).items.find(row => cases.some(c => c.id === row.case_id) && row.review_kind === kind);
    const sampled = await find('spotcheck'); assert(sampled);
    const review = async (assignment, result) => {
      assert.equal((await request('/api/reviews/' + assignment.case_id, { token: reviewer })).status, 403, 'Explicit start required');
      await json('/api/tasks/start-review', { task_id: task.id, case_id: assignment.case_id, assignment_id: assignment.assignment_id }, reviewer);
      const data = await get('/api/reviews/' + assignment.case_id, reviewer);
      assert.equal(data.review_kind, assignment.review_kind); assert(data.annotations.every(a => a.is_gold));
      return json('/api/reviews/' + assignment.case_id, { expected_version: assignment.review_version, assignment_id: assignment.assignment_id, result,
        comments: result === '通过' ? [checks] : [checks, { kind: 'overall', text: '合成抽检：轮廓边界须重新标注。' }] }, reviewer);
    };
    const failed = await review(sampled, '打回');
    assert.equal(failed.status, '已下线'); assert.equal(failed.assigned_count, 1);
    assert.equal((await request('/api/library/' + sampled.case_id, { token: annotator })).status, 403);
    const recheck = await find('recheck'); assert(recheck && recheck.case_id !== sampled.case_id);
    assert.equal((await get('/api/library/' + recheck.case_id, annotator)).case.status, '已发布');
    assert.equal((await review(recheck, '通过')).status, '已发布');
    console.log('PASS real 10% sampling, same-version exclusion, failure offlining and same-author recheck');
    const item = cases.find(c => c.id === sampled.case_id);
    const revived = await json(`/api/cases/${item.id}/reactivate`, { expected_version: item.version }, admin);
    item.version = revived.version;
    await json('/api/tasks/dispatch', { mode: 'manual', task_id: task.id, case_ids: [item.id], assignee_id: accounts.annotator.id, task_role: 'annotate' }, admin);
    await json(`/api/cases/${item.id}/submit`, { expected_version: item.version }, annotator);
    await json('/api/tasks/dispatch', { mode: 'manual', task_id: task.id, case_ids: [item.id], assignee_id: accounts.reviewer.id, task_role: 'review' }, admin);
    await json('/api/tasks/start-review', { task_id: task.id, case_id: item.id }, reviewer);
    await json('/api/reviews/' + item.id, { expected_version: item.version, result: '通过', comments: [checks] }, reviewer);
    const next = await json(`/api/tasks/${task.id}/spotchecks`, {}, admin);
    assert.equal(next.candidate_count, 1); assert.equal(next.sampled_count, 1);
    assert.equal((await review(await find('spotcheck'), '通过')).status, '已发布');
    console.log('PASS republished new version enters a new round and passes quality review');
  } finally {
    for (const user of restored) await json('/api/users', { id: user.id, quals: user.quals }, admin, 200, 'PATCH');
  }
};
