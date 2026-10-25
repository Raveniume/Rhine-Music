import { invoke } from '@tauri-apps/api/core';

export const RHINE_REPOSITORY = 'https://github.com/Raveniume/Rhine-Music';
type ReleaseAsset = { name?: string; browser_download_url?: string; digest?: string };
type Release = { tag_name?: string; name?: string; html_url?: string; body?: string; assets?: ReleaseAsset[] };

export function aboutMarkup(version: string) {
  return `<section class="panel-section about-section" data-settings-group="about"><h3>RhineMusic</h3><p class="about-version">当前版本 <strong>V${version}</strong></p><p>三维档案架音乐终端，保留本地曲库、网易云歌单与桌面歌词能力。</p><div class="about-actions"><button class="primary-button" data-action="check-update">检查更新 ↻</button><a class="text-button about-github-link" href="${RHINE_REPOSITORY}" target="_blank" rel="noopener">打开 GitHub ↗</a></div><p id="update-status" class="scan-status" role="status" aria-live="polite"></p><details open><summary>来源与许可</summary><p>视觉基于 RhineLabUI、Rhine-Music-Demo；播放器交互参考 rhine-lab-music；歌词参考 AMLL；桌面任务栏歌词参考 SPlayer-Next 与 TaskbarLyrics。代码与素材许可以仓库中的 LICENSE、NOTICE 和第三方声明为准。</p></details></section>`;
}

const versionKey = (value: string) => value.replace(/^v/i, '').split(/[+-]/)[0].split('.').map(part => Number(part) || 0);
function newer(remote: string, current: string) {
  const a = versionKey(remote), b = versionKey(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

export async function checkForUpdates(current: string, interactive = true) {
  const status = document.querySelector<HTMLElement>('#update-status');
  if (status) status.textContent = '正在连接 GitHub 检查更新…';
  try {
    const release: Release = await (window.__TAURI_INTERNALS__ ? invoke('desktop_check_update') : fetch('https://api.github.com/repos/Raveniume/Rhine-Music/releases/latest').then(response => response.json()));
    const remote = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!remote || !newer(remote, current)) { if (status) status.textContent = `已是最新版本 V${current}`; return false; }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find(asset => /windows.*setup.*\.exe$/i.test(asset.name || '') || /setup.*\.exe$/i.test(asset.name || ''));
    const checksum = assets.find(asset => asset.name === `${installer?.name}.sha256`);
    if (!installer?.browser_download_url) { if (status) status.textContent = `发现 V${remote}，但仓库还没有可用 Windows 安装包。`; return false; }
    if (status) status.textContent = `发现新版本 V${remote}`;
    if (!interactive || !window.confirm(`RhineMusic 有新版本 V${remote}，是否下载并安装？`)) return true;
    if (!window.__TAURI_INTERNALS__) { window.open(installer.browser_download_url, '_blank', 'noopener'); return true; }
    // GitHub's asset digest arrives over the native release request, avoiding
    // a cross-origin checksum download from the local WebView origin.
    let expectedHash = installer.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
    if (!expectedHash && checksum?.browser_download_url) {
      const sums = await fetch(checksum.browser_download_url).then(response => { if (!response.ok) throw Error('校验文件下载失败'); return response.text(); });
      expectedHash = sums.split(/\r?\n/).find(line => line.endsWith(installer.name!))?.match(/^([a-f0-9]{64})\s+/i)?.[1];
    }
    if (!expectedHash) { if (status) status.textContent = '未找到安装包校验值，已取消安装。'; return false; }
    if (status) status.textContent = '正在下载并校验安装包…';
    await invoke('desktop_install_update', { url: installer.browser_download_url, sha256: expectedHash });
    return true;
  } catch (error) {
    if (status) status.textContent = `检查更新失败：${String(error)}`;
    return false;
  }
}

declare global { interface Window { __TAURI_INTERNALS__?: unknown } }
