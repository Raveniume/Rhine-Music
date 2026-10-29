# Rhine Music · macOS

macOS 与 Windows 使用同一源码、锁文件和版本号。macOS 12 或更高版本；Apple Silicon 与 Intel 分别构建，不将单架构 Node 标为 Universal。

## 本机构建

安装官方 Node.js 22（22.12+）、Rust stable、Xcode Command Line Tools 后，在项目根目录执行：

```sh
npm ci
npm run desktop:build
```

相同命令在 Windows 生成原有便携目录，在 Mac 生成 ad-hoc 签名测试包：

```text
release/
  Rhine-Music-Windows/                         Windows 原有便携包
  Installers/                                 Windows 原有安装包
  macos-<version>-arm64-preview/                Apple Silicon 测试包
  macos-<version>-x64-preview/                  Intel 测试包
  macos-<version>-<arch>/                      Developer ID 正式候选包
```

Mac 输出包含 `.dmg`、`.sha256` 和 `verification.json`；`Rhine Music.app` 可在构建机直接启动。输出目录已存在时停止，避免覆盖已验收文件；重复构建前请将旧目录移走。

测试包**未经苹果公证**，不能保证在其他 Mac 下载后通过 Gatekeeper。它不会由 Windows 发布流程上传或提升为正式版本。不要通过关闭系统安全检查解决旧包的签名错误。

## 平台行为

- macOS 使用原生红黄绿窗口按钮和 Dock。关闭窗口可继续播放，点击 Dock 恢复；Command–Q 完整退出并关闭音乐服务。
- Windows 任务栏歌词在 Mac 对应菜单栏文字；无独立托盘图标，也不创建 Windows 播放控制浮窗。点击歌词可播放／暂停、切歌、恢复窗口和退出。关闭歌词后移除菜单栏项。菜单栏空间不足时，macOS 可能不展示全部项目。
- 设置使用“菜单栏歌词”“关闭窗口，继续播放”和“macOS 系统输出”。更新入口指向发布页，不下载或运行 Windows 安装器。
- 曲库由用户在设置中选择。应用数据位于 `~/Library/Application Support/local.rhine.music.macos/`，不写入应用包或曲库文件。
- macOS 登录凭据目前仅在本次进程内保存，退出后需重新扫码；Windows DPAPI 保存逻辑保持不变。未将凭据改为明文落盘。
- 自动画质下 Mac 三维渲染像素预算为 2,073,600，界面文字保持原生分辨率；手动画质不受此限制。歌词仅在内容变化时更新，隐藏窗口时暂停场景渲染，音频独立运行。实际帧率取决于设备、窗口尺寸及曲库。

## CI 与正式发布

`.github/workflows/build-macos.yml` 在 PR、版本标签或手动运行时分别构建 arm64/x64 测试包。它与 Windows 的 `release-desktop.yml`、`promote-desktop.yml` 独立，Mac 构建失败不阻止 Windows 发布。两个平台都执行共享版本校验。

本次实测范围与待验项目见 [Mac 验收记录](docs/MACOS-VALIDATION.md)。正式签名、公证和实机验收见 [macOS 发布规范](docs/MACOS-RELEASE.md)。Apple Developer Program 会员、Developer ID Application 证书及公证凭据就绪后：

```sh
export APPLE_SIGNING_IDENTITY='Developer ID Application: YOUR NAME (TEAMID)'
export RHINE_NOTARY_PROFILE='rhine-notary'
npm run release:macos
```

脚本先签名内嵌 Node 和原生依赖，再签名、公证 app 与 DMG，并验证 Gatekeeper。它不自动上传。通过实机验收的 Mac 附件可以添加到对应版本 Release，不替换 Windows 附件、不移动已公开标签。
