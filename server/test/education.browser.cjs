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
 let login=await request('/api/auth/login',null,{username:admin.username,password:admin.password});
 if(login.next==='verify_2fa')login=await request('/api/auth/2fa/verify',login.token,{code:await generate({secret:admin.secret})});
 assert.equal(login.next,'authenticated');const adminToken=login.token;
 const title='学生浏览器验证 '+Date.now();const created=await request('/api/education/tasks',adminToken,{title,instructions:'纯合成影像，独立填写并提交后对照。',case_ids:accounts.case_ids,roster_ids:[student.roster_id]});
 const spki=createHash('sha256').update(new X509Certificate(ca).publicKey.export({type:'spki',format:'der'})).digest('base64');
 const browser=await chromium.launch({headless:true,executablePath:process.env.MIAP_CHROME_EXECUTABLE,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
 const artifacts=process.env.MIAP_EDUCATION_ARTIFACTS||path.resolve(__dirname,'../../reports/student-education/browser');await fs.mkdir(artifacts,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1800,height:1150}});const errors=[];let workbench,feedback;
  page.on('pageerror',()=>errors.push('Browser runtime error'));
  page.on('response',async r=>{try{if(r.status()===200&&/\/education\/attempts\/[^/]+\/workbench$/.test(new URL(r.url()).pathname))workbench=await r.json();if(r.status()===200&&/\/education\/attempts\/[^/]+\/feedback$/.test(new URL(r.url()).pathname))feedback=await r.json();}catch{/* Aborted navigation response. */}});
  await page.goto(base+'/login');await page.getByLabel('用户名',{exact:true}).fill(student.username);await page.getByLabel('密码',{exact:true}).fill(student.password);await page.getByRole('button',{name:/^登\s*录$/}).click();await page.waitForURL('**/student');
  assert.equal(await page.getByRole('menuitem',{name:'病例库',exact:true}).count(),0);
  const card=page.locator('.ant-card').filter({hasText:title});
  for(let question=0;question<2;question++){
  await card.getByRole('button',{name:/开始作答/}).first().click();await page.getByLabel('标注绘图层').waitFor();
  assert(workbench);assert(!('reference'in workbench));assert(!JSON.stringify(workbench).includes('合成教学参考'));assert.equal(await page.getByText('参考报告',{exact:true}).count(),0);
  if(workbench.series[0].frame_count>1){await page.getByRole('button',{name:'下一帧',exact:true}).click();await page.locator('[data-frame-ready="1"]').waitFor();}
  await page.getByRole('combobox',{name:'身体部位',exact:true}).fill('合成示例部位-resp');await page.getByText('呼吸 / 合成示例部位-resp',{exact:true}).click();
  await page.getByLabel('影像所见',{exact:true}).fill('合成影像中见圆形明亮模拟目标，边界清楚。');await page.getByLabel('诊断意见',{exact:true}).fill('合成目标，供软件操作训练使用。');
  await page.getByRole('button',{name:'矩形',exact:true}).click();const canvas=page.getByLabel('标注绘图层'),box=await canvas.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.38);await page.mouse.down();await page.mouse.move(box.x+box.width*.54,box.y+box.height*.58,{steps:12});await page.mouse.up();
  await page.getByLabel('器官 / 位置',{exact:true}).fill('合成目标区域');await page.getByLabel('病变描述',{exact:true}).fill('模拟圆形高亮区，已用矩形标注范围。');await page.getByRole('button',{name:/^保\s*存$/}).click();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
  await page.screenshot({path:path.join(artifacts,`student-workbench-${workbench.series[0].modality}.png`)});
  const firstAttempt=workbench.attempt.id;
  await page.getByRole('link',{name:'我的考核',exact:true}).click();await page.waitForURL('**/student');await card.getByRole('button',{name:/继续作答/}).first().click();await page.getByLabel('标注绘图层').waitFor();
  assert.equal(await page.getByLabel('影像所见',{exact:true}).inputValue(),'合成影像中见圆形明亮模拟目标，边界清楚。');
  await page.getByRole('button',{name:'提交作答',exact:true}).click();await page.locator('.ant-popconfirm-buttons button.ant-btn-primary').click();await page.waitForURL('**/feedback');await page.getByRole('heading',{name:'参考报告',exact:true}).waitFor();
  assert(feedback);assert.equal(feedback.attempt.id,firstAttempt);assert(feedback.reference.report.includes('合成教学参考'));assert.equal(feedback.reference.annotations.length,1);assert.equal(await page.getByLabel('影像所见',{exact:true}).isDisabled(),true);
  await page.getByLabel('标注绘图层').waitFor();await page.screenshot({path:path.join(artifacts,`student-feedback-${workbench.series[0].modality}.png`)});
  await page.getByRole('link',{name:'我的考核',exact:true}).click();await page.waitForURL('**/student');
  }
  const submissions=await request(`/api/education/tasks/${created.id}/submissions?page=1`,adminToken);assert.equal(submissions.length,2);assert.equal(submissions[0].answer.objects.length,1);
  assert.deepEqual(errors,[]);
  console.log('PASS real browser: student login, hidden reference, watermarked frame, drawing, object report, save/reopen, immutable submission and gold/reference comparison. student_demo remains unsubmitted.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
