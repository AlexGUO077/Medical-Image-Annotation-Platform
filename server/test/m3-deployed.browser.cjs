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
    const completeFrames = new Set();
    page.on('response', async response => {
      try {
        const pathname = new URL(response.url()).pathname;
        if (!pathname.startsWith('/api/frames/') || pathname === '/api/frames/ticket' || response.status() !== 200) return;
        const encoded = pathname.split('/').at(-1).split('.')[1];
        const target = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (await response.finished() === null) completeFrames.add(`${target.case_id}:${target.frame_index}`);
      } catch { /* Aborted viewer requests are not completed preloads. */ }
    });
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
      if (item.modality === 'CT' && item.frame_count === 300 && process.env.MIAP_M3_FUNCTIONAL_ONLY === '1') {
        console.log('SKIP CT performance in functional-only run; this run cannot satisfy the 200 ms acceptance gate');
      } else if (item.modality === 'CT' && item.frame_count === 300) {
        const timings = [];
        const diagnostics = process.env.MIAP_M3_DIAGNOSTICS === '1';
        if (diagnostics) await page.evaluate(() => {
          window.__miapPerformanceSamples = [];
          window.__miapLongTasks = [];
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) window.__miapLongTasks.push({ start_ms: entry.startTime, duration_ms: entry.duration });
          }).observe({ type: 'longtask', buffered: false });
        });
        for (let frame = 1; frame < 300; frame++) {
          const until = Date.now() + 30000;
          while (!completeFrames.has(`${item.id}:${frame}`) && Date.now() < until) await page.waitForTimeout(25);
          assert(completeFrames.has(`${item.id}:${frame}`), 'Adjacent frame preload must complete before timing');
          const duration = await page.evaluate(target => new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
              if (document.querySelector(`[data-frame-ready="${target}"]`)) {
                const end = performance.now();
                if (window.__miapPerformanceSamples) {
                  // Preserve only timing numbers, never ResourceTiming URLs or signed tickets.
                  const ticket = performance.getEntriesByType('resource').find(entry => entry.startTime >= start && new URL(entry.name).pathname === '/api/frames/ticket');
                  window.__miapPerformanceSamples.push({ frame: target, start_ms: start, ready_ms: end, ticket_ms: ticket?.duration ?? null });
                }
                clearTimeout(timer); observer.disconnect(); resolve(end - start);
              }
            });
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Frame readiness timeout')); }, 10000);
            observer.observe(document.body, { subtree: true, attributes: true, childList: true });
            if (window.__miapPerformanceSamples) performance.clearResourceTimings();
            const start = performance.now();
            document.querySelector('button[aria-label="下一帧"]').click();
          }), frame);
          timings.push(duration);
          if (frame % 50 === 0) console.log(`PROGRESS real CT sequential frame ${frame + 1}/300`);
        }
        const ordered = [...timings].sort((a, b) => a - b);
        const result = { frames: 300, samples: timings.length, max_ms: Math.max(...timings), p95_ms: ordered[Math.ceil(ordered.length * 0.95) - 1], within_200ms: timings.every(ms => ms <= 200), timings_ms: timings };
        await fs.writeFile(path.join(artifacts, 'ct-300-performance.json'), JSON.stringify(result, null, 2));
        if (diagnostics) await fs.writeFile(path.join(artifacts, 'ct-300-diagnostics.json'), JSON.stringify(await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          canvases: [...document.querySelectorAll('.workbench-viewport canvas')].map(canvas => ({ width: canvas.width, height: canvas.height, client_width: canvas.clientWidth, client_height: canvas.clientHeight })),
          samples: window.__miapPerformanceSamples, long_tasks: window.__miapLongTasks,
        })), null, 2));
        await page.screenshot({ path: path.join(artifacts, 'workbench-CT-300.png') });
        console.log(`CT performance: samples=${result.samples}, p95=${result.p95_ms.toFixed(1)}ms, max=${result.max_ms.toFixed(1)}ms`);
        assert(result.within_200ms, 'Every preloaded CT flip must be at most 200 ms');
      }
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
