// Real local HTTPS deployment, actual student login and drawing. No mocked HTTP, HAR, traces or credential output.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),https=require('node:https');
const {createHash,X509Certificate}=require('node:crypto');
const {generate}=require('otplib');
const {chromium}=require(process.env.MIAP_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const instance=process.env.MIAP_EDUCATION_INSTANCE,credentialFile=process.env.MIAP_EDUCATION_CREDENTIALS;
 assert(instance&&credentialFile,'Explicit local instance and private demo credentials required');
 const env=require('dotenv').parse(await fs.readFile(path.join(instance,'.env'))),base=`https://localhost:${env.DEPLOY_HTTPS_PORT}`,ca=await fs.readFile(path.join(instance,'certs/fullchain.pem'));
 const accounts=JSON.parse(await fs.readFile(credentialFile)),admin=JSON.parse(await fs.readFile(path.join(instance,'acceptance-accounts.json'))).admin;
 const student=accounts.accounts.find(a=>a.username==='student_check');assert(student);
 const request=(route,token,body,method=body===undefined?'GET':'POST')=>new Promise((resolve,reject)=>{
  const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));const r=https.request(base+route,{method,ca,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const value=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode<200||res.statusCode>=300)return reject(Error(`Request failed: ${route} (${res.statusCode})`));resolve(value);});});r.on('error',reject);r.end(bytes);
 });
 const title='学生浏览器验证 '+Date.now();
 const spki=createHash('sha256').update(new X509Certificate(ca).publicKey.export({type:'spki',format:'der'})).digest('base64');
 const browser=await chromium.launch({headless:true,executablePath:process.env.MIAP_CHROME_EXECUTABLE,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
 const artifacts=process.env.MIAP_EDUCATION_ARTIFACTS||path.resolve(__dirname,'../../reports/student-education/browser');await fs.mkdir(artifacts,{recursive:true});
 try{
  const organizer=await browser.newPage({viewport:{width:1500,height:1000}});
  await organizer.goto(base+'/login');
  await organizer.getByLabel('用户名',{exact:true}).fill(admin.username);await organizer.getByLabel('密码',{exact:true}).fill(admin.password);
  await organizer.getByRole('button',{name:/^登\s*录$/}).click();
  await organizer.getByLabel('动态验证码').fill(await generate({secret:admin.secret}));
  const verified=organizer.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/2fa/verify');
  await organizer.getByRole('button',{name:'验证并登录'}).click();
  const adminToken=(await (await verified).json()).token;
  await organizer.getByRole('menuitem',{name:'学生与考核',exact:true}).click();
  await organizer.getByRole('tab',{name:'安排考核'}).click();
  await organizer.getByLabel('考核名称').fill(title);await organizer.getByLabel('作答说明').fill('独立阅片，逐个标注病灶并完成报告。');
  for(const modality of ['DX','CT'])await organizer.getByRole('checkbox',{name:new RegExp('SYN-EDU-MULTI-V2-'+modality)}).check();
  await organizer.locator('.education-reference-editor').nth(1).waitFor();
  const reference_sections=[];
  for(const group of await organizer.locator('.education-reference-editor').all()){
   const findings=await group.getByLabel('医生影像所见').inputValue(),impression=await group.getByLabel('医生诊断意见').inputValue();
   assert(findings&&impression,'Doctor sections must be prefilled from the synthetic reports');reference_sections.push({findings,impression});
  }
  assert.equal(reference_sections.length,2);
  await organizer.getByRole('checkbox',{name:/student_check/}).check();
  await organizer.getByRole('button',{name:'发布考核',exact:true}).click();
  const published=organizer.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/education/tasks');
  await organizer.locator('.ant-popconfirm-buttons button.ant-btn-primary').click();
  const response=await published;assert.equal(response.status(),201);const created=await response.json();
  await organizer.close();
  const page=await browser.newPage({viewport:{width:1800,height:1150}});const errors=[];let workbench,feedback;
  page.on('pageerror',()=>errors.push('Browser runtime error'));
  page.on('response',async r=>{try{if(r.status()===200&&/\/education\/attempts\/[^/]+\/workbench$/.test(new URL(r.url()).pathname))workbench=await r.json();if(r.status()===200&&/\/education\/attempts\/[^/]+\/feedback$/.test(new URL(r.url()).pathname))feedback=await r.json();}catch{/* Aborted navigation response. */}});
  await page.goto(base+'/login');await page.getByLabel('用户名',{exact:true}).fill(student.username);await page.getByLabel('密码',{exact:true}).fill(student.password);await page.getByRole('button',{name:/^登\s*录$/}).click();await page.waitForURL('**/student');
  assert.equal(await page.getByRole('menuitem',{name:'病例库',exact:true}).count(),0);
  const card=page.locator('.ant-card').filter({hasText:title});
  for(let question=0;question<2;question++){
  await card.getByRole('button',{name:/开始作答/}).first().click();await page.getByLabel('标注绘图层').waitFor();
  assert(workbench);assert(!('reference'in workbench));assert(!JSON.stringify(workbench).includes('合成教学参考'));assert.equal(await page.getByText('医生影像所见',{exact:true}).count(),0);
  assert(!JSON.stringify(workbench).includes(reference_sections[0].impression));
  assert.equal(await page.getByRole('switch',{name:'未见异常'}).count(),0);
  if(workbench.series[0].frame_count>1){await page.getByRole('button',{name:'下一帧',exact:true}).click();await page.locator('[data-frame-ready="1"]').waitFor();}
  await page.getByRole('combobox',{name:'身体部位',exact:true}).fill('合成示例部位-resp');await page.getByText('呼吸 / 合成示例部位-resp',{exact:true}).click();
  await page.getByLabel('影像所见',{exact:true}).fill('上肺区见圆形亮影，对侧下肺区见片状影。');await page.getByLabel('诊断意见',{exact:true}).fill('考虑模拟结节及局部实变。');
  await page.getByRole('button',{name:'新增病灶',exact:true}).click();
  await page.getByRole('button',{name:'画笔',exact:true}).click();
  const canvas=page.getByLabel('标注绘图层'),box=await canvas.boundingBox();assert(box);
  // The demo images are square; the viewport fits them without stretching.
  const side=Math.min(box.width,box.height);
  const at=(x,y)=>[box.x+(box.width-side)/2+side*x/512,box.y+(box.height-side)/2+side*y/512];
  const stroke=async(x,y,x2,y2)=>{await page.mouse.move(...at(x,y));await page.mouse.down();await page.mouse.move(...at(x2,y2),{steps:8});await page.mouse.up();};
  await stroke(156,175,192,175);
  await page.getByLabel('器官 / 位置',{exact:true}).fill('上肺区');await page.getByLabel('病变描述',{exact:true}).fill('圆形结节样影');
  await stroke(173,163,173,184);
  assert.equal(await page.locator('.education-object').count(),1);
  await page.getByRole('button',{name:'新增病灶',exact:true}).click();await stroke(328,293,371,293);
  await page.getByLabel('器官 / 位置',{exact:true}).fill('对侧下肺区');await page.getByLabel('病变描述',{exact:true}).fill('楔形片状影');
  await page.getByRole('button',{name:'病灶 1 · 上肺区',exact:true}).click();
  assert.equal(await page.getByLabel('病变描述',{exact:true}).inputValue(),'圆形结节样影');
  await page.getByRole('button',{name:/^保\s*存$/}).click();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  await page.screenshot({path:path.join(artifacts,`student-workbench-${workbench.series[0].modality}.png`)});
  const firstAttempt=workbench.attempt.id;
  await page.getByRole('link',{name:'我的考核',exact:true}).click();await page.waitForURL('**/student');await card.getByRole('button',{name:/继续作答/}).first().click();await page.getByLabel('标注绘图层').waitFor();
  assert.equal(await page.getByLabel('影像所见',{exact:true}).inputValue(),'上肺区见圆形亮影，对侧下肺区见片状影。');
  await page.getByRole('button',{name:'病灶 2 · 对侧下肺区',exact:true}).click();
  assert.equal(await page.getByLabel('病变描述',{exact:true}).inputValue(),'楔形片状影');
  await page.getByRole('button',{name:'提交作答',exact:true}).click();await page.locator('.ant-popconfirm-buttons button.ant-btn-primary').click();await page.waitForURL('**/feedback');await page.getByRole('heading',{name:'医生诊断意见',exact:true}).waitFor();
  assert(feedback);assert.equal(feedback.attempt.id,firstAttempt);assert(feedback.reference.report.includes('合成教学参考'));assert.equal(feedback.reference.annotations.length,2);assert.equal(feedback.attempt.answer.objects.length,2);assert.equal(feedback.reference.findings,reference_sections[0].findings);assert.equal(feedback.reference.impression,reference_sections[0].impression);assert.equal(await page.getByLabel('影像所见',{exact:true}).isDisabled(),true);
  await page.getByLabel('标注绘图层').waitFor();await page.screenshot({path:path.join(artifacts,`student-feedback-${workbench.series[0].modality}.png`)});
  await page.getByRole('link',{name:'我的考核',exact:true}).click();await page.waitForURL('**/student');
  }
  const submissions=await request(`/api/education/tasks/${created.id}/submissions?page=1`,adminToken);assert.equal(submissions.length,2);assert(submissions.every(s=>s.answer.objects.length===2&&new Set(s.answer.objects.map(o=>o.id)).size===2));
  assert.deepEqual(errors,[]);
  console.log('PASS real browser: admin case review/publication, student login, hidden reference, watermarked frame, drawing, object report, save/reopen, immutable submission and gold/reference comparison. student_demo was not used.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
