// Synthetic API mocks + real Chrome/Cornerstone pixels; PG/Redis/ES transactions are covered separately.
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const sharp=require(path.resolve(__dirname,'../../node_modules/sharp'));
const output=process.env.MIAP_LIBRARY_ARTIFACT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'miap-library-browser-'));fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],tickets=[],queries=[];let denied=false;
  page.on('pageerror',e=>errors.push(e.message));
  const id='11111111-2222-4333-8444-555555555555',series={id:'series',series_uid:'2.25.1',modality:'CT',frame_count:3,default_window:{center:40,width:400}};
  const object={id:'object',series_id:'series',tool:'box',geometry:{x:180,y:100,w:230,h:200},frame_start:0,frame_end:2,key_frame_index:0,part_id:'part',confidence:'typical',sign_tag_ids:['sign'],window_preset:'lung',report_sent_ids:[0],is_gold:true};
  const data={case:{id,case_no:'SYN-LIBRARY-CT',source:'synthetic',status:'已发布',system_code:'resp',clinical_text:'合成病例库临床信息',confirm_method:'临床综合诊断',age_band:'成人',sex:'未知'},disease:{id:'disease',name:'合成疾病'},series:[series],sentences:[{idx:0,text:'合成结节描述。'}],attachments:[{id:'attachment',kind:'其他',filename:'合成安全附件.png'}],version:3,current_version:3,annotations:[object],teaching_fields:{difficulty:'基础',applicable_level:'实习',sign_points:['结节']}};
  const item={id,case_no:data.case.case_no,system_code:'resp',source:'synthetic',version:3,disease:data.disease,signs:[{id:'sign',name:'结节'}],modalities:['CT'],thumbnail:{...series,frame_index:0}};
  const png=await sharp({create:{width:640,height:480,channels:3,background:'#888'}}).composite([{input:Buffer.from('<svg width="640" height="480"><rect x="180" y="100" width="230" height="200" fill="#ddd"/><text x="20" y="450" fill="white">SYNTHETIC LIBRARY ONLY</text></svg>')}]).png().toBuffer();
  const tree={id:'root',name:'呼吸',level:1,children:[{id:'part',name:'肺',level:2,children:[{id:'disease',name:'合成疾病',level:3,children:[{id:'subtype',name:'合成亚型',level:4,children:[]}]}]}]};
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer synthetic-library');
   if(url.pathname==='/api/taxonomy/tree')return route.fulfill({json:{tree:[tree],sign_tags:[{id:'sign',name:'结节',system_code:'resp',definition:'合成规范'}]}});
   if(url.pathname==='/api/search'){queries.push(Object.fromEntries(url.searchParams));return route.fulfill({json:{items:[item],page:Number(url.searchParams.get('page')||1),pageSize:20,total:21}});}
   if(url.pathname===`/api/library/${id}`)return denied?route.fulfill({status:403,json:{message:'已发布病例不可访问'}}):route.fulfill({json:data});
   if(url.pathname.includes('/attachments/')){assert.equal(url.searchParams.get('version'),'3');return denied?route.fulfill({status:403,json:{message:'已发布病例不可访问'}}):route.fulfill({contentType:'image/png',headers:{'X-Page-Count':'2'},body:png});}
   if(url.pathname==='/api/frames/ticket'){const p=req.postDataJSON();assert.equal(p.access_mode,'library');assert.equal(p.expected_version,3);tickets.push(p);return denied?route.fulfill({status:403,json:{message:'已发布病例不可访问'}}):route.fulfill({json:{url:'/api/frames/a.b.c'}});}
   if(url.pathname==='/api/frames/a.b.c')return route.fulfill({contentType:'image/png',headers:{'X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1})},body:png});
   throw Error('Unexpected library request '+req.method()+' '+url.pathname);
  });
  await page.route('**/library-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/library'],initialSession:{token:'synthetic-library',role:'member',quals:{resp:['review']}}}));
  </script></body></html>`}));
  await page.goto((process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5182')+'/library-smoke');await page.getByText('共 21 例',{exact:true}).waitFor();await page.getByAltText('SYN-LIBRARY-CT 安全缩略图',{exact:true}).waitFor();
  await page.getByLabel('报告与临床全文',{exact:true}).fill('合成结节');await page.getByLabel('报告与临床全文',{exact:true}).press('Enter');await page.waitForFunction(()=>document.querySelector('img')?.complete);assert.equal(queries.at(-1).q,'合成结节');
  await page.getByTitle('2',{exact:true}).click();await page.getByText('共 21 例',{exact:true}).waitFor();assert.equal(queries.at(-1).page,'2');
  await page.screenshot({path:path.join(output,'library-list.png'),fullPage:true,animations:'disabled'});await page.getByRole('link',{name:'SYN-LIBRARY-CT',exact:true}).click();await page.getByLabel('病例库只读详情',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.workbench-viewport canvas')?.width>0);
  assert.equal(await page.getByRole('button',{name:'审核通过',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'保存',exact:true}).count(),0);
  const stats=await sharp(await page.getByLabel('影像视口',{exact:true}).screenshot()).stats();assert(stats.channels[0].stdev>10);
  await page.getByRole('button',{name:'对象 1 · 矩形',exact:true}).click();await page.locator('[data-linked="true"]').waitFor();
  await page.getByRole('button',{name:'下一帧',exact:true}).click();await page.getByText('第 2 / 3 帧',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[data-frame-ready="1"]'));
  await page.getByLabel('窗位',{exact:true}).fill('60');await page.getByRole('button',{name:'应用窗设置',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.workbench-viewport canvas')?.width>0);assert(tickets.some(t=>t.window.center===60));
  await page.screenshot({path:path.join(output,'library-readonly-ct.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('tab',{name:'附件',exact:true}).click();await page.getByRole('button',{name:'合成安全附件.png（其他）',exact:true}).click();await page.getByAltText('已确认附件安全预览',{exact:true}).waitFor();denied=true;await page.getByRole('button',{name:'附件下一页',exact:true}).click();await page.getByText('影像或附件已不可访问，请重新打开病例',{exact:true}).waitFor();assert.equal(await page.getByLabel('影像视口',{exact:true}).count(),0);assert.equal(await page.getByAltText('已确认附件安全预览',{exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'library-revoked.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByLabel('用户名',{exact:true}).waitFor();assert.equal(await page.getByText('SYN-LIBRARY-CT',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log('PASS Chrome: server pagination/search, safe version-bound thumbnails, real Cornerstone CT pixels/frame/window, locked gold/report linking, version-bound attachment denial clears all imagery, logout; synthetic API mocks. Artifacts: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
