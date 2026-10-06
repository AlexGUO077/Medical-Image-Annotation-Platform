// Reuses the existing real PostgreSQL/Redis HTTP suite; only renderer/storage pixels are synthetic.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({db,app,base,get,actor,other,token,otherToken,adminToken})=>{
 const send=(path,body,auth=otherToken)=>fetch(base+path,{method:'POST',headers:{...(auth?{Authorization:`Bearer ${auth}`} :{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const checks={kind:'checks',deidentification:true,confirmation_basis:true,disease_label:true};
 const [part]=await db.query('SELECT part_id FROM annotation_objects WHERE part_id IS NOT NULL LIMIT 1');
 const [sign]=await db.query("SELECT id FROM sign_tags WHERE system_code='resp' LIMIT 1");
 const [disease]=await db.query("INSERT INTO taxonomy_nodes(parent_id,level,name,synonyms) VALUES($1,3,'合成审核疾病','[]') RETURNING id",[part.part_id]);
 const cases=[];
 const fixture=async({self=false,mode='manual',modality='DX',sharedTask}={})=>{
  const id=randomUUID(),task=sharedTask??randomUUID(),study=randomUUID(),series=randomUUID(),objectId=randomUUID();cases.push(id);
  await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method,disease_tag_id) VALUES($1,$2,'标注中','synthetic','resp','临床综合诊断',$3)",[id,id,disease.id]);
  if(!sharedTask)await db.query("INSERT INTO tasks(id,name,source,system_code,review_mode,status,dispatch_mode,priority) VALUES($1,'合成审核','synthetic','resp',$2,'进行中',$3,0)",[task,self?'self':'peer',mode]);
  await db.query('INSERT INTO task_cases(task_id,case_id) VALUES($1,$2)',[task,id]);
  await db.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,state) VALUES($1,$2,'annotate','active')",[id,actor.id]);
  await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','127.0.0.1')",[actor.id,`cases:${id}`]);
  await db.query("INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,'2026-10-02')",[study,id,study]);
  await db.query("INSERT INTO series(id,study_id,modality,series_uid,orthanc_id,frame_count,default_window) VALUES($1,$2,$3,$4,$5,$6,$7)",[series,study,modality,series,randomUUID(),modality==='CT'?300:1,modality==='CT'?JSON.stringify({center:40,width:400}):null]);
  await db.query("INSERT INTO reports(case_id,raw_text,sentences) VALUES($1,'合成结节',$2)",[id,JSON.stringify([{idx:0,text:'肺内结节'}])]);
  const object={id:objectId,series_id:series,tool:'box',geometry:{x:2,y:3,w:10,h:10},frame_start:0,frame_end:modality==='CT'?20:0,key_frame_index:0,window_preset:modality==='CT'?'lung':null,part_id:part.part_id,confidence:'typical',sign_tag_ids:[sign.id],report_sent_ids:[0]};
  const save=(v,objects=[object])=>fetch(`${base}/api/cases/${id}/annotations`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expected_version:v,annotations:objects})});
  assert.equal((await save(0)).status,200);
  assert.equal((await send(`/api/cases/${id}/submit`,{expected_version:1},token)).status,201);
  const reviewToken=self?token:otherToken;
  if(!self)assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:task,case_ids:[id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);
  assert.equal((await send('/api/tasks/start-review',{task_id:task,case_id:id},reviewToken)).status,201);
  const decide=(result='通过',version=1,comments=[checks],auth=reviewToken)=>send(`/api/reviews/${id}`,{expected_version:version,result,comments},auth);
  const state=async()=>(await db.query('SELECT status,annotation_version FROM cases WHERE id=$1',[id]))[0];
  return {id,task,series,objectId,object,save,decide,state,reviewToken};
 };
 const f=await fixture();
 for(const auth of ['',token,adminToken])assert.equal((await get(`/api/reviews/${f.id}`,auth)).status,auth?403:401);
 let response=await get(`/api/reviews/${f.id}`,otherToken);assert.equal(response.status,200);let data=await response.json();
 assert.equal(data.review_mode,'peer');assert.equal(data.disease.id,disease.id);assert.equal(data.version,1);assert.equal(data.annotations[0].id,f.objectId);assert.equal(data.case.status,'审核中');
 assert(!JSON.stringify(data).includes('orthanc_id'));assert.equal((await get(`/api/reviews/${f.id}?admin=true`,otherToken)).status,400);assert.equal((await get(`/api/reviews/${f.id}?version=2`,otherToken)).status,404);
 assert.equal((await f.decide('通过',0)).status,409);assert.equal((await f.decide('通过',1,[{...checks,disease_label:false}])).status,400);
 assert.equal((await f.decide('打回',1,[checks])).status,400);
 assert.equal((await f.decide('打回',1,[checks,{kind:'object',annotation_id:randomUUID(),text:'修正轮廓'}])).status,400);
 assert.equal((await f.decide('通过',1,[checks],token)).status,403);
 const attachment=randomUUID();await db.query("INSERT INTO attachments(id,case_id,kind,object_key,filename,size,deid_confirmed) VALUES($1,$2,'其他',$3,'合成.png','1',true)",[attachment,f.id,`cases/${f.id}/review-test`]);
 const preview=`/api/reviews/${f.id}/attachments/${attachment}/preview?page=1`;
 response=await get(preview,otherToken);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/png/);assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.equal((await get(preview,token)).status,403);assert.equal((await get(preview,adminToken)).status,403);assert.equal((await get(preview+'&raw=true',otherToken)).status,400);
 assert.equal((await get(`/api/reviews/${f.id}/attachments/${randomUUID()}/preview?page=1`,otherToken)).status,404);
 await db.query('UPDATE attachments SET deid_confirmed=false WHERE id=$1',[attachment]);assert.equal((await get(preview,otherToken)).status,404);await db.query('UPDATE attachments SET deid_confirmed=true WHERE id=$1',[attachment]);
 const cross=await fixture();assert.equal((await get(`/api/reviews/${cross.id}/attachments/${attachment}/preview?page=1`,otherToken)).status,404);
 const {AttachmentObjectService}=require('../dist/modules/cases/attachment-object.service');
 const storage=app.get(AttachmentObjectService),readPng=storage.readPng;
 try{
  storage.readPng=async(...args)=>{const bytes=await readPng(...args);await db.query("UPDATE task_assignments SET due_at=clock_timestamp()-interval '1 second' WHERE case_id=$1 AND state='active'",[f.id]);return bytes;};
  assert.equal((await get(preview,otherToken)).status,403,'deadline expires during attachment storage read');
 }finally{storage.readPng=readPng;await db.query("UPDATE task_assignments SET due_at=NULL WHERE case_id=$1 AND state='active'",[f.id]);}
 // Every failure leaves case, review count, assignment and gold state intact.
 const counts=async()=> (await db.query(`SELECT (SELECT count(*)::int FROM reviews WHERE case_id=$1) reviews,
   (SELECT count(*)::int FROM task_assignments WHERE case_id=$1 AND state='active') active,
   (SELECT count(*)::int FROM annotation_objects WHERE case_id=$1 AND is_gold) gold`,[f.id]))[0];
 await db.query(`CREATE FUNCTION fail_review_audit() RETURNS trigger AS $$ BEGIN IF NEW.action IN ('reviews.decided','cases.published','reviews.viewed','workbench.attachment_viewed') THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await db.query('CREATE TRIGGER fail_review BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_review_audit()');
 assert.equal((await get(`/api/reviews/${f.id}`,otherToken)).status,500);assert.equal((await get(preview,otherToken)).status,500,'audit failure must withhold PNG');
 assert.equal((await f.decide()).status,500);assert.deepEqual(await counts(),{reviews:0,active:1,gold:0});assert.equal((await f.state()).status,'审核中');
 await db.query('DROP TRIGGER fail_review ON audit_logs');
 const race=await Promise.all([f.decide(),f.decide()]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);assert.deepEqual(await counts(),{reviews:1,active:0,gold:1});assert.equal((await f.state()).status,'已发布');assert.equal((await f.save(1)).status,403);assert.equal((await get(preview,otherToken)).status,403);
 const [stored]=await db.query('SELECT * FROM reviews WHERE case_id=$1',[f.id]);assert.equal(stored.reviewer_id,other.id);assert.equal(stored.is_spotcheck,false);assert.equal(stored.comments[0].annotation_version,1);assert.equal(stored.comments[0].reviewer_id,other.id);assert.match(stored.comments[0].created_at,/Z$/);
 // Return preserves old versions and makes its comments visible only to a valid reannotation assignee.
 const returned=await fixture({modality:'CT'}),opinion=[checks,{kind:'object',annotation_id:returned.objectId,text:'请微调边界并核对报告关联。'}];
 response=await returned.decide('打回',1,opinion);assert.equal(response.status,201);data=await response.json();assert.equal(data.status,'标注中');assert.equal(data.reannotation.assignee_id,actor.id);
 assert.equal((await get(`/api/reviews/${returned.id}`,otherToken)).status,403);data=await (await get(`/api/cases/${returned.id}/annotations`,token)).json();assert.equal(data.latest_review.comments[1].annotation_id,returned.objectId);
 assert.equal((await get(`/api/cases/${returned.id}/annotations`,otherToken)).status,403);assert.equal((await returned.save(1,[{...returned.object,geometry:{x:4,y:5,w:12,h:10}}])).status,200);
 assert.equal((await send(`/api/cases/${returned.id}/submit`,{expected_version:2},token)).status,201);
 assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:returned.task,case_ids:[returned.id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);
 assert.equal((await send('/api/tasks/start-review',{task_id:returned.task,case_id:returned.id},otherToken)).status,201);
 data=await (await get(`/api/reviews/${returned.id}?version=1`,otherToken)).json();assert.equal(data.annotations[0].geometry.x,2);assert.equal(data.current_version,2);
 assert.equal((await returned.decide('通过',2)).status,201);assert.equal((await db.query('SELECT is_gold FROM annotation_objects WHERE case_id=$1 AND version=1',[returned.id]))[0].is_gold,false);
 assert.equal((await db.query('SELECT is_gold FROM annotation_objects WHERE case_id=$1 AND version=2',[returned.id]))[0].is_gold,true);
 // Self-review counts capacity after finishing the review assignment.
 const self=await fixture({self:true});await db.query('UPDATE tasks SET in_flight_limit=1 WHERE id=$1',[self.task]);
 response=await self.decide('打回',1,[checks,{kind:'overall',text:'请修正边界。'}]);assert.equal(response.status,201);assert.equal((await response.json()).status,'标注中');
 await db.query("UPDATE task_assignments SET state='released' WHERE case_id=$1 AND state='active'",[self.id]);
 // Approved exception: stopped account, missing qualification, or capacity -> pending allocation, never an unauthorized active assignment.
 for(const [change,reason] of [[{status:'disabled'},'account_unavailable'],[{quals:{resp:['review']}},'qualification_removed'],[{in_flight_limit:1},'capacity_full']]){
  const item=await fixture();const [before]=await db.query('SELECT *,expire_at::text FROM users WHERE id=$1',[actor.id]);const [key,value]=Object.entries(change)[0];await db.query(`UPDATE users SET ${key}=$2 WHERE id=$1`,[actor.id,key==='quals'?JSON.stringify(value):value]);
  response=await item.decide('打回',1,[checks,{kind:'overall',text:'请核对标签。'}]);assert.equal(response.status,201);data=await response.json();assert.equal(data.status,'待分配');assert.equal(data.reannotation.reason,reason);
  assert.equal((await db.query("SELECT count(*)::int n FROM task_assignments WHERE case_id=$1 AND state='active'",[item.id]))[0].n,0);
  await db.query(`UPDATE users SET ${key}=$2 WHERE id=$1`,[actor.id,key==='quals'?JSON.stringify(before[key]):before[key]]);
 }
 const invalid=await fixture();await db.query('UPDATE cases SET disease_tag_id=NULL WHERE id=$1',[invalid.id]);assert.equal((await invalid.decide()).status,400);
 const [wrongRoot]=await db.query("INSERT INTO taxonomy_nodes(level,name,synonyms) VALUES(1,'骨骼','[]') RETURNING id");
 const [wrongPart]=await db.query("INSERT INTO taxonomy_nodes(parent_id,level,name,synonyms) VALUES($1,2,'合成部位','[]') RETURNING id",[wrongRoot.id]);
 const [wrongDisease]=await db.query("INSERT INTO taxonomy_nodes(parent_id,level,name,synonyms) VALUES($1,3,'合成异系统疾病','[]') RETURNING id",[wrongPart.id]);
 await db.query('UPDATE cases SET disease_tag_id=$2 WHERE id=$1',[invalid.id,wrongDisease.id]);assert.equal((await invalid.decide()).status,400);
 // Review authorization is live, including during attachment I/O, not a frontend route guard.
 const boundary=await fixture();const [a]=await db.query("SELECT id FROM task_assignments WHERE case_id=$1 AND state='active'",[boundary.id]);
 await db.query("UPDATE task_assignments SET due_at=now()-interval '1 second' WHERE id=$1",[a.id]);assert.equal((await boundary.decide()).status,403);assert.equal((await get(`/api/reviews/${boundary.id}`,otherToken)).status,403);await db.query('UPDATE task_assignments SET due_at=NULL WHERE id=$1',[a.id]);
 const [u]=await db.query('SELECT quals,status,updated_at FROM users WHERE id=$1',[other.id]);
 await db.query("UPDATE users SET quals='{}' WHERE id=$1",[other.id]);assert.equal((await boundary.decide()).status,403);await db.query('UPDATE users SET quals=$2 WHERE id=$1',[other.id,JSON.stringify(u.quals)]);
 await db.query("UPDATE users SET status='disabled' WHERE id=$1",[other.id]);assert.equal((await boundary.decide()).status,403);await db.query('UPDATE users SET status=$2 WHERE id=$1',[other.id,u.status]);
 await db.query("UPDATE users SET updated_at=updated_at+interval '1 second' WHERE id=$1",[other.id]);assert.equal((await boundary.decide()).status,401);await db.query('UPDATE users SET updated_at=$2 WHERE id=$1',[other.id,u.updated_at]);
 // No leftover active fixtures alter existing frame budgets/capacity checks.
 await db.query("UPDATE task_assignments SET state='released' WHERE case_id=ANY($1::uuid[]) AND state='active'",[cases]);
 await require('./case-lifecycle.assertions.cjs')({db,app,base,get,send,fixture,actor,other,token,otherToken,adminToken});
 await db.query("UPDATE task_assignments SET state='released' WHERE case_id=ANY($1::uuid[]) AND state='active'",[cases]);
 await require('./quality-reviews.assertions.cjs')({db,app,base,get,send,fixture,actor,other,token,otherToken,adminToken,checks});
 await db.query("UPDATE task_assignments SET state='released' WHERE case_id=ANY($1::uuid[]) AND state='active'",[cases]);
 console.log('PASS: review HTTP read/attachments, self/peer isolation, veto checks, optimistic/concurrent decisions, atomic audit rollback, DX/CT publication gold lock, return/re-submit history, self capacity and unavailable/qualification/capacity fallback');
};
