'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, X509Certificate } = require('node:crypto');

module.exports = async ({ base, ca, account, cases, artifacts }) => {
  const { chromium } = require(process.env.MIAP_PLAYWRIGHT_MODULE || 'playwright');
  // Trust only this generated local certificate's public key, not arbitrary TLS errors.
  const spki = createHash('sha256').update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'miap-m3-browser-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: process.env.MIAP_CHROME_EXECUTABLE,
      headless: true, viewport: { width: 1700, height: 1100 }, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    const page = await context.newPage();
    const errors = [], downloads = [];
    page.on('pageerror', () => errors.push('browser runtime error'));
    page.on('download', () => downloads.push('unexpected download'));
    await page.goto(base + '/login');
    await page.getByLabel('用户名', { exact: true }).fill(account.username);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await page.waitForURL('**/tasks');
    await fs.mkdir(artifacts, { recursive: true });
    for (const item of cases) {
      await page.getByRole('menuitem', { name: '任务列表', exact: true }).click();
      await page.locator(`a[href="/workbench/${item.id}"]`).click();
      await page.getByLabel('标注绘图层').waitFor();
      await page.getByText(`已保存 · 版本 ${item.version}`, { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /下载|导出|打印/ }).count(), 0);
      await page.screenshot({ path: path.join(artifacts, `workbench-${item.modality}.png`) });
    }
    for (const label of ['任务列表', '病例库']) {
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByRole('button', { name: /下载|导出|打印/ }).count(), 0);
    }
    const storage = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      const drafts = [];
      for (const info of databases) {
        if (info.name !== 'miap-synthetic-annotation-drafts') continue;
        const rows = await new Promise((resolve, reject) => {
          const request = indexedDB.open(info.name);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('drafts', 'readonly');
            const read = tx.objectStore('drafts').getAll();
            tx.oncomplete = () => { db.close(); resolve(read.result); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
        });
        drafts.push(...rows);
      }
      return { cache: await caches.keys(), local: { ...localStorage }, session: { ...sessionStorage }, databases, drafts };
    });
    assert.deepEqual(storage.cache, []);
    assert.deepEqual(storage.session, {});
    for (const [key, value] of Object.entries(storage.local)) {
      if (key === 'loglevel') assert.match(value, /^(TRACE|DEBUG|INFO|WARN|ERROR|SILENT)$/);
      else {
        assert.equal(key, 'cornerstone3D.renderingCapabilities');
        const cap = JSON.parse(value);
        assert.deepEqual(Object.keys(cap).sort(), ['formats', 'probeVersion', 'renderer', 'webgl2']);
        assert.equal(cap.probeVersion, 1);
        assert.equal(typeof cap.webgl2, 'boolean');
        assert.equal(typeof cap.renderer, 'string');
        assert(cap.renderer.length < 512);
        assert.deepEqual(Object.keys(cap.formats).sort(), ['float', 'floatLinear', 'halfFloat', 'halfFloatLinear', 'norm16', 'norm16Linear']);
        assert(Object.values(cap.formats).every(v => typeof v === 'boolean'));
      }
    }
    assert(storage.databases.every(db => db.name === 'miap-synthetic-annotation-drafts'));
    assert.deepEqual(storage.drafts, [], 'Read-only visits must not persist image data or new drafts');
    assert.deepEqual(downloads, []);
    assert.deepEqual(errors, []);
    console.log('PASS built frontend real login, DX/CT canvas, member routes, no download and no Cache Storage/session data');
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
};
