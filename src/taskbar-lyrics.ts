import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type DesktopLyricState = {
  visible?: boolean;
  current?: string;
  next?: string;
  title?: string;
  artist?: string;
  playing?: boolean;
  instrumental?: boolean;
};

const esc = (value: unknown) => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));

function mount() {
  document.documentElement.className = 'rhine-taskbar-page';
  document.body.innerHTML = `<main class="taskbar-lyric" data-state="empty" aria-live="polite">
    <div class="taskbar-copy"><strong data-current>RHINE MUSIC</strong><small data-next></small></div>
    <div class="taskbar-actions" role="group" aria-label="播放控制">
      <button type="button" data-taskbar-action="previous" aria-label="上一首" title="上一首">‹</button>
      <button type="button" data-taskbar-action="toggle" aria-label="播放或暂停" title="播放或暂停">▶</button>
      <button type="button" data-taskbar-action="next" aria-label="下一首" title="下一首">›</button>
    </div>
  </main>`;
  const style = document.createElement('style');
  style.textContent = `
    :root.rhine-taskbar-page, :root.rhine-taskbar-page body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent; color:#17201e; font-family:Inter,\"Segoe UI\",sans-serif; }
    .taskbar-lyric { box-sizing:border-box; display:flex; align-items:center; gap:14px; width:100%; height:100%; min-height:52px; padding:6px 12px 6px 16px; border:1px solid rgba(23,32,30,.34); background:rgba(242,245,242,.96); box-shadow:0 2px 10px rgba(23,32,30,.18); user-select:none; }
    .taskbar-copy { min-width:0; flex:1; line-height:1.12; overflow:hidden; }
    .taskbar-copy strong, .taskbar-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .taskbar-copy strong { font-size:18px; font-weight:650; letter-spacing:.01em; }
    .taskbar-copy small { margin-top:4px; color:#54706a; font-size:12px; }
    .taskbar-actions { display:flex; flex:none; gap:2px; }
    .taskbar-actions button { width:32px; height:32px; border:0; padding:0; border-radius:3px; background:transparent; color:#17201e; font-size:24px; line-height:1; cursor:pointer; }
    .taskbar-actions button:hover, .taskbar-actions button:focus-visible { background:#c8ef66; outline:none; }
    .taskbar-lyric[data-state="empty"] { opacity:.72; }
    .taskbar-lyric[data-state="hidden"] { display:none; }
    @media (prefers-color-scheme: dark) { .taskbar-lyric { border-color:rgba(224,235,230,.28); background:rgba(22,29,27,.94); color:#e7f1ed; } .taskbar-copy small { color:#a4c0b8; } .taskbar-actions button { color:#e7f1ed; } }
  `;
  document.head.append(style);
  const root = document.querySelector<HTMLElement>('.taskbar-lyric')!;
  const current = root.querySelector<HTMLElement>('[data-current]')!;
  const next = root.querySelector<HTMLElement>('[data-next]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-taskbar-action="toggle"]')!;
  let last: DesktopLyricState = {};
  const render = (value: DesktopLyricState) => {
    last = value;
    const visible = value.visible !== false && !!(value.current || value.title || value.instrumental);
    root.dataset.state = visible ? 'ready' : value.visible === false ? 'hidden' : 'empty';
    current.textContent = value.current || (value.instrumental ? '纯音乐' : value.title || 'RHINE MUSIC');
    next.textContent = value.next || (value.artist ? `${value.title || ''} · ${value.artist}` : '');
    toggle.textContent = value.playing ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', value.playing ? '暂停' : '播放');
  };
  root.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-taskbar-action]')?.dataset.taskbarAction;
    if (action) void invoke('desktop_taskbar_action', { action }).catch(error => console.warn('任务栏歌词控制失败', error));
  });
  let stopLyrics: UnlistenFn | undefined;
  let stopAction: UnlistenFn | undefined;
  void (async () => {
    stopLyrics = await listen<DesktopLyricState>('rhine-taskbar-lyric', event => render(event.payload));
    stopAction = await listen<{ action?: string }>('rhine-taskbar-action', event => {
      if (event.payload?.action === 'toggle') render({ ...last, playing: !last.playing });
    });
    await invoke('desktop_taskbar_lyric_ready');
  })();
  window.addEventListener('beforeunload', () => { stopLyrics?.(); stopAction?.(); });
}

mount();

