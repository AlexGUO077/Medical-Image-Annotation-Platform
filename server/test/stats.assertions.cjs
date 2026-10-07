const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({db,app,base,get,actor,other,token,otherToken,adminToken,dx,ct})=>{
 const read=async(query='',auth=adminToken)=>{const response=await get('/api/stats'+(query?'?'+query:''),auth);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');return response.json();};
 const normal={completed:1,normal_passed:1,normal_returned:0,normal_total:1,spotcheck_passed:0,spotcheck_returned:0,spotcheck_total:0,return_rate:0,spotcheck_pass_rate:null};
 assert.deepEqual((await read(`task_id=${dx.task}`)).summary,normal,'DX ordinary publication');
 const result=await read(`task_id=${ct.task}&group_by=person`);
 assert.deepEqual(result.summary,{...normal,normal_returned:1,normal_total:2,return_rate:0.5},'CT return and resubmission do not erase the old result');
 assert.equal(result.items[0].key,actor.id);assert.notEqual(result.items[0].key,other.id);
 assert.equal((await read(`task_id=${ct.task}&person_id=${other.id}`)).summary.normal_total,0);
 for(const auth of ['',token,otherToken])assert.equal((await get('/api/stats',auth)).status,auth?403:401);
 for(const query of ['page=01','pageSize=101','from=2026-10-01','group_by=reviewer','task_id=bad','page=1&page=2','from=2026-02-30&to=2026-03-01','person_id[$ne]=x','raw=true'])assert.equal((await get('/api/stats?'+query,adminToken)).status,400);
 const first=await read('pageSize=1'),second=await read('pageSize=1&page=2');
 assert(first.total>1);assert.equal(first.items.length,1);assert.notEqual(first.items[0].key,second.items[0].key);
 assert.deepEqual(first.summary,second.summary);assert.deepEqual(first.trend,second.trend);
 for(const forbidden of ['comments','clinical_text','raw_text','case_id','geometry','ip','object_key','password_hash'])assert(!JSON.stringify(result).includes(`"${forbidden}"`));

 // The fixture administrator is the token's subject, regardless of other synthetic admins.
 const claims=app.get(require('../dist/modules/auth/auth-token.service').AuthTokenService).verify(adminToken,['access']);
 const [current]=await db.query('SELECT *,expire_at::text FROM users WHERE id=$1',[claims.sub]);
 for(const [field,value]of [['status','disabled'],['expire_at','2000-01-01'],['must_change_password',true],['mfa_secret_encrypted',null]]){
  await db.query(`UPDATE users SET ${field}=$2 WHERE id=$1`,[current.id,value]);assert.equal((await get('/api/stats',adminToken)).status,403);
  await db.query(`UPDATE users SET ${field}=$2 WHERE id=$1`,[current.id,current[field]]);
 }
 await db.query("UPDATE users SET updated_at=updated_at+interval '1 second' WHERE id=$1",[current.id]);assert.equal((await get('/api/stats',adminToken)).status,401);
 await db.query('UPDATE users SET updated_at=$2,quals=\'{}\' WHERE id=$1',[current.id,current.updated_at]);assert.equal((await get('/api/stats',adminToken)).status,200,'admin aggregate requires no viewing qualification');
 await db.query('UPDATE users SET quals=$2 WHERE id=$1',[current.id,JSON.stringify(current.quals)]);
 const oldActor=(await db.query('SELECT status,quals FROM users WHERE id=$1',[actor.id]))[0];
 await db.query("UPDATE users SET status='disabled',quals='{}' WHERE id=$1",[actor.id]);assert.deepEqual((await read(`task_id=${ct.task}`)).summary,result.summary);
 await db.query('UPDATE users SET status=$2,quals=$3 WHERE id=$1',[actor.id,oldActor.status,JSON.stringify(oldActor.quals)]);
 // Explicit synthetic timestamps test inclusive Beijing dates and immutable version/task attribution.
 const task=randomUUID(),foreignTask=randomUUID(),caseId=randomUUID();
 for(const id of [task,foreignTask])await db.query("INSERT INTO tasks(id,name,source,system_code,review_mode,status,priority) VALUES($1,'合成日期统计','synthetic','resp','peer','已完成',0)",[id]);
 await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method,annotation_version) VALUES($1::uuid,$1::text,'已下线','synthetic','resp','临床综合诊断',9)",[caseId]);
 await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','synthetic')",[actor.id,'cases:'+caseId]);
 const add=async({at,result='通过',kind='normal',version=1,caseValue=caseId,taskValue=task,submitted=true,legacy=false})=>{
  const id=randomUUID(),target='cases:'+caseValue;
  if(submitted)await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip,created_at) VALUES($1,'annotations.submitted',$2,$3,'synthetic','2029-12-01T00:00:00Z')",[actor.id,target,JSON.stringify({task_id:taskValue,version})]);
  await db.query('INSERT INTO reviews(id,case_id,reviewer_id,result,is_spotcheck,created_at) VALUES($1,$2,$3,$4,$5,$6)',[id,caseValue,other.id,result,kind==='spotcheck',at]);
  await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip,created_at) VALUES($1,'reviews.decided',$2,$3,'synthetic',$4)",[other.id,target,JSON.stringify({task_id:taskValue,review_id:id,version,result,...(legacy?{}:{review_kind:kind})}),at]);
  return id;
 };
 await add({at:'2029-12-31T15:59:59.999Z',version:0}); // outside
 await add({at:'2029-12-31T16:00:00Z',version:1,legacy:true});
 await add({at:'2030-01-01T15:59:59.999Z',version:2,result:'打回'});
 await add({at:'2030-01-01T16:00:00Z',version:3});
 await add({at:'2030-01-02T15:59:59.999Z',version:4,result:'打回'});
 await add({at:'2030-01-02T16:00:00Z',version:5}); // outside
 await add({at:'2030-01-01T00:00:00Z',kind:'spotcheck'});
 await add({at:'2030-01-02T00:00:00Z',kind:'spotcheck',result:'打回'});
 await add({at:'2030-01-01T00:00:00Z',kind:'recheck'});
 await add({at:'2030-01-02T00:00:00Z',kind:'recheck',result:'打回'});
 await add({at:'2030-01-01T00:00:00Z',version:8,submitted:false});
 const unconfirmed=randomUUID();
 await db.query("INSERT INTO cases(id,case_no,status,source,system_code,confirm_method) VALUES($1::uuid,$1::text,'已发布','synthetic','resp','临床综合诊断')",[unconfirmed]);
 await add({at:'2030-01-01T00:00:00Z',caseValue:unconfirmed}); // no deidentification confirmation
 const rawReview=randomUUID();await db.query("INSERT INTO reviews(id,case_id,reviewer_id,result) VALUES($1,$2,$3,'通过')",[rawReview,caseId,other.id]); // no decision audit
 // New membership and later submitter cannot rewrite the older reviewed task/version.
 await db.query('INSERT INTO task_cases(task_id,case_id) VALUES($1,$2)',[foreignTask,caseId]);
 await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip,created_at) VALUES($1,'annotations.submitted',$2,$3,'synthetic','2031-01-01T00:00:00Z')",[other.id,'cases:'+caseId,JSON.stringify({task_id:task,version:1})]);
 const query=`task_id=${task}&person_id=${actor.id}&system_code=resp&source=synthetic&from=2030-01-01&to=2030-01-02`;
 let started=performance.now();const dated=await read(query+'&group_by=day');
 assert.deepEqual(dated.summary,{completed:2,normal_passed:2,normal_returned:2,normal_total:4,spotcheck_passed:1,spotcheck_returned:1,spotcheck_total:2,return_rate:0.5,spotcheck_pass_rate:0.5});
 assert.deepEqual(dated.trend.map(row=>[row.day,row.normal_total,row.completed]),[['2030-01-01',2,1],['2030-01-02',2,1]]);
 for(const group of ['task','person','system','source','day'])assert.deepEqual((await read(query+'&group_by='+group)).summary,dated.summary);
 assert.equal((await read(query.replace('system_code=resp','system_code=bone'))).summary.normal_total,0);
 assert.equal((await read(query.replace('source=synthetic','source=teacher_provided_teaching'))).summary.normal_total,0);
 assert.equal((await read(`task_id=${foreignTask}&from=2030-01-01&to=2030-01-02`)).summary.normal_total,0);
 for(const [table,field,value,restore]of [['cases','deleted_at',new Date(),null],['cases','source','teacher_provided_teaching','synthetic'],['tasks','deleted_at',new Date(),null]]){
  const id=table==='cases'?caseId:task;
  await db.query(`UPDATE ${table} SET ${field}=$2 WHERE id=$1`,[id,value]);assert.equal((await read(query)).summary.normal_total,0);await db.query(`UPDATE ${table} SET ${field}=$2 WHERE id=$1`,[id,restore]);
 }
 const empty=await read(`task_id=${randomUUID()}&from=2030-01-01&to=2030-01-03`);
 assert.equal(empty.total,0);assert.equal(empty.summary.return_rate,null);assert.equal(empty.summary.spotcheck_pass_rate,null);assert.equal(empty.trend.length,3);assert(empty.trend.every(row=>row.completed===0));
 await db.query('ALTER TABLE reviews RENAME TO synthetic_hidden_reviews');
 try{const failure=await get('/api/stats',adminToken);assert.equal(failure.status,500);const message=JSON.stringify(await failure.json());assert(!message.includes('synthetic_hidden_reviews'));assert(!message.includes('SELECT'));}
 finally{await db.query('ALTER TABLE synthetic_hidden_reviews RENAME TO reviews');}
 const [volume]=await db.query('SELECT (SELECT count(*)::int FROM cases) cases,(SELECT count(*)::int FROM reviews) reviews,(SELECT count(*)::int FROM audit_logs) audits');
 const fullStart=performance.now();await read();console.log(`Stats current synthetic volume ${JSON.stringify(volume)}, unfiltered GET ${(performance.now()-fullStart).toFixed(1)}ms`);
 console.log(`PASS: stats real PG/Nest HTTP DX/CT, normal/spotcheck/recheck, author/version/task history, Beijing endpoints, scope, null rates, full totals/pagination and admin/session rejection; grouped query set ${(performance.now()-started).toFixed(1)}ms`);
 if(process.env.MIAP_STATS_BROWSER_URL)await require('./stats-browser.assertions.cjs')({base,adminToken,memberToken:token,task:ct.task,db,fixtureUser:current});
};
