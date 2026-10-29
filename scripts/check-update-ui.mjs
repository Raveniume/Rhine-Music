import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ logLevel: 'error', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/src-tauri/**','**/artifacts/**','**/release/**','**/desktop-runtime/**'] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.RHINE_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), headless: true, args: ['--mute-audio'] });
try {
  for (const platform of ['Windows NT 10.0', 'Macintosh; Intel Mac OS X 14_0']) {
    const page = await browser.newPage({ userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 Chrome/130 Safari/537.36` });
    let release = { tag_name: 'v0.4.14', assets: [{ name: 'Rhine-Music-Windows-0.4.14-x64-Setup.exe', browser_download_url: 'https://github.com/Raveniume/Rhine-Music/releases/download/v0.4.14/Rhine-Music-Windows-0.4.14-x64-Setup.exe' }] };
    await page.route('https://api.github.com/**', route => route.fulfill({ json: release }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.evaluate(async () => {
      const module = await import('/src/music-about.ts');
      document.body.innerHTML = module.aboutMarkup('0.4.13');
      window.testUpdate = () => module.checkForUpdates('0.4.13');
    });
    await page.evaluate(() => { void window.testUpdate(); });
    if (platform.startsWith('Windows')) {
      await page.locator('[data-update-choice="cancel"]').click();
      assert.equal(await page.locator('.update-confirm-scrim').count(), 0);
      await page.evaluate(() => { void window.testUpdate(); void window.testUpdate(); });
      await page.locator('.update-confirm-scrim').waitFor();
      assert.equal(await page.locator('.update-confirm-scrim').count(), 1);
      await page.keyboard.press('Escape');
    } else {
      await page.locator('#update-status a').waitFor();
      assert.equal(await page.locator('.update-confirm-scrim').count(), 0);
      assert.match(await page.locator('#update-status a').getAttribute('href'), /releases\/tag\/v0.4.14$/);
    }
    release = { tag_name: 'invalid', assets: [] };
    await page.evaluate(() => window.testUpdate());
    assert.match(await page.locator('#update-status').innerText(), /失败/);
    await page.close();
  }
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36' });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.evaluate(async () => {
    const module = await import('/src/music-about.ts');
    window.updateCalls = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { window.updateProgress = callback; return 1; },
      invoke(command) {
        if (command === 'desktop_check_update') return new Promise(resolve => { window.finishCheck = () => resolve({ tag_name: 'v0.4.14', assets: [{ name: 'Rhine-Music-Windows-0.4.14-x64-Setup.exe', browser_download_url: 'https://github.com/Raveniume/Rhine-Music/releases/download/v0.4.14/Rhine-Music-Windows-0.4.14-x64-Setup.exe', digest: `sha256:${'a'.repeat(64)}` }] }); });
        if (command === 'desktop_install_update') { window.updateCalls++; return new Promise((_, reject) => { window.failDownload = () => reject('下载连接中断'); }); }
        return Promise.resolve(1);
      },
    };
    window.reopenAbout = () => { document.body.innerHTML = module.aboutMarkup('0.4.13'); };
    window.testUpdate = interactive => module.checkForUpdates('0.4.13', interactive);
    window.reopenAbout();
    void window.testUpdate(false);
  });
  // Clicking while automatic checking is pending must still request a dialog.
  await page.evaluate(() => { void window.testUpdate(true); window.finishCheck(); });
  await page.locator('[data-update-choice="confirm"]').click();
  await page.waitForFunction(() => window.updateCalls === 1);
  await page.evaluate(() => window.updateProgress({ payload: { message: '正在下载：64% · 88.0 / 136.6 MiB' } }));
  await page.evaluate(() => { window.reopenAbout(); void window.testUpdate(); });
  assert.match(await page.locator('#update-status').innerText(), /64%/);
  assert.equal(await page.evaluate(() => window.updateCalls), 1);
  assert.equal(await page.locator('[data-action="check-update"]').innerText(), '正在更新…');
  await page.evaluate(() => { document.body.innerHTML = '<p>其他设置页面</p>'; window.failDownload(); });
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.reopenAbout(); void window.testUpdate(false); });
  assert.match(await page.locator('#update-status').innerText(), /下载更新失败.*重试/);
  assert.equal(await page.locator('[data-action="check-update"]').getAttribute('aria-busy'), 'false');
  await page.evaluate(() => { void window.testUpdate(); window.finishCheck(); });
  await page.locator('[data-update-choice="confirm"]').click();
  await page.waitForFunction(() => window.updateCalls === 2);
  await page.evaluate(() => window.failDownload());
  await page.close();
  console.log('Update UI passed: dialog, platform handling, automatic/manual check race, progress across rerenders, duplicate guard, detached-page failure and retry. Network and installer commands mocked; no installer executed.');
} finally { await browser.close(); await server.close(); }
