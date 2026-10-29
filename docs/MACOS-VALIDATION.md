# macOS 0.4.18 本地适配验收

日期：2026-10-30。环境：macOS 15.8.1、Apple Silicon arm64、官方 Node.js 22.23.4、Rust stable 1.99.1。源码来自 0.4.18 的 `219b4ac`，适配保存在独立分支 `codex/macos-dual-platform`；构建时精确提交、工作区状态和 DMG SHA-256 以输出目录的 `verification.json` 为准。

## 已完成

- 使用现有 npm/Cargo 锁文件构建 TypeScript、Vite、Tauri release app 和压缩 DMG；未更改依赖版本。
- app、内嵌 Node 及 Mach-O 依赖逐项签名；`codesign --verify --deep --strict` 与 `hdiutil verify` 通过。签名为 ad-hoc，**未公证**。
- 从只读挂载的 DMG 启动实际 app，使用临时数据目录和一首合成静音 WAV；音量 0%，播放进度前进。未用私人曲库或真实账号。
- 实机确认原生窗口控件、Mac 设置分类、207 万像素自动预算、关闭窗口后后台服务保留、重新激活后窗口恢复、Command–Q 退出后主程序/Node 消失且端口关闭。
- Rust 7 项通过，包括菜单栏标题可见性、Unicode 长度、空白整理及更新下载校验；平台测试 5 项通过；GPU 预算回归 14 项通过。
- Mac 桌面桥接 UI 测试通过：窗口控件、关闭提示、歌词开关与载荷、平台设置。这里原生 IPC 使用 mock。
- 更新 UI 回归通过：Windows 安装器路径与非 Windows 手动更新分支均为 mock，没有执行真实安装器。
- `check:windows` 的 4 项可在 Mac 运行的测试通过，包括本地服务目录/Host/Origin 边界、合成曲库和退出；Windows 原生程序检查跳过。

## 性能处理与边界

Mac 自动画质像素预算从共享默认 3,686,400 限制到 2,073,600；不降低 DOM 文字分辨率，保留手动画质、材质和动效选择。原生菜单栏仅在文字或可见状态变化时更新，队列最多保留一次待处理更新；窗口状态通知合并重复值，避免焦点/尺寸事件重复触发前端恢复。隐藏时沿用暂停三维绘制、音频继续运行的机制。

实机截取时界面显示约 12–16 FPS，但该观察受窗口焦点和自动化截图影响，未形成可重复的前后台基准；不能据此承诺流畅帧率或量化提速。大曲库、持续播放、Intel GPU、全屏/多显示器的性能仍需真实场景验收。

## 未完成与已知限制

- 未加入 Apple Developer Program；Developer ID、公证、Gatekeeper 下载隔离验收、干净测试用户安装尚未完成。`runtimeChecked` 保持 false，表示完整发布门槛未通过，并非完全没有本机启动测试。
- 菜单栏文字逻辑和 IPC 已测试，但系统菜单栏布局/刘海屏拥挤场景、真实在线歌词及菜单切歌尚未完成人工验收。
- Intel 包和 Windows 原生构建需各自 runner 执行；本地 Mac 不替代这些验收。新增 Mac CI 与原有 Windows 发布/提升工作流分离。
- 原有 `check:window-controls` 中独立逻辑测试通过 2 项、Windows 原生项跳过；其启动 UI 套件在未修改基线 `219b4ac` 也于 `check-startup-responsiveness-ui.mjs:116` 超时，不能计为通过。本次保留原脚本，不通过删断言掩盖失败。
- macOS 账号凭据仅保存在本次进程；未实现钥匙串持久化，不写明文。登录和在线平台未用真实账号测试。
- 目前是本地 preview，不代表已经上传 GitHub 或发布正式 Mac 版本。不得替换已发布 0.4.18 附件或移动原标签；正式修复发布应使用审阅后的新版本。
