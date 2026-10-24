import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startFixture, fixtureLibrary } from './windows-fixture.mjs';
import { spawn } from 'node:child_process';

const output = path.resolve('artifacts/benchmark');
await fs.mkdir(output, { recursive: true });
const native = Boolean(process.env.RHINE_CDP);
const fixture = native ? null : await startFixture(process.env.RHINE_BENCH_DIST || 'dist');
const browser = native ? await chromium.connectOverCDP(process.env.RHINE_CDP) : await chromium.launch({ executablePath: process.env.RHINE_BROWSER, headless: true });
const nativePage = native ? browser.contexts()[0].pages().find(page => !page.url().includes('taskbar=1')) || browser.contexts()[0].pages()[0] : null;
let nativeSession;
if (native) {
  const restore = spawn(path.resolve(process.env.RHINE_DESKTOP_EXE || 'src-tauri/target/release/rhine-music-windows.exe'), [], { windowsHide: true });
  await new Promise(resolve => restore.once('exit', resolve));
  await nativePage.route('**/api/library', route => route.fulfill({ json: fixtureLibrary() }));
  nativeSession = await nativePage.context().newCDPSession(nativePage);
  const state = await nativePage.evaluate(() => window.__TAURI__.core.invoke('desktop_window_state'));
  if (!state.fullscreen) await nativePage.evaluate(() => window.__TAURI__.core.invoke('desktop_window_action', { action: 'fullscreen' }));
}
const setMetrics = async () => { if (nativeSession) await nativeSession.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); };
const origin = native ? new URL(nativePage.url()).origin : fixture.url.replace(/\/$/, '');
const report = { at: new Date().toISOString(), note: 'Actual WebView2/Chromium on the current machine, NOT integrated-GPU certification. Synthetic 96-album library; original materials, effects and samples; fixture mode requests 1920×1080 at DPR 1, while native WebView2 reports its actual CSS and drawing-buffer dimensions because native DPI overrides CDP metrics. Active navigation and detail transition are measured separately. No forced software/GPU overrides.', runs: [] };
try {
  for (const mode of ['reference', 'optimized']) {
    const page = nativePage || await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.clear();
    localStorage.setItem('rhine-music-preferences', JSON.stringify({ bgm: false, sound: false, volume: 0, quality: 'balanced', theme: 'day',
        startupOpening: false,
        renderQuality: { scale: 100, pixelRatio: 1.5, antialias: 'smaa', shadows: 1024, aoSamples: 8, aoResolution: 0.5, depthOfField: 100, depthOfFieldResolution: 0.5, transmission: 0.25, anisotropy: 8, arrayBudget: 1, pixelBudget: 3686400 } }));
    });
    const started = performance.now();
    await page.goto(`${origin}/?scene=archive&lab=0&scheduler=1&render=${mode}${native ? '&desktop=1' : ''}`);
    await setMetrics();
    await page.waitForFunction(() => {
      const stats = window.rhineMusic?.stats?.();
      const loading = document.querySelector('#music-loading');
      return Boolean(stats?.loaded && (!loading || (loading instanceof HTMLElement && loading.hidden)));
    }, null, { timeout: 120000 });
    await page.waitForFunction(() => !!document.querySelector('.music-panel-scrim'), null, { timeout: 15000 });
    await page.locator('.music-panel-scrim [data-action="close-panel"]').click();
    await page.waitForFunction(() => !document.querySelector('.music-panel-scrim'), null, { timeout: 10000 });
    await page.waitForFunction(() => window.rhineMusic?.stats()?.musicArchiveReady, null, { timeout: 30000 });
    const readyMs = Math.round(performance.now() - started);
    await page.waitForTimeout(5000);
    const run = { mode, readyMs, errors, scenarios: [] };
    report.runs.push(run);
    for (const scenario of ['archive-day', 'active-day', 'detail-day']) {
      if (scenario === 'detail-day') {
        await page.waitForFunction(() => window.rhineMusic?.presentation.phase === 'archive' && window.rhineMusic?.stats()?.musicArchiveReady, null, { timeout: 30000 });
      }
      let transitionMs;
      if (scenario === 'detail-day') {
        const transitionStarted = performance.now();
        await page.locator('[data-action="open"]').click();
        await page.waitForFunction(() => window.rhineMusic?.presentation.phase === 'detail' &&
          document.querySelector('#music-detail')?.dataset.transition === 'open', null, { timeout: 20000 });
        transitionMs = Math.round(performance.now() - transitionStarted);
      }
      await setMetrics();
      await page.waitForTimeout(4000);
      if (scenario === 'active-day') {
        for (let i = 0; i < 100; i++) { await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowDown'); await page.waitForTimeout(200); }
      } else await page.waitForTimeout(18000);
      const stats = await page.evaluate(() => {
        const gl = document.querySelector('#three-scene canvas').getContext('webgl2');
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const host = document.querySelector('#three-scene');
        return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, frame: JSON.parse(host.dataset.frameTiming || '{}'), quality: JSON.parse(host.dataset.renderQuality || '{}'),
          stats: window.rhineMusic.stats(), gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      });
      run.scenarios.push({ scenario, ...(transitionMs === undefined ? {} : { transitionMs }), ...stats });
      if (native) {
        if (!(stats.quality.width > 0 && stats.quality.height > 0)) throw new Error(`Invalid native drawing buffer: ${stats.quality.width}×${stats.quality.height}`);
      } else if (stats.quality.width !== 1920 || stats.quality.height !== 1080) {
        throw new Error(`Invalid fixture drawing buffer: ${stats.quality.width}×${stats.quality.height}`);
      }
      console.log(`${mode} ${scenario}: ${stats.frame.fps} FPS, CPU p95 ${stats.frame.cpuP95}ms, GPU p95 ${stats.stats.gpuTiming?.gpuP95 ?? 'unavailable'}ms, ${stats.stats.triangles} triangles, ${stats.stats.drawCalls} draws`);
      await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      await page.screenshot({ path: path.join(output, `${mode}-${scenario}.png`), scale: 'css', timeout: 10000 });
      await setMetrics();
    }
    if (!native) await page.close();
    page.removeAllListeners('pageerror');
  }
} finally {
  await browser.close(); await fixture?.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
if (report.runs.some(run => run.errors.length)) { console.error(report.runs.map(run => run.errors)); process.exitCode = 1; }
