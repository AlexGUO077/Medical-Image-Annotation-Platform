// Real local browser -> Vite proxy -> Nest -> PostgreSQL/Redis/Orthanc.
// Synthetic schema/pixels only. No HAR or bearer tokens are written to artifacts.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {randomUUID,randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
require('dotenv').config({path:process.env.MIAP_ENV_FILE??path.resolve(__dirname,'../../.env.local'),quiet:true});
if(!process.env.POSTGRES_DB?.includes('synthetic'))throw new Error('Requires synthetic development database');
process.env.JWT_SECRET=randomBytes(32).toString('hex');process.env.FRAME_TOKEN_SECRET=randomBytes(32).toString('hex');
// Explicit fixture budgets, never application defaults.
process.env.FRAME_RATE_WINDOW_SECONDS='600';
for(const m of ['DX','CR','US'])process.env[`FRAME_RATE_${m}`]='100';
for(const m of ['CT','MR'])process.env[`FRAME_RATE_${m}`]='1000';
require('reflect-metadata');
const {DataSource}=require('typeorm'),{Client}=require('pg'),{createClient}=require('redis');
const {Test}=require('@nestjs/testing'),{Global,Module}=require('@nestjs/common');
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const sharp=require('sharp');
async function assertVisibleWatermark(marked,raw){
 const pixels=bytes=>sharp(bytes).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
 const [actual,source]=await Promise.all([pixels(marked),pixels(raw)]);
 assert.deepEqual(actual.info,source.info,'watermark comparison must use identical dimensions/channels');
 assert.equal(actual.data.length,source.data.length);assert.notDeepEqual(actual.data,source.data,'visible watermark pixels must differ');
}
const {OrthancService}=require('../dist/modules/cases/orthanc.service');
const {AuthTokenService}=require('../dist/modules/auth/auth-token.service');
const {DATABASE_SOURCE}=require('../dist/modules/database/database.tokens');
const {REDIS_CLIENT}=require('../dist/modules/redis/redis.module');
const {AuditService}=require('../dist/modules/audit/audit.service');
const {ApiExceptionFilter}=require('../dist/common/api-exception.filter');
const {TaskMaintenanceService}=require('../dist/modules/tasks/task-maintenance.service');
const connection={host:process.env.POSTGRES_HOST??'127.0.0.1',port:Number(process.env.POSTGRES_PORT??5432),user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB};
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'miap-m2-')),schema='m2_'+randomBytes(8).toString('hex');
 const admin=new Client(connection),keys=new Set(),orthanc=new OrthancService(),uploaded=[];
 const redis=createClient({socket:{host:process.env.REDIS_HOST??'127.0.0.1',port:Number(process.env.REDIS_PORT??6379),reconnectStrategy:false},password:process.env.REDIS_PASSWORD});redis.on('error',()=>{});
 let db,app,vite,browser;
 try{
  execFileSync(process.env.MIAP_PYTHON||'python3',[path.join(__dirname,'generate-m2-synthetic.py'),temp],{stdio:'pipe'});
  await admin.connect();await redis.connect();await admin.query(`CREATE SCHEMA "${schema}"`);
  db=new DataSource({type:'postgres',host:connection.host,port:connection.port,username:connection.user,password:connection.password,database:connection.database,schema,extra:{options:`-c search_path=${schema}`},migrations:[path.resolve(__dirname,'../dist/database/migrations/*.js')],synchronize:false,logging:false});await db.initialize();await db.runMigrations();
  const instrumented={withTypeMapping:redis.withTypeMapping.bind(redis),set:(key,...args)=>{keys.add(key);return redis.set(key,...args);},eval:(script,options)=>{options.keys.forEach(k=>keys.add(k));return redis.eval(script,options);}};
  class FixturesModule{}Global()(FixturesModule);Module({providers:[AuditService,{provide:DATABASE_SOURCE,useValue:db},{provide:REDIS_CLIENT,useValue:instrumented}],exports:[DATABASE_SOURCE,REDIS_CLIENT,AuditService]})(FixturesModule);
  const modules=['frames/frames','workbench/workbench','annotations/annotations','tasks/tasks','taxonomy/taxonomy'].map(p=>Object.entries(require('../dist/modules/'+p+'.module')).find(([name])=>name.endsWith('Module'))[1]);
  const module=await Test.createTestingModule({imports:[FixturesModule,...modules]}).overrideProvider(TaskMaintenanceService).useValue({}).compile();
  app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const api=await app.getUrl();
  const makeUser=async name=>(await db.query(`INSERT INTO users(username,password_hash,real_name,role,status,expire_at,must_change_password,quals) VALUES($1,'synthetic-unused',$1,'member','active','2099-12-31',false,'{"resp":["annotate","review"]}') RETURNING *,expire_at::text`,[name]))[0];
  const actor=await makeUser('synthetic-annotator'),reviewer=await makeUser('synthetic-reviewer');
  const token=app.get(AuthTokenService).signAccess(actor),reviewToken=app.get(AuthTokenService).signAccess(reviewer);
  const root=randomUUID(),part=randomUUID(),sign=randomUUID();
  await db.query("INSERT INTO taxonomy_nodes(id,level,name,synonyms) VALUES($1,1,'呼吸','[]')",[root]);
  await db.query("INSERT INTO taxonomy_nodes(id,parent_id,level,name,synonyms) VALUES($1,$2,2,'合成肺','[]')",[part,root]);
  await db.query("INSERT INTO sign_tags(id,name,system_code,definition) VALUES($1,'合成结节','resp','仅供合成验收')",[sign]);
  const cases=[];
  for(const item of JSON.parse(await fs.readFile(path.join(temp,'manifest.json'),'utf8'))){
   const files=(await fs.readdir(path.join(temp,item.modality))).sort().map(f=>path.join(temp,item.modality,f));
   const source=await orthanc.uploadSeries(files);uploaded.push(source.id);
   const id=randomUUID(),study=randomUUID(),series=randomUUID(),task=randomUUID();
   await db.query("INSERT INTO cases(id,case_no,source,system_code,status,confirm_method) VALUES($1,$2,'synthetic','resp','标注中','临床综合诊断')",[id,'SYN-M2-'+item.modality]);
   await db.query("INSERT INTO tasks(id,name,source,system_code,review_mode,status,dispatch_mode,priority) VALUES($1,'合成验收','synthetic','resp','peer','进行中','auto',0)",[task]);
   await db.query('INSERT INTO task_cases(task_id,case_id) VALUES($1,$2)',[task,id]);
   await db.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,state) VALUES($1,$2,'annotate','active')",[id,actor.id]);
   await db.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'case_manual.confirmed',$2,'{}','synthetic-test')",[actor.id,`cases:${id}`]);
   await db.query("INSERT INTO studies(id,case_id,study_uid,study_date) VALUES($1,$2,$3,'2026-10-02')",[study,id,item.study_uid]);
   await db.query('INSERT INTO series(id,study_id,modality,series_uid,orthanc_id,frame_count,default_window) VALUES($1,$2,$3,$4,$5,$6,$7)',[series,study,item.modality,item.series_uid,source.id,item.count,JSON.stringify({center:128,width:256})]);
   await db.query("INSERT INTO reports(case_id,raw_text,sentences) VALUES($1,'合成肺结节',$2)",[id,JSON.stringify([{idx:0,text:'合成肺结节。'}])]);
   cases.push({...item,id,task,series,orthanc:source.id});
  }
  const {createServer}=await import('vite');vite=await createServer({root:path.resolve(__dirname,'../../web-anno'),server:{host:'127.0.0.1',port:0,proxy:{'/api':api}},logLevel:'error'});await vite.listen();const base=vite.resolvedUrls.local[0];
  browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
  const context=await browser.newContext({viewport:{width:1700,height:1100}}),page=await context.newPage(),errors=[],responses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(base).origin)errors.push('unexpected external browser request');});
  // Read a clone while the response stream is live; CDP may discard blobs after viewer disposal.
  await page.addInitScript(()=>{
   window.__m2Responses=[];window.__m2Reads=[];const native=window.fetch;
   window.fetch=async(...args)=>{
    const response=await native(...args),url=new URL(response.url);
    if(url.pathname.startsWith('/api/')){
     const info={pathname:url.pathname.startsWith('/api/frames/')?'/api/frames/<redacted>':url.pathname,status:response.status,headers:Object.fromEntries(response.headers)};
     if(response.headers.get('content-type')?.includes('image/')){
      const encoded=url.pathname.split('/').pop().split('.')[1];const bound=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));
      info.target={case_id:bound.case_id,series_uid:bound.series_uid,frame_index:bound.frame_index};
     }
     window.__m2Reads.push(response.clone().arrayBuffer().then(bytes=>window.__m2Responses.push({...info,bytes:Array.from(new Uint8Array(bytes))})).catch(e=>{if(e.name!=='AbortError')window.__m2Responses.push({failed:true});}));
    }
    return response;
   };
  });
  for(const item of cases){
   await page.route('**/m2-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/workbench/${item.id}'],initialSession:${JSON.stringify({token,role:'member',quals:{resp:['annotate','review']}})}}));</script></body></html>`}));
   await page.goto(base+'m2-smoke');await page.getByLabel('标注绘图层').waitFor();await page.getByText('已保存 · 版本 0',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:/下载|导出|打印/}).count(),0);
   const post=(url,body,auth=token)=>fetch(api+url,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const issued=await post('/api/frames/ticket',{case_id:item.id,series_uid:item.series_uid,frame_index:item.count-1});assert.equal(issued.status,201);const ticket=await issued.json();
   assert.equal((await fetch(api+ticket.url,{headers:{Authorization:`Bearer ${reviewToken}`}})).status,403);
   assert.equal((await fetch(api+ticket.url+'?frame_index=0',{headers:{Authorization:`Bearer ${token}`}})).status,400);
   assert.equal((await fetch(api+ticket.url,{headers:{Authorization:`Bearer ${token}`}})).status,200);
   const timings=[];
   if(item.modality==='CT')for(let frame=1;frame<=5;frame++){
    await page.waitForTimeout(500); // Give adjacent-frame preloading time; measure only the subsequent flip.
    timings.push(await page.evaluate(target=>new Promise((resolve,reject)=>{const start=performance.now(),timer=setTimeout(()=>{observer.disconnect();reject(new Error('frame timeout'));},10000);const observer=new MutationObserver(()=>{if(document.querySelector(`[data-frame-ready="${target}"]`)){clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);}});observer.observe(document.body,{subtree:true,attributes:true,childList:true});[...document.querySelectorAll('button')].find(b=>b.textContent==='下一帧').click();}),frame));
   }
   const box=await page.getByLabel('标注绘图层').boundingBox();await page.getByRole('button',{name:'4 点',exact:true}).click();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
   await page.getByRole('combobox',{name:'标注部位'}).click();await page.getByTitle('合成肺',{exact:true}).click();
   await page.getByRole('combobox',{name:'标注征象'}).click();await page.getByTitle('合成结节',{exact:true}).click();await page.keyboard.press('Escape');
   await page.getByRole('combobox',{name:'标注置信度'}).click();await page.getByTitle('典型',{exact:true}).click();await page.getByRole('button',{name:/\[0\] 合成肺结节/}).click();
   await page.keyboard.press('Escape');
   if(process.env.MIAP_M2_ARTIFACT_DIR){await fs.mkdir(process.env.MIAP_M2_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MIAP_M2_ARTIFACT_DIR,item.modality+'.png')});}
   await page.getByRole('button',{name:'提交审核',exact:true}).click();await page.getByText('个人任务与标注领取池',{exact:true}).waitFor();
   const [saved]=await db.query('SELECT status,annotation_version FROM cases WHERE id=$1',[item.id]);assert.equal(saved.status,'待审核');assert(saved.annotation_version>0);
   const [review]=await db.query("SELECT assignee_id FROM task_assignments WHERE case_id=$1 AND task_role='review' AND state='active'",[item.id]);assert.equal(review.assignee_id,reviewer.id);
   assert.equal((await fetch(api+ticket.url,{headers:{Authorization:`Bearer ${token}`}})).status,403,'submission revokes the annotator frame ticket');
   assert.equal((await post('/api/frames/ticket',{case_id:item.id,series_uid:item.series_uid,frame_index:0},reviewToken)).status,403,'preassignment does not start review');
   console.log(JSON.stringify({modality:item.modality,frames:item.count,status:saved.status,preloaded_flip_ms:timings.map(t=>Math.round(t*10)/10),within_200ms:timings.every(t=>t<=200)}));
   const captured=await page.evaluate(async()=>{await Promise.all(window.__m2Reads);return window.__m2Responses;});
   const first=captured.find(r=>r.headers?.['content-type']?.includes('image/')&&r.target?.case_id===item.id&&r.target?.series_uid===item.series_uid&&r.target?.frame_index===0);assert(first,'capture must include the exact frame zero');
   const resolved=await orthanc.resolveSeriesFrame(item.orthanc,item.series_uid,0,item.count);
   const raw=await orthanc.renderInstanceFrame(resolved.instance_id,resolved.frame_index,{center:128,width:256});
   await assertVisibleWatermark(Buffer.from(first.bytes),raw);
   await assert.rejects(assertVisibleWatermark(await sharp(raw).ensureAlpha().png().toBuffer(),raw),assert.AssertionError,'alpha alone must not pass watermark verification');
   responses.push(...captured);assert(timings.every(t=>t<=200),'local preloaded flip exceeds 200ms');await page.unroute('**/m2-smoke');
  }
  // Examine actual browser responses without persisting signed URLs or authorization headers.
  let images=0;
  for(const response of responses){
   assert(!response.failed,'completed browser response capture must succeed');
   const {pathname,headers}=response,bytes=Buffer.from(response.bytes);
   if(headers['content-type']?.includes('image/')){
    assert.match(pathname,/^\/api\/frames\//);assert.equal(headers['cache-control'],'no-store, private');
    assert(bytes.length,'completed image response must contain pixels');const meta=await sharp(bytes).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,512);assert.equal(meta.exif,undefined);images++;
   }else if(headers['content-type']?.includes('application/json')){
    const json=bytes.toString('utf8');assert(!/orthanc_id|object_key|mask_map_id|PixelData/.test(json));for(const id of uploaded)assert(!json.includes(id));
   }
  }
  assert(images>5);assert.deepEqual(errors,[]);
  const storage=await page.evaluate(async()=>({cache:await caches.keys(),local:{...localStorage},session:{...sessionStorage}}));
  assert.deepEqual(storage.cache,[]);assert.deepEqual(storage.session,{});
  // Cornerstone stores GPU capability probes and loglevel stores its verbosity, never image bytes.
  for(const [key,value] of Object.entries(storage.local)){
   if(key==='loglevel')assert.match(value,/^(TRACE|DEBUG|INFO|WARN|ERROR|SILENT)$/);
   else{assert.equal(key,'cornerstone3D.renderingCapabilities');const cap=JSON.parse(value);assert.deepEqual(Object.keys(cap).sort(),['formats','probeVersion','renderer','webgl2']);assert.equal(cap.probeVersion,1);assert.equal(typeof cap.webgl2,'boolean');assert.equal(typeof cap.renderer,'string');assert(cap.renderer.length<512);assert.deepEqual(Object.keys(cap.formats).sort(),['float','floatLinear','halfFloat','halfFloatLinear','norm16','norm16Linear']);assert(Object.values(cap.formats).every(v=>typeof v==='boolean'));}
  }
  for(const item of cases)assert.equal(await page.evaluate(async({account,id})=>{const d=await import('/src/annotations/drafts.ts');return d.syntheticDraftStore(account,id,'synthetic').read();},{account:actor.id,id:item.id}),undefined,'successful submission leaves no saved draft');
  const rows=await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='frames.viewed'");assert(rows[0].n>=images);
 }finally{
  // Each resource is attempted even if a preceding cleanup fails. Only this run's IDs are touched.
  const failures=[],attempt=async(label,work)=>{try{await work();}catch{failures.push(label);}};
  await attempt('browser',()=>browser?.close());await attempt('vite',()=>vite?.close());await attempt('app',()=>app?.close());
  await attempt('redis keys',async()=>{if(keys.size){if(!redis.isReady)throw new Error('Redis unavailable');await redis.del([...keys]);}});
  await attempt('redis connection',()=>{if(redis.isOpen)redis.destroy();});
  await attempt('database connection',()=>db?.destroy());
  await attempt('synthetic schema',async()=>{if(admin._connected){await admin.query('SET statement_timeout=10000');await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}});
  await attempt('admin connection',()=>admin.end());
  for(const id of uploaded)await attempt('synthetic Orthanc series',async()=>{
   const base=`${process.env.ORTHANC_USE_TLS==='true'?'https':'http'}://${process.env.ORTHANC_HOST??'127.0.0.1'}:${process.env.ORTHANC_PORT??8042}`;
   const headers={authorization:'Basic '+Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD}`).toString('base64')};
   const remove=await fetch(`${base}/series/${id}`,{method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!remove.ok&&remove.status!==404)throw new Error('Series cleanup failed');
   assert.equal((await fetch(`${base}/series/${id}`,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})).status,404);
  });
  await attempt('temporary pixels',()=>fs.rm(temp,{recursive:true,force:true}));
  if(failures.length)throw new Error('Synthetic cleanup failed: '+failures.join(', '));
 }
 console.log('PASS: real DX/300-slice CT browser to pending review, no API mocks, PNG-only image responses, same-frame visible watermark, private no-store, no upstream identifiers/external requests, frame audit, empty CacheStorage/session storage/drafts; localStorage only GPU probes/log verbosity; cleanup verified');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
