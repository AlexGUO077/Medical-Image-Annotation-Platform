// Same DX/CT annotation/save/submit/review routes as the review suite; real ES is opt-in and enabled in CI.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({db,app,base,get,send,fixture,actor,other,token,otherToken,adminToken,realSearch,setRenderHook})=>{
 const {ElasticService}=require('../dist/modules/search/elastic.service');
 const {SearchSyncService}=require('../dist/modules/search/search-sync.service');
 const {searchEvents}=require('../dist/modules/search/search-events');
 const elastic=app.get(ElasticService),sync=new SearchSyncService(db,elastic),events=[];
 const record=id=>events.push(id);searchEvents.on('case',record);
 const dx=await fixture(),ct=await fixture({modality:'CT'});
 for(const item of [dx,ct]){item.uid=`2.25.${BigInt('0x'+randomUUID().replaceAll('-',''))}`;await db.query('UPDATE series SET series_uid=$2 WHERE id=$1',[item.series,item.uid]);}
 try{
  await db.query("UPDATE cases SET clinical_text='wp12unique clinicalneedle' WHERE id=ANY($1::uuid[])",[[dx.id,ct.id]]);
  await db.query("UPDATE reports SET raw_text='wp12unique reportneedle 合成肺部结节' WHERE case_id=ANY($1::uuid[])",[[dx.id,ct.id]]);
  // Rollback must neither publish nor enqueue ES work.
  await db.query(`CREATE FUNCTION fail_library_publish() RETURNS trigger AS $$ BEGIN IF NEW.action='cases.published' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fail_library_publish BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_library_publish()');
  assert.equal((await dx.decide()).status,500);assert(!events.includes(dx.id));
  assert.equal((await get(`/api/library/${dx.id}`)).status,403);
  await db.query('DROP TRIGGER fail_library_publish ON audit_logs');
  for(const item of [dx,ct]){assert.equal((await item.decide()).status,201);assert(events.includes(item.id));}
  const unconfirmed=randomUUID();await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method) VALUES($1,$2,'已发布','synthetic','resp','临床综合诊断')",[unconfirmed,unconfirmed]);assert.equal((await get(`/api/library/${unconfirmed}`)).status,403);
  const negatives=await db.query("SELECT c.id FROM cases c WHERE c.status='已发布' AND NOT EXISTS(SELECT 1 FROM annotation_objects a WHERE a.case_id=c.id AND a.version=c.annotation_version AND a.deleted_at IS NULL) AND EXISTS(SELECT 1 FROM audit_logs l WHERE l.target='cases:'||c.id::text AND l.action='cases.published')");assert(negatives.length>0);assert.equal((await get(`/api/library/${negatives[0].id}`)).status,200);
  assert.equal((await get('/api/search','')).status,401);
  for(const q of ['?source=real','?admin=true','?page=0','?pageSize=101','?q=a&q=b','?part_id=bad'])assert.equal((await get('/api/search'+q)).status,400);
  let response=await get('/api/search?pageSize=1');assert.equal(response.status,200);let data=await response.json();assert.equal(data.items.length,1);assert(data.total>=2);
  const total=data.total;const second=await (await get('/api/search?page=2&pageSize=1')).json();assert.equal(second.total,total);assert.notEqual(second.items[0].id,data.items[0].id);
  for(const item of [dx,ct]){
   response=await get(`/api/library/${item.id}`,otherToken);assert.equal(response.status,200);data=await response.json();assert.equal(data.version,1);assert.equal(data.annotations[0].id,item.objectId);assert.equal(data.case.status,'已发布');
   assert(!JSON.stringify(data).includes('orthanc_id'));assert(!JSON.stringify(data).includes('object_key'));
   assert.equal((await get(`/api/workbench/${item.id}`,otherToken)).status,403);
   const issue=(patch={})=>send('/api/frames/ticket',{case_id:item.id,series_uid:item.uid,frame_index:0,access_mode:'library',expected_version:1,...patch},otherToken);
   response=await issue();assert.equal(response.status,201);const ticket=await response.json();response=await get(ticket.url,otherToken);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/png/);
   assert.equal((await issue({expected_version:0})).status,403);assert.equal((await issue({expected_version:undefined})).status,400);assert.equal((await issue({access_mode:undefined})).status,400);
   assert.equal((await send('/api/frames/ticket',{case_id:item.id,series_uid:item.uid,frame_index:0},otherToken)).status,403);
   // Cached library PNG still rechecks source, deletion, deidentification and live account qualification.
   for(const [sql,args,restore] of [
    ["UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1",[item.id],"UPDATE cases SET source='synthetic' WHERE id=$1"],
    ['UPDATE cases SET deleted_at=now() WHERE id=$1',[item.id],'UPDATE cases SET deleted_at=NULL WHERE id=$1'],
    ["UPDATE users SET quals='{}' WHERE id=$1",[other.id],`UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE id=$1`],
   ]){await db.query(sql,args);assert.equal((await get(`/api/library/${item.id}`,otherToken)).status,403);assert.equal((await get(ticket.url,otherToken)).status,403);await db.query(restore,args);}
   await db.query("UPDATE users SET quals='{}' WHERE id=(SELECT id FROM users WHERE role='admin' LIMIT 1)");assert.equal((await get(`/api/library/${item.id}`,adminToken)).status,403);await db.query(`UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE role='admin'`);
   await db.query(`UPDATE users SET quals='{"resp":["review"]}' WHERE id=$1`,[other.id]);assert.equal((await get(`/api/library/${item.id}`,otherToken)).status,200);await db.query(`UPDATE users SET quals='{"resp":["annotate","review"]}' WHERE id=$1`,[other.id]);
  }
  const attachment=randomUUID();await db.query("INSERT INTO attachments(id,case_id,kind,object_key,filename,size,deid_confirmed) VALUES($1,$2,'其他',$3,'合成病例库.png',1,true)",[attachment,dx.id,`cases/${dx.id}/synthetic-library`]);
  const preview=`/api/library/${dx.id}/attachments/${attachment}/preview?page=1&version=1`;
  assert.equal((await get(preview,otherToken)).status,200);assert.equal((await get(preview.replace('&version=1',''),otherToken)).status,400);assert.equal((await get(preview.replace('&version=1','&version=0'),otherToken)).status,403);
  await db.query(`CREATE FUNCTION fail_library_read() RETURNS trigger AS $$ BEGIN IF NEW.action IN ('library.viewed','library.attachment_viewed') THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);await db.query('CREATE TRIGGER fail_library_read BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_library_read()');assert.equal((await get(`/api/library/${dx.id}`)).status,500);assert.equal((await get(preview,otherToken)).status,500);await db.query('DROP TRIGGER fail_library_read ON audit_logs');
  if(realSearch){
   await sync.runOnce(true);
   const query=async(q)=>{const r=await get('/api/search?'+q);assert.equal(r.status,200);return r.json();};
   data=await query('q=reportneedle%20clinicalneedle');assert.deepEqual(new Set(data.items.map(i=>i.id)),new Set([dx.id,ct.id]));assert.equal(data.total,2);
   for(const modality of ['DX','CT']){data=await query(`q=wp12unique&modality=${modality}`);assert.equal(data.total,1);assert.equal(data.items[0].id,modality==='DX'?dx.id:ct.id);}
   data=await query(`q=wp12unique&part_id=${dx.object.part_id}&sign_tag_id=${dx.object.sign_tag_ids[0]}`);assert.equal(data.total,2);
   const [disease]=await db.query('SELECT disease_tag_id FROM cases WHERE id=$1',[dx.id]);data=await query(`q=wp12unique&disease_id=${disease.disease_tag_id}&modality=MR`);assert.equal(data.total,0);
   data=await query('q='+encodeURIComponent('肺部结节'));assert.equal(data.total,2);
   const [subtype]=await db.query("INSERT INTO taxonomy_nodes(parent_id,level,name,synonyms) VALUES($1,4,'合成检索亚型','[]') RETURNING id",[disease.disease_tag_id]);await db.query('UPDATE cases SET disease_tag_id=$2,updated_at=clock_timestamp() WHERE id=$1',[ct.id,subtype.id]);await sync.syncCase(ct.id);data=await query(`q=wp12unique&disease_id=${disease.disease_tag_id}`);assert.equal(data.total,2);data=await query(`q=wp12unique&disease_id=${subtype.id}`);assert.equal(data.total,1);assert.equal(data.items[0].id,ct.id);
   data=await query('q=wp12unique&pageSize=1&page=2');assert.equal(data.items.length,1);assert.equal(data.total,2);
   // Current content revision excludes stale report text before synchronization catches up.
   await db.query("UPDATE reports SET raw_text='newreport',updated_at=clock_timestamp() WHERE case_id=$1",[dx.id]);data=await query('q=reportneedle');assert.equal(data.total,1);assert.equal(data.items[0].id,ct.id);await sync.syncCase(dx.id);data=await query('q=newreport');assert.equal(data.total,1);
   // Query I/O races with PG visibility changes: result AND total are re-evaluated.
   const match=elastic.match.bind(elastic);elastic.match=async(...args)=>{const hits=await match(...args);await db.query("UPDATE cases SET status='已下线' WHERE id=$1",[ct.id]);return hits;};
   try{data=await query('q=clinicalneedle');assert.equal(data.total,1);assert.equal(data.items[0].id,dx.id);}finally{elastic.match=match;await db.query("UPDATE cases SET status='已发布' WHERE id=$1",[ct.id]);}
   const orphan=randomUUID();await elastic.put({case_id:orphan,revision_key:'orphan',system_code:'resp',source:'synthetic',report_text:'clinicalneedle',clinical_text:''});data=await query('q=clinicalneedle');assert.equal(data.total,2);await sync.runOnce(true);assert(!(await elastic.ids()).includes(orphan));
   // Runtime service account is actually denied access to security management.
   const denied=await fetch(`http://${process.env.ELASTICSEARCH_HOST}:${process.env.ELASTICSEARCH_PORT}/_security/user`,{headers:{Authorization:`Basic ${Buffer.from(`${process.env.SEARCH_ELASTIC_USERNAME}:${process.env.SEARCH_ELASTIC_PASSWORD}`).toString('base64')}`}});assert.equal(denied.status,403);
   const originalPort=process.env.ELASTICSEARCH_PORT;process.env.ELASTICSEARCH_PORT='1';try{assert.equal((await get('/api/search?q=clinicalneedle')).status,503);assert.equal((await get('/api/search')).status,200);assert.equal((await get(`/api/library/${dx.id}`)).status,200);await assert.rejects(sync.runOnce(true));}finally{process.env.ELASTICSEARCH_PORT=originalPort;}await sync.runOnce(true);
  }else assert.equal((await get('/api/search?q=wp12unique')).status,503);
  // Offline takes effect through all PG gates before ES deletion; old gold is retained.
  const issued=await (await send('/api/frames/ticket',{case_id:dx.id,series_uid:dx.uid,frame_index:0,access_mode:'library',expected_version:1},otherToken)).json();
  response=await send(`/api/cases/${dx.id}/offline`,{expected_version:1},adminToken);assert.equal(response.status,201);
  assert.equal((await get(`/api/library/${dx.id}`,otherToken)).status,403);assert.equal((await get(issued.url,otherToken)).status,403);assert.equal((await get(preview,otherToken)).status,403);
  assert.equal((await db.query('SELECT is_gold FROM annotation_objects WHERE case_id=$1 AND version=1',[dx.id]))[0].is_gold,true);
  if(realSearch){const r=await get('/api/search?q=newreport');assert.equal(r.status,200);assert.equal((await r.json()).total,0);await sync.syncCase(dx.id);assert(!(await elastic.ids()).includes(dx.id));}
  assert.equal((await send(`/api/cases/${dx.id}/reactivate`,{expected_version:1},adminToken)).status,201);assert.equal((await get(`/api/library/${dx.id}`)).status,403);
  assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:dx.task,case_ids:[dx.id],assignee_id:actor.id,task_role:'annotate'},adminToken)).status,201);assert.equal((await dx.save(2)).status,200);assert.equal((await send(`/api/cases/${dx.id}/submit`,{expected_version:3},token)).status,201);assert.equal((await send('/api/tasks/dispatch',{mode:'manual',task_id:dx.task,case_ids:[dx.id],assignee_id:other.id,task_role:'review'},adminToken)).status,201);assert.equal((await send('/api/tasks/start-review',{task_id:dx.task,case_id:dx.id},otherToken)).status,201);assert.equal((await dx.decide('通过',3)).status,201);data=await (await get(`/api/library/${dx.id}`)).json();assert.equal(data.version,3);assert.equal((await get(issued.url,otherToken)).status,403);assert.equal((await get(preview,otherToken)).status,403);if(realSearch){await sync.syncCase(dx.id);data=await (await get('/api/search?q=newreport')).json();assert.equal(data.total,1);assert.equal(data.items[0].version,3);}
  // Uncached render must not release bytes if publication is withdrawn during render.
  const target={case_id:ct.id,series_uid:ct.uid,frame_index:1,window:{center:123,width:987},access_mode:'library',expected_version:1};response=await send('/api/frames/ticket',target,otherToken);assert.equal(response.status,201);const ctTicket=await response.json();
  setRenderHook(()=>db.query("UPDATE cases SET status='已下线' WHERE id=$1",[ct.id]));try{assert.equal((await get(ctTicket.url,otherToken)).status,403);}finally{setRenderHook(undefined);}
  console.log(`PASS: published library DX/CT pipeline, pagination/AND filters, qualification/no-admin-bypass, explicit version-bound frames/attachments, cached/post-render revocation, atomic sync event${realSearch?', real ES cross-field full text/revision races/orphan reconciliation/outage/recovery/service account':''}`);
 }finally{searchEvents.off('case',record);await sync.onModuleDestroy();}
};
