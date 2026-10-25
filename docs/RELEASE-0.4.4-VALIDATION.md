# 0.4.4 验证记录

验证日期：2026-10-25。代码基线：`544ecd2`。仅使用合成账号、120 首合成曲目、空歌单与静音 WAV；不读取私人曲库、登录会话或真实封面。

## 已执行的运行检查

- Edge / 真实 Three.js WebGL：1280×800、1440×900、1920×1080、1024×768。主标题、整体展示及我的歌单共用左边缘，误差小于 1 CSS 像素。
- 在歌曲详情、歌词、一起听三个开发版选项卡间切换：标题字体、位置和高度相同；播放按钮与加入歌单不重叠，操作栏位于选项卡上方。
- 连续真实滚轮事件，逐动画帧观察标题与当前曲目；没有已绘制的旧标题回跳。SONG 编号记录到独立运行的竖直滚动动画。
- 首页歌单名字、整体展示歌单标签主体均打开歌单详情；120 首曲目按每页 50 首分页，第二页从第 51 首开始。
- Windows 发布构建 / 原生 WebView2：以上四种视口和两个公开选项卡重复通过；362 个滚轮采样帧、两个歌单入口通过，托盘隐藏和通过托盘命令恢复通过。
- 原生任务栏歌词窗口：合成当前行到达独立窗口并显示，停止后隐藏；未以静态检查替代运行结果。
- 启动回归：日常启动不创建完整前奏，安装器首次启动显示完整前奏，设置关闭动画与手动重播入口保留。

浏览器与 Windows WebView2 本轮 UI 检查 `runtimeChecked=true`。本机 QA 图片与逐帧记录保留在忽略提交的 `artifacts/current-ux` 和 `artifacts/current-native-ux`。截图中没有私人账号与真实曲库。

## 构建与自动检查

已通过 TypeScript / Vite 生产构建、overview、rapid-wheel、windows、lyric-motion、online、gpu-budget 检查、`cargo test --locked`、Windows 原生 release 构建。

GitHub Actions `40179259264`：Windows x64 EXE 安装包与 macOS DMG 原生构建均成功。macOS 未做实机 UI、安装或播放检查，`runtimeChecked=false`；也不声明签名或公证完成。

公开安装包不包含受限的一起听 SDK，因此公开界面显示歌曲详情和歌词两个选项卡；三选项卡布局额外在开发构建验证。

## 本次来源与改动边界

继续使用已有 RhineLabUI / Rhine-Music-Demo 衍生的 Three.js 场景和 Tauri 宿主。本次直接修复本工程的布局、标题状态交接、数字动画、歌单入口、启动流程与更新器，未再引入另一套播放器底座。AMLL 是现有歌词依赖；SPlayer-Next / TaskbarLyrics 是此前任务栏设计参考，未在本次复制其整套实现。来源、版本与许可见 `third-party-notices.md`。
