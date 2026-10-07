const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
module.exports=async({db,app,base,get,token,adminToken,dx,ct})=>{
 const {AuthTokenService}=require('../dist/modules/auth/auth-token.service');const signer=app.get(AuthTokenService),requester=signer.verify(adminToken,['access']).sub;
 const [approver]=await db.query(`INSERT INTO users(username,password_hash,real_name,role,status,expire_at,must_change_password,mfa_secret_encrypted,quals)
 VALUES($1,'synthetic-unused','合成导出审批人','admin','active','2099-12-31',false,'synthetic','{}') RETURNING *,expire_at::text`,[randomUUID()]);const approveToken=signer.signAccess(approver);
 const send=(path,body,auth=adminToken)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
 const create=async(ids=[dx.id,ct.id])=>{const r=await send('/api/exports',{case_ids:ids});assert.equal(r.status,201);return (await r.json()).id;};
 const decide=(id,decision='approve',auth=approveToken)=>send(`/api/exports/${id}/approve`,{decision},auth);
 const download=(id,auth=adminToken)=>get(`/api/exports/${id}/download`,auth);
 const state=async id=>(await db.query('SELECT * FROM export_requests WHERE id=$1',[id]))[0];
 const objectService=app.get(require('../dist/modules/cases/attachment-object.service').AttachmentObjectService);
 for(const auth of ['',token]){assert.equal((await get('/api/exports',auth)).status,auth?403:401);assert.equal((await get('/api/audit',auth)).status,auth?403:401);assert.equal((await send('/api/exports',{case_ids:[dx.id]},auth)).status,auth?403:401);}
 for(const body of [{case_ids:[]},{case_ids:[dx.id,dx.id]},{case_ids:['bad']},{case_ids:Array(21).fill(dx.id)},{case_ids:[dx.id],raw:true}])assert.equal((await send('/api/exports',body)).status,400);
 assert.equal((await get('/api/exports?page=1&page=2',adminToken)).status,400);
 const options=await get('/api/exports/candidates?pageSize=100',adminToken);assert.equal(options.status,200);assert((await options.json()).items.some(c=>c.id===ct.id));
 const first=await create();
 for(const auth of ['',token]){assert.equal((await decide(first,'approve',auth)).status,auth?403:401);assert.equal((await download(first,auth)).status,auth?403:401);}
 const pendingScope=await create([ct.id]);await db.query("UPDATE cases SET source='teacher_provided_teaching' WHERE id=$1",[ct.id]);assert.equal((await decide(pendingScope)).status,403);assert.equal((await state(pendingScope)).url,null);await db.query("UPDATE cases SET source='synthetic' WHERE id=$1",[ct.id]);assert.equal((await decide(first,'approve',adminToken)).status,403);assert.equal((await download(first)).status,403,'pending link is not active');
 const rejected=await create([dx.id]);assert.equal((await decide(rejected,'reject')).status,201);assert.equal((await state(rejected)).url,null);assert.equal((await decide(rejected)).status,409);
 const race=await Promise.all([decide(first),decide(first)]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);const row=await state(first);assert.equal(row.approver_id,approver.id);assert(row.expire_at.getTime()-Date.now()>23*3600000);assert.equal(row.url,`/api/exports/${first}/download`);
 let list=await (await get('/api/exports?pageSize=1',adminToken)).json();assert(list.total>=2);assert.equal(list.items.length,1);assert(!JSON.stringify(list).includes('package_sha256'));
 list=await (await get('/api/exports',approveToken)).json();assert(list.items.every(r=>r.url===null));assert.equal((await download(first,approveToken)).status,403);
 for(const [field,value]of [['status','disabled'],['expire_at','2000-01-01'],['mfa_secret_encrypted',null],['role','member']]){
  await db.query(`UPDATE users SET ${field}=$2 WHERE id=$1`,[approver.id,value]);assert.equal((await download(first)).status,403);assert.equal((await state(first)).download_count,0);await db.query(`UPDATE users SET ${field}=$2 WHERE id=$1`,[approver.id,approver[field]]);
 }
 for(const [field,value,restore]of [['source','teacher_provided_teaching','synthetic'],['status','已下线','已发布'],['deleted_at',new Date(),null]]){
  await db.query(`UPDATE cases SET ${field}=$2 WHERE id=$1`,[ct.id,value]);assert.equal((await download(first)).status,403);await db.query(`UPDATE cases SET ${field}=$2 WHERE id=$1`,[ct.id,restore]);
 }
 await db.query('UPDATE annotation_objects SET is_gold=false WHERE case_id=$1 AND version=(SELECT annotation_version FROM cases WHERE id=$1)',[ct.id]);assert.equal((await download(first)).status,403);await db.query('UPDATE annotation_objects SET is_gold=true WHERE case_id=$1 AND version=(SELECT annotation_version FROM cases WHERE id=$1)',[ct.id]);
 const version=(await db.query('SELECT annotation_version FROM cases WHERE id=$1',[ct.id]))[0].annotation_version;
 await db.query('UPDATE cases SET annotation_version=annotation_version+1 WHERE id=$1',[ct.id]);assert.equal((await download(first)).status,403);await db.query('UPDATE cases SET annotation_version=$2 WHERE id=$1',[ct.id,version]);
 const readJson=objectService.readJson,storeJson=objectService.storeJson;
 objectService.readJson=async()=>{throw Error('synthetic storage unavailable');};assert.equal((await download(first)).status,503);assert.equal((await state(first)).download_count,0);objectService.readJson=readJson;
 objectService.readJson=async key=>Buffer.concat([await readJson(key),Buffer.from(' ')]);assert.equal((await download(first)).status,503);objectService.readJson=readJson;
 await db.query(`CREATE FUNCTION fail_export_audit() RETURNS trigger AS $$ BEGIN IF NEW.action IN ('exports.approved','exports.downloaded') THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await db.query('CREATE TRIGGER fail_export BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_export_audit()');
 assert.equal((await download(first)).status,500);assert.equal((await state(first)).download_count,0);
 const failed=await create([dx.id]);assert.equal((await decide(failed)).status,500);assert.equal((await state(failed)).status,'待审批');await assert.rejects(objectService.readJson(`exports/${failed}.json`));
 await db.query('DROP TRIGGER fail_export ON audit_logs');
 const failedPut=await create([dx.id]);objectService.storeJson=async(...args)=>{await storeJson(...args);throw Error('synthetic uncertain put');};assert.equal((await decide(failedPut)).status,500);assert.equal((await state(failedPut)).url,null);await assert.rejects(objectService.readJson(`exports/${failedPut}.json`));objectService.storeJson=storeJson;
 const once=await Promise.all([download(first),download(first)]);assert.deepEqual(once.map(r=>r.status).sort(),[200,403]);const success=once.find(r=>r.status===200);assert.equal(success.headers.get('cache-control'),'no-store, private');assert.match(success.headers.get('content-disposition'),/^attachment;/);
 const packet=await success.json();assert.equal(packet.schema_version,1);assert.equal(packet.cases.length,2);assert(packet.cases.every(c=>c.annotations.length&&c.series.every(s=>s.frames[0].width===640)));assert(packet.cases.find(c=>c.id===ct.id).annotations.every(a=>a.geometry&&a.report_sent_ids));
 const contents=JSON.stringify(packet);for(const forbidden of ['clinical_text','sentences','raw_text','series_uid','orthanc_id','mask_map','object_key','ip','password','created_by'])assert(!contents.includes('"'+forbidden+'"'));
 assert.equal((await state(first)).download_count,1);assert.equal((await download(first)).status,403);
 const expired=await create([dx.id]);assert.equal((await decide(expired)).status,201);await db.query("UPDATE export_requests SET expire_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired]);assert.equal((await download(expired)).status,403);assert.equal((await state(expired)).download_count,0);
 await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'synthetic.audit_projection',$2,$3,'synthetic')",[requester,'exports:'+first,JSON.stringify({version:1,token:'SYNTHETIC-SECRET',clinical_text:'SYNTHETIC-PRIVATE',object_key:'SYNTHETIC-KEY'})]);
 const audit=await get(`/api/audit?target=exports:${first}`,adminToken);assert.equal(audit.status,200);const events=await audit.json();for(const action of ['exports.requested','exports.approved','exports.downloaded','exports.download_denied'])assert(events.items.some(e=>e.action===action));assert(!JSON.stringify(events).includes('SYNTHETIC-SECRET'));assert(!JSON.stringify(events).includes('SYNTHETIC-PRIVATE'));assert(!JSON.stringify(events).includes('SYNTHETIC-KEY'));
 assert.equal((await get('/api/audit?action=exports.downloaded&from=2020-01-01T00%3A00%3A00Z&to=2099-01-01T00%3A00%3A00Z',adminToken)).status,200);
 for(const query of ['actor=bad','raw=true','page=1&page=2','from=2026-02-30T00:00:00Z'])assert.equal((await get('/api/audit?'+query,adminToken)).status,400);
 await assert.rejects(db.query('UPDATE audit_logs SET detail=\'{}\' WHERE id=$1',[events.items[0].id]),/append-only/);await assert.rejects(db.query('DELETE FROM audit_logs WHERE id=$1',[events.items[0].id]),/append-only/);
 const {ControlledExports1791331200000}=require('../dist/database/migrations/1791331200000-ControlledExports');const runner=db.createQueryRunner();await assert.rejects(new ControlledExports1791331200000().down(runner),/Preserve export history/);await runner.release();
 await assert.rejects(db.query('UPDATE export_requests SET approver_id=requester_id WHERE id=$1',[first]),e=>e.code==='23514');
 console.log('PASS: exports/audit real HTTP DX/CT minimal JSON, dual-admin/concurrent decisions, expiry/once/concurrent claim, current account/source/gold/version scope, private storage/hash/audit failures and durable compensation, read-only audit projection and protected migration rollback');
 if(process.env.MIAP_EXPORTS_BROWSER_URL)await require('./exports-browser.assertions.cjs')({base,adminToken,approveToken,memberToken:token,dx,db,requester,approver:approver.id});
};
