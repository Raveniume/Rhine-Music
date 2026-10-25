# 0.4.5 交付验证

日期：2026-10-25。应用源提交 `56fb280`。本版补齐手动完整开场，包含 0.4.4 的首页对齐、切歌标题、编号滚动、详情布局、歌单详情、启动分流和更新器修复。之前的验证与失败记录见 [0.4.4 记录](RELEASE-0.4.4-VALIDATION.md)。

## 运行与视觉检查

- TypeScript / Vite 生产构建及 Windows `tauri build --no-bundle -- --locked` 通过。
- 启动响应性、减少动态效果、首屏加载失败恢复、设置可达性回归通过。
- 浏览器真实 WebGL 回归通过：四种窗口尺寸、三个开发版选项卡、两个歌单入口、50 首分页、滚轮逐帧标题与 SONG 滚动检查。
- Windows 发布构建原生 WebView2 回归通过：四种窗口尺寸，两个公开版选项卡，378 个滚轮采样帧，两个歌单入口及分页，托盘隐藏和恢复。
- 原生手动完整开场实际运行到白色开场的图形/文字阶段并截图，跳过后进入音乐前奏，再次跳过后回到档案架；不再仅检查空白遮罩或按钮存在。
- 采用独立测试账号、曲库目录、WebView2 配置与静音合成音频；未使用私人账号和曲库。

以上范围 `runtimeChecked=true`。macOS 安装与 UI 实机验证未执行，`runtimeChecked=false`。

## 证据与复现

当前本机证据：`artifacts/current-ux`、`artifacts/current-native-ux`，均在版本控制忽略范围，不把运行日志或测试配置写进公开包。

浏览器：`node scripts/check-release-ux.mjs`。Windows 原生：先关闭其他 RhineMusic，将环境变量 `RHINE_DESKTOP_EXE` 设置为待测可执行文件，再运行同一命令。原生脚本会自动创建隔离测试目录，不读取默认用户配置。

来源与许可继续见 [第三方声明](third-party-notices.md)：场景沿用 RhineLabUI / Rhine-Music-Demo 衍生实现，本次修复均在现有 Tauri / Three.js 工程内完成；AMLL 保持现有集成，SPlayer-Next / TaskbarLyrics 仍属于设计参考。
