// Optional native-browser extension of the existing real PG/Nest HTTP suite.
// Only session bootstrap is supplied by the fixture; every API request goes to Nest.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async({base,adminToken,memberToken,task,db,fixtureUser})=>{
 const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
 const browser=await chromium.launch({executablePath:process.env.MIAP_CHROME_EXECUTABLE,headless:true});
 const resetCss=await fs.readFile(require.resolve('antd/dist/reset.css'),'utf8');
 const directory=path.resolve(process.env.MIAP_STATS_BROWSER_OUTPUT||'reports/wp13-stats-browser');await fs.mkdir(directory,{recursive:true});
 let page;const errors=[],requests=[];
 try{
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const incoming=route.request(),url=new URL(incoming.url());if(url.pathname==='/api/stats')requests.push(url.search);
   const response=await fetch(base+url.pathname+url.search,{method:incoming.method(),headers:{Authorization:incoming.headers().authorization??''}});
   await route.fulfill({status:response.status,contentType:response.headers.get('content-type')??'application/json',headers:{'Cache-Control':'no-store, private'},body:Buffer.from(await response.arrayBuffer())});
  });
  const open=async(session)=>{
   await page.route('**/stats-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"><style>${resetCss}</style></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;
    const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {App}=await import('/src/app/App.tsx');await import('/src/styles/global.css');
    createRoot(document.getElementById('root')).render(React.createElement(App,{initialEntries:['/dashboard'],initialSession:${JSON.stringify(session)}}));</script></body></html>`}));
   await page.goto(process.env.MIAP_STATS_BROWSER_URL+'/stats-smoke');
  };
  await db.query("UPDATE tasks SET name='合成 CT 打回统计任务' WHERE id=$1",[task]);
  await open({token:adminToken,role:'admin',quals:{}});
  await page.getByRole('img',{name:'北京时间每日完成量趋势'}).waitFor();
  for(let i=0;i<10&&await page.getByRole('button',{name:'加载更多任务',exact:true}).count();i++){
   await page.getByRole('button',{name:'加载更多任务',exact:true}).click();
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='加载更多任务'&&button.disabled));
  }
  await page.getByRole('combobox',{name:'筛选任务',exact:true}).fill('合成 CT 打回统计任务');await page.locator('.ant-select-dropdown:visible').getByText('合成 CT 打回统计任务',{exact:true}).click();
  await page.getByRole('button',{name:'查询统计'}).click();await page.getByText('1 / 2 次普通审核',{exact:true}).waitFor();await page.getByText('0 / 0 次已完成抽检',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'统计分组',exact:true}).press('ArrowDown');await page.locator('.ant-select-dropdown:visible').getByText('系统',{exact:true}).click();await page.getByRole('button',{name:'查询统计'}).click();
  await page.getByText('按系统汇总',{exact:true}).waitFor();await page.getByRole('cell',{name:'呼吸',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/导出|下载|打印/}).count(),0);
  await page.screenshot({path:path.join(directory,'dashboard.png'),fullPage:true});
  await db.query("UPDATE users SET status='disabled' WHERE id=$1",[fixtureUser.id]);
  await page.getByRole('button',{name:'刷新统计'}).click();await page.getByRole('heading',{name:'医学影像标注平台',exact:true}).waitFor();await page.locator('input[autocomplete="username"]').waitFor();assert.equal(await page.getByText('1 / 2 次普通审核',{exact:true}).count(),0);
  await db.query('UPDATE users SET status=$2 WHERE id=$1',[fixtureUser.id,fixtureUser.status]);
  const before=requests.length;await page.unroute('**/stats-smoke');
  await open({token:memberToken,role:'member',quals:{resp:['annotate','review']}});
  await page.getByRole('heading',{name:'个人任务与标注领取池'}).waitFor();assert.equal(requests.length,before,'member direct route must not request stats');
  assert.equal(await page.getByRole('heading',{name:'统计看板'}).count(),0);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({synthetic:true,api:'real Nest HTTP / isolated PostgreSQL schema',checks:['task selection including later pages','system grouping','normal 1/2 and null spotcheck','read-only UI','disabled admin clears and exits','member direct route no stats request'],requests:requests.length,pageErrors:errors},null,2));
  console.log('PASS: native Chrome real statistics HTTP task picker/grouping/counts/null rate, readonly display, revoked admin logout and member direct-route guard');
 }catch(error){
  if(page){await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({pageErrors:errors,body:await page.locator('body').innerText(),requestCount:requests.length},null,2));await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true});}
  throw error;
 }finally{await db.query('UPDATE users SET status=$2 WHERE id=$1',[fixtureUser.id,fixtureUser.status]);await browser.close();}
};
