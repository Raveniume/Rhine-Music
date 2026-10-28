import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const RHINE_REPOSITORY = 'https://github.com/Raveniume/Rhine-Music';
type ReleaseAsset = { name?: string; browser_download_url?: string; digest?: string };
type Release = { tag_name?: string; name?: string; html_url?: string; body?: string; assets?: ReleaseAsset[] };

let checking = false;
let interactiveRequested = false;
let updateMessage = '';
let releaseLink = '';
let updateButton = '检查更新 ↻';
const escapeMarkup = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]!));
function renderUpdateState() {
  const status = document.querySelector<HTMLElement>('#update-status');
  if (status) {
    status.textContent = updateMessage;
    if (releaseLink) {
      const link = document.createElement('a');
      link.href = releaseLink; link.target = '_blank'; link.rel = 'noopener'; link.textContent = '查看适用安装包 ↗';
      status.append(link);
    }
  }
  const button = document.querySelector<HTMLButtonElement>('[data-action="check-update"]');
  if (button) { button.textContent = updateButton; button.setAttribute('aria-busy', String(checking)); }
}
function setUpdateMessage(message: string) { updateMessage = message; renderUpdateState(); }

export function aboutMarkup(version: string) {
  return `<section class="panel-section about-section" data-settings-group="about"><h3>RhineMusic</h3><p class="about-version">当前版本 <strong>V${version}</strong></p><p>三维档案架音乐终端，保留本地曲库、网易云歌单与桌面歌词能力。</p><div class="about-actions"><button class="primary-button" data-action="check-update" aria-busy="${checking}">${updateButton}</button><a class="text-button about-github-link" href="${RHINE_REPOSITORY}" target="_blank" rel="noopener">打开 GitHub ↗</a></div><p id="update-status" class="scan-status" role="status" aria-live="polite">${escapeMarkup(updateMessage)}${releaseLink ? `<a href="${releaseLink}" target="_blank" rel="noopener">查看适用安装包 ↗</a>` : ''}</p><details open><summary>来源与许可</summary><p>视觉基于 RhineLabUI、Rhine-Music-Demo；播放器交互参考 rhine-lab-music；歌词参考 AMLL；桌面任务栏歌词参考 SPlayer-Next 与 TaskbarLyrics。代码与素材许可以仓库中的 LICENSE、NOTICE 和第三方声明为准。</p></details></section>`;
}

const versionKey = (value: string) => value.replace(/^v/i, '').split(/[+-]/)[0].split('.').map(part => Number(part) || 0);
function newer(remote: string, current: string) {
  const a = versionKey(remote), b = versionKey(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

export async function checkForUpdates(current: string, interactive = true) {
  if (checking) { interactiveRequested ||= interactive; renderUpdateState(); return false; }
  // Reopening About must not erase a download error with an automatic check.
  if (!interactive && updateMessage) { renderUpdateState(); return false; }
  checking = true;
  interactiveRequested = interactive;
  releaseLink = '';
  updateButton = '正在检查…';
  let unlisten: UnlistenFn | undefined;
  let downloading = false;
  setUpdateMessage('正在连接 GitHub 检查更新…');
  try {
    const release: Release = await (window.__TAURI_INTERNALS__ ? invoke('desktop_check_update') : fetch('https://api.github.com/repos/Raveniume/Rhine-Music/releases/latest', { signal: AbortSignal.timeout(15000) }).then(response => { if (!response.ok) throw Error(`GitHub HTTP ${response.status}`); return response.json(); }));
    const remote = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(remote)) throw Error('更新版本信息无效');
    if (!newer(remote, current)) { setUpdateMessage(`已是最新版本 V${current}`); return false; }
    if (!/Windows/i.test(navigator.userAgent)) {
      releaseLink = `${RHINE_REPOSITORY}/releases/tag/v${remote}`;
      setUpdateMessage(`发现新版本 V${remote}。`);
      return true;
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find(asset => /windows.*setup.*\.exe$/i.test(asset.name || '') || /setup.*\.exe$/i.test(asset.name || ''));
    const checksum = assets.find(asset => asset.name === `${installer?.name}.sha256`);
    if (!installer?.browser_download_url) { setUpdateMessage(`发现 V${remote}，但仓库还没有可用 Windows 安装包。`); return false; }
    setUpdateMessage(`发现新版本 V${remote}`);
    if (!interactiveRequested || !(await askUpdate(`RhineMusic 有新版本 V${remote}，是否下载并安装？`))) return true;
    if (!window.__TAURI_INTERNALS__) { window.open(installer.browser_download_url, '_blank', 'noopener'); return true; }
    // GitHub's asset digest arrives over the native release request, avoiding
    // a cross-origin checksum download from the local WebView origin.
    let expectedHash = installer.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
    if (!expectedHash && checksum?.browser_download_url) {
      const sums = await fetch(checksum.browser_download_url, { signal: AbortSignal.timeout(15000) }).then(response => { if (!response.ok) throw Error('校验文件下载失败'); return response.text(); });
      expectedHash = sums.split(/\r?\n/).find(line => line.endsWith(installer.name!))?.match(/^([a-f0-9]{64})\s+/i)?.[1];
    }
    if (!expectedHash) { setUpdateMessage('未找到安装包校验值，已取消安装。'); return false; }
    downloading = true;
    updateButton = '正在更新…';
    setUpdateMessage('正在连接下载服务器…');
    unlisten = await listen<{ message: string }>('rhine-update-progress', event => setUpdateMessage(event.payload.message));
    await invoke('desktop_install_update', { url: installer.browser_download_url, sha256: expectedHash });
    setUpdateMessage('安装包已校验，正在退出并安装…');
    return true;
  } catch (error) {
    setUpdateMessage(`${downloading ? '下载更新' : '检查更新'}失败：${String(error)}。可点击“检查更新”重试。`);
    return false;
  } finally { unlisten?.(); checking = false; updateButton = '检查更新 ↻'; renderUpdateState(); }
}

function askUpdate(message: string) {
  return new Promise<boolean>(resolve => {
    document.querySelector<HTMLElement>('.update-confirm-scrim')?.remove();
    const scrim = document.createElement('div');
    scrim.className = 'update-confirm-scrim';
    scrim.innerHTML = `<section class="update-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title"><small>RHINE MUSIC / UPDATE</small><h2 id="update-confirm-title">发现新版本</h2><p></p><div class="update-confirm-actions"><button type="button" data-update-choice="cancel">稍后</button><button type="button" class="primary-button" data-update-choice="confirm">下载并安装</button></div></section>`;
    scrim.querySelector('p')!.textContent = message;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.append(scrim);
    const finish = (value: boolean) => { scrim.remove(); previousFocus?.focus(); resolve(value); };
    scrim.addEventListener('click', event => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-update-choice]')?.dataset.updateChoice;
      if (choice === 'confirm') finish(true);
      else if (choice === 'cancel' || event.target === scrim) finish(false);
    });
    scrim.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = [...scrim.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    });
    scrim.querySelector<HTMLButtonElement>('[data-update-choice="confirm"]')?.focus();
  });
}

declare global { interface Window { __TAURI_INTERNALS__?: unknown } }
