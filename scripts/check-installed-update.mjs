// Actual installed application and GitHub Release. No release/API mocks.
// Explicitly invoked by a maintainer: this performs a real in-place update.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
const exe = process.env.RHINE_DESKTOP_EXE;
const expected = process.env.RHINE_UPDATE_EXPECTED;
if (!exe || !/^\d+\.\d+\.\d+$/.test(expected || '')) throw Error('Set RHINE_DESKTOP_EXE and RHINE_UPDATE_EXPECTED. This installs the actual GitHub update.');
const output = path.resolve('artifacts/update-verification');
await fs.mkdir(output, { recursive: true });
const data = path.join(output, 'isolated-data'), profile = path.join(output, 'isolated-webview');
await fs.mkdir(data, { recursive: true });
const sentinel = path.join(data, 'update-test-preserved.txt');
await fs.writeFile(sentinel, 'isolated-update-data');
const source = JSON.parse(await fs.readFile(path.join(path.dirname(exe), 'BUILD-INFO.json'), 'utf8'));
const port = 9348;
const child = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore', env: {
  ...process.env, RHINE_DESKTOP_DATA_DIR: data, WEBVIEW2_USER_DATA_FOLDER: profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --mute-audio`,
} });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 150; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 });
      const page = browser.contexts()[0].pages().find(p => p.url().includes('desktop=1') && !/taskbar=1|tray=1/.test(p.url()));
      if (page) return { browser, page };
      await browser.close();
    } catch {}
    await pause(500);
  }
  throw Error('Installed WebView did not start');
}
let { browser, page } = await connect();
page.setDefaultTimeout(120000);
const report = { runtimeChecked: false, sourceVersion: source.version, targetVersion: expected, mockedNetwork: false, scope: 'Installed Windows application; actual GitHub download, silent installer, automatic restart; isolated data and muted audio' };
async function about(initialize = false) {
  await page.waitForFunction(() => !!window.rhineMusic);
  await page.evaluate(initialize => {
    if (initialize) {
      localStorage.setItem('rhine-music-preferences', JSON.stringify({ startupOpening: false, theme: 'night', sfx: false, quality: 'performance' }));
      localStorage.setItem('rhine-update-test-sentinel', 'preserve-webview-data');
    }
    document.querySelector('.music-boot-skip')?.click();
    document.querySelector('.rhine-loading button')?.click();
  }, initialize);
  await page.locator('[data-action="settings"]').first().click({ force: true });
  await page.locator('[data-category="about"]').click();
}
try {
  await about(true);
  await page.locator('[data-action="check-update"]').click();
  await page.waitForFunction(() => !document.querySelector('#update-status')?.textContent?.includes('正在连接'));
  report.initialStatus = await page.locator('#update-status').innerText();
  await page.screenshot({ path: path.join(output, 'check-update.png') });
  if (process.env.RHINE_UPDATE_CHECK_ONLY === '1') {
    console.log(JSON.stringify(report));
  } else {
    assert.match(report.initialStatus, new RegExp(`发现新版本 V${expected.replaceAll('.', '\\.')}`));
    await page.locator('[data-update-choice="confirm"]').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('正在下载'));
    await page.screenshot({ path: path.join(output, 'download.png') });
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < 360000) {
      const status = await page.locator('#update-status').innerText().catch(() => '');
      if (/失败|取消/.test(status)) throw Error(status);
      await pause(500);
    }
    assert.notEqual(child.exitCode, null, 'Old app exits after verifying the download');
    await browser.close().catch(() => {});
    await pause(3000);
    ({ browser, page } = await connect());
    page.setDefaultTimeout(120000);
    await about();
    const installed = JSON.parse(await fs.readFile(path.join(path.dirname(exe), 'BUILD-INFO.json'), 'utf8'));
    assert.equal(installed.version, expected);
    await page.locator('[data-action="check-update"]').click();
    await page.waitForFunction(() => document.querySelector('#update-status')?.textContent?.includes('已是最新版本'));
    report.finalStatus = await page.locator('#update-status').innerText();
    await page.screenshot({ path: path.join(output, 'updated-latest.png') });
    const rows = (await fs.readFile(path.join(path.dirname(exe), 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
    for (const row of rows) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
      assert.ok(match);
      const target = path.resolve(path.dirname(exe), match[2]);
      assert.ok(target.startsWith(path.dirname(exe) + path.sep));
      const actual = createHash('sha256').update(await fs.readFile(target)).digest('hex');
      assert.equal(actual, match[1], match[2]);
    }
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'isolated-update-data');
    report.installedFilesVerified = rows.length;
    report.settings = await page.evaluate(() => JSON.parse(localStorage.getItem('rhine-music-preferences')));
    assert.equal(await page.evaluate(() => localStorage.getItem('rhine-update-test-sentinel')), 'preserve-webview-data');
    assert.equal(report.settings.theme, 'night');
    report.automaticRestart = true;
    report.elapsedMs = Date.now() - started;
    report.installed = installed;
    report.runtimeChecked = true;
    console.log(JSON.stringify(report));
  }
} catch (error) { report.error = String(error); throw error; }
finally {
  await fs.writeFile(path.join(output, 'in-app-update.json'), JSON.stringify(report, null, 2));
  await page.evaluate(() => window.__TAURI__.core.invoke('desktop_close_decision', { behavior: 'exit', remember: false })).catch(() => {});
  await browser.close().catch(() => {});
}
