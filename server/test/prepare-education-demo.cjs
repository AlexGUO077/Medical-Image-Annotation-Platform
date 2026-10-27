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
 try{await fs.access(destination);console.log('Demo credentials already exist; existing passwords and answers retained.');return;}catch(e){if(e.code!=='ENOENT')throw e;}
 await db.initialize();let redis;const createdSeries=[];
 try{
  await db.runMigrations({transaction:'all'});await provisionApplicationRole(db);
  const [admin]=await db.query(`SELECT *,expire_at::text FROM users WHERE role='admin' AND status='active' AND NOT must_change_password AND mfa_secret_encrypted IS NOT NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  if(!admin)throw Error('An enrolled local administrator is required');
  for(const name of ['student_demo','student_check'])if((await db.query('SELECT id FROM users WHERE username=$1 AND deleted_at IS NULL',[name])).length)throw Error('Demo identity already exists without matching private handoff; refusing password overwrite');
  redis=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT)},password:process.env.REDIS_PASSWORD});await redis.connect();
  const service=new EducationService(db,new SecurityStateService(redis),new OrthancService());
  const auth='Basic '+Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString('base64');
  const base=`http://${process.env.ORTHANC_HOST}:${process.env.ORTHANC_PORT}`;
  const orthanc=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Synthetic image preparation failed');return r.json();};
  const cases=[];
  for(const modality of ['DX','CT']){
   const studyUid='2.25.'+BigInt('0x'+randomBytes(16).toString('hex')),seriesUid='2.25.'+BigInt('0x'+randomBytes(16).toString('hex'));
   let source;const frames=modality==='CT'?3:1;
   for(let frame=0;frame<frames;frame++){
    const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#171e29"/><ellipse cx="256" cy="235" rx="175" ry="180" fill="#8c939d"/><ellipse cx="256" cy="235" rx="155" ry="160" fill="#424b59"/><circle cx="232" cy="224" r="${35+frame*4}" fill="#ddd"/><text x="25" y="480" fill="white" font-size="19">SYNTHETIC EDUCATION ${modality} ${frame+1}</text></svg>`);
    const png=await sharp(svg).png().toBuffer();const made=await orthanc('/tools/create-dicom',{Force:true,Tags:{PatientName:'SYNTHETIC^EDUCATION',PatientID:'EDU-'+studyUid.slice(-12),StudyInstanceUID:studyUid,SeriesInstanceUID:seriesUid,Modality:modality,PixelSpacing:'1\\1',InstanceNumber:String(frame+1),StudyDate:'20261027',WindowCenter:'128',WindowWidth:'256',SeriesDescription:'SYNTHETIC EDUCATION ONLY'},Content:`data:image/png;base64,${png.toString('base64')}`});
    const info=await orthanc('/instances/'+made.ID);source=info.ParentSeries;
   }
   createdSeries.push(source);
   const caseId=randomUUID(),studyId=randomUUID(),seriesId=randomUUID(),taskId=randomUUID(),logical=randomUUID();
   await db.transaction(async m=>{
    await m.query(`INSERT INTO cases(id,case_no,status,source,system_code,confirm_method,annotation_version) VALUES($1,$2,'已发布','synthetic','resp','临床综合诊断',1)`,[caseId,'SYN-EDU-'+modality+'-'+randomBytes(4).toString('hex')]);
    await m.query(`INSERT INTO reports(case_id,raw_text,sentences) VALUES($1,$2,$3::jsonb)`,[caseId,'【合成教学参考】图中明亮圆形区域是用于软件训练的模拟目标，不代表真实疾病。可标注其边缘，描述位置、形态与范围。',JSON.stringify([{idx:0,text:'【合成教学参考】明亮圆形区域为模拟目标。'}])]);
    await m.query(`INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,'2026-10-27')`,[studyId,caseId,studyUid]);
    await m.query(`INSERT INTO series(id,study_id,series_uid,orthanc_id,modality,frame_count,default_window) VALUES($1,$2,$3,$4,$5,$6,'{"center":128,"width":256}')`,[seriesId,studyId,seriesUid,source,modality,frames]);
    await m.query(`INSERT INTO tasks(id,name,source,system_code,review_mode,dispatch_mode,priority,status) VALUES($1,'合成教学标准夹具','synthetic','resp','peer','manual',0,'已完成')`,[taskId]);
    const [a]=await m.query(`INSERT INTO annotation_objects(case_id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,report_sent_ids,part_id,confidence,version,is_gold,created_by,task_id,logical_id)
      VALUES($1,$2,'box','{"x":190,"y":182,"w":84,"h":84}',0,$3,0,'{"center":128,"width":256}','[0]','11000000-0000-4000-8000-000000000003','典型',1,true,$4,$5,$6) RETURNING id`,[caseId,seriesId,frames-1,admin.id,taskId,logical]);
    await m.query(`INSERT INTO annotation_tags(annotation_id,sign_tag_id) VALUES($1,'20000000-0000-4000-8000-000000000003')`,[a.id]);
    await m.query(`INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{"synthetic_fixture":true}','local-demo')`,[admin.id,'cases:'+caseId]);
   });cases.push(caseId);
  }
  const accounts=[];
  for(const [n,name]of ['student_demo','student_check'].entries()){
   const r=await service.createRoster(admin,{student_no:name,real_name:n?'合成浏览器验证学生':'合成测试学生',class_name:'本地教学演示',expire_at:'2099-12-31'},'local-demo');
   const password='Aa1!'+randomBytes(20).toString('hex');await service.activate({student_no:name,activation_code:r.activation_code,password},'local-demo');
   const [u]=await db.query('SELECT id FROM users WHERE username=$1',[name]);accounts.push({username:name,password,id:u.id,roster_id:r.id});
  }
  const task=await service.createTask(admin,{title:'学生功能合成演示',instructions:'识别明亮圆形模拟目标，标注其区域并完成报告。此图仅用于软件练习。',case_ids:cases,roster_ids:accounts.map(a=>a.roster_id)},'local-demo');
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,JSON.stringify({accounts,task_id:task.id,case_ids:cases},null,2),{mode:0o600,flag:'wx'});
  console.log('Prepared synthetic DX/CT education task and two student identities. Passwords written only to private handoff file.');
 }finally{if(redis?.isOpen)await redis.quit();if(db.isInitialized)await db.destroy();}
})().catch(()=>{console.error('Synthetic education setup failed; inspect private local state before retrying.');process.exitCode=1;});
