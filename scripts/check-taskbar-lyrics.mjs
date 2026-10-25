import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = process.cwd();
const port = Number(process.env.RHINE_CDP_PORT || 9335);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid RHINE_CDP_PORT');
const output = path.resolve('artifacts/desktop-ui/taskbar-lyrics-report.json');
await fs.mkdir(path.dirname(output), { recursive: true });
const executable = path.resolve(process.env.RHINE_DESKTOP_EXE || 'release/Rhine-Music-Windows/Rhine Music.exe');
const executableDir = path.dirname(executable);
const child = spawn(executable, [], { cwd: executableDir, windowsHide: true, stdio: 'ignore', env: {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: path.resolve(`artifacts/taskbar-lyrics-profile-${process.pid}`),
  RHINE_DESKTOP_DATA_DIR: path.resolve(`artifacts/taskbar-lyrics-data-${process.pid}`),
} });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { runtimeChecked: false, checks: [], syntheticLyric: '合成任务栏歌词验证' };
const sockets = [];
const connect = async target => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    clearTimeout(item.timer);
    data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { command, evaluate };
};
const waitFor = async (predicate, timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Desktop exited with code ${child.exitCode}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const result = await predicate(targets);
      if (result) return result;
    } catch (error) { lastError = error; }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for desktop WebViews${lastError ? `: ${lastError.message}` : ''}`);
};

try {
  const mainTarget = await waitFor(targets => targets.find(target => target.type === 'page' && /desktop=1/.test(target.url) && !/taskbar=1/.test(target.url)));
  const main = await connect(mainTarget);
  await waitFor(async () => await main.evaluate(`!!window.rhineMusic && !!document.querySelector('.desktop-chrome')`));
  const taskbarTarget = await waitFor(targets => targets.find(target => target.type === 'page' && /taskbar=1/.test(target.url)));
  const taskbar = await connect(taskbarTarget);
  await waitFor(async () => await taskbar.evaluate(`!!document.querySelector('[data-current]')`), 30000);
  await main.evaluate(`window.dispatchEvent(new CustomEvent('rhine-lyric-state', { detail: {
    visible: true, current: '合成任务栏歌词验证', next: '合成下一句', title: '合成歌曲', artist: '测试歌手', playing: true, instrumental: false
  }}))`);
  await waitFor(async () => await taskbar.evaluate(`document.querySelector('[data-current]')?.textContent === '合成任务栏歌词验证'`), 10000);
  const visible = await taskbar.evaluate(`window.__TAURI__.window.getCurrentWindow().isVisible()`);
  const position = await taskbar.evaluate(`window.__TAURI__.window.getCurrentWindow().outerPosition().then(({x,y}) => ({x,y}))`);
  const size = await taskbar.evaluate(`window.__TAURI__.window.getCurrentWindow().outerSize().then(({width,height}) => ({width,height}))`);
  assert.equal(visible, true, 'taskbar lyric window becomes visible for active synthetic lyrics');
  assert.ok(size.width >= 260 && size.height >= 24, JSON.stringify(size));
  report.checks.push('Synthetic lyric reaches the separate taskbar WebView and shows its native window');
  report.window = { visible, position, size, url: taskbarTarget.url };

  await main.evaluate(`window.dispatchEvent(new CustomEvent('rhine-lyric-state', { detail: {
    visible: false, current: '', next: '', title: '', artist: '', playing: false, instrumental: false
  }}))`);
  await waitFor(async () => !(await taskbar.evaluate(`window.__TAURI__.window.getCurrentWindow().isVisible()`)), 10000);
  report.checks.push('Taskbar lyric window hides after the synthetic track stops');
  report.runtimeChecked = true;
} finally {
  for (const socket of sockets) { try { socket.close(); } catch {} }
  if (child.exitCode === null) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(item => item.type === 'page' && /desktop=1/.test(item.url) && !/taskbar=1/.test(item.url));
      if (target) {
        const main = await connect(target);
        await main.evaluate(`window.__TAURI__.core.invoke('desktop_window_action', { action: 'close' })`);
        await Promise.race([once(child, 'exit'), sleep(5000)]);
      }
    } catch {}
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), sleep(3000)]);
    }
  }
  report.status = report.runtimeChecked ? 'passed' : 'failed';
  await fs.writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
