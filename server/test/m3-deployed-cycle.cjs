'use strict';
const assert = require('node:assert/strict');
module.exports = async ({ get, json, request, admin, annotator, reviewer, accounts, cases, task }) => {
  const checks = { kind: 'checks', deidentification: true, confirmation_basis: true, disease_label: true };
  const saveObjects = data => data.annotations.map(({ version, is_gold, ...object }) => object);
  async function review(item, result = '通过') {
    await json('/api/tasks/dispatch', { mode: 'manual', task_id: task.id, case_ids: [item.id], assignee_id: accounts.reviewer.id, task_role: 'review' }, admin);
    await json('/api/tasks/start-review', { task_id: task.id, case_id: item.id }, reviewer);
    const work = await get('/api/reviews/' + item.id, reviewer);
    assert.equal(work.disease.id, item.disease_tag_id);
    assert.equal(work.annotations.length, 4);
    const body = { expected_version: item.version, result, comments: result === '通过' ? [checks] : [checks, { kind: 'overall', text: '合成复验：请调整矩形边界并重新核对报告关联。' }] };
    assert.equal((await request('/api/reviews/' + item.id, { method: 'POST', body, token: annotator })).status, 403);
    const decision = await json('/api/reviews/' + item.id, body, reviewer);
    assert.equal(decision.status, result === '通过' ? '已发布' : '标注中');
    return decision;
  }
  for (const item of cases) {
    await json(`/api/cases/${item.id}/submit`, { expected_version: item.version }, annotator);
    if (item.modality === 'CT') {
      await review(item, '打回');
      const returned = await get(`/api/cases/${item.id}/annotations`, annotator);
      assert.equal(returned.latest_review.result, '打回');
      const objects = saveObjects(returned);
      objects.find(o => o.tool === 'box').geometry.x += 2;
      await json(`/api/cases/${item.id}/annotations`, { expected_version: item.version, annotations: objects }, annotator, 200, 'PUT');
      item.version++;
      await json(`/api/cases/${item.id}/submit`, { expected_version: item.version }, annotator);
      console.log('PASS CT return, actionable comments, amended version and resubmission');
    }
    await review(item);
    const library = await get('/api/library/' + item.id, annotator);
    assert.equal(library.version, item.version);
    assert(library.annotations.every(object => object.is_gold));
    assert.equal((await request(`/api/cases/${item.id}/annotations`, { method: 'PUT', token: annotator, body: { expected_version: item.version, annotations: [] } })).status, 403);
  }
  for (const q of ['', '&q=' + encodeURIComponent('肺内结节')]) {
    let found = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await request('/api/search?system_code=resp&pageSize=100' + q, { token: annotator });
      if (response.status === 200) {
        const data = response.json();
        found = cases.every(item => data.items.some(row => row.id === item.id && row.version === item.version));
      } else assert.equal(response.status, 503, 'Search only retries unavailable synchronization');
      if (found) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert(found, q ? 'Real ES full text contains published DX/CT' : 'Published query contains DX/CT');
  }
  console.log('PASS real DX/CT submission, peer review, gold lock and PG/Elasticsearch search');
  const item = cases[0], library = await get('/api/library/' + item.id, annotator);
  const old = await json('/api/frames/ticket', { case_id: item.id, series_uid: library.series[0].series_uid, frame_index: 0, access_mode: 'library', expected_version: item.version }, annotator);
  await json(`/api/cases/${item.id}/offline`, { expected_version: item.version }, admin);
  assert.equal((await request('/api/library/' + item.id, { token: annotator })).status, 403);
  assert.equal((await request(old.url, { token: annotator })).status, 403);
  assert(!(await get('/api/search?system_code=resp&pageSize=100', annotator)).items.some(row => row.id === item.id));
  const revived = await json(`/api/cases/${item.id}/reactivate`, { expected_version: item.version }, admin);
  assert.equal(revived.version, item.version + 1); item.version = revived.version;
  await json('/api/tasks/dispatch', { mode: 'manual', task_id: task.id, case_ids: [item.id], assignee_id: accounts.annotator.id, task_role: 'annotate' }, admin);
  const seeded = await get(`/api/cases/${item.id}/annotations`, annotator);
  assert.equal(seeded.annotations.length, 4); assert(seeded.annotations.every(o => !o.is_gold));
  await json(`/api/cases/${item.id}/submit`, { expected_version: item.version }, annotator);
  await review(item);
  assert.equal((await request(old.url, { token: annotator })).status, 403, 'Old published-version ticket stays invalid after republication');
  console.log('PASS offline invisibility, old ticket rejection, non-gold reactivation and republication');
};
