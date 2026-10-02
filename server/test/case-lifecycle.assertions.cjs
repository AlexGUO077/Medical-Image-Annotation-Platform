// Real HTTP/PG transactions; uses the existing synthetic annotation/review fixtures.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
module.exports=async({db,app,base,get,send,fixture,actor,other,token,otherToken,adminToken})=>{
 const change=(f,action='offline',version=1,auth=adminToken,body={expected_version:version})=>send(`/api/cases/${f.id}/${action}`,body,auth);
 const oldRows=async f=>(await db.query('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) rows FROM annotation_objects a WHERE case_id=$1 AND version=1',[f.id]))[0].rows;
 const oldTags=async f=>(await db.query('SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) rows FROM annotation_tags t JOIN annotation_objects a ON a.id=t.annotation_id WHERE a.case_id=$1 AND a.version=1',[f.id]))[0].rows;
 const f=await fixture({modality:'CT'});
 const uid=`2.25.${BigInt('0x'+randomUUID().replaceAll('-',''))}`;await db.query('UPDATE series SET series_uid=$2 WHERE id=$1',[f.series,uid]);
 const frame={case_id:f.id,series_uid:uid,frame_index:0};
 const ticketResponse=await send('/api/frames/ticket',frame,otherToken);assert.equal(ticketResponse.status,201);const ticket=await ticketResponse.json();
 assert.equal((await f.decide()).status,201);const objects=await oldRows(f),tags=await oldTags(f);
 for(const auth of ['',token,otherToken])assert.equal((await change(f,'offline',1,auth)).status,auth?403:401);
 for(const body of [{},{expected_version:-1},{expected_version:1,status:'已录入'},{expected_version:1.5}])assert.equal((await change(f,'offline',1,adminToken,body)).status,400);
 assert.equal((await change(f,'offline',0)).status,409);assert.equal((await change(f,'reactivate')).status,409);
 assert.equal((await change({id:randomUUID()})).status,404);
 await db.query("UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1",[f.id]);assert.equal((await change(f)).status,403);await db.query("UPDATE cases SET source='synthetic' WHERE id=$1",[f.id]);
 const unconfirmed=randomUUID();await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method) VALUES($1,$2,'已发布','synthetic','resp','临床综合诊断')",[unconfirmed,unconfirmed]);assert.equal((await change({id:unconfirmed},'offline',0)).status,403);
 // Fail at the final sensitive audit to prove release/state/copy are in the same transaction.
 await db.query(`CREATE FUNCTION fail_lifecycle_audit() RETURNS trigger AS $$ BEGIN IF NEW.action IN ('cases.offlined','cases.reactivated') THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await db.query('CREATE TRIGGER fail_lifecycle BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_audit()');
 const [residual]=await db.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,state) VALUES($1,$2,'review','active') RETURNING id",[f.id,other.id]);
 assert.equal((await change(f)).status,500);assert.equal((await f.state()).status,'已发布');assert.equal((await db.query('SELECT state FROM task_assignments WHERE id=$1',[residual.id]))[0].state,'active');
 await db.query('DROP TRIGGER fail_lifecycle ON audit_logs');
 const race=await Promise.all([change(f),change(f)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);assert.deepEqual(await f.state(),{status:'已下线',annotation_version:1});
 assert.equal((await db.query('SELECT state FROM task_assignments WHERE id=$1',[residual.id]))[0].state,'released');assert.deepEqual(await oldRows(f),objects);assert.deepEqual(await oldTags(f),tags);
 assert.equal((await get(ticket.url,otherToken)).status,403);assert.equal((await send('/api/frames/ticket',frame,otherToken)).status,403);assert.equal((await get(`/api/reviews/${f.id}`,otherToken)).status,403);assert.equal((await f.save(1)).status,403);
 await db.query("UPDATE tasks SET status='已完成' WHERE id=$1",[f.task]);assert.equal((await change(f,'reactivate')).status,409);assert.deepEqual(await f.state(),{status:'已下线',annotation_version:1});await db.query("UPDATE tasks SET status='进行中' WHERE id=$1",[f.task]);
 await db.query('UPDATE task_cases SET deleted_at=now() WHERE case_id=$1',[f.id]);assert.equal((await change(f,'reactivate')).status,409);await db.query('UPDATE task_cases SET deleted_at=NULL WHERE case_id=$1',[f.id]);
 await db.query("UPDATE cases SET annotation_version=2147483647 WHERE id=$1",[f.id]);assert.equal((await change(f,'reactivate',2147483647)).status,409);await db.query('UPDATE cases SET annotation_version=1 WHERE id=$1',[f.id]);
 await db.query('CREATE TRIGGER fail_lifecycle BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_audit()');
 assert.equal((await change(f,'reactivate')).status,500);assert.deepEqual(await f.state(),{status:'已下线',annotation_version:1});assert.equal((await db.query('SELECT count(*)::int n FROM annotation_objects WHERE case_id=$1 AND version=2',[f.id]))[0].n,0);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE target=$1 AND action='annotations.seeded'",[`cases:${f.id}`]))[0].n,0);
 await db.query('DROP TRIGGER fail_lifecycle ON audit_logs');
 const rerace=await Promise.all([change(f,'reactivate'),change(f,'reactivate')]);assert.deepEqual(rerace.map(r=>r.status).sort(),[201,409]);assert.deepEqual(await f.state(),{status:'待分配',annotation_version:2});
 assert.deepEqual(await oldRows(f),objects);assert.deepEqual(await oldTags(f),tags);
 const [seed]=await db.query('SELECT * FROM annotation_objects WHERE case_id=$1 AND version=2',[f.id]);assert.equal(seed.is_gold,false);assert.equal(seed.logical_id,f.objectId);assert.equal(seed.created_by,actor.id);assert.deepEqual(seed.geometry,f.object.geometry);
 assert.equal((await db.query('SELECT sign_tag_id FROM annotation_tags WHERE annotation_id=$1',[seed.id]))[0].sign_tag_id,f.object.sign_tag_ids[0]);
 assert.equal((await change(f,'offline',2)).status,409);assert.equal((await change(f,'reactivate',2)).status,409);
 const assign=async item=>{const response=await send('/api/tasks/dispatch',{mode:'manual',task_id:item.task,case_ids:[item.id],assignee_id:actor.id,task_role:'annotate'},adminToken);assert.equal(response.status,201);};
 await assign(f);let response=await get(`/api/cases/${f.id}/annotations`,token);assert.equal(response.status,200);assert.equal((await response.json()).version,2);
 assert.equal((await f.save(1)).status,409);assert.equal((await f.save(2,[{...f.object,geometry:{x:4,y:3,w:12,h:10}}])).status,200);assert.deepEqual(await oldRows(f),objects);
 assert.equal((await send(`/api/cases/${f.id}/submit`,{expected_version:3},token)).status,201);
 assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:f.task,case_ids:[f.id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);
 assert.equal((await send('/api/tasks/start-review',{task_id:f.task,case_id:f.id},otherToken)).status,201);
 response=await get(`/api/reviews/${f.id}?version=1`,otherToken);assert.equal(response.status,200);assert.equal((await response.json()).annotations[0].is_gold,true);
 assert.equal((await f.decide('通过',3)).status,201);assert.deepEqual(await oldRows(f),objects);assert.equal((await db.query('SELECT is_gold FROM annotation_objects WHERE case_id=$1 AND version=3',[f.id]))[0].is_gold,true);
 // Zero-object reactivation produces a readable seed without pretending to be a human save.
 const empty=await fixture();assert.equal((await empty.decide('打回',1,[{kind:'checks',deidentification:true,confirmation_basis:true,disease_label:true},{kind:'overall',text:'请核对阴性报告。'}])).status,201);
 await db.query("UPDATE reports SET raw_text='未见异常',sentences=$2 WHERE case_id=$1",[empty.id,JSON.stringify([{idx:0,text:'未见异常',negative:true}])]);
 assert.equal((await empty.save(1,[])).status,200);assert.equal((await send(`/api/cases/${empty.id}/submit`,{expected_version:2},token)).status,201);
 assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:empty.task,case_ids:[empty.id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);assert.equal((await send('/api/tasks/start-review',{task_id:empty.task,case_id:empty.id},otherToken)).status,201);assert.equal((await empty.decide('通过',2)).status,201);
 assert.equal((await change(empty,'offline',2)).status,201);assert.equal((await change(empty,'reactivate',2)).status,201);await assign(empty);
 response=await get(`/api/cases/${empty.id}/annotations?version=3`,token);assert.equal(response.status,200);assert.deepEqual((await response.json()).annotations,[]);
 assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE target=$1 AND action='annotations.saved' AND detail->>'version'='3'",[`cases:${empty.id}`]))[0].n,0);
 assert.equal((await send(`/api/cases/${empty.id}/submit`,{expected_version:3},token)).status,201);
 assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:empty.task,case_ids:[empty.id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);assert.equal((await send('/api/tasks/start-review',{task_id:empty.task,case_id:empty.id},otherToken)).status,201);
 response=await get(`/api/reviews/${empty.id}?version=3`,otherToken);assert.equal(response.status,200);assert.deepEqual((await response.json()).annotations,[]);assert.equal((await empty.decide('通过',3)).status,201);
 // Existing auto/pool modes consume the reactivated pending case unchanged.
 for(const mode of ['auto','pool']){
  const item=await fixture();assert.equal((await item.decide()).status,201);assert.equal((await change(item)).status,201);assert.equal((await change(item,'reactivate')).status,201);await db.query('UPDATE tasks SET dispatch_mode=$2 WHERE id=$1',[item.task,mode]);
  if(mode==='auto'){const {TaskDispatchService}=require('../dist/modules/tasks/task-dispatch.service');await app.get(TaskDispatchService).maintainAutomatic();}
  else assert.equal((await send('/api/tasks/dispatch',{mode:'pool',task_id:item.task,case_id:item.id,task_role:'annotate'},token)).status,201);
  assert.equal((await item.state()).status,'标注中');await db.query("UPDATE task_assignments SET state='released' WHERE case_id=$1 AND state='active'",[item.id]);
 }
 const jwt=new (require('@nestjs/jwt').JwtService)({secret:process.env.JWT_SECRET}),claims=jwt.decode(adminToken);
 assert.equal((await change(f,'offline',3,jwt.sign({...claims,exp:Math.floor(Date.now()/1000)-1}))).status,401);
 console.log('PASS: administrator lifecycle HTTP authorization, audit rollback and concurrent conflicts; offline frame denial/residual release; immutable old gold/tags, seeded/empty versions, re-save/submit/publication and original manual/auto/pool reallocation');
};
