const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async ({ db, base, get, caseId, actor, assignment, taskId, seriesId, token, otherToken, adminToken }) => {
  const url=`/api/cases/${caseId}/annotations`;
  const columns=await db.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='cases' AND column_name='annotation_version') OR (table_name='annotation_objects' AND column_name IN ('logical_id','key_frame_index'))) ORDER BY column_name`);
  assert.deepEqual(columns.map(c=>[c.column_name,c.data_type,c.is_nullable]),[['annotation_version','integer','NO'],['key_frame_index','integer','NO'],['logical_id','uuid','NO']]);
  const root=randomUUID(),part=randomUUID(),sign=randomUUID(),sign2=randomUUID(),foreignSign=randomUUID();
  await db.query("INSERT INTO taxonomy_nodes(id,level,name) VALUES($1,1,'呼吸')",[root]);
  await db.query("INSERT INTO taxonomy_nodes(id,parent_id,level,name) VALUES($1,$2,2,'合成标注部位')",[part,root]);
  for(const [id,system,name] of [[sign,'resp','合成征象一'],[sign2,'resp','合成征象二'],[foreignSign,'bone','合成其他系统征象']]) await db.query("INSERT INTO sign_tags(id,name,system_code,definition) VALUES($1,$2,$3,'合成测试')",[id,name,system]);
  const original={series_id:seriesId,tool:'box',geometry:{x:10,y:20,w:30,h:40},frame_start:0,frame_end:0,key_frame_index:0,part_id:part,sign_tag_ids:[sign],confidence:'typical',report_sent_ids:[-1]};
  const save=(version,annotations,auth=token)=>fetch(base+url,{method:'PUT',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:JSON.stringify({expected_version:version,annotations})});
  const current=async()=>{const response=await get(url);assert.equal(response.status,200);return response.json();};
  assert.equal((await get(url,'')).status,401);assert.equal((await get(url,otherToken)).status,403);assert.equal((await get(url,adminToken)).status,403);
  assert.equal((await save(0,[original],'')).status,401);assert.equal((await save(0,[original],otherToken)).status,403);assert.equal((await save(0,[original],adminToken)).status,403);
  assert.deepEqual(await current(),{version:0,current_version:0,annotations:[],latest_review:null});
  for(const changes of [{series_id:randomUUID()},{frame_end:1},{part_id:root},{sign_tag_ids:[foreignSign]}, {report_sent_ids:[999]},{report_sent_ids:[-1,0]},{geometry:{x:630,y:20,w:30,h:40}},{tool:'point',geometry:{x:640,y:1}},{tool:'brush',geometry:{width:2,height:2,rle:[4]}}]) assert.equal((await save(0,[{...original,...changes}])).status,400);
  await db.query(`UPDATE series SET modality='CT',default_window='{"center":40,"width":400}' WHERE id=$1`,[seriesId]);assert.equal((await save(0,[original])).status,400);
  await db.query("UPDATE series SET modality='DX',default_window=NULL WHERE id=$1",[seriesId]);
  let response=await save(0,[original]);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');
  let result=await response.json();const logicalId=result.annotations[0].id;assert.equal(result.version,1);assert.equal(result.annotations[0].confidence,'typical');
  assert.equal((await db.query('SELECT annotation_version FROM cases WHERE id=$1',[caseId]))[0].annotation_version,1);
  const oldRows=await db.query('SELECT id,logical_id,geometry FROM annotation_objects WHERE case_id=$1 AND version=1',[caseId]);assert.notEqual(oldRows[0].id,logicalId);
  const changed={...original,id:logicalId,geometry:{x:15,y:20,w:30,h:40},report_sent_ids:[0],sign_tag_ids:[sign2]};
  assert.equal((await save(0,[changed])).status,409);
  await db.query('UPDATE annotation_objects SET is_gold=true WHERE case_id=$1 AND version=1',[caseId]);assert.equal((await save(1,[changed])).status,409);
  await db.query('UPDATE annotation_objects SET is_gold=false WHERE case_id=$1 AND version=1',[caseId]);
  response=await save(1,[changed]);assert.equal(response.status,200);assert.equal((await response.json()).annotations[0].id,logicalId);
  const history=await (await get(url+'?version=1')).json();assert.equal(history.current_version,2);assert.deepEqual(history.annotations[0].geometry,original.geometry);assert.deepEqual(history.annotations[0].sign_tag_ids,[sign]);
  assert.equal((await get(url+'?version=999')).status,404);assert.equal((await get(url+'?version=1.5')).status,400);
  assert.equal((await save(2,[])).status,200);assert.deepEqual((await current()).annotations,[]);assert.equal((await current()).version,3);
  assert.equal((await (await get(url+'?version=2')).json()).annotations.length,1);
  assert.deepEqual((await (await get(url+'?version=3')).json()).annotations,[]);
  const race=await Promise.all([save(3,[changed]),save(3,[])]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await current()).version,4);
  await db.query(`CREATE FUNCTION fail_annotation_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='annotations.saved' OR NEW.action='annotations.viewed' THEN RAISE EXCEPTION 'synthetic annotation audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_annotation BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_annotation_audit()');
  assert.equal((await save(4,[changed])).status,500);assert.equal((await get(url)).status,500);
  assert.equal((await db.query('SELECT annotation_version FROM cases WHERE id=$1',[caseId]))[0].annotation_version,4);
  assert.equal((await db.query('SELECT count(*)::int n FROM annotation_objects WHERE case_id=$1 AND version=5',[caseId]))[0].n,0);
  await db.query('DROP TRIGGER fail_annotation ON audit_logs');
  for(const [sql,args,restore] of [
    ["UPDATE task_assignments SET state='released' WHERE id=$1",[assignment.id],"UPDATE task_assignments SET state='active' WHERE id=$1"],
    ["UPDATE task_assignments SET due_at='2000-01-01' WHERE id=$1",[assignment.id],'UPDATE task_assignments SET due_at=NULL WHERE id=$1'],
    ["UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1",[caseId],"UPDATE cases SET source='synthetic' WHERE id=$1"],
    ["UPDATE users SET quals='{}' WHERE id=$1",[actor.id],`UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE id=$1`],
    ["UPDATE tasks SET deleted_at=now() WHERE id=$1",[taskId],'UPDATE tasks SET deleted_at=NULL WHERE id=$1'],
  ]){await db.query(sql,args);assert.equal((await get(url+'?version=1')).status,403);assert.equal((await save(4,[changed])).status,403);await db.query(restore,args);}
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='annotations.saved' AND target=$1",[`cases:${caseId}`]))[0].n,4);
  assert.deepEqual(await db.query('SELECT id,logical_id,geometry FROM annotation_objects WHERE case_id=$1 AND version=1',[caseId]),oldRows);
  // Positive round-trip for all four geometries and a CT representative/extra mask frame.
  await db.query(`UPDATE series SET modality='CT',frame_count=3,default_window='{"center":40,"width":400}' WHERE id=$1`,[seriesId]);
  const shapes=[
    {tool:'box',geometry:{x:1,y:2,w:3,h:4}}, {tool:'point',geometry:{x:1.25,y:2.5}},
    {tool:'polygon',geometry:{points:[[0,0],[3,0],[0,3]]}},
    {tool:'brush',geometry:{width:640,height:480,rle:[0,307200],frames:[{frame_index:2,width:640,height:480,rle:[1,2,307197]}]}},
  ];
  response=await save(4,shapes.map(shape=>({...original,...shape,id:randomUUID(),frame_end:2,key_frame_index:1,window_preset:'lung'})));
  assert.equal(response.status,200);result=await response.json();assert.equal(result.version,5);
  for(const shape of shapes)assert.deepEqual(result.annotations.find(a=>a.tool===shape.tool).geometry,shape.geometry);
  await db.query("UPDATE series SET modality='DX',frame_count=1,default_window=NULL WHERE id=$1",[seriesId]);
  response=await save(5,[{...original,part_id:null,confidence:null,sign_tag_ids:[]}]);assert.equal(response.status,200);
  const draft=(await response.json()).annotations[0];assert.equal(draft.part_id,null);assert.equal(draft.confidence,null);assert.deepEqual(draft.sign_tag_ids,[]);
  await assert.rejects(db.undoLastMigration(),/null values/);
  const {AnnotationVersionState1790726400000}=require('../dist/database/migrations/1790726400000-AnnotationVersionState');
  await assert.rejects(db.transaction(manager=>new AnnotationVersionState1790726400000().down({query:manager.query.bind(manager)})),/Annotation history exists/);
  console.log('PASS: annotation save/history/session/scope boundaries, stable identity and old tags, empty versions, concurrent 409, gold lock, audit rollback, expired/released access, guarded downgrade');
};
