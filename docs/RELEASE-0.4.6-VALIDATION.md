# 0.4.6 交付验证

日期：2026-10-26。源分支为 `codex/desktop-ux-about-updater`，版本为 `0.4.6`。

## 构建与静态检查

- `npm run build` 通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` 通过，任务栏几何测试 2/2。
- `npm run check:windows` 通过，5/5。
- `npm run check:gpu-budget` 通过，14/14。
- `git diff --check` 通过。

## Windows 原生 WebView2 检查

- `scripts/check-release-ux.mjs` 使用新生成的 `release/Rhine-Music-Windows/Rhine Music.exe` 运行通过。
- 检查了 1280×800、1440×900、1920×1080、1024×768 四种窗口尺寸。
- 检查首页布局、歌单入口、50 首分页、歌单歌曲进入统一歌曲详情页、详情/歌词/一起听页签、滚轮切歌无旧标题回闪、SONG 编号滚动动画、托盘隐藏恢复和完整启动动画。
- 使用隔离 WebView2 配置、合成账号/曲目/歌词和静音合成音频；未读取私人账号、私人曲库或真实音频。
- `runtimeChecked=true`。

## Windows 任务栏歌词

- `npm run check:taskbar:desktop` 使用同一份 0.4.6 便携包运行通过。
- 合成歌词能进入独立任务栏 WebView 并显示，原生窗口实际尺寸约 `542×57`，位置为 `x=180, y=1556`；停止播放后窗口自动隐藏。
- 任务栏窗口不注入 Explorer，更新只传递当前行和下一行有限状态。

## 发布边界

- 本机已生成 0.4.6 Windows 便携包；本机未安装 NSIS，因此 Windows 安装 EXE 与 macOS DMG 由 GitHub Actions Release 工作流构建。
- macOS 未在本机实机运行，需以 Release CI 的 macOS 构建结果为准。
- 软件内更新闭环沿用 GitHub Release 安装包和 SHA-256 校验；待 `v0.4.6` Release 资产生成后，再从已安装 0.4.5 的“关于 → 检查更新”执行覆盖安装验证。
