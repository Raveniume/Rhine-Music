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

  constructor(host: HTMLElement, seek: SeekHandler) {
    this.host = host;
    this.seek = seek;
    this.player = new LyricPlayer();
    this.player.setEnableBlur(true);
    this.player.setEnableScale(true);
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.player.setEnableSpring(!this.reducedMotion);
    this.player.setOverscanPx(420);
    this.player.setWordFadeWidth(0.5);
    this.player.addEventListener("line-click", event => {
      const line = (event as CustomEvent & { line?: { startTime?: number } }).line;
      if (line && Number.isFinite(line.startTime)) this.seek(Math.max(0, Number(line.startTime) / 1000));
    });
    host.replaceChildren(this.player.getElement());
    host.classList.add("amll-lyrics-host");
  }

  setDocument(document: LyricDocument, key: string, time: number) {
    if (this.disposed || key === this.documentKey) return;
    this.documentKey = key;
    const lines = document.lines.map(line => ({
      ...line,
      words: line.words.length ? line.words : [{ startTime: line.startTime, endTime: line.endTime, word: "" }],
    })) as LyricLine[];
    this.player.setLyricLines(lines, Math.max(0, time) * 1000);
    this.player.update(0);
  }

  setTime(time: number, playing: boolean, isSeek = false) {
    if (this.disposed) return;
    this.clockTime = Math.max(0, Number.isFinite(time) ? time : 0);
    this.clockAt = performance.now();
    this.playing = playing;
    this.player.setCurrentTime(this.clockTime * 1000, isSeek);
    if (playing) this.player.resume(); else this.player.pause();
    if (this.visible && !this.reducedMotion) this.start();
    else if (!playing) this.stop();
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (visible) {
      if (this.playing) this.player.resume();
      else this.player.pause();
      if (!this.reducedMotion) this.start();
      else this.player.update(0);
    } else {
      this.player.pause();
      this.stop();
    }
  }

  setReducedMotion(reduced: boolean) {
    if (this.disposed || this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    this.player.setEnableSpring(!reduced);
    if (reduced) { this.stop(); this.player.update(0); }
    else if (this.visible) this.start();
  }

  reset() {
    this.documentKey = "";
    this.player.setLyricLines([], 0);
    this.player.update(0);
  }

  private start() {
    if (this.frame || this.disposed || !this.visible || this.reducedMotion) return;
    this.lastFrame = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const delta = Math.min(100, Math.max(0, now - this.lastFrame));
      this.lastFrame = now;
      if (this.playing) this.player.setCurrentTime((this.clockTime + (now - this.clockAt) / 1000) * 1000);
      this.player.update(delta);
      this.frame = requestAnimationFrame(tick);
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
    this.player.dispose();
    this.host.replaceChildren();
    this.host.classList.remove("amll-lyrics-host");
  }
}

