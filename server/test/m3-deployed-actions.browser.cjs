'use strict';
// Real built pages and authenticated HTTPS only; no API routing or fixture JWTs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, X509Certificate } = require('node:crypto');
const { generate } = require('otplib');

module.exports = async ({ base, ca, accounts, artifacts, get, annotator }) => {
  const { chromium } = require(process.env.MIAP_PLAYWRIGHT_MODULE);
  const spki = createHash('sha256').update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const sessions = new Map(), errors = [];
  await fs.mkdir(artifacts, { recursive: true });
  const signIn = async (page, role) => {
    await page.goto(base + '/login');
    await page.getByLabel('用户名', { exact: true }).fill(accounts[role].username);
    await page.getByLabel('密码', { exact: true }).fill(accounts[role].password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    if (accounts[role].secret) {
      await page.getByLabel('动态验证码', { exact: true }).waitFor();
      if (accounts[role].lastStep === Math.floor(Date.now() / 30000)) await page.waitForTimeout(30100 - Date.now() % 30000);
      await page.getByLabel('动态验证码', { exact: true }).fill(await generate({ secret: accounts[role].secret }));
      await page.getByRole('button', { name: '验证并登录', exact: true }).click();
      accounts[role].lastStep = Math.floor(Date.now() / 30000);
    }
    await page.waitForURL('**/tasks');
  };
  const openWorkbench = async (page, item) => {
    await page.getByRole('menuitem', { name: '任务列表', exact: true }).click();
    await page.getByRole('button', { name: '刷新任务', exact: true }).click();
    await page.locator(`a[href="/workbench/${item.id}"]`).click();
  };
  const pageFor = async role => {
    if (sessions.has(role)) return sessions.get(role).page;
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'miap-m3-ui-'));
    const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.MIAP_CHROME_EXECUTABLE,
      headless: true, viewport: { width: 1700, height: 1100 }, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    const page = await context.newPage();
    sessions.set(role, { context, profile, page });
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => errors.push('page runtime error'));
    if (role === 'annotator' || role === 'reviewer') page.on('download', () => errors.push('unexpected member download'));
    await signIn(page, role);
    return page;
  };
  const noDownload = async page => assert.equal(await page.getByRole('button', { name: /下载|导出|打印/ }).count(), 0);
  return {
    async edit(item) {
      const page = await pageFor('annotator');
      await openWorkbench(page, item);
      await page.locator('[data-frame-ready="0"]').waitFor();
      await page.locator('[data-save-state="saved"]').waitFor();
      const layer = page.getByLabel('标注绘图层'), box = await layer.boundingBox();
      assert(box && box.width > 100 && box.height > 100);
      // Keep gestures clear of the seeded point/contours: hitting a contour
      // intentionally selects it in the current workbench instead of drawing.
      const center = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.4 };
      const count = () => page.locator('.annotation-object-list > li').count();
      assert.equal(await count(), 4);
      for (const tool of ['矩形', '画笔', '多边形', '点']) {
        console.log('PROGRESS UI ' + item.modality + ' draw/undo ' + tool);
        await page.getByRole('button', { name: tool, exact: true }).click();
        if (tool === '多边形') {
          for (const [dx, dy] of [[-40, -40], [50, -40], [10, 50]]) await page.mouse.click(center.x + dx, center.y + dy);
          await page.keyboard.press('Enter');
        } else {
          await page.mouse.move(center.x - 25, center.y - 25);
          await page.mouse.down();
          if (tool !== '点') await page.mouse.move(center.x + 35, center.y + 30, { steps: 5 });
          await page.mouse.up();
        }
        await page.waitForFunction(() => document.querySelectorAll('.annotation-object-list > li').length === 5);
        assert((await page.locator('.annotation-object-list > li').last().innerText()).includes('· ' + tool));
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.annotation-object-list > li').length === 4);
      }
      await page.locator('.object-select').filter({ hasText: '矩形' }).click();
      console.log('PROGRESS UI ' + item.modality + ' properties and report association');
      await page.getByRole('combobox', { name: '标注置信度', exact: true }).press('ArrowDown');
      await page.getByTitle('不典型', { exact: true }).click();
      const report = page.getByRole('button', { name: /\[1\].*肺内结节/ });
      await report.click();
      await page.locator('#report-sentence-1[data-linked="false"]').waitFor();
      await report.click();
      await page.locator('#report-sentence-1[data-linked="true"]').waitFor();
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/cases/${item.id}/annotations` && r.request().method() === 'PUT');
      await page.getByRole('button', { name: '保存标注', exact: true }).click();
      assert.equal((await saved).status(), 200);
      await page.locator('[data-save-state="saved"]').waitFor();
      const data = await get(`/api/cases/${item.id}/annotations`, annotator);
      assert.equal(data.annotations.length, 4);
      assert.equal(data.annotations.find(a => a.tool === 'box').confidence, 'atypical');
      assert(data.annotations.find(a => a.tool === 'box').report_sent_ids.includes(1));
      item.version = data.current_version;
      await page.reload();
      await page.waitForURL('**/login');
      await signIn(page, 'annotator');
      await openWorkbench(page, item);
      await page.locator('[data-frame-ready="0"]').waitFor();
      assert.equal(await count(), 4);
      await page.locator('.object-select').filter({ hasText: '矩形' }).click();
      await page.getByTitle('不典型', { exact: true }).waitFor();
      await page.locator('#report-sentence-1[data-linked="true"]').waitFor();
      await noDownload(page);
      await page.screenshot({ path: path.join(artifacts, `editable-${item.modality}.png`) });
      console.log('PASS ' + item.modality + ' real four-tool drawing/undo, report association, save and reload');
    },
    async submit(item) {
      const page = await pageFor('annotator');
      await openWorkbench(page, item);
      await page.locator('[data-save-state="saved"]').waitFor();
      const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/cases/${item.id}/submit`);
      await page.getByRole('button', { name: '提交审核', exact: true }).click();
      assert.equal((await response).status(), 201);
      await page.waitForURL('**/tasks');
    },
    async review(item, result, kind = 'normal') {
      const page = await pageFor('reviewer');
      await page.getByRole('menuitem', { name: '任务列表', exact: true }).click();
      await page.getByRole('combobox', { name: '任务角色', exact: true }).press('ArrowDown');
      await page.locator('.ant-select-dropdown:visible').getByTitle('审核', { exact: true }).click();
      await page.getByRole('button', { name: '刷新任务', exact: true }).click();
      await page.locator(`a[href="/review/${item.id}"]`).click();
      await page.getByLabel('只读审核台', { exact: true }).waitFor();
      await page.locator('[data-frame-ready]').waitFor();
      await noDownload(page);
      assert.equal(await page.getByRole('button', { name: '矩形', exact: true }).count(), 0);
      for (const name of ['脱敏是否合格', '确诊依据是否完整', '疾病标签是否正确']) {
        const choice = page.getByRole('combobox', { name, exact: true });
        await choice.press('ArrowDown');
        await choice.press('Enter');
        await choice.locator('..').locator('..').getByTitle('合格 / 完整 / 正确', { exact: true }).waitFor();
      }
      if (result === '打回') await page.getByLabel('总体审核意见', { exact: true }).fill('合成复验：请调整矩形边界并重新核对报告关联。');
      const button = result === '通过' ? '审核通过' : (kind === 'normal' ? '打回重标' : '打回并下线');
      await page.getByRole('button', { name: button, exact: true }).click();
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reviews/' + item.id && r.request().method() === 'POST');
      await page.getByRole('button', { name: result === '通过' ? '确认发布' : '确认打回', exact: true }).click();
      const reply = await response;
      assert.equal(reply.status(), 201);
      const data = await reply.json();
      await page.getByRole('alert').filter({ hasText: result === '通过' ? /通过/ : /打回|下线/ }).first().waitFor();
      await page.screenshot({ path: path.join(artifacts, `review-${kind}-${result === '通过' ? 'pass' : 'return'}.png`) });
      return data;
    },
    async published(cases) {
      for (const role of ['annotator', 'reviewer']) {
        const page = await pageFor(role);
        for (const route of ['/tasks', '/library', ...cases.map(c => '/library/' + c.id)]) {
          await page.getByRole('menuitem', { name: route === '/tasks' ? '任务列表' : '病例库', exact: true }).click();
          if (route.startsWith('/library/')) await page.locator(`a[href="${route}"]`).click();
          await page.waitForLoadState('networkidle');
          await noDownload(page);
          if (route.startsWith('/library/')) await page.getByLabel('病例库只读详情').waitFor();
        }
        await page.screenshot({ path: path.join(artifacts, `published-${role}.png`) });
      }
      console.log('PASS reviewer decisions and both member roles published pages without download controls');
    },
    pageFor,
    async close() {
      for (const [role, { context, profile, page }] of sessions) {
        if (/^\/(workbench|review)\//.test(new URL(page.url()).pathname)) {
          await page.screenshot({ path: path.join(artifacts, `last-workbench-${role}.png`) }).catch(() => {});
        }
        await context.close();
        await fs.rm(profile, { recursive: true, force: true });
      }
      assert.deepEqual(errors, []);
    },
  };
};
