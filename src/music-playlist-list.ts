/** One scroll surface for the full playlist; only nearby rows own DOM nodes. */
export class MusicPlaylistList {
  private frame = 0;
  private start = -1;
  private end = -1;
  private revision = -1;
  private resize: ResizeObserver;
  private readonly rowHeight = 52;
  constructor(private scroller: HTMLElement, private list: HTMLElement,
    private options: { count: () => number; revision: () => number;
      row: (position: number) => string; load: (first: number, last: number) => void;
      changed: () => void }) {
    list.classList.add('playlist-continuous-list');
    scroller.addEventListener('scroll', this.schedule, { passive: true });
    this.resize = new ResizeObserver(this.schedule); this.resize.observe(scroller);
    this.render();
  }
  private schedule = () => { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); };
  render() {
    const count = this.options.count();
    this.list.style.height = `${count * this.rowHeight}px`;
    const top = this.list.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
    const first = Math.max(0, Math.floor(-top / this.rowHeight) - 4);
    const start = Math.min(first, Math.max(0, count - 1));
    const end = Math.min(count, start + Math.ceil(this.scroller.clientHeight / this.rowHeight) + 9);
    const revision = this.options.revision();
    if (start !== this.start || end !== this.end || revision !== this.revision) {
      this.start = start; this.end = end; this.revision = revision;
      this.list.innerHTML = count ? Array.from({length: end - start}, (_, i) => {
        const position = start + i;
        return `<div class="playlist-continuous-row" style="top:${position * this.rowHeight}px">${this.options.row(position)}</div>`;
      }).join('') : '<p>这个歌单还没有歌曲。</p>';
      this.options.changed();
      if (end > start) this.options.load(start, end - 1);
    }
  }
  destroy() { cancelAnimationFrame(this.frame); this.resize.disconnect(); this.scroller.removeEventListener('scroll', this.schedule); }
}
