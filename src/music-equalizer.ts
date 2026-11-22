export const eqFrequencies = [80, 250, 1000, 4000, 10000] as const;
export const eqPresets = [
  { name: '平直', gains: [0, 0, 0, 0, 0] },
  { name: '人声', gains: [-2, -1, 2, 2, 0] },
  { name: '低音', gains: [4, 2, 0, 0, 0] },
  { name: 'WH-1000XM6 · 清晰', gains: [-3, -2, 1, 2, 1] },
  { name: 'AirPods Pro · 温暖', gains: [2, 1, 0, -1, -1] },
];
export interface EqualizerSettings { enabled: boolean; gains: number[] }
export function readEqualizer(value?: Partial<EqualizerSettings> | null): EqualizerSettings {
  return { enabled: value?.enabled === true, gains: eqFrequencies.map((_, i) => {
    const gain = value?.gains?.[i];
    return typeof gain === 'number' && Number.isFinite(gain) ? Math.max(-12, Math.min(12, Math.round(gain))) : 0;
  }) };
}

/** Owns only the audible connection. The analyser may share the input. */
export class EqualizerOutput {
  private headroom?: GainNode;
  private bands: BiquadFilterNode[] = [];
  private readonly context: BaseAudioContext;
  private readonly input: AudioNode;
  constructor(context: BaseAudioContext, input: AudioNode) {
    this.context = context; this.input = input;
    input.connect(context.destination);
  }
  configure(settings: EqualizerSettings) {
    if (!settings.enabled || !settings.gains.some(Boolean)) {
      if (this.headroom) {
        this.input.disconnect(this.headroom);
        this.clearFilters();
        this.input.connect(this.context.destination);
      }
      return;
    }
    if (!this.headroom) {
      const headroom = this.context.createGain();
      this.bands = eqFrequencies.map((frequency, i) => {
        const band = this.context.createBiquadFilter();
        band.type = i === 0 ? 'lowshelf' : i === eqFrequencies.length - 1 ? 'highshelf' : 'peaking';
        band.frequency.value = Math.min(frequency, this.context.sampleRate * .49);
        band.Q.value = 1;
        band.gain.value = settings.gains[i];
        return band;
      });
      this.bands.reduce<AudioNode>((node, band) => node.connect(band), headroom).connect(this.context.destination);
      headroom.gain.value = 10 ** (-Math.max(0, ...settings.gains) / 20);
      this.input.disconnect(this.context.destination);
      this.input.connect(headroom);
      this.headroom = headroom;
    } else {
      const time = this.context.currentTime;
      this.bands.forEach((band, i) => band.gain.setTargetAtTime(settings.gains[i], time, .014));
      this.headroom.gain.setTargetAtTime(10 ** (-Math.max(0, ...settings.gains) / 20), time, .014);
    }
  }
  private clearFilters() {
    this.headroom?.disconnect(); this.headroom = undefined;
    for (const band of this.bands) band.disconnect();
    this.bands = [];
  }
  dispose() { this.clearFilters(); }
}
