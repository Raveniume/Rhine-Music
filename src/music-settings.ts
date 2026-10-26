import './music-settings.css';

export const settingsCategories = {
  local: '音乐库',
  playback: '播放与音频',
  lyrics: '歌词与频谱',
  appearance: '外观与动效',
  desktop: '桌面与托盘',
  shortcuts: '快捷键',
  display: '画质与性能',
  developer: '高级与诊断',
  about: '关于',
} as const;
export type SettingsCategory = keyof typeof settingsCategories;
export function settingsNavigation() {
  return `<nav class="settings-navigation" aria-label="设置分类">${Object.entries(settingsCategories).map(([key, label]) => `<button type="button" data-action="settings-category" data-category="${key}">${label}</button>`).join('')}</nav>`;
}
// Move existing controls rather than recreating them when changing categories.
// Pending metadata jobs and the original control listeners keep their DOM nodes.
export function groupSettingsContent(body: HTMLElement) {
  const controls = [...body.children] as HTMLElement[];
  for (const [key, label] of Object.entries(settingsCategories)) {
    const page = document.createElement('section');
    page.id = `settings-page-${key}`;
    page.className = 'settings-page';
    page.dataset.settingsPage = key;
    page.setAttribute('aria-labelledby', `settings-heading-${key}`);
    page.innerHTML = `<h2 id="settings-heading-${key}" tabindex="-1">${label}</h2>`;
    for (const control of controls) if (control.dataset.settingsGroup === key) page.append(control);
    body.append(page);
  }
}
export function selectSettingsCategory(root: HTMLElement, category: SettingsCategory) {
  root.querySelectorAll<HTMLElement>('[data-settings-page]').forEach(page => { page.hidden = page.dataset.settingsPage !== category; });
  root.querySelectorAll<HTMLElement>('[data-action="settings-category"]').forEach(button => {
    const selected = button.dataset.category === category;
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  root.querySelector('#panel-body')?.scrollTo({ top: 0 });
}
