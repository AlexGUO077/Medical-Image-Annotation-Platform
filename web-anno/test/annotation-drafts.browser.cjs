// Run against local Vite with external Playwright/Chrome; no installed browser or CI dependency added.
const { chromium } = require(process.env.MIAP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base=process.env.MIAP_BROWSER_BASE_URL||'http://127.0.0.1:5179';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try{
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
  const errors=[];for(const page of [a,b])page.on('pageerror',e=>errors.push(e.message));
  await Promise.all([a.goto(base),b.goto(base)]);
  for(const page of [a,b])await page.evaluate(async()=>{
   window.drafts=await import('/src/annotations/drafts.ts');
   window.item={id:'a',series_id:'s',tool:'point',geometry:{x:1,y:2,report_text:'excluded'},frame_start:0,frame_end:0,key_frame_index:0,window_preset:null,part_id:'p',sign_tag_ids:['s'],confidence:'typical',report_sent_ids:[-1],token:'excluded',report:'excluded'};
   window.make=(account='account-a',caseId='case')=>drafts.syntheticDraftStore(account,caseId,'synthetic');
  });
  await a.evaluate(async()=>{window.store=make();await store.read();await store.write({baseVersion:3,annotations:[item]});});
  const restored=await b.evaluate(async()=>{window.store=make();return store.read();});assert.equal(restored.baseVersion,3);assert(!JSON.stringify(restored).includes('excluded'));
  await a.reload();await a.evaluate(async()=>{window.drafts=await import('/src/annotations/drafts.ts');window.store=drafts.syntheticDraftStore('account-a','case','synthetic');});
  assert.equal((await a.evaluate(()=>store.read())).baseVersion,3,'survives actual reload');
  await b.evaluate(()=>store.write({baseVersion:3,annotations:[{...item,geometry:{x:9,y:2}}]}));
  assert.match(await a.evaluate(()=>store.remove().then(()=>'',e=>e.message)),/另一页面/,'old save ACK cannot delete a newer tab draft');
  assert.match(await a.evaluate(()=>store.write({baseVersion:4,annotations:[]}).then(()=>'',e=>e.message)),/另一页面/,'old writer cannot overwrite newer tab draft');
  await b.evaluate(async()=>{window.other=make('account-b');await other.read();await other.write({baseVersion:1,annotations:[]});});
  assert.equal((await b.evaluate(()=>other.read())).baseVersion,1);
  await a.evaluate(()=>drafts.clearAccountDrafts('account-a'));
  assert.match(await b.evaluate(()=>store.write({baseVersion:3,annotations:[]}).then(()=>'',e=>e.message)),/其他页面退出/,'logout revokes handles in another page');
  assert.equal((await b.evaluate(()=>other.read())).baseVersion,1,'logout only removes its own account');
  await a.evaluate(async()=>{drafts.allowAccountDrafts('account-a');window.fresh=drafts.syntheticDraftStore('account-a','case','synthetic');});
  assert.equal(await a.evaluate(()=>fresh.read()),undefined);
  assert.match(await a.evaluate(()=>store.write({baseVersion:1,annotations:[]}).then(()=>'',e=>e.message)),/账号草稿已关闭/,'old handle stays revoked after same-account login');
  await a.evaluate(()=>fresh.write({baseVersion:1,annotations:[]}));
  assert.deepEqual(await a.evaluate(()=>fresh.read()),{baseVersion:1,annotations:[]});await a.evaluate(()=>fresh.remove());assert.equal(await a.evaluate(()=>fresh.read()),undefined);
  assert.match(await b.evaluate(()=>{try{make('a','b');drafts.syntheticDraftStore('a','b','real');return '';}catch(e){return e.message;}}),/合成病例/);
  assert.deepEqual(errors,[]);console.log('PASS browser IndexedDB: reload, allowlisted payload, empty draft, account isolation, conditional write/delete, cross-tab logout epoch, stale-handle revocation and cleanup');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
