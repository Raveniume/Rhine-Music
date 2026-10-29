import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isMacDesktop, desktopLyricsLabel, backgroundCloseLabel, desktopSystemName } from '../src/desktop-platform.ts';
import { automaticQuality } from '../src/automatic-quality.ts';
import { qualityPresets, renderDimensions } from '../src/render-quality.ts';

test('native macOS host selects menu-bar lyrics and background-window wording', () => {
  globalThis.window = { __RHINE_PLATFORM__: 'macos' };
  assert.equal(isMacDesktop(), true);
  assert.equal(desktopLyricsLabel(), '菜单栏歌词');
  assert.equal(backgroundCloseLabel(), '关闭窗口，继续播放');
  assert.equal(desktopSystemName(), 'macOS');
});
test('Windows retains taskbar, tray, and system-output terminology', () => {
  globalThis.window = { __RHINE_PLATFORM__: 'windows' };
  assert.equal(isMacDesktop(), false);
  assert.equal(desktopLyricsLabel(), '任务栏歌词');
  assert.equal(backgroundCloseLabel(), '最小化到托盘');
  assert.equal(desktopSystemName(), 'Windows');
});
test('plain browser does not impersonate a native Mac host', () => {
  globalThis.window = {};
  assert.equal(isMacDesktop(), false);
  delete globalThis.window;
  assert.equal(isMacDesktop(), false);
});
test('both desktop packages share the locked version', () => {
  execFileSync(process.execPath, ['scripts/check-desktop-version.mjs']);
});
test('Retina automatic Mac rendering bounds pixels without changing Windows or manual presets', () => {
  const device = { renderer: 'Apple M1', unmasked: true, cores: 8, nativePixels: 5120 * 2880 };
  const mac = automaticQuality({ ...device, platform: 'macos' });
  const windows = automaticQuality({ ...device, platform: 'windows' });
  assert.equal(mac.quality.pixelBudget, 2_073_600);
  assert.equal(windows.quality.pixelBudget, qualityPresets.balanced.pixelBudget);
  assert.equal(mac.quality.antialias, qualityPresets.balanced.antialias);
  assert.equal(mac.quality.depthOfField, qualityPresets.balanced.depthOfField);
  assert.equal(qualityPresets.balanced.pixelBudget, 3_686_400);
  const dimensions = renderDimensions(mac.quality, 2560, 1440, 1, 2, 16384);
  assert.ok(dimensions.width * dimensions.height <= 2_073_600 + 5000);
});
