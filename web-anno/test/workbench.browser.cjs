// Optional local browser smoke: provide Playwright externally; no CI/browser download required.
const { chromium } = require(process.env.MIAP_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = path.resolve(__dirname, '../..');
const output = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'miap-workbench-browser-'));
const base = process.env.MIAP_BROWSER_BASE_URL || 'http://127.0.0.1:5179';
const sharp = require(repo+'/node_modules/sharp');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('pageerror:',e.message)});
 const png=await sharp({create:{width:640,height:480,channels:3,background:'#888888'}}).composite([{input:Buffer.from('<svg width="640" height="480"><rect x="170" y="80" width="300" height="280" fill="#dddddd"/><text x="20" y="460" fill="white" font-size="22">SYNTHETIC TEST ONLY</text></svg>')}]).png().toBuffer();
 let frames=0, denyReads=false;
 await page.route('**/api/**',async route=>{
 const req=route.request(), url=new URL(req.url());
 assert.equal(req.headers()['authorization'],'Bearer synthetic-test');
 if(url.pathname==='/api/taxonomy/tree')return route.fulfill({json:{tree:[],sign_tags:[]}});
 if(url.pathname==='/api/workbench/case') return route.fulfill({json:{case:{id:'case',case_no:'SYN-BROWSER',source:'synthetic',status:'标注中',system_code:'resp',confirm_method:'临床综合诊断'},series:[{id:'s',series_uid:'2.25.1',modality:'CT',frame_count:300,default_window:{center:40,width:400}}],sentences:[{idx:0,text:'合成报告：用于本地浏览器阅片验证。'}],attachments:[]}});
 if(url.pathname==='/api/frames/ticket')return denyReads?route.fulfill({status:429,json:{message:'合成账号已停用'}}):route.fulfill({json:{url:'/api/frames/a.b.c'}});
 if(url.pathname==='/api/frames/a.b.c'){if(denyReads)return route.fulfill({status:429,json:{message:'合成账号已停用'}});frames++;return route.fulfill({contentType:'image/png',headers:{'X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1})},body:png});}
 return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
 });
 await page.route('**/workbench-smoke', route => route.fulfill({contentType:'text/html', body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
 import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;
 const { default: React } = await import('/node_modules/.vite/deps/react.js');
 const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
 const { App } = await import('/src/app/App.tsx'); await import('/src/styles/global.css');
 createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/workbench/case'],initialSession:{token:'synthetic-test',role:'member',quals:{resp:['annotate']}}}));
 </script></body></html>`}));
 await page.goto(base+'/workbench-smoke');
 console.log('initial browser errors',errors); await page.getByRole('button',{name:/放\s*大/}).waitFor({timeout:30000});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.replace(/\s/g,'')==='放大'&&!b.disabled));
 await page.waitForFunction(()=>document.querySelector('.workbench-viewport canvas')?.width>0,{timeout:30000});
 await page.waitForTimeout(1500);
 console.log('browser errors',errors);
 assert.deepEqual(errors,[]);
 const viewport=page.getByLabel('影像视口');
 await viewport.screenshot({path:path.join(output,'viewer.png')});
 const image=await sharp(path.join(output,'viewer.png')).stats();assert(image.channels[0].stdev>10,'rendered frame must have visible pixel variation');
 // A solid rectangle must not turn into repeated RGBA/RGB row-stride stripes.
 const {data: pixels, info} = await sharp(path.join(output,'viewer.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const column=Math.floor(info.width/2);let transitions=0, lastEdge=-10;
 for(let y=Math.floor(info.height*.2)+1;y<info.height*.75;y++) if(Math.abs(pixels[(y*info.width+column)*3]-pixels[((y-1)*info.width+column)*3])>20){if(y-lastEdge>2)transitions++;lastEdge=y;}
 assert(transitions<=2, 'unexpected stripes in packed RGB frame');
 await page.screenshot({path:path.join(output,'three-panels.png')});
 await page.getByRole('button',{name:'下一帧'}).click();await page.getByText('第 2 / 300 帧').waitFor();
 await page.getByRole('button',{name:/放\s*大/}).click();
 await page.waitForTimeout(200);const beforeFocus=frames;await page.getByRole('button',{name:'影像专注模式'}).click();
 assert.equal(await page.getByText('标注对象').count(),0);
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.replace(/\s/g,'')==='放大'&&!b.disabled));
 await page.waitForTimeout(500); await page.screenshot({path:path.join(output,'focus.png')});
 assert(frames>=2);assert.equal(frames,beforeFocus,'focus mode must not request the frame again');assert.deepEqual(errors,[]);
 denyReads=true;await page.getByRole('button',{name:'下一帧'}).click();await page.getByText('合成账号已停用').waitFor();
 assert.equal(await viewport.locator('canvas').count(),0,'failed frame must clear the old canvas');
 assert.equal(await page.evaluate(async()=>{const {cache}=await import('/node_modules/.vite/deps/@cornerstonejs_core.js');return cache.getCacheSize();}),0,'failed frame must leave no cached pixels');
 await page.getByRole('button',{name:'退出登录'}).click();await page.getByLabel('用户名',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('影像视口').count(),0);assert.deepEqual(errors,[]);
 console.log('Screenshots: '+output);
 console.log('PASS browser: Cornerstone actual canvas pixels, bearer-only frame requests, frame navigation, zoom/focus, failed-read cleanup and logout; frames='+frames);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
