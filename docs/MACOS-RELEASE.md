# macOS 发布接手规范

## 2026-10-30 双端构建补充

已添加 macOS 平台配置、菜单栏歌词、原生窗口按钮、Dock 恢复和独立 CI。构建入口及目录布局见 [README.macos.md](../README.macos.md)。`npm run desktop:build` 在 Mac 生成明确标记的未公证 preview；`npm run release:macos` 仍要求 Developer ID 和公证配置，保留下述正式发布门槛。Mac 的内嵌 Node 现为 `runtime/node`，下方 `node.exe` 路径仅用于诊断历史包。

没有 Apple Developer Program 会员时，无法完成 Developer ID 正式签发。开通后在 Apple Developer 的 Certificates 创建 **Developer ID Application**（本项目不需要 Installer 证书），提交本机 CSR，下载 `.cer` 并与原私钥导入登录钥匙串。公证凭据通过 `xcrun notarytool store-credentials rhine-notary` 交互保存，密码不写入脚本、仓库或聊天。

本机可先用 `security find-identity -v -p codesigning` 检查身份。证书、公钥请求和私钥不要存放在仓库；只有构建脚本与非敏感的配置示例进入版本控制。Apple 官方步骤：[创建 Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)、[公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。

## 历史问题与正式发布要求

2026-10-28：用户反馈旧 DMG 提示“Rhine Music 已损坏”。现有 CI 只运行了 Tauri 打包，未配置 Developer ID、公证或 Gatekeeper 验收，内嵌 Node 也没有独立的签名步骤。Windows 无法读取该 Mac 的签名诊断，因此这只是已确认的发布流程缺口，不是已经证明的唯一故障原因。**旧 Mac 包不能视为验收通过；从 0.4.14 起暂停自动附带 Mac DMG。** Windows 发布继续独立进行，旧标签与附件保留。

## 先诊断用户下载的旧包

保留原 DMG，核对 Release 的 SHA-256，然后在 Mac 执行（按实际安装位置调整路径）：

```sh
shasum -a 256 ~/Downloads/Rhine-Music-macOS-0.4.13.dmg
codesign --verify --deep --strict --verbose=4 '/Applications/Rhine Music.app'
codesign -d --verbose=4 '/Applications/Rhine Music.app'
spctl --assess --type execute --verbose=4 '/Applications/Rhine Music.app'
xcrun stapler validate '/Applications/Rhine Music.app'
file '/Applications/Rhine Music.app/Contents/MacOS/'*
file '/Applications/Rhine Music.app/Contents/Resources/runtime/node.exe'
```

记录完整错误及 macOS、CPU 架构、下载来源。签名无效时不要只对最外层 app 重签；先检查内嵌可执行文件及打包后修改。缺少票据与资源签名损坏要分别记录。不要把关闭 Gatekeeper、删除隔离属性或要求用户绕过安全提示写成正式安装步骤。

## 在 Mac 构建候选包

使用当前发布标签或审阅后的独立分支、Node.js 22、Rust stable、Xcode Command Line Tools。保持锁文件。安装维护者自己的 **Developer ID Application** 证书到钥匙串，用 `xcrun notarytool store-credentials` 交互保存公证凭据；不要把密码、p12、私钥或凭据日志提交到仓库。脚本只接收签名标识和钥匙串配置名称。

```sh
security find-identity -v -p codesigning
export APPLE_SIGNING_IDENTITY='Developer ID Application: YOUR NAME (TEAMID)'
export RHINE_NOTARY_PROFILE='rhine-notary'
node scripts/release-macos.mjs
```

脚本先打包公开运行时，再给内嵌 Node 添加 hardened runtime / JIT 签名，最后封装签名 app。随后公证并附加 app 票据、制作 DMG、公证并附加 DMG 票据，严格验证签名及 Gatekeeper。任何一步失败都会停止，不发布附件。输出按版本和架构命名；已有目录不会覆盖。`verification.json` 的 `runtimeChecked` 默认为 false。

本次已在 Apple Silicon Mac 完成 preview 构建、嵌套代码签名验证和合成曲库启动测试；Developer ID、公证与干净机器下载验收仍未完成。先单独发布 arm64 或 x64，架构写入文件名；不能将单架构 Node 塞入所谓 universal 包。没有 Developer ID / 公证条件时，preview 仅用于本地测试，不宣称下载后可直接安装，不作为正式发布附件。

## 实机发布门槛

1. 将候选 DMG 放入草稿 Release，通过浏览器重新下载到干净 Mac 或独立测试用户，使下载保留系统正常的隔离属性。校验 SHA-256，双击安装到 Applications，不修改安全设置。
2. 首次启动、退出、重启均成功；内嵌 Node 正常启动，离线下可用本地合成曲库。测试零音量播放、搜索详情定位、主题、启动动画、窗口恢复、歌词及快捷键。不得因为 Windows 已验收就标记 Mac 成功。
3. 核查平台差异：任务栏歌词与 Windows 托盘不应在 Mac 假装可用；账号凭据要落实钥匙串或现有安全存储，未完成的平台功能应隐藏或明确标注。当前 Windows 自动安装更新链路不适用于 Mac；Mac 只提供发布页手动下载入口。
4. 记录系统版本、CPU、精确 commit、DMG 哈希、签名 Team ID、公证结果和实测范围；在单独验收记录中设置 runtimeChecked=true。失败项修复后重新签名、公证、下载验收，不能修改已签名包的内容。
5. 检查 LICENSE / NOTICE / 第三方许可齐全，不包含私人索引、账号、封面缓存、FFmpeg 或未获再分发许可的 SDK。附件只上传通过验收的架构 DMG、sha256 和可公开的验收说明。保留旧标签，不覆盖同名已发布附件；修复包使用新版本。

Windows 与 Mac 可以独立发布；Mac 附件增加到同版本 Release 前必须满足上述门槛。发布工作流不再要求 Mac 包存在，也不会自动把未签名 DMG 提升为正式资产。

参考：[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Apple 嵌套代码签名](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)、[Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/)。
