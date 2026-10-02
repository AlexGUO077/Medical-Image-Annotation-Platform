// Optional Chrome regression with explicitly synthetic API mocks. Real transactions are verified by frame-api.integration.cjs.
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const repo=path.resolve(__dirname,'../..'),sharp=require(repo+'/node_modules/sharp');
const output=process.env.MIAP_REVIEW_ARTIFACT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'miap-review-browser-'));
fs.mkdirSync(output,{recursive:true});
const base=process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5181';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const object={id:'11111111-1111-4111-8111-111111111111',series_id:'series',tool:'box',geometry:{x:180,y:100,w:230,h:200},frame_start:0,frame_end:5,key_frame_index:0,part_id:'part',confidence:'typical',sign_tag_ids:['sign'],window_preset:'lung',report_sent_ids:[0]};
  const data={case:{id:'case',case_no:'SYN-REVIEW-BROWSER',source:'synthetic',status:'审核中',system_code:'resp',clinical_text:'合成临床信息，仅用于开发测试。',confirm_method:'临床综合诊断',age_band:null,sex:null},disease:{id:'disease',name:'合成疾病'},series:[{id:'series',series_uid:'2.25.1',modality:'CT',frame_count:300,default_window:{center:40,width:400}}],sentences:[{idx:0,text:'合成结节描述，与对象关联。'}],attachments:[{id:'attachment',filename:'合成附件.png',kind:'其他'}],review_mode:'peer',version:2,current_version:2,annotations:[object],latest_review:null};
  const png=await sharp({create:{width:640,height:480,channels:3,background:'#888888'}}).composite([{input:Buffer.from('<svg width="640" height="480"><rect x="170" y="80" width="300" height="280" fill="#dddddd"/><text x="20" y="460" fill="white" font-size="20">SYNTHETIC REVIEW TEST ONLY</text></svg>')}]).png().toBuffer();
  let published=false,posts=[],frameRequests=0,attachmentRequests=0;
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer synthetic-review');
   if(url.pathname==='/api/taxonomy/tree')return route.fulfill({json:{tree:[{id:'root',name:'呼吸',children:[{id:'part',name:'合成部位',synonyms:[],children:[]}]}],sign_tags:[{id:'sign',name:'合成征象',definition:'仅为合成测试规范。',system_code:'resp'}]}});
   if(url.pathname==='/api/reviews/case'){
    if(req.method()==='GET')return route.fulfill({json:{...data,version:url.searchParams.has('version')?Number(url.searchParams.get('version')):2,annotations:[{...object,geometry:url.searchParams.has('version')?{x:160,y:100,w:230,h:200}:object.geometry}]}});
    assert.equal(req.method(),'POST');const payload=req.postDataJSON();posts.push(payload);published=true;
    return route.fulfill({json:{review_id:'review',case_id:'case',version:2,status:payload.result==='通过'?'已发布':'标注中',is_gold:payload.result==='通过',reannotation:payload.result==='通过'?null:{assignment_id:'assignment',assignee_id:'author',reason:null}}});
   }
   if(url.pathname==='/api/reviews/case/attachments/attachment/preview'){attachmentRequests++;return route.fulfill({contentType:'image/png',headers:{'X-Page-Count':'2','Cache-Control':'no-store, private'},body:png});}
   if(url.pathname==='/api/frames/ticket'){assert(!published,'finished review must not obtain new frames');return route.fulfill({json:{url:'/api/frames/a.b.c'}});}
   if(url.pathname==='/api/frames/a.b.c'){frameRequests++;return route.fulfill({contentType:'image/png',headers:{'X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1}),'Cache-Control':'no-store, private'},body:png});}
   throw new Error('Unexpected API: '+req.method()+' '+url.pathname);
  });
  await page.route('**/review-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/review/case'],initialSession:{token:'synthetic-review',role:'member',quals:{resp:['review']}}}));
  </script></body></html>`}));
  await page.goto(base+'/review-smoke');await page.getByText('审核台 · SYN-REVIEW-BROWSER').waitFor();
  await page.waitForFunction(()=>document.querySelector('.workbench-viewport canvas')?.width>0);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.replace(/\s/g,'')==='放大'&&!b.disabled));
  assert(await page.getByRole('button',{name:'审核通过',exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:'提交审核',exact:true}).count(),0);
  await page.getByRole('button',{name:/对象 1 ·/}).click();
  await page.getByText('合成征象：仅为合成测试规范。').waitFor();
  await page.getByRole('button',{name:'叠加上一版本',exact:true}).click();await page.getByText(/当前版本：实线；历史版本 1/).waitFor();
  await page.screenshot({path:path.join(output,'review-overlap.png'),fullPage:true});
  const stats=await sharp(await page.getByLabel('影像视口',{exact:true}).screenshot()).stats();assert(stats.channels[0].stdev>10,'real Cornerstone canvas must contain rendered pixels');
  await page.getByRole('tab',{name:'附件',exact:true}).click();await page.getByRole('button',{name:'合成附件.png（其他）',exact:true}).click();await page.getByAltText('已确认附件安全预览').waitFor();await page.getByRole('button',{name:'附件下一页',exact:true}).click();await page.getByText('第 2 / 2 页', {exact:true}).waitFor();
  assert.equal(attachmentRequests,2);await page.getByRole('button',{name:'Close',exact:true}).click();
  for(const label of ['脱敏是否合格','确诊依据是否完整','疾病标签是否正确']){await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="合格 / 完整 / 正确"]').last().click();}
  await page.getByLabel('总体审核意见',{exact:true}).fill('合成审核：轮廓与报告关联已核对。');
  await page.getByRole('button',{name:'审核通过',exact:true}).click();assert.equal(posts.length,0);await page.getByText(/通过后病例立即发布/).waitFor();
  await page.getByRole('button',{name:'确认发布',exact:true}).click();await page.getByText('审核通过，当前版本已发布并锁定为金标准',{exact:true}).waitFor();
  assert.equal(posts.length,1);assert.equal(posts[0].expected_version,2);assert.equal(posts[0].result,'通过');assert(await page.getByRole('button',{name:'下一帧',exact:true}).isDisabled());
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'published-readonly.png'),fullPage:true});
  const after=frameRequests;await page.waitForTimeout(300);assert.equal(frameRequests,after);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(async()=> (await caches.keys()).length),0);
  assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage)),[]);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).waitFor();assert.equal(await page.getByLabel('影像视口',{exact:true}).count(),0);
  // A fresh mounted reviewer can reject a veto item and return an object-level note.
  published=false;await page.goto(base+'/review-smoke');await page.getByText('审核台 · SYN-REVIEW-BROWSER').waitFor();
  for(const [index,label] of ['脱敏是否合格','确诊依据是否完整','疾病标签是否正确'].entries()){await page.getByRole('combobox',{name:label,exact:true}).click();await page.locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${index===2?'不合格 / 缺失 / 错误':'合格 / 完整 / 正确'}"]`).last().click();}
  assert(await page.getByRole('button',{name:'审核通过',exact:true}).isDisabled());await page.getByLabel('对象 1 审核意见',{exact:true}).fill('请核对疾病标签。');await page.getByRole('button',{name:'打回重标',exact:true}).click();await page.getByRole('button',{name:'确认打回',exact:true}).click();await page.getByText('已打回，原标注人可继续修改',{exact:true}).waitFor();
  assert.equal(posts.length,2);assert.equal(posts[1].comments[1].annotation_id,object.id);assert.deepEqual(errors,[]);
  console.log('PASS Chrome: real Cornerstone pixels, locked review objects, previous-version overlay, safe attachment pagination, checks/confirm/publication/return, no further frame access, logout cleanup; API mocks are synthetic. Artifacts: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
