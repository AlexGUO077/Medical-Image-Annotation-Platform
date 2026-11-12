// Idempotent local SYNTHETIC fixtures only. This is not deidentification or clinical-standard acceptance.
'use strict';
const {randomBytes,randomUUID}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
require('reflect-metadata');
const {AppDataSource:db}=require('../dist/database/data-source');
const {EducationService}=require('../dist/modules/education/education.service');
const {SecurityStateService}=require('../dist/modules/auth/security-state.service');
const {OrthancService}=require('../dist/modules/cases/orthanc.service');
const {provisionApplicationRole}=require('../dist/database/provision-role');
const {createClient}=require('redis');
const sharp=require('sharp');
(async()=>{
 if(process.env.POSTGRES_DB!=='miap_synthetic'||process.env.EDUCATION_PREPARE_SYNTHETIC!=='1')throw Error('Explicit synthetic demo setup required');
 const destination=process.env.EDUCATION_DEMO_FILE;if(!destination||!path.isAbsolute(destination))throw Error('Absolute private credential destination required');
 let existing;
 await db.initialize();let redis;const guard=db.createQueryRunner();
 try{
  await guard.connect();await guard.query('SELECT pg_advisory_lock(748119231)');
  // Read the handoff under the same lock for concurrent local setup runs.
  try{existing=JSON.parse(await fs.readFile(destination,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const [database]=await db.query("SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=current_database()");
  if(database.owned){await db.runMigrations({transaction:'all'});await provisionApplicationRole(db);}
  const [admin]=await db.query(`SELECT *,expire_at::text FROM users WHERE role='admin' AND status='active' AND NOT must_change_password AND mfa_secret_encrypted IS NOT NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  if(!admin)throw Error('An enrolled local administrator is required');
  if(existing){
   for(const name of ['student_demo','student_check']){
    const account=existing.accounts.find(a=>a.username===name);
    if(!account||!(await db.query('SELECT 1 FROM users u JOIN education_roster r ON r.user_id=u.id WHERE u.id=$1 AND r.id=$2 AND u.username=$3 AND u.role=\'student\' AND u.deleted_at IS NULL',[account.id,account.roster_id,name])).length)throw Error('Private handoff does not match this instance');
   }
  }else for(const name of ['student_demo','student_check'])if((await db.query('SELECT id FROM users WHERE username=$1 AND deleted_at IS NULL',[name])).length)throw Error('Demo identity already exists without matching private handoff; refusing password overwrite');
  redis=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT)},password:process.env.REDIS_PASSWORD});await redis.connect();
  const service=new EducationService(db,new SecurityStateService(redis),new OrthancService());
  const auth='Basic '+Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString('base64');
  const base=`http://${process.env.ORTHANC_HOST}:${process.env.ORTHANC_PORT}`;
  const orthanc=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Synthetic image preparation failed');return r.json();};
  const cases=[],sections=[];
  const findings='一侧上肺区见边界清楚的圆形结节样影，另一侧下肺区见楔形片状增密影。';
  const impression='分别考虑结节样病灶及局灶性实变。此为合成教学模拟。';
  const report='【合成教学参考】\n影像所见：'+findings+'\n诊断意见：'+impression;
  for(const modality of ['DX','CT']){
   const caseNo='SYN-EDU-MULTI-V2-'+modality;
   const [prepared]=await db.query("SELECT id FROM cases WHERE case_no=$1 AND source='synthetic' AND deleted_at IS NULL",[caseNo]);
   if(prepared){cases.push(prepared.id);sections.push({case_id:prepared.id,findings,impression});continue;}
   const studyUid='2.25.173400000011122026'+(modality==='CT'?'2':'1'),seriesUid=studyUid+'.1';
   let source;const frames=modality==='CT'?3:1;
   for(let frame=0;frame<frames;frame++){
    const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
     <rect width="512" height="512" fill="#171717"/><ellipse cx="256" cy="248" rx="207" ry="196" fill="#8c8c8c"/>
     <ellipse cx="165" cy="235" rx="80" ry="139" fill="#414141"/><ellipse cx="346" cy="235" rx="80" ry="139" fill="#484848"/>
     <circle cx="174" cy="175" r="${23+frame}" fill="#cbcbcb"/><polygon points="314,294 368,260 387,304 344,322" fill="#aaa"/>
     <text x="25" y="480" fill="white" font-size="19">SYNTHETIC EDUCATION ${modality} ${frame+1}</text></svg>`);
    const png=await sharp(svg).png().toBuffer();const made=await orthanc('/tools/create-dicom',{Force:true,Tags:{PatientName:'SYNTHETIC^EDUCATION',PatientID:'EDU-'+studyUid.slice(-12),StudyInstanceUID:studyUid,SeriesInstanceUID:seriesUid,SOPInstanceUID:seriesUid+'.'+(frame+1),Modality:modality,PixelSpacing:'1\\1',InstanceNumber:String(frame+1),StudyDate:'20261112',WindowCenter:'128',WindowWidth:'256',SeriesDescription:'SYNTHETIC EDUCATION ONLY'},Content:`data:image/png;base64,${png.toString('base64')}`});
    const info=await orthanc('/instances/'+made.ID);source=info.ParentSeries;
   }
   const caseId=randomUUID(),studyId=randomUUID(),seriesId=randomUUID(),taskId=randomUUID();
   await db.transaction(async m=>{
    await m.query(`INSERT INTO cases(id,case_no,status,source,system_code,confirm_method,annotation_version) VALUES($1,$2,'已发布','synthetic','resp','临床综合诊断',1)`,[caseId,caseNo]);
    await m.query(`INSERT INTO reports(case_id,raw_text,sentences) VALUES($1,$2,$3::jsonb)`,[caseId,report,JSON.stringify([{idx:0,text:findings},{idx:1,text:impression}])]);
    await m.query(`INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,'2026-11-12')`,[studyId,caseId,studyUid]);
    await m.query(`INSERT INTO series(id,study_id,series_uid,orthanc_id,modality,frame_count,default_window) VALUES($1,$2,$3,$4,$5,$6,'{"center":128,"width":256}')`,[seriesId,studyId,seriesUid,source,modality,frames]);
    await m.query(`INSERT INTO tasks(id,name,source,system_code,review_mode,dispatch_mode,priority,status) VALUES($1,'合成教学标准夹具','synthetic','resp','peer','manual',0,'已完成')`,[taskId]);
    const shapes=[['box',{x:149,y:150,w:50,h:50}],['polygon',{points:[[314,294],[368,260],[387,304],[344,322]]}]];
    for(const [tool,geometry] of shapes){
     const [a]=await m.query(`INSERT INTO annotation_objects(case_id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,report_sent_ids,part_id,confidence,version,is_gold,created_by,task_id,logical_id)
       VALUES($1,$2,$3,$4::jsonb,0,$5,0,'{"center":128,"width":256}','[0]','11000000-0000-4000-8000-000000000003','典型',1,true,$6,$7,$8) RETURNING id`,[caseId,seriesId,tool,JSON.stringify(geometry),frames-1,admin.id,taskId,randomUUID()]);
     await m.query(`INSERT INTO annotation_tags(annotation_id,sign_tag_id) VALUES($1,'20000000-0000-4000-8000-000000000003')`,[a.id]);
    }
    await m.query(`INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{"synthetic_fixture":true}','local-demo')`,[admin.id,'cases:'+caseId]);
   });cases.push(caseId);sections.push({case_id:caseId,findings,impression});
  }
  const accounts=existing?.accounts??[];
  if(!existing)for(const [n,name]of ['student_demo','student_check'].entries()){
   const r=await service.createRoster(admin,{student_no:name,real_name:n?'合成浏览器验证学生':'合成测试学生',class_name:'本地教学演示',expire_at:'2099-12-31'},'local-demo');
   const password='Aa1!'+randomBytes(20).toString('hex');await service.activate({student_no:name,activation_code:r.activation_code,password},'local-demo');
   const [u]=await db.query('SELECT id FROM users WHERE username=$1',[name]);accounts.push({username:name,password,id:u.id,roster_id:r.id});
  }
  const title='影像阅片与病灶标注（合成练习）';
  const [published]=await db.query(`SELECT t.id FROM education_tasks t WHERE t.title=$1 AND t.status='published' AND t.deleted_at IS NULL
    AND (SELECT array_agg(i.case_id ORDER BY i.case_id) FROM education_items i WHERE i.task_id=t.id)=$2::uuid[]
    AND (SELECT array_agg(s.roster_id ORDER BY s.roster_id) FROM education_students s WHERE s.task_id=t.id)=$3::uuid[] LIMIT 1`,[title,[...cases].sort(),accounts.map(a=>a.roster_id).sort()]);
  const task=published??await service.createTask(admin,{title,instructions:'独立阅片，逐个标注发现的病灶，再填写整例的影像所见和诊断意见。',case_ids:cases,roster_ids:accounts.map(a=>a.roster_id),reference_sections:sections},'local-demo');
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  const temporary=destination+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,JSON.stringify({accounts,task_id:task.id,case_ids:cases},null,2),{mode:0o600,flag:'wx'});
  await fs.rename(temporary,destination);
  console.log('Multi-lesion synthetic DX/CT practice is ready. Existing passwords, tasks and answers are preserved.');
 }finally{if(redis?.isOpen)await redis.quit();if(!guard.isReleased){await guard.query('SELECT pg_advisory_unlock(748119231)');await guard.release();}if(db.isInitialized)await db.destroy();}
})().catch(e=>{console.error('Synthetic education setup failed.',e.code??e.name);process.exitCode=1;});
