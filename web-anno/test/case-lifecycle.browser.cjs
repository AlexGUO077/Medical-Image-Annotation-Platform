// Optional Chrome UI regression with synthetic API mocks; real DB effects use frame-api.integration.cjs.
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=process.env.MIAP_LIFECYCLE_ARTIFACT_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'miap-lifecycle-browser-'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  let status='已发布',version=3,conflict=true,denied=false;
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.headers().authorization,'Bearer synthetic-admin');
   if(req.method()==='GET'&&url.pathname==='/api/cases/case')return route.fulfill({json:{id:'case',case_no:'SYN-LIFECYCLE',status,annotation_version:version,source:'synthetic',system_code:'resp',confirm_method:'临床综合诊断',clinical_text:'仅用于合成测试。',age_band:null,sex:null,teaching_fields:null,attachments:[]}});
   if(req.method()==='GET'&&url.pathname==='/api/cases/case/report')return route.fulfill({json:{masked_report:'合成安全报告。',sentences:[{idx:0,text:'合成安全报告。'}]}});
   if(req.method()==='POST'&&['/api/cases/case/offline','/api/cases/case/reactivate'].includes(url.pathname)){
    const body=req.postDataJSON();posts.push({path:url.pathname,body});assert.deepEqual(body,{expected_version:version});
    if(denied)return route.fulfill({status:403,json:{message:'管理员账号或会话已失效'}});
    if(url.pathname.endsWith('/reactivate')&&conflict){conflict=false;return route.fulfill({status:409,json:{message:'原任务不可用，请由管理员处理后重试'}});}
    status=url.pathname.endsWith('/offline')?'已下线':'待分配';if(status==='待分配')version++;
    return route.fulfill({status:201,json:{case_id:'case',status,version}});
   }
   throw new Error('Unexpected API: '+req.method()+' '+url.pathname);
  });
  await page.route('**/lifecycle-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
   import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
   createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/cases/case'],initialSession:{token:'synthetic-admin',role:'admin',quals:{}}}));
  </script></body></html>`}));
  const url=(process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5181')+'/lifecycle-smoke';
  await page.goto(url);await page.getByText('SYN-LIFECYCLE',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存临床信息',exact:true}).count(),0);
  await page.getByRole('button',{name:'下线病例',exact:true}).click();assert.equal(posts.length,0);await page.getByRole('dialog',{name:'确认下线病例',exact:true}).waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('[role=dialog]');return el&&getComputedStyle(el).opacity==='1'&&el.getBoundingClientRect().width>500;});
  await page.screenshot({path:path.join(output,'offline-confirmation.png'),fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'确认下线',exact:true}).click();await page.getByText('病例已下线，旧金标准和历史保留',{exact:true}).waitFor();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(posts.length,1);assert.equal(await page.getByRole('button',{name:'下线病例',exact:true}).count(),0);
  await page.getByRole('button',{name:'重新启用病例',exact:true}).click();await page.getByRole('button',{name:'确认重新启用',exact:true}).click();await page.getByText('原任务不可用，请由管理员处理后重试',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'重新启用病例',exact:true}).isDisabled());
  await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'重新读取病例',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重新启用病例'&&!b.disabled));
  await page.getByRole('button',{name:'重新启用病例',exact:true}).click();await page.getByRole('button',{name:'确认重新启用',exact:true}).click();await page.getByText('病例已重新启用，版本 4，等待原任务分派',{exact:true}).waitFor();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(posts.length,3);assert.equal(await page.getByRole('button',{name:'重新启用病例',exact:true}).count(),0);await page.getByRole('button',{name:'保存临床信息',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'reactivated-pending.png'),fullPage:true});
  status='已发布';version=3;denied=true;await page.goto(url);await page.getByRole('button',{name:'下线病例',exact:true}).click();await page.getByRole('button',{name:'确认下线',exact:true}).click();await page.getByText('管理员账号或会话已失效',{exact:true}).waitFor();
  assert.equal(await page.getByText('合成安全报告。',{exact:true}).count(),0);assert.equal(await page.getByText('SYN-LIFECYCLE',{exact:true}).count(),0);assert.equal(await page.getByLabel('临床信息',{exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log('PASS Chrome: administrator confirmation, offline state, original-task conflict/reload, reactivation version/pending state, denial clears content; synthetic API mocks. Artifacts: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
