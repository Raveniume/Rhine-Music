import type { MusicProvider } from './music-platform';
import { musicPlatforms } from './music-platform';
import type { MusicTrack, NeteasePlaylist } from './music-types';
import { escapeHtml as esc } from './html';
import { fetchOnline } from './online-debug';
import './playlist-manager.css';
import { orderedPlaylists, readPlaylistOrder, savePlaylistOrder } from './playlist-order';

type Action = 'create' | 'rename' | 'delete' | 'add' | 'remove';
type Capabilities = Record<Action, boolean> & { session: string; notice?: string };
type Page = { tracks: (MusicTrack | null)[]; total: number };

/** One account-bound dialog, shared by search results and playlist drawers. */
export class PlaylistManager {
  private dialog?: HTMLDialogElement;
  private controller = new AbortController();
  private epoch = 0;
  private busy = false;
  private provider: MusicProvider = 'netease';
  private caps?: Capabilities;
  private playlists: NeteasePlaylist[] = [];
  private selected?: NeteasePlaylist;
  private adding?: MusicTrack;
  private picked = new Map<string, MusicTrack>();
  private pages = new Map<number, Page>();
  private pending = new Set<number>();
  private opener?: HTMLElement;
  private filter = '';
  private createDraft = '';
  private orderScope = '';
  constructor(private root: HTMLElement, private changed: () => Promise<void>, private notify: (message: string) => void,
    private ordering?: { scope: () => string; changed: () => Promise<void> }) {}
  dispose() {
    this.epoch++; this.controller.abort(); this.controller = new AbortController();
    this.dialog?.close(); this.dialog?.remove(); this.dialog = undefined;
    this.caps = undefined; this.busy = false; this.selected = undefined;
    this.pages.clear(); this.pending.clear(); this.picked.clear(); this.playlists = []; this.adding = undefined;
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = undefined;
  }
  private async request<T>(path: string, body?: object): Promise<T> {
    const response = await fetchOnline(this.provider, body ? 'playlistWrite' : 'playlists', `/api/online/${this.provider}/${path}`, {
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]),
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '歌单请求失败。');
    return value;
  }
  async open(provider: MusicProvider, options: { track?: MusicTrack; playlistId?: string } = {}) {
    this.dispose(); this.provider = provider; this.adding = options.track;
    this.filter = ''; this.createDraft = ''; this.orderScope = this.ordering?.scope() || '';
    if (options.track && options.track.onlineSource?.provider !== provider) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const epoch = this.epoch;
    const dialog = this.dialog = document.createElement('dialog'); dialog.className = 'playlist-manager';
    dialog.setAttribute('aria-labelledby', 'playlist-manager-title');
    dialog.innerHTML = `<header><div><small>${esc(musicPlatforms[provider])}</small><h2 id="playlist-manager-title">${this.adding ? '添加到歌单' : '整理我的歌单'}</h2></div><button type="button" data-close aria-label="关闭歌单整理">×</button></header><p class="playlist-manager-status" role="status" aria-live="polite">正在读取…</p><div class="playlist-manager-body"></div>`;
    this.root.append(dialog); dialog.showModal();
    for (const type of ['keydown', 'wheel', 'pointerdown', 'click']) dialog.addEventListener(type, event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.busy) this.dispose(); });
    dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || this.busy) return;
      if (button.hasAttribute('data-close')) this.dispose();
      if (button.dataset.move) void this.move(button.dataset.move, Number(button.dataset.direction));
      if (button.dataset.choose) {
        const playlist = this.playlists.find(item => item.id === button.dataset.choose); if (!playlist) return;
        if (this.adding) void this.write('add', { playlistId: playlist.id, trackIds: [this.adding.onlineSource!.id] });
        else this.showPlaylist(playlist);
      }
      if (button.hasAttribute('data-back')) { this.selected = undefined; this.picked.clear(); this.render(); }
      if (button.hasAttribute('data-remove')) this.confirm('remove');
      if (button.hasAttribute('data-delete')) this.confirm('delete');
      if (button.dataset.confirm) void this.write(button.dataset.confirm as Action, { playlistId: this.selected?.id, trackIds: [...this.picked.keys()] });
      if (button.hasAttribute('data-cancel-confirm')) this.dialog?.querySelector('.playlist-confirm')?.remove();
    });
    dialog.addEventListener('submit', event => {
      const form = event.target as HTMLFormElement; event.preventDefault(); if (this.busy) return;
      const action = form.dataset.form as Action;
      const name = new FormData(form).get('name');
      if (action === 'create' || action === 'rename') void this.write(action, { name, playlistId: this.selected?.id });
    });
    dialog.addEventListener('change', event => {
      const select = event.target as HTMLSelectElement;
      if (!select.matches('[data-order]') || this.busy) return;
      const list = this.ordered();
      if (select.value === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      if (select.value === 'count') list.sort((a, b) => b.trackCount - a.trackCount);
      if (select.value) void this.setOrder(select.value === 'default' ? [] : list.map(item => item.id));
    });
    try {
      const caps = await this.request<Capabilities>('playlist-management');
      if (epoch !== this.epoch) return;
      this.caps = caps;
      await this.loadPlaylists();
      if (epoch !== this.epoch) return;
      const selected = this.playlists.find(item => item.id === options.playlistId);
      if (selected && !this.adding) this.showPlaylist(selected); else this.render();
    } catch (error) { if (epoch === this.epoch) this.status((error as Error).message); }
  }
  private async loadPlaylists() {
    const epoch = this.epoch, list: NeteasePlaylist[] = [];
    for (let offset = 0; offset <= 5000; offset += 100) {
      const page = await this.request<{ playlists: NeteasePlaylist[]; hasMore: boolean }>(`playlists?offset=${offset}`);
      if (epoch !== this.epoch) return;
      list.push(...page.playlists); if (!page.hasMore) break;
    }
    this.playlists = [...new Map(list.map(item => [item.id, item])).values()];
  }
  private status(message: string) { const node = this.dialog?.querySelector('.playlist-manager-status'); if (node) node.textContent = message; }
  private ordered() { return orderedPlaylists(this.playlists, readPlaylistOrder(this.orderScope)); }
  private async move(id: string, direction: number) {
    const list = this.ordered(), index = list.findIndex(item => item.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    await this.setOrder(list.map(item => item.id), id, direction);
  }
  private async setOrder(ids: string[], focusId?: string, direction?: number) {
    if (!this.ordering || this.busy) return;
    const epoch = this.epoch, scrollTop = this.dialog?.querySelector('.playlist-manager-choices')?.scrollTop || 0;
    try {
      savePlaylistOrder(this.orderScope, ids);
      this.busy = true;
      this.render();
      const scroll = this.dialog?.querySelector('.playlist-manager-choices'); if (scroll) scroll.scrollTop = scrollTop;
      await this.ordering.changed();
      if (epoch !== this.epoch) return;
      this.busy = false; this.render();
      const list = this.dialog?.querySelector('.playlist-manager-choices'); if (list) list.scrollTop = scrollTop;
      const buttons = [...(this.dialog?.querySelectorAll<HTMLButtonElement>('[data-move]') || [])];
      const focus = buttons.find(button => button.dataset.move === focusId && Number(button.dataset.direction) === direction && !button.disabled)
        || buttons.find(button => button.dataset.move === focusId && !button.disabled);
      (focus || this.dialog?.querySelector<HTMLSelectElement>('[data-order]'))?.focus({ preventScroll: true });
      this.status(ids.length ? '歌单顺序已更新。' : '已恢复平台默认顺序。');
    } catch (error) { if (epoch === this.epoch) { this.busy = false; this.render(); this.status(`未能完成排序：${(error as Error).message}`); } }
  }
  private render() {
    const body = this.dialog?.querySelector<HTMLElement>('.playlist-manager-body'); if (!body || !this.caps) return;
    const playlist = this.selected;
    if (!playlist) {
      const ordered = this.ordered(), own = ordered.filter(item => item.owned);
      const canOrder = !!this.ordering && !!this.orderScope && !this.adding;
      this.status(this.caps.notice || (this.adding ? `将「${this.adding.title}」添加到${musicPlatforms[this.provider]}歌单` : '自己的歌单可编辑，收藏的歌单只读。'));
      body.innerHTML = `${this.caps.create ? `<form data-form="create" class="playlist-name-form"><input name="name" aria-label="新歌单名称" placeholder="新建歌单" maxlength="${this.provider === 'qq' ? 20 : 40}" required><button type="submit">＋ 新建</button></form>` : ''}<input type="search" class="playlist-filter" aria-label="筛选歌单" placeholder="查找歌单"><div class="playlist-order-tools">${canOrder ? `<span>歌单顺序</span><select data-order aria-label="歌单排序" ${this.busy ? 'disabled' : ''}><option value="">排序方式…</option><option value="name">按名称</option><option value="count">按歌曲数量</option><option value="default">恢复平台默认顺序</option></select>` : ''}</div><div class="playlist-manager-choices">${(this.adding ? own : ordered).map((item, index) => `<div class="playlist-choice-row" data-name="${esc(item.name.toLocaleLowerCase())}"><button type="button" class="playlist-choice" data-choose="${esc(item.id)}" data-name="${esc(item.name.toLocaleLowerCase())}" ${this.busy || this.adding && !this.caps!.add ? 'disabled' : ''}><span class="playlist-choice-cover">${item.coverUrl ? `<img src="${esc(item.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '♪'}</span><span><strong>${esc(item.name)}</strong><small>${item.trackCount} 首 · ${item.owned ? '我创建的' : '我收藏的'}</small></span><span aria-hidden="true">${this.adding ? '＋' : '›'}</span></button>${canOrder ? `<div class="playlist-order-move"><button data-move="${esc(item.id)}" data-direction="-1" aria-label="上移 ${esc(item.name)}" title="上移" ${this.busy || index === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button><button data-move="${esc(item.id)}" data-direction="1" aria-label="下移 ${esc(item.name)}" title="下移" ${this.busy || index === ordered.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button></div>` : ''}</div>`).join('') || '<p>暂无可选择的歌单。</p>'}</div>`;
      const search = body.querySelector<HTMLInputElement>('input[type="search"]')!;
      const createName = body.querySelector<HTMLInputElement>('[data-form="create"] input');
      if (createName) { createName.value = this.createDraft; createName.addEventListener('input', () => this.createDraft = createName.value); }
      const filter = () => body.querySelectorAll<HTMLElement>('.playlist-choice-row').forEach(item => { item.hidden = !item.dataset.name?.includes(this.filter.trim().toLocaleLowerCase()); });
      search.value = this.filter; filter();
      search.addEventListener('input', () => { this.filter = search.value; filter(); });
      return;
    }
    const editable = playlist.owned;
    const system = playlist.specialType === 5 || this.provider === 'qq' && playlist.id.startsWith('201-');
    body.innerHTML = `<button type="button" class="text-button" data-back>← 全部歌单</button><div class="playlist-edit-heading"><h3>${esc(playlist.name)}</h3><small>${playlist.trackCount} 首 · ${editable ? '我创建的' : '只读歌单'}</small></div>${editable && this.caps.rename && !system ? `<form data-form="rename" class="playlist-name-form"><input name="name" aria-label="歌单名称" value="${esc(playlist.name)}" maxlength="40" required><button type="submit">保存名称</button></form>` : ''}<div class="playlist-edit-tools">${editable && this.caps.remove ? '<button type="button" data-remove disabled>移除所选 <span data-selected-count></span></button>' : ''}${editable && this.caps.delete && !system ? '<button type="button" class="playlist-danger" data-delete>删除歌单</button>' : ''}</div><div class="playlist-edit-tracks" tabindex="0" aria-label="歌单歌曲"><div class="playlist-edit-window"></div></div>`;
    this.status(this.caps.notice || (editable ? '修改将同步到当前音乐平台。' : '这是收藏的歌单，可查看，不能修改。'));
    const scroll = body.querySelector<HTMLElement>('.playlist-edit-tracks')!;
    scroll.addEventListener('scroll', () => this.paintTracks(), { passive: true });
    scroll.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (!input.dataset.pick) return;
      const track = [...this.pages.values()].flatMap(page => page.tracks).find(track => track?.onlineSource?.id === input.dataset.pick);
      if (!track) return;
      if (input.checked && this.picked.size >= 50) { input.checked = false; this.status('每次最多选择 50 首歌曲。'); return; }
      input.checked ? this.picked.set(input.dataset.pick, track) : this.picked.delete(input.dataset.pick);
      const remove = body.querySelector<HTMLButtonElement>('[data-remove]'); if (remove) remove.disabled = !this.picked.size;
      const count = body.querySelector('[data-selected-count]'); if (count) count.textContent = this.picked.size ? `(${this.picked.size})` : '';
    });
    this.paintTracks();
  }
  private showPlaylist(playlist: NeteasePlaylist) {
    this.selected = playlist; this.pages.clear(); this.pending.clear(); this.picked.clear(); this.render();
  }
  private paintTracks() {
    const scroll = this.dialog?.querySelector<HTMLElement>('.playlist-edit-tracks'), playlist = this.selected;
    if (!scroll || !playlist) return;
    const first = Math.max(0, Math.floor(scroll.scrollTop / 52) - 3), last = Math.min(playlist.trackCount, first + 20);
    const window = scroll.querySelector<HTMLElement>('.playlist-edit-window')!;
    window.style.height = `${playlist.trackCount * 52}px`;
    const editable = playlist.owned && this.caps?.remove;
    window.innerHTML = Array.from({ length: Math.max(0, last - first) }, (_, index) => {
      const position = first + index, offset = Math.floor(position / 50) * 50;
      const loaded = this.pages.get(offset), track = loaded?.tracks[position % 50];
      if (!loaded && !this.pending.has(offset)) void this.loadPage(playlist, offset);
      return `<label class="playlist-edit-track" style="top:${position * 52}px">${editable ? `<input type="checkbox" data-pick="${esc(track?.onlineSource?.id || '')}" aria-label="选择 ${esc(track?.title || String(position + 1))}" ${this.busy || !track ? 'disabled' : ''} ${track && this.picked.has(track.onlineSource!.id) ? 'checked' : ''}>` : ''}<small>${position + 1}</small><span><strong>${esc(track?.title || (loaded ? '歌曲不可用' : '正在读取…'))}</strong><small>${esc(track?.artist || '')}</small></span></label>`;
    }).join('') || '<p>这个歌单还没有歌曲，可从搜索结果添加。</p>';
  }
  private async loadPage(playlist: NeteasePlaylist, offset: number) {
    const epoch = this.epoch; this.pending.add(offset);
    try {
      const page = await this.request<Page>(`playlists/${encodeURIComponent(playlist.id)}/tracks?offset=${offset}`);
      if (epoch !== this.epoch || this.selected !== playlist) return;
      playlist.trackCount = page.total; this.pages.set(offset, page);
      while (this.pages.size > 8) this.pages.delete(this.pages.keys().next().value!);
      this.paintTracks();
    } catch (error) { if (epoch === this.epoch && this.selected === playlist) this.status((error as Error).message); }
    finally { if (epoch === this.epoch && this.selected === playlist) this.pending.delete(offset); }
  }
  private confirm(action: 'remove' | 'delete') {
    if (action === 'remove' && !this.picked.size) return;
    this.dialog?.querySelector('.playlist-confirm')?.remove();
    this.dialog?.querySelector('.playlist-edit-tools')?.insertAdjacentHTML('afterend', `<div class="playlist-confirm" role="alert"><p>${action === 'delete' ? '删除整个歌单及其歌曲列表？此操作会同步到音乐平台。' : `从歌单中移除所选的 ${this.picked.size} 首歌曲？歌曲本身不会被删除。`}</p><button type="button" data-cancel-confirm>取消</button><button type="button" class="playlist-danger" data-confirm="${action}">确认${action === 'delete' ? '删除歌单' : '移除'}</button></div>`);
  }
  private async write(action: Action, values: object) {
    if (this.busy || !this.caps?.[action]) return;
    this.busy = true; const epoch = this.epoch, selectedId = this.selected?.id;
    this.dialog?.setAttribute('aria-busy', 'true');
    this.dialog?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => node.disabled = true);
    this.status('正在保存…');
    let saved = false;
    try {
      const result = await this.request<{ message: string }>('playlist-management', { ...values, action, session: this.caps.session });
      if (epoch !== this.epoch) return;
      saved = true; this.notify(result.message);
      if (action === 'create') this.createDraft = '';
      await this.changed();
      if (epoch !== this.epoch) return;
      await this.loadPlaylists();
      if (epoch !== this.epoch) return;
      this.selected = action === 'delete' ? undefined : this.playlists.find(item => item.id === selectedId);
      this.pages.clear(); this.pending.clear(); this.picked.clear();
      this.busy = false; this.render(); this.status(result.message);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.status(saved ? '修改已提交，但刷新失败。请关闭后重新打开歌单核对。' : `${(error as Error).message} 若连接中断，请先刷新歌单核对结果，避免重复提交。`);
    } finally {
      if (epoch === this.epoch) {
        this.busy = false; this.dialog?.removeAttribute('aria-busy');
        this.dialog?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => node.disabled = false);
        const rows = this.dialog?.querySelectorAll('.playlist-choice-row');
        rows?.[0]?.querySelector<HTMLButtonElement>('[data-direction="-1"]')?.setAttribute('disabled', '');
        rows?.[rows.length - 1]?.querySelector<HTMLButtonElement>('[data-direction="1"]')?.setAttribute('disabled', '');
        const remove = this.dialog?.querySelector<HTMLButtonElement>('[data-remove]'); if (remove) remove.disabled = !this.picked.size;
        this.paintTracks();
      }
    }
  }
}
