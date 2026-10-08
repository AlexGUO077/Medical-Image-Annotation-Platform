'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async ({ db, req, json, caseId, tokens }) => {
  const created = [], suffix = randomUUID().replaceAll('-', '');
  const trigger = `disease_audit_${suffix}`;
  const base = { clinical_text: '合成人名', age_band: '', sex: '', confirm_method: '临床综合诊断' };
  const save = (tag, token = tokens[0]) => req(`/${caseId}/clinical`, token, json('PUT', { ...base, disease_tag_id: tag }));
  const state = async () => (await db.query('SELECT disease_tag_id,clinical_text FROM cases WHERE id=$1', [caseId]))[0];
  try {
    const parts = await db.query("SELECT n.id,r.name FROM taxonomy_nodes n JOIN taxonomy_nodes r ON r.id=n.parent_id WHERE n.level=2 AND n.deleted_at IS NULL AND r.deleted_at IS NULL");
    const part = parts.find(n => n.name === '呼吸'), wrong = parts.find(n => n.name === '骨骼');
    assert(part && wrong);
    async function node(parent, level) {
      const [made] = await db.query("INSERT INTO taxonomy_nodes(parent_id,level,name,synonyms) VALUES($1,$2,$3,'[]') RETURNING id", [parent, level, `合成疾病-${randomUUID()}`]);
      created.push(made.id); return made.id;
    }
    const disease = await node(part.id, 3), subtype = await node(disease, 4), cross = await node(wrong.id, 3);
    assert.equal((await save(disease, tokens[2])).status, 403);
    for (const tag of [null, '', 'bad-id', part.id, cross]) assert.equal((await save(tag)).status, 400);
    assert.equal((await save(disease)).status, 200);
    let detail = await (await req(`/${caseId}`)).json();
    assert.equal(detail.disease_tag_id, disease); assert.equal(typeof detail.disease_tag_name, 'string');
    assert.equal((await req(`/${caseId}/clinical`, tokens[0], json('PUT', base))).status, 200);
    assert.equal((await state()).disease_tag_id, disease, 'omission preserves diagnosis');
    assert.equal((await save(subtype)).status, 200);
    await db.query('UPDATE taxonomy_nodes SET deleted_at=now() WHERE id=$1', [disease]);
    assert.equal((await save(subtype)).status, 400, 'deleted ancestor invalidates subtype');
    await db.query('UPDATE taxonomy_nodes SET deleted_at=NULL WHERE id=$1', [disease]);
    await db.query('UPDATE taxonomy_nodes SET deleted_at=now() WHERE id=$1', [subtype]);
    assert.equal((await save(subtype)).status, 400);
    await db.query('UPDATE taxonomy_nodes SET deleted_at=NULL WHERE id=$1', [subtype]);
    for (const status of ['标注中', '待审核', '审核中', '已发布', '已下线']) {
      await db.query('UPDATE cases SET status=$2 WHERE id=$1', [caseId, status]);
      assert.equal((await save(disease)).status, 409);
      assert.equal((await state()).disease_tag_id, subtype);
    }
    await db.query("UPDATE cases SET status='待分配' WHERE id=$1", [caseId]);
    const before = await state();
    await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN IF NEW.target='cases:${caseId}' AND NEW.action='case.clinical_updated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    assert.equal((await save(disease)).status, 500);
    assert.deepEqual(await state(), before, 'audit failure rolls back diagnosis and clinical values');
    await db.query(`DROP TRIGGER ${trigger} ON audit_logs`);
    assert.equal((await save(disease)).status, 200);
    const [audit] = await db.query("SELECT detail FROM audit_logs WHERE target=$1 AND action='case.clinical_updated' ORDER BY created_at DESC,id DESC LIMIT 1", [`cases:${caseId}`]);
    assert.equal(audit.detail.disease_tag_id_before, subtype); assert.equal(audit.detail.disease_tag_id_after, disease);
    assert(!JSON.stringify(audit.detail).includes(base.clinical_text));
    console.log('PASS D-45 admin boundary, same-system disease/subtype, invalid ancestors, states, omission and audit rollback');
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs`);
    await db.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    await db.query("UPDATE cases SET status='已录入',disease_tag_id=NULL WHERE id=$1", [caseId]);
    for (const id of created.reverse()) await db.query('DELETE FROM taxonomy_nodes WHERE id=$1', [id]);
  }
};
