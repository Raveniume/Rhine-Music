import { LyricPlayer, type LyricLine } from "@applemusic-like-lyrics/core";
import "@applemusic-like-lyrics/core/style.css";
import type { LyricDocument } from "./music-lyrics";

type SeekHandler = (seconds: number) => void;

/** Lightweight DOM binding for AMLL. Audio state remains owned by MusicPlayer. */
export class AmlLyricSurface {
  private readonly player: LyricPlayer;
  private readonly host: HTMLElement;
  private readonly seek: SeekHandler;
  private frame = 0;
  private lastFrame = 0;
  private clockTime = 0;
  private clockAt = 0;
  private playing = false;
  private disposed = false;
  private visible = false;
  private reducedMotion = false;
  private documentKey = "";
  private seekTimes: number[] = [];
  private settleUntil = 0;
  private readonly events = new AbortController();

  constructor(host: HTMLElement, seek: SeekHandler) {
    this.host = host;
    this.seek = seek;
    this.player = new LyricPlayer();
    // Keep AMLL's complete Apple Music style renderer enabled.  The renderer
    // owns line springs, scale hierarchy, blur falloff, gradient word masks,
    // interlude dots and background vocal placement; this wrapper only feeds it
    // the clock and the parsed lyric document.
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.player.setEnableBlur(!this.reducedMotion);
    this.player.setEnableSpring(!this.reducedMotion);
    this.player.setEnableScale(!this.reducedMotion);
    this.player.setAlwaysPostpositionBackground(true);
    this.player.setHidePassedLines(false);
    this.player.setEnableAutoSeekDetection(true);
    this.player.setLyricProcessConfig({ optimizeOptions: {
      normalizeSpaces: false,
      resetLineTimestamps: false,
      syncMainAndBackgroundLines: true,
      cleanUnintentionalOverlaps: true,
      tryAdvanceStartTime: true,
    } });
    this.player.setAlignPosition(0.35);
    this.player.setOverscanPx(240);
    // Use the upstream iPad-style mask: a defined leading edge with a soft fade.
    this.player.setWordFadeWidth(0.5);
    this.player.addEventListener("line-click", event => {
      // AMLL moves the visual line start earlier for its entrance animation.
      // Audio seeking must use the unmodified source timestamp.
      const time = this.seekTimes[(event as Event & { lineIndex: number }).lineIndex];
      if (Number.isFinite(time)) this.seek(Math.max(0, time / 1000));
    });
    host.replaceChildren(this.player.getElement());
    host.classList.add("amll-lyrics-host");
    host.ownerDocument.addEventListener('visibilitychange', () => this.syncVisibility(), { signal: this.events.signal });
    // Paused lyrics still respond to scrolling, then return to an idle clock.
    for (const event of ['wheel', 'pointerdown', 'pointermove', 'keydown']) {
      host.addEventListener(event, () => { this.settleUntil = performance.now() + 1200; if (!this.reducedMotion) this.start(); }, { signal: this.events.signal, passive: true });
    }
  }

  setDocument(document: LyricDocument, key: string, time: number) {
    if (this.disposed || key === this.documentKey) return;
    this.documentKey = key;
    this.seekTimes = document.lines.map(line => line.startTime);
    const lines = document.lines.map(line => ({
      ...line,
      words: line.words.length ? line.words.map(word => ({ ...word })) : [{ startTime: line.startTime, endTime: line.endTime, word: "" }],
    })) as LyricLine[];
    this.player.setLyricLines(lines, Math.max(0, time) * 1000);
    this.player.update(0);
    this.settleUntil = performance.now() + 1200;
  }

  setTime(time: number, playing: boolean, isSeek = false) {
    if (this.disposed) return;
    const now = performance.now(), next = Math.max(0, Number.isFinite(time) ? time : 0);
    const changed = next !== this.clockTime || playing !== this.playing || isSeek;
    if (!changed) return;
    const jump = isSeek || Math.abs(next - this.currentTime(now)) > 0.5;
    const transportChanged = playing !== this.playing;
    this.clockTime = next;
    this.clockAt = now;
    this.playing = playing;
    if (!this.canRender()) { this.player.pause(); this.stop(); return; }
    this.player.setCurrentTime(next * 1000, jump);
    // resume walks all lines and restarts Web Animations. Only do it on an
    // actual transport change, not on each audio timeupdate.
    if (transportChanged) { if (playing) this.player.resume(); else this.player.pause(); }
    if (!playing) this.settleUntil = now + 1200;
    if (this.reducedMotion) { this.player.update(0); this.stop(); }
    else this.start();
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.syncVisibility();
  }

  private canRender() { return this.visible && this.host.isConnected && !this.host.ownerDocument.hidden; }
  private currentTime(now = performance.now()) { return this.clockTime + (this.playing ? Math.max(0, now - this.clockAt) / 1000 : 0); }
  private syncVisibility() {
    if (this.canRender()) {
      this.player.setCurrentTime(this.currentTime() * 1000, true);
      if (this.playing) this.player.resume();
      else this.player.pause();
      this.settleUntil = performance.now() + 1200;
      if (!this.reducedMotion) this.start(); else this.player.update(0);
    } else {
      this.player.pause();
      this.stop();
    }
  }

  setReducedMotion(reduced: boolean) {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    this.player.setEnableSpring(!reduced);
    this.player.setEnableScale(!reduced);
    this.settleUntil = performance.now() + (reduced ? 0 : 1200);
    this.player.setEnableBlur(!reduced);
    if (this.canRender()) {
      this.player.update(0);
      if (!reduced) this.start(); else this.stop();
    }
  }

  reset() {
    this.stop();
    this.documentKey = "";
    this.player.setLyricLines([], 0);
    this.player.update(0);
  }

  private start() {
    if (this.frame || this.disposed || !this.canRender()) return;
    this.lastFrame = performance.now();
    const tick = (now: number) => {
      this.frame = 0;
      if (this.disposed || !this.canRender()) return;
      if (now - this.lastFrame < 1000 / 60 - 1) { this.frame = requestAnimationFrame(tick); return; }
      const delta = Math.min(100, Math.max(0, now - this.lastFrame));
      this.lastFrame = now;
      if (this.playing) this.player.setCurrentTime(this.currentTime(now) * 1000);
      this.player.update(this.reducedMotion ? 0 : delta);
      if (this.playing || now < this.settleUntil) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.events.abort();
    this.player.dispose();
    this.host.replaceChildren();
    this.host.classList.remove("amll-lyrics-host");
  }
}

