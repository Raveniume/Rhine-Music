import { eqFrequencies, eqPresets, type EqualizerSettings } from './music-equalizer';

export const equalizerMarkup = `<button type="button" class="song-eq-button" popovertarget="song-eq-panel" aria-label="音效" title="音效"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h2m4 0h12"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></svg></button>
<section id="song-eq-panel" popover aria-label="音效"><header><strong>音效</strong><label>启用 <input type="checkbox"></label></header>
<select aria-label="均衡器预设">${eqPresets.map((p,i) => `<option value="${i}">${p.name}</option>`).join('')}<option value="-1" disabled>自定义</option></select>
${eqFrequencies.map((hz, i) => `<label class="eq-band"><span>${hz >= 1000 ? hz / 1000 + ' kHz' : hz + ' Hz'}</span><input type="range" min="-12" max="12" step="1" data-band="${i}" aria-label="${hz} Hz"><output></output></label>`).join('')}</section>`;

export function mountEqualizer(root: HTMLElement, settings: EqualizerSettings, change: (settings: EqualizerSettings) => void, signal: AbortSignal) {
  const panel = root.querySelector<HTMLElement>('#song-eq-panel')!;
  const button = root.querySelector<HTMLButtonElement>('.song-eq-button')!;
  const enabled = panel.querySelector<HTMLInputElement>('[type=checkbox]')!;
  const preset = panel.querySelector('select')!;
  const bands = [...panel.querySelectorAll<HTMLInputElement>('[data-band]')];
  function paint() {
    enabled.checked = settings.enabled;
    button.classList.toggle('active', settings.enabled);
    preset.value = String(eqPresets.findIndex(p => p.gains.every((v,i) => v === settings.gains[i])));
    bands.forEach((band, i) => {
      const value = settings.gains[i];
      band.value = String(value);
      const label = `${value > 0 ? '+' : ''}${value} dB`;
      band.setAttribute('aria-valuetext', label);
      band.nextElementSibling!.textContent = label;
    });
  }
  function position() {
    const rect = button.getBoundingClientRect();
    panel.style.right = Math.max(8, innerWidth - rect.right) + 'px';
    panel.style.bottom = Math.max(8, innerHeight - rect.top + 6) + 'px';
  }
  panel.addEventListener('beforetoggle', position, {signal});
  window.addEventListener('resize', () => { if (panel.matches(':popover-open')) position(); }, {signal});
  panel.addEventListener('input', event => {
    const target = event.target;
    if (target === enabled) settings = {...settings, enabled: enabled.checked};
    else if (target === preset) settings = {enabled: true, gains: [...eqPresets[Number(preset.value)].gains]};
    else if (target instanceof HTMLInputElement && bands.includes(target)) {
      const gains = [...settings.gains]; gains[Number(target.dataset.band)] = Number(target.value);
      settings = {enabled: true, gains};
    } else return;
    change(settings); paint();
  }, {signal});
  panel.addEventListener('keydown', event => event.stopPropagation(), {signal});
  paint();
}
