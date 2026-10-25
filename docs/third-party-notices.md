# RhineMusic 第三方组件说明

本文件记录当前源码树中直接使用、构建或明确参考的第三方项目。版本以锁文件和源码中的固定提交为准；未列入的间接依赖仍按其随包许可证履行义务。

## 直接使用

| 组件 | 版本／来源 | 用途 | 许可证与随包文本 |
| --- | --- | --- | --- |
| Apple Music Like Lyrics Core | `@applemusic-like-lyrics/core` 0.6.0 | DOM 逐词歌词渲染、滚动与动画 | AGPL-3.0-only，见 npm 包中的 `LICENSE` |
| Apple Music Like Lyrics Lyric | `@applemusic-like-lyrics/lyric` 1.1.0 | LRC、QRC、YRC 解析 | AGPL-3.0-only，见 npm 包中的 `LICENSE` |
| Apple Music Like Lyrics TTML | `@applemusic-like-lyrics/ttml` 1.0.1 | TTML 解析支持 | AGPL-3.0-only，见 npm 包中的 `LICENSE` |
| Three.js | `three` 0.183.x | 三维档案架渲染 | MIT，完整文本位于 `public/licenses/three.txt` |
| Tauri | `@tauri-apps/api` / `tauri` 2.12.1 | Windows、macOS 桌面宿主 | MIT 或 Apache-2.0，按各自随包 LICENSE / NOTICE |
| NeteaseCloudMusicApi | 4.32.0 | 网易云协议适配、二维码登录、搜索、歌单、播放和歌词 | MIT，完整文本位于 `third-party/NETEASE-API-LICENSE.txt` |

AMLL 组件以源码依赖方式接入；播放器只向组件传递脱敏后的 `LyricDocument`，不分发歌曲、账号、歌词缓存或真实封面。由于 AMLL 组件采用 AGPL-3.0-only，本工程的可交付代码按 AGPL-3.0-only 发布；原有上游 MIT 代码和署名仍保留，见根目录 `LICENSE` 与 `NOTICE.md`。

## 参考而未直接复制

- SPlayer-Next：仅参考任务栏歌词、系统媒体控制和同步策略；当前仓库没有把其 Rust 源码作为依赖或复制进发布包。
- ANYNC/TaskbarLyrics：仅参考任务栏位置、缓存和避让思路；不引入其 WPF/WebView2 宿主。
- ncm-api-rs：尚未通过来源、许可证、构建和接口兼容审计，当前未进入依赖树，也不参与发布构建。
- RhineLabUI、Rhine-Music-Demo、rhine-lab-music：保留原有源码来源和 MIT 署名；只使用本仓库已具备的三维场景和交互实现，不复制未获分发许可的模型、标志、字体或视频素材。

## 内容与平台边界

网易云音乐的歌曲、封面、歌词、账号数据和接口权限不由上述代码许可证授予。登录仅在本机通过用户主动扫码完成；会话由本地服务使用 Windows DPAPI 等平台机制保存，渲染进程不能读取 `MUSIC_U` 或 Cookie。公开包不包含私人曲库、真实封面缓存、二维码、日志或账号配置。

发布前应把本文件、对应许可证原文和 `NOTICE.md` 一并放入源码与安装包的许可目录。维护者联系方式为 `GitHub Issues`。
