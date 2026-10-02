// Chrome UI uses synthetic API mocks; real transactions are checked in frame-api.integration.cjs.
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const sharp=require(path.resolve(__dirname,'../../node_modules/sharp'));
const output=process.env.MIAP_QUALITY_ARTIFACT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'miap-quality-browser-'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[],posts=[];let started=false,offlined=false;
  page.on('pageerror',e=>errors.push(e.message));
  const object={id:'11111111-1111-4111-8111-111111111111',series_id:'series',tool:'box',geometry:{x:180,y:100,w:230,h:200},frame_start:0,frame_end:0,key_frame_index:0,part_id:'part',confidence:'typical',sign_tag_ids:['sign'],window_preset:null,report_sent_ids:[0],is_gold:true};
  const task={id:'task',name:'合成抽检任务',source:'synthetic',system_code:'resp',review_mode:'self',dispatch_mode:'manual',priority:0,in_flight_limit:1,status:'进行中',created_at:'2026-10-02T13:00:00Z',case_count:11};
  const data={case:{id:'case',case_no:'SYN-QUALITY',source:'synthetic',status:'已发布',system_code:'resp',clinical_text:'合成质量审核，仅用于测试。',confirm_method:'临床综合诊断',age_band:null,sex:null},disease:{id:'disease',name:'合成疾病'},series:[{id:'series',series_uid:'2.25.1',modality:'DX',frame_count:1,default_window:null}],sentences:[{idx:0,text:'合成结节描述。'}],attachments:[],review_mode:'self',version:3,current_version:3,annotations:[object],latest_review:null,review_kind:'spotcheck',review_version:3,assignment_id:'quality-id',started_at:'2026-10-02T13:00:00Z'};
  const png=await sharp({create:{width:640,height:480,channels:3,background:'#888888'}}).composite([{input:Buffer.from('<svg width="640" height="480"><rect x="180" y="100" width="230" height="200" fill="#ddd"/><text x="20" y="450" fill="white">SYNTHETIC QUALITY ONLY</text></svg>')}]).png().toBuffer();
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer synthetic-quality');
   if(url.pathname==='/api/tasks')return route.fulfill({json:{items:[task],total:1,page:1,pageSize:20}});
   if(url.pathname==='/api/tasks/task/spotchecks'){posts.push(req.postDataJSON());return route.fulfill({status:201,json:{batch_id:'batch',candidate_count:11,sampled_count:2,assigned_count:1,pending_count:1}});}
   if(url.pathname==='/api/tasks/pool')return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
   if(url.pathname==='/api/tasks/mine'){const items=url.searchParams.get('task_role')==='review'?[{task_id:'task',task_name:task.name,case_id:'case',case_no:'SYN-QUALITY',status:'已发布',priority:0,due_at:null,review_mode:'self',assignment_id:'quality-id',review_kind:'spotcheck',review_version:3,started_at:started?data.started_at:null}]:[];return route.fulfill({json:{items,total:items.length,page:1,pageSize:20}});}
   if(url.pathname==='/api/tasks/start-review'){assert.deepEqual(req.postDataJSON(),{task_id:'task',case_id:'case',assignment_id:'quality-id'});started=true;return route.fulfill({status:201,json:{case_id:'case',status:'已发布'}});}
   if(url.pathname==='/api/taxonomy/tree')return route.fulfill({json:{tree:[],sign_tags:[]}});
   if(url.pathname==='/api/reviews/case'){
    assert(started);if(req.method()==='GET')return route.fulfill({json:data});
    const payload=req.postDataJSON();assert.equal(payload.assignment_id,'quality-id');assert.equal(payload.expected_version,3);assert.equal(payload.result,'打回');posts.push(payload);offlined=true;
    return route.fulfill({status:201,json:{review_id:'review',case_id:'case',version:3,status:'已下线',is_gold:true,reannotation:null,review_kind:'spotcheck',assigned_count:1,pending_count:8}});
   }
   if(url.pathname==='/api/frames/ticket'){assert(!offlined);return route.fulfill({json:{url:'/api/frames/a.b.c'}});}
   if(url.pathname==='/api/frames/a.b.c')return route.fulfill({contentType:'image/png',headers:{'X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1})},body:png});
   throw new Error('Unexpected API '+req.method()+' '+url.pathname);
  });
  await page.route('**/quality-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/tasks'],initialSession:{token:'synthetic-quality',role:'admin',quals:{resp:['review']}}}));
  </script></body></html>`}));
  await page.goto((process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5181')+'/quality-smoke');
  await page.getByRole('button',{name:'发起抽检',exact:true}).click();assert.equal(posts.length,0);
  await page.getByRole('button',{name:'确认生成抽检',exact:true}).click();await page.getByText('本轮候选 11 例，抽中 2 例',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'sampling-pending.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:/关\s*闭/,exact:true}).click();
  await page.getByRole('tab',{name:'个人任务',exact:true}).click();await page.getByRole('combobox',{name:'任务角色',exact:true}).locator('..').locator('..').click();await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="审核"]').last().click();
  assert.equal(await page.getByRole('link',{name:'进入审核台',exact:true}).count(),0);await page.getByRole('button',{name:'开始审核',exact:true}).click();
  await page.getByRole('link',{name:'进入审核台',exact:true}).click();await page.getByText('审核台 · SYN-QUALITY',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.workbench-viewport canvas')?.width>0);
  const stats=await sharp(await page.getByLabel('影像视口',{exact:true}).screenshot()).stats();assert(stats.channels[0].stdev>10);
  for(const [i,label] of ['脱敏是否合格','确诊依据是否完整','疾病标签是否正确'].entries()){await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${i===2?'不合格 / 缺失 / 错误':'合格 / 完整 / 正确'}"]`).last().click();}
  await page.getByLabel('总体审核意见',{exact:true}).fill('合成抽检：请修正标签。');await page.getByRole('button',{name:'打回并下线',exact:true}).click();assert.equal(posts.length,1);
  await page.getByText(/同时触发本轮同标注人/).waitFor();await page.waitForFunction(()=>{const el=document.querySelector('[role=dialog]');return el&&getComputedStyle(el).opacity==='1'&&el.getBoundingClientRect().width>500;});await page.screenshot({path:path.join(output,'quality-confirmation.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'确认打回',exact:true}).click();await page.getByText('抽检未通过，病例已下线',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('影像视口',{exact:true}).count(),0);assert.equal(posts.length,2);await page.getByText(/待派 8 例/).waitFor();
  await page.screenshot({path:path.join(output,'offlined-expanded.png'),fullPage:true});assert.deepEqual(errors,[]);
  console.log('PASS Chrome: admin batch/pending counts, personal peer-quality queue/explicit start, real Cornerstone pixels, pinned assignment, veto/confirmation, offline clears imagery and shows expanded review counts; synthetic API mocks. Artifacts: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
