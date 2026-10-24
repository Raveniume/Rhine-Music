import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type TrayLyricState = {
  visible?: boolean;
  current?: string;
  next?: string;
  title?: string;
  artist?: string;
  playing?: boolean;
  instrumental?: boolean;
};

function mount() {
  document.documentElement.className = 'rhine-tray-page';
  document.body.innerHTML = `<main class="tray-controls" aria-label="RhineMusic 托盘控制">
    <header><div><small>RHINE MUSIC</small><strong data-title>RhineMusic</strong></div><button type="button" data-tray-action="hide" aria-label="隐藏托盘控制">×</button></header>
    <section class="tray-lyric" aria-live="polite"><strong data-current>暂无播放</strong><small data-next></small></section>
    <nav class="tray-actions" aria-label="播放控制">
      <button type="button" data-tray-action="previous" aria-label="上一首" title="上一首">‹</button>
      <button type="button" data-tray-action="toggle" aria-label="播放或暂停" title="播放或暂停" data-toggle>▶</button>
      <button type="button" data-tray-action="next" aria-label="下一首" title="下一首">›</button>
      <span></span>
      <button type="button" data-tray-action="show">打开主窗口</button>
      <button type="button" data-tray-action="settings">设置</button>
    </nav>
  </main>`;
  const style = document.createElement('style');
  style.textContent = `
    :root.rhine-tray-page, :root.rhine-tray-page body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent; color:#17201e; font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif; }
    .tray-controls { box-sizing:border-box; width:100%; height:100%; padding:12px 14px 11px; border:1px solid rgba(23,32,30,.22); background:rgba(242,245,242,.97); box-shadow:0 8px 28px rgba(23,32,30,.2); user-select:none; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    header small { display:block; color:#6c8079; font-size:9px; letter-spacing:.16em; }
    header strong { display:block; margin-top:3px; font-size:13px; font-weight:650; }
    header button { width:24px; height:24px; border:0; background:transparent; color:inherit; font-size:20px; line-height:1; cursor:pointer; }
    header button:hover, header button:focus-visible { background:#c8ef66; outline:none; }
    .tray-lyric { min-width:0; margin:13px 0 10px; padding:9px 10px; border-left:2px solid #0b928d; background:rgba(255,255,255,.5); }
    .tray-lyric strong, .tray-lyric small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tray-lyric strong { font-size:13px; font-weight:650; }
    .tray-lyric small { margin-top:4px; color:#54706a; font-size:10px; }
    .tray-actions { display:grid; grid-template-columns:30px 30px 30px 1fr auto auto; align-items:center; gap:5px; }
    .tray-actions button { min-height:28px; border:1px solid transparent; border-radius:3px; padding:3px 7px; background:transparent; color:inherit; font-size:12px; cursor:pointer; }
    .tray-actions button:hover, .tray-actions button:focus-visible { border-color:#0b928d; background:#c8ef66; outline:none; }
    .tray-actions > button:nth-child(-n+3) { padding:0; font-size:20px; line-height:1; }
    @media (prefers-color-scheme: dark) { :root.rhine-tray-page, :root.rhine-tray-page body { color:#e7f1ed; } .tray-controls { border-color:rgba(224,235,230,.25); background:rgba(22,29,27,.97); } .tray-lyric { background:rgba(255,255,255,.05); } .tray-lyric small { color:#a4c0b8; } }
  `;
  document.head.append(style);
  const current = document.querySelector<HTMLElement>('[data-current]')!;
  const next = document.querySelector<HTMLElement>('[data-next]')!;
  const title = document.querySelector<HTMLElement>('[data-title]')!;
  const toggle = document.querySelector<HTMLButtonElement>('[data-toggle]')!;
  const render = (state: TrayLyricState) => {
    const currentText = state.current || (state.instrumental ? '纯音乐' : state.title || '暂无播放');
    current.textContent = currentText;
    next.textContent = state.next || (state.artist ? `${state.title || ''} · ${state.artist}` : '');
    title.textContent = state.title || 'RhineMusic';
    toggle.textContent = state.playing ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  };
  document.body.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-tray-action]')?.dataset.trayAction;
    if (action) void invoke('desktop_tray_action', { action }).catch(error => console.warn('托盘控制失败', error));
  });
  let stopLyrics: UnlistenFn | undefined;
  void (async () => {
    stopLyrics = await listen<TrayLyricState>('rhine-taskbar-lyric', event => render(event.payload));
    await invoke('desktop_taskbar_lyric_ready');
  })();
  window.addEventListener('beforeunload', () => stopLyrics?.());
}

mount();
