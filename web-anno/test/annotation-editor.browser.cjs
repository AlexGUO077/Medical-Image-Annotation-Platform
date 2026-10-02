// Synthetic full browser workflow, against local Vite; supply external Playwright and Chrome.
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const base=process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5179';
const ids={account:'10000000-0000-4000-8000-000000000001',case:'20000000-0000-4000-8000-000000000001',series:'30000000-0000-4000-8000-000000000001',part:'40000000-0000-4000-8000-000000000001',sign:'50000000-0000-4000-8000-000000000001'};
const token='e30.'+Buffer.from(JSON.stringify({sub:ids.account})).toString('base64url')+'.synthetic';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1700,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const png=await sharp({create:{width:640,height:480,channels:3,background:'#777777'}}).png().toBuffer();
  let initialFailure=false,expiredSave=false,calibrated=true,version=0,objects=[],writes=0;const history=new Map([[0,[]]]);
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer '+token);
   if(url.pathname==='/api/workbench/'+ids.case)return route.fulfill({json:{case:{id:ids.case,case_no:'SYN-ANNOTATION',source:'synthetic',system_code:'resp',status:'标注中',confirm_method:'临床综合诊断'},series:[{id:ids.series,series_uid:'2.25.123',modality:'CT',frame_count:300,default_window:{center:40,width:400}}],sentences:[{idx:0,text:'肺内合成结节。'}],attachments:[]}});
   if(url.pathname==='/api/taxonomy/tree')return route.fulfill({json:{tree:[{id:'root',name:'呼吸',level:1,children:[{id:ids.part,name:'肺',level:2,synonyms:[],children:[]}]}],sign_tags:[{id:ids.sign,name:'结节',system_code:'resp',definition:'合成测试定义'}]}});
   if(url.pathname.endsWith('/annotations')){
    if(req.method()==='PUT'){if(expiredSave)return route.fulfill({status:401,json:{message:'登录已过期'}});const body=req.postDataJSON();if(body.expected_version!==version)return route.fulfill({status:409,json:{message:'标注版本冲突'}});version++;writes++;objects=body.annotations;history.set(version,structuredClone(objects));return route.fulfill({json:{version,annotations:objects}});}
    if(initialFailure){initialFailure=false;return route.fulfill({status:503,json:{message:'首次读取失败'}});}
    const target=url.searchParams.has('version')?Number(url.searchParams.get('version')):version;return route.fulfill({json:{version:target,current_version:version,annotations:history.get(target)??objects}});
   }
   if(url.pathname==='/api/frames/ticket')return route.fulfill({json:{url:'/api/frames/a.b.c'}});
   if(url.pathname==='/api/frames/a.b.c')return route.fulfill({contentType:'image/png',headers:{'X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:calibrated?0.8:null,column_spacing:calibrated?0.6:null})},body:png});
   return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
  });
  await page.route('**/annotation-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/workbench/${ids.case}'],initialSession:{token:'${token}',role:'member',quals:{resp:['annotate']}}}));</script></body></html>`}));
  await page.goto(base+'/annotation-smoke');await page.getByLabel('标注绘图层').waitFor();await page.getByText('已保存 · 版本 0',{exact:true}).waitFor();
  const latencies=[];
  for(let frame=1;frame<=5;frame++){
   await page.waitForTimeout(150);
   latencies.push(await page.evaluate(target=>new Promise((resolve,reject)=>{
    const start=performance.now(),timer=setTimeout(()=>{observer.disconnect();reject(new Error('frame timeout'));},5000);
    const observer=new MutationObserver(()=>{if(document.querySelector(`[data-frame-ready="${target}"]`)){clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);}});
    observer.observe(document.body,{subtree:true,attributes:true,childList:true});[...document.querySelectorAll('button')].find(b=>b.textContent==='下一帧').click();
   }),frame));
  }
  console.log('Synthetic 300-frame client flip latencies (ms):',latencies);assert(Math.max(...latencies)<=200,'preloaded client frame switches must finish within 200ms');
  for(let i=0;i<5;i++){await page.getByRole('button',{name:'上一帧',exact:true}).click();await page.locator(`[data-frame-ready="${4-i}"]`).waitFor();}
  const layer=page.getByLabel('标注绘图层');let box=await layer.boundingBox();const center={x:box.x+box.width*.5,y:box.y+box.height*.5};
  const draw=async(name,start,end)=>{await page.getByRole('button',{name,exact:true}).click();await page.mouse.move(start.x,start.y);await page.mouse.down();if(end)await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();};
  const save=async()=>{await page.getByRole('button',{name:'保存标注',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.startsWith('已保存'));};
  await draw('4 点',center);await save();assert.equal(objects.length,1);assert.equal(objects[0].part_id,null,'incomplete attributes are valid drafts');assert(Math.abs(objects[0].geometry.x-320)<1&&Math.abs(objects[0].geometry.y-240)<1,'center stores original anisotropic DICOM pixel coordinates');
  await page.getByRole('combobox',{name:'标注部位'}).click();await page.getByTitle('肺',{exact:true}).click();
  await page.getByRole('combobox',{name:'标注征象'}).click();await page.getByTitle('结节',{exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'标注置信度'}).click();await page.getByTitle('典型',{exact:true}).click();
  await page.getByRole('button',{name:/\[0\] 肺内合成结节/}).click();await save();assert.deepEqual(objects[0].report_sent_ids,[0]);assert.equal(objects[0].part_id,ids.part);
  await draw('1 矩形',{x:center.x-70,y:center.y-60},{x:center.x+60,y:center.y+60});await save();assert(objects.find(a=>a.tool==='box').geometry.w>0);
  await page.getByRole('button',{name:'3 多边形',exact:true}).click();for(const [x,y] of [[-50,-30],[60,-30],[10,60]])await page.mouse.click(center.x+x,center.y+y);await page.keyboard.press('Enter');await save();
  await draw('2 画笔',{x:center.x-20,y:center.y},{x:center.x+30,y:center.y+20});await save();assert.deepEqual(new Set(objects.map(a=>a.tool)),new Set(['point','box','polygon','brush']));
  const brush=objects.find(a=>a.tool==='brush');assert.equal(brush.geometry.width,640);assert.equal(brush.geometry.height,480);
  const before=JSON.stringify(objects);await page.getByRole('button',{name:/放\s*大/}).click();await page.getByRole('button',{name:/缩\s*小/}).click();assert.equal(JSON.stringify(objects),before,'zoom does not mutate source coordinates');
  // Edit the selected mask, then undo and redo its completed stroke.
  await page.getByLabel('橡皮擦',{exact:true}).check();await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+12,center.y+5,{steps:3});await page.mouse.up();
  await page.getByRole('button',{name:/撤\s*销/}).click();await page.getByRole('button',{name:/重\s*做/}).click();await save();await page.getByLabel('橡皮擦',{exact:true}).uncheck();
  await page.getByRole('button',{name:'复制到后一帧',exact:true}).click();await page.getByText('第 2 / 300 帧',{exact:true}).waitFor();await save();assert.equal(objects.find(a=>a.tool==='brush').geometry.frames[0].frame_index,1);
  // A preselected millimetre brush must turn off when the next source lacks calibration.
  calibrated=false;await page.getByRole('button',{name:'2 画笔',exact:true}).click();
  for(let frame=2;frame<=3;frame++){await page.getByRole('button',{name:'下一帧',exact:true}).click();await page.locator(`[data-frame-ready="${frame}"]`).waitFor();}
  await page.getByText('影像缺少像素间距，毫米画笔和测量不可用',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'2 画笔',exact:true}).isDisabled());
  const uncalibratedSnapshot=JSON.stringify(objects);await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+20,center.y+10,{steps:3});await page.mouse.up();assert(await page.getByRole('button',{name:'保存标注',exact:true}).isDisabled());assert.equal(JSON.stringify(objects),uncalibratedSnapshot);assert.deepEqual(errors,[]);
  await context.setOffline(true);await page.getByText(/离线：/).waitFor();const oldWrites=writes;
  await page.getByLabel('报告未提及',{exact:true}).check();await page.waitForTimeout(2200);assert.equal(writes,oldWrites,'offline editing never sends a save');
  await context.setOffline(false);await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.startsWith('已保存'),{timeout:15000});assert(objects.find(a=>a.tool==='brush').report_sent_ids.includes(-1));
  await page.getByRole('button',{name:'版本历史',exact:true}).click();await page.getByLabel('历史标注版本',{exact:true}).fill('1');await page.getByRole('button',{name:'读取并比较',exact:true}).click();await page.getByRole('button',{name:'在影像上查看历史轮廓',exact:true}).click();
  await page.getByText('正在查看历史版本 1，轮廓只读',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'4 点',exact:true}).isDisabled());await page.getByRole('button',{name:'返回当前标注',exact:true}).click();
  await page.getByRole('button',{name:/对象 4 · 画笔/}).click();
  // A competing server version stops automatic save and leaves the local candidate visible.
  version++;await page.getByLabel('报告未提及',{exact:true}).uncheck();await page.getByText('版本冲突：自动保存已暂停',{exact:true}).waitFor({timeout:10000});
  await page.getByRole('button',{name:'查看冲突'}).click();await page.getByRole('button',{name:'保留本地草稿'}).click();
  assert.deepEqual(errors,[]);await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).waitFor();
  const remaining=await page.evaluate(async()=>{const d=await import('/src/annotations/drafts.ts');d.allowAccountDrafts('10000000-0000-4000-8000-000000000001');return d.syntheticDraftStore('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','synthetic').read();});assert.equal(remaining,undefined);
  // Initial transport failure must not expose drawing controls; retry opens them.
  initialFailure=true;await page.goto(base+'/annotation-smoke');await page.getByText('首次读取失败',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'4 点',exact:true}).isDisabled());
  await page.getByRole('button',{name:'重新检查',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.startsWith('已保存'));await page.getByLabel('标注绘图层').waitFor();
  box=await layer.boundingBox();expiredSave=true;await draw('4 点',{x:box.x+box.width*.5,y:box.y+box.height*.5});await page.getByRole('button',{name:'保存标注',exact:true}).click();await page.getByLabel('用户名',{exact:true}).waitFor();
  const preserved=await page.evaluate(async()=>{const d=await import('/src/annotations/drafts.ts');return d.syntheticDraftStore('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','synthetic').read();});assert(preserved?.annotations.length>0,'expiry redirects after persisting the recoverable draft');assert.deepEqual(errors,[]);
  console.log('PASS editor browser: four tools, incomplete draft, attributes/report association, source coordinates, CT mask copy, offline recovery, conflict stop, uncalibrated brush guard, initialization retry, expiry draft preservation and logout cleanup; writes='+writes);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
