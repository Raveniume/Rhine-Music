// Exercise the real desktop bridge in a browser. Native IPC is mocked; actual
// menu-bar presentation and Dock activation require the Mac runtime check.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ logLevel: 'error', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 0,
  watch: { ignored: ['**/src-tauri/**', '**/release/**', '**/artifacts/**', '**/desktop-runtime/**'] } } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.RHINE_BROWSER, headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.route('**/desktop-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/desktop-fixture`);
  await page.evaluate(async () => {
    window.__RHINE_PLATFORM__ = 'macos';
    window.calls = [];
    window.listeners = {};
    const callbacks = new Map(); let id = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback(fn) { callbacks.set(++id, fn); return id; },
      invoke(command, args) {
        window.calls.push({ command, args });
        if (command === 'plugin:event|listen') window.listeners[args.event] = callbacks.get(args.handler);
        if (command === 'desktop_window_state') return Promise.resolve({ fullscreen: false, maximized: false });
        return Promise.resolve(null);
      },
    };
    const desktop = await import('/src/desktop.ts');
    desktop.mountDesktop();
    window.desktop = desktop;
  });
  assert.equal(await page.locator('.desktop-chrome nav').isVisible(), false);
  await page.evaluate(() => window.listeners['rhine-close-requested']({ payload: null }));
  await page.getByRole('button', { name: '关闭窗口，继续播放', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls.find(c => c.command === 'desktop_close_decision').args),
    { behavior: 'tray', remember: false });
  await page.evaluate(async () => {
    await window.desktop.configureTaskbarLyrics(false);
    window.dispatchEvent(new CustomEvent('rhine-lyric-state', { detail: {
      visible: true, current: '合成测试歌词', next: '', title: '测试', artist: '', playing: true, instrumental: false,
    } }));
  });
  assert.equal(await page.evaluate(() => window.calls.find(c => c.command === 'desktop_taskbar_lyric_control').args.enabled), false);
  assert.equal(await page.evaluate(() => window.calls.find(c => c.command === 'desktop_taskbar_lyric_update').args.payload.current), '合成测试歌词');
  await page.evaluate(async () => {
    const settings = await import('/src/music-settings.ts');
    document.body.insertAdjacentHTML('beforeend', settings.settingsNavigation() + window.desktop.windowDisplayMarkup());
  });
  assert.equal(await page.getByRole('button', { name: '桌面与菜单栏', exact: true }).count(), 1);
  assert.match(await page.locator('body').innerText(), /最大化保留菜单栏与 Dock/);
  assert.doesNotMatch(await page.locator('body').innerText(), /最小化到托盘/);
  console.log('Mac bridge UI passed: native-control visibility, background close, lyric toggle and payload, platform settings. IPC mocked.');
} finally { await browser?.close(); await server.close(); }
