// Real PostgreSQL transactions, HTTP auth and Redis; Orthanc/rendering are explicit synthetic boundaries.
'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const path=require('node:path');
require('dotenv').config({path:process.env.MIAP_ENV_FILE??path.resolve(__dirname,'../../.env.local'),quiet:true});
if(!process.env.POSTGRES_DB?.includes('synthetic'))throw Error('Synthetic database required');
require('reflect-metadata');
const {DataSource}=require('typeorm'),{Client}=require('pg'),{createClient}=require('redis');
const {ExpressAdapter}=require('@nestjs/platform-express');
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core'),{JwtModule}=require('@nestjs/jwt');
const {DATABASE_SOURCE}=require('../dist/modules/database/database.tokens');
const {REDIS_CLIENT}=require('../dist/modules/redis/redis.module');
const {EducationService}=require('../dist/modules/education/education.service');
const {EducationController,EducationActivationController}=require('../dist/modules/education/education.controller');
const {AccessTokenGuard}=require('../dist/modules/auth/access-token.guard');
const {AdminGuard}=require('../dist/modules/auth/admin.guard');
const {AuthTokenService}=require('../dist/modules/auth/auth-token.service');
const {AuthService}=require('../dist/modules/auth/auth.service');
const {AuthController}=require('../dist/modules/auth/auth.controller');
const {SecurityStateService}=require('../dist/modules/auth/security-state.service');
const {TotpService}=require('../dist/modules/auth/totp.service');
const {AuditService}=require('../dist/modules/audit/audit.service');
const {FramesService}=require('../dist/modules/frames/frames.service');
const {FramesController}=require('../dist/modules/frames/frames.controller');
const {FrameRateService}=require('../dist/modules/frames/frame-rate.service');
const {FrameRenderCacheService}=require('../dist/modules/frames/frame-render-cache.service');
const {OrthancService}=require('../dist/modules/cases/orthanc.service');
const {WorkbenchController}=require('../dist/modules/workbench/workbench.module');
const {WorkbenchService}=require('../dist/modules/workbench/workbench.service');
const {seedDatabase}=require('../dist/database/seed');
const {hashPassword}=require('../dist/database/password');
const {ApiExceptionFilter}=require('../dist/common/api-exception.filter');
const schema='edu_test_'+randomBytes(8).toString('hex');
const connection={host:process.env.POSTGRES_HOST??'127.0.0.1',port:Number(process.env.POSTGRES_PORT??5432),user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB};
(async()=>{
 const owner=new Client(connection);let db,app,redis;
 await owner.connect();
 try{
  await owner.query(`CREATE SCHEMA "${schema}"`);
  db=new DataSource({type:'postgres',host:connection.host,port:connection.port,username:connection.user,password:connection.password,database:connection.database,schema,extra:{options:`-c search_path=${schema}`},logging:false,migrations:[path.resolve(__dirname,'../dist/database/migrations/*.js')]});
  await db.initialize();await db.runMigrations();await db.undoLastMigration();await db.runMigrations();
  await seedDatabase(db,randomBytes(20).toString('hex'));
  redis=createClient({url:process.env.REDIS_URL??`redis://:${encodeURIComponent(process.env.REDIS_PASSWORD)}@${process.env.REDIS_HOST??'127.0.0.1'}:${process.env.REDIS_PORT??6379}`});await redis.connect();
  const png=await require('sharp')({create:{width:128,height:128,channels:3,background:'#888'}}).png().toBuffer();let onRender;
  const orthanc={resolveSeriesFrame:async()=>({instance_id:'synthetic',frame_index:0}),frameGeometry:async()=>({width:128,height:128,row_spacing:1,column_spacing:1})};
  class IntegrationModule{}
  Module({imports:[JwtModule.register({secret:process.env.JWT_SECRET})],controllers:[EducationController,EducationActivationController,AuthController,FramesController,WorkbenchController],providers:[EducationService,AccessTokenGuard,AdminGuard,AuthTokenService,AuthService,SecurityStateService,TotpService,AuditService,FramesService,FrameRateService,
   {provide:DATABASE_SOURCE,useValue:db},{provide:REDIS_CLIENT,useValue:redis},{provide:OrthancService,useValue:orthanc},{provide:FrameRenderCacheService,useValue:{render:async()=>{if(onRender)await onRender();return png;}}},{provide:WorkbenchService,useValue:{read:()=>{throw Error('Student reached production service');},attachment:()=>{throw Error('Student reached production attachments');}}}]})(IntegrationModule);
  app=await NestFactory.create(IntegrationModule,new ExpressAdapter(),{logger:false});app.setGlobalPrefix('api');app.useBodyParser('json',{limit:'3mb'});app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'0.0.0.0');const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api`;
  const req=async(url,method='GET',body,token)=>{const r=await fetch(base+url,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=r.headers.get('content-type')?.includes('application/json')?await r.json():await r.arrayBuffer();return {status:r.status,data,headers:r.headers};};
  const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
  await db.query(`UPDATE users SET mfa_secret_encrypted='synthetic-test',must_change_password=false WHERE role='admin'`);
  const [admin]=await db.query(`SELECT *,expire_at::text FROM users WHERE role='admin'`),adminToken=app.get(AuthTokenService).signAccess(admin);
  const caseId=randomUUID(),study=randomUUID(),series=randomUUID(),alienSeries=randomUUID(),part='11000000-0000-4000-8000-000000000003';
  await db.query(`INSERT INTO cases(id,case_no,status,source,system_code,confirm_method,clinical_text) VALUES($1,'SYN-EDU','已录入','synthetic','resp','临床综合诊断','HIDDEN CLINICAL')`,[caseId]);
  await db.query(`INSERT INTO reports(case_id,raw_text,sentences) VALUES($1,'SYNTHETIC REFERENCE ORIGINAL','[{"idx":0,"text":"HIDDEN SENTENCE"}]')`,[caseId]);
  await db.query(`INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,'2.25.88881',CURRENT_DATE)`,[study,caseId]);
  await db.query(`INSERT INTO series(id,study_id,series_uid,orthanc_id,modality,frame_count,default_window) VALUES($1,$2,'2.25.88882','synthetic','CT',3,'{"center":40,"width":400}')`,[series,study]);
  await db.query(`INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','test')`,[admin.id,'cases:'+caseId]);
  // More than five valid students can activate behind one shared network address.
  for(let n=0;n<6;n++){
   const no=`network_${schema}_${n}`;const row=ok(await req('/education/roster','POST',{student_no:no,real_name:'合成同网学生',class_name:'测试',expire_at:'2099-12-31'},adminToken),201);
   ok(await req('/education/activate','POST',{student_no:no,activation_code:row.activation_code,password:randomBytes(16).toString('hex')}));
  }
  const people=[];
  for(let n=0;n<2;n++){
   const no=`edu_${schema}_${n}`,password=' '+randomBytes(14).toString('hex')+' ';
   const row=ok(await req('/education/roster','POST',{student_no:no,real_name:'合成学生'+n,class_name:'测试班',expire_at:'2099-12-31'},adminToken),201);
   assert(!JSON.stringify(ok(await req('/education/roster','GET',undefined,adminToken))).includes(row.activation_code));
   ok(await req('/education/activate','POST',{student_no:no,activation_code:row.activation_code,password}));
   const login=ok(await req('/auth/login','POST',{username:no,password}));assert.equal(login.role,'student');
   const [user]=await db.query('SELECT id FROM users WHERE username=$1',[no]);people.push({roster:row.id,token:login.token,id:user.id,no,password});
  }
  assert.equal((await req('/education/roster','GET',undefined,people[0].token)).status,403);
  assert.equal((await req(`/workbench/${caseId}`,'GET',undefined,people[0].token)).status,403);
  assert.equal((await req(`/workbench/${caseId}/attachments/${randomUUID()}/preview`,'GET',undefined,people[0].token)).status,403);
  assert.equal((await req('/education/tasks','POST',{},people[0].token)).status,403);
  const task=ok(await req('/education/tasks','POST',{title:'合成考核',instructions:'独立作答',case_ids:[caseId],roster_ids:people.map(p=>p.roster)},adminToken),201);
  const tasks=ok(await req('/education/tasks','GET',undefined,people[0].token));assert.equal(tasks.length,1);const item=tasks[0].items[0].id;
  const attempts=[];for(const p of people)attempts.push(ok(await req(`/education/items/${item}/attempts`,'POST',{},p.token),201).id);
  const w=ok(await req(`/education/attempts/${attempts[0]}/workbench`,'GET',undefined,people[0].token));
  assert.match((await req(`/education/attempts/${attempts[0]}/workbench`,'GET',undefined,people[0].token)).headers.get('cache-control'),/no-store/);
  for(const secret of ['HIDDEN CLINICAL','HIDDEN SENTENCE','SYNTHETIC REFERENCE ORIGINAL','clinical_text','reference','system_code'])assert(!JSON.stringify(w).includes(secret),secret);
  assert.equal((await req(`/education/attempts/${attempts[0]}/feedback`,'GET',undefined,people[0].token)).status,403);
  assert.equal((await req(`/education/attempts/${attempts[0]}/workbench`,'GET',undefined,people[1].token)).status,403);
  const body={body_part_id:part,normal:false,findings:'学生自己的所见',impression:'学生自己的判断',objects:[{id:randomUUID(),series_id:series,tool:'box',geometry:{x:10,y:10,w:20,h:20},frame_start:0,frame_end:0,key_frame_index:0,window_preset:'{"center":40,"width":400}',part_id:part,sign_tag_ids:[],confidence:null,report_sent_ids:[],organ:'合成器官',description:'独立病变描述'}]};
  const save=(who,expected,answer)=>req(`/education/attempts/${attempts[who]}/draft`,'PUT',{expected_version:expected,answer},people[who].token);
  const race=await Promise.all([save(0,0,body),save(0,0,body)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  ok(await save(1,0,{...body,findings:'另一学生',objects:body.objects.map(o=>({...o,id:randomUUID()}))}));
  assert.equal(ok(await req(`/education/attempts/${attempts[0]}/workbench`,'GET',undefined,people[0].token)).attempt.answer.findings,'学生自己的所见');
  assert.equal((await save(0,1,{...body,objects:body.objects.map(o=>({...o,series_id:alienSeries}))})).status,400);
  assert.equal((await save(0,1,{...body,objects:body.objects.map(o=>({...o,geometry:{x:120,y:120,w:20,h:20}}))})).status,400);
  const frameBody={case_id:caseId,series_uid:'2.25.88882',frame_index:0,window:null,access_mode:'education',attempt_id:attempts[0]};
  const ticket=ok(await req('/frames/ticket','POST',frameBody,people[0].token),201);
  ok(await req(ticket.url.replace('/api',''),'GET',undefined,people[0].token));
  assert.equal((await req(ticket.url.replace('/api',''),'GET',undefined,people[1].token)).status,403);
  for(const change of [{attempt_id:attempts[1]},{access_mode:'library',attempt_id:undefined,expected_version:0},{access_mode:undefined,attempt_id:undefined}])assert.equal((await req('/frames/ticket','POST',{...frameBody,...change},people[0].token)).status,403);
  const submit=()=>req(`/education/attempts/${attempts[0]}/submit`,'POST',{expected_version:1},people[0].token);
  const submitted=await Promise.all([submit(),submit()]);assert(submitted.every(r=>r.status===201));assert.equal(submitted[0].data.submitted_at,submitted[1].data.submitted_at);
  assert.equal((await save(0,1,body)).status,409);
  await assert.rejects(db.query('UPDATE education_attempts SET version=version+1 WHERE id=$1',[attempts[0]]),/immutable/);
  await assert.rejects(db.query('DELETE FROM education_attempts WHERE id=$1',[attempts[0]]),/immutable/);
  await db.query(`UPDATE reports SET raw_text='CHANGED REFERENCE' WHERE case_id=$1`,[caseId]);
  const feedback=ok(await req(`/education/attempts/${attempts[0]}/feedback`,'GET',undefined,people[0].token));assert.equal(feedback.reference.report,'SYNTHETIC REFERENCE ORIGINAL');assert(!JSON.stringify(feedback).includes('HIDDEN CLINICAL'));
  // Validate complete submission pagination beyond the former fixed cap.
  for(let n=0;n<51;n++){
    const userId=randomUUID();await db.query(`INSERT INTO users(id,username,password_hash,real_name,role,status,expire_at,must_change_password) VALUES($1,$2,'unused','合成分页学生','student','active','2099-12-31',false)`,[userId,`page_${schema}_${n}`]);
    await db.query(`INSERT INTO education_roster(student_no,real_name,expire_at,user_id,activated_at) VALUES($1,'合成分页学生','2099-12-31',$2,now())`,[`page_${schema}_${n}`,userId]);
    await db.query(`INSERT INTO education_attempts(item_id,student_id,state,answer,submitted_at) VALUES($1,$2,'submitted',$3::jsonb,now())`,[item,userId,JSON.stringify(body)]);
  }
  const page1=ok(await req(`/education/tasks/${task.id}/submissions?page=1`,'GET',undefined,adminToken));
  const page2=ok(await req(`/education/tasks/${task.id}/submissions?page=2`,'GET',undefined,adminToken));
  assert.equal(page1.length,50);assert.equal(page2.length,2);assert.equal(new Set([...page1,...page2].map(a=>a.id)).size,52);
  const production=(await db.query('SELECT status,annotation_version FROM cases WHERE id=$1',[caseId]))[0];assert.deepEqual(production,{status:'已录入',annotation_version:0});
  ok(await req(`/education/tasks/${task.id}`,'PATCH',{status:'closed'},adminToken));
  assert.equal((await save(1,1,body)).status,403);ok(await req(`/education/attempts/${attempts[0]}/feedback`,'GET',undefined,people[0].token));
  await db.query(`UPDATE education_tasks SET status='published' WHERE id=$1`,[task.id]);
  onRender=async()=>{await db.query(`UPDATE education_tasks SET status='revoked' WHERE id=$1`,[task.id]);onRender=undefined;};
  assert.equal((await req(ticket.url.replace('/api',''),'GET',undefined,people[0].token)).status,403);
  assert.equal((await req(`/education/attempts/${attempts[0]}/feedback`,'GET',undefined,people[0].token)).status,403);
  await db.query(`UPDATE education_tasks SET status='published' WHERE id=$1`,[task.id]);
  await db.query(`UPDATE cases SET status='已下线' WHERE id=$1`,[caseId]);assert.equal((await req('/frames/ticket','POST',frameBody,people[0].token)).status,403);
  await db.query(`UPDATE cases SET status='已录入' WHERE id=$1`,[caseId]);
  const changed=ok(await req('/auth/password','POST',{current_password:people[0].password,new_password:randomBytes(16).toString('hex')},people[0].token));assert.equal(changed.role,'student');
  assert.equal((await req('/education/tasks','GET',undefined,people[0].token)).status,401);
  await assert.rejects(db.undoLastMigration(),/Student education data exists/);
  const leaks=await db.query(`SELECT detail::text FROM audit_logs WHERE action LIKE 'education.%'`);assert(!JSON.stringify(leaks).includes('学生自己的所见'));assert(!JSON.stringify(leaks).includes(people[0].password));
  console.log('PASS education HTTP/PostgreSQL/Redis: activation/login, isolation, concurrent saves, immutable/idempotent submission, frozen reference, frame binding/revocation, password invalidation and safe migration rollback. Orthanc is synthetic.');
 } finally {if(app)await app.close();if(redis?.isOpen)await redis.quit();if(db?.isInitialized)await db.destroy();await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await owner.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
