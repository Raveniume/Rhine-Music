import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/src-tauri/**','**/artifacts/**','**/release/**','**/desktop-runtime/**'] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
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
  console.log('Update dialog cancellation, single instance, invalid metadata and non-Windows manual update passed. Network was mocked; installer is covered separately.');
} finally { await browser.close(); await server.close(); }
