declare global {
  interface Window { __RHINE_PLATFORM__?: string }
}

// The native host supplies the platform before the page loads; a browser's
// user agent must not enable desktop-only controls.
export const isMacDesktop = () => typeof window !== 'undefined' && window.__RHINE_PLATFORM__ === 'macos';
export const desktopLyricsLabel = () => isMacDesktop() ? '菜单栏歌词' : '任务栏歌词';
export const backgroundCloseLabel = () => isMacDesktop() ? '关闭窗口，继续播放' : '最小化到托盘';
export const desktopSystemName = () => isMacDesktop() ? 'macOS' : 'Windows';
