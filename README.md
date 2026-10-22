# DING with Widgets

在 Ubuntu/GNOME 桌面图标扩展 DING 的基础上，加入可移动、可缩放、可持久保存的中文桌面小组件。

本项目是 [`rastersoft/desktop-icons-ng`](https://gitlab.com/rastersoft/desktop-icons-ng) 的非官方衍生版本，并参考了 [`smedius/desktop-icons-ng`](https://gitlab.com/smedius/desktop-icons-ng) 的 GTK4 Widget 架构思路。它不是 GNOME、Canonical、Apple 或上述上游项目的官方产品。

## 1.2.0 正式版

1.2.0 将系统监控重新设计为单一紧凑布局：CPU 与 GPU 使用大圆环，内存与磁盘并排显示容量，网络区显示上下行速度和曲线。取消系统监控的尺寸选择，旧尺寸设置会自动迁移；辅助文字、容量和速度信息也经过放大和重新对齐。

其他 Widget、系统监控的数据采集与设备选择、多屏幕物理身份记录、跨屏幕拖动及桌面图标功能均保持不变。详细内容见 [`RELEASE_NOTES_1.2.0.md`](RELEASE_NOTES_1.2.0.md)；此前版本说明仍可参阅 [`RELEASE_NOTES_1.0.1.md`](RELEASE_NOTES_1.0.1.md) 和 [`RELEASE_NOTES_1.0.0.md`](RELEASE_NOTES_1.0.0.md)。

## 主要功能

- 支持 GNOME Shell 50、51 和 Wayland。
- 保留 DING 的桌面图标、自由排列、拖放和右键菜单等功能。
- 内置八个统一视觉风格的中文 Widget：便笺、世界时钟、日历、天气、设备电量、照片、音乐播放器、系统监控。
- Widget 可在同一屏幕或不同屏幕之间直接拖动，并记录所属屏幕、位置和尺寸。
- 外接屏幕断开时，位于副屏的 Widget 会临时显示在主屏；同一块副屏接回后恢复原归属和位置。
- 四边和四角均可缩放；拖动与缩放感应区平时保持透明。
- 登录、重启 DING、睡眠与唤醒后恢复 Widget 的内容、设置、位置和尺寸。
- 便笺支持标题、富文本、字体、字号、颜色、Checklist 与透明度。
- 世界时钟通过城市名搜索地点，可显示多个城市，支持数显、表显与 12/24 小时制；表显钟面随系统深浅色主题自动切换。
- 日历支持翻月、农历、传统节日、二十四节气和中国大陆休假/补班信息。
- 天气支持三种尺寸、城市搜索、当前天气、逐小时天气、体感温度、湿度、风速和五日预报。
- 设备电量使用系统 UPower 数据，并可选择显示笔记本电脑和已连接蓝牙设备。
- 照片可从自定义本机文件夹轮播，支持两种单图尺寸和三图拼贴。
- 音乐播放器通过 MPRIS 兼容用户已安装应用，支持三种尺寸、封面、进度和播放控制。
- 系统监控采用紧凑卡片布局，可选择显示 CPU、内存、AMD/NVIDIA 显卡、磁盘容量与实时读写，以及网络上下行曲线。

扩展标识：

- 名称：`DING with Widgets`
- UUID：`ding-with-widgets@yanjing_chen.qq.com`
- 当前正式版本：`1.2.0`

## 系统要求

- Ubuntu 26.04 或其他提供 GNOME Shell 50/51 的 Linux 发行版
- GTK 4、GJS、Meson、Ninja
- WebKitGTK 6 GObject Introspection：`gir1.2-webkit-6.0`
- 新增系统日程需要 Evolution Data Server 的 `ECal 2.0` 与 `ICalGLib 3.0` GObject Introspection（安装 GNOME 日历时通常已具备）
- GNOME Extensions 命令行工具

目前仅明确支持 GNOME Shell 50 和 51。其他版本可能可以运行，但尚未验证。

## 安装

### 从 Release 安装（推荐）

1. 下载对应版本的 ZIP：`ding-with-widgets-v1.2.0-gnome50-51.zip`。
2. 打开终端并安装依赖：

```bash
sudo apt update
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0 gir1.2-ecal-2.0 gir1.2-ical-3.0
```

3. 解压并安装：

```bash
cd ~/下载
unzip -o ding-with-widgets-v1.2.0-gnome50-51.zip
cd ding-with-widgets
chmod +x install-local-test.sh
./install-local-test.sh
```

如果系统的下载目录名为 `Downloads`，请把 `~/下载` 改成 `~/Downloads`。

安装脚本会：

- 将扩展安装到 `~/.local/share/gnome-shell/extensions/`，不会改写 `/usr` 下的系统文件；
- 备份已有的 DING with Widgets 本地版本；
- 禁用 Ubuntu 原版 `ding@rastersoft.com`，但不会删除它；
- 启用 `ding-with-widgets@yanjing_chen.qq.com`。

安装后如桌面右键菜单没有立刻更新，请注销并重新登录。不要同时启用本项目和 Ubuntu 原版 DING，因为两者都会管理同一桌面。

### 从 Git 源码安装

```bash
git clone https://github.com/yanjing-chen/ding-with-widgets.git
cd ding-with-widgets
chmod +x install-local-test.sh
./install-local-test.sh
```

## 使用

在桌面空白处右键：

- 选择“添加小组件…”添加 Widget；
- 选择“编辑小组件”显示编辑控制；
- 在非编辑模式下，将鼠标移动到 Widget 顶部透明拖动区即可移动；
- 从 Widget 的任意边缘或四角拖动即可改变大小；
- Widget 内的齿轮或 `Aa` 按钮用于设置内容、样式和透明度。

打开扩展设置：

```bash
gnome-extensions prefs ding-with-widgets@yanjing_chen.qq.com
```

Widget 状态保存在：

```text
~/.local/share/ding-with-widgets/widgets-state.json
```

安装脚本的备份位于：

```text
~/.local/share/ding-with-widgets/backups/
```

更完整的测试方法见 [`WIDGETS-LOCAL-TEST.md`](WIDGETS-LOCAL-TEST.md)。

## 恢复 Ubuntu 原版 DING

执行：

```bash
gnome-extensions disable ding-with-widgets@yanjing_chen.qq.com
gnome-extensions enable ding@rastersoft.com
```

注销并重新登录后即可恢复原版桌面管理。新版扩展和 Widget 数据不会自动删除，便于以后重新启用。

## 网络访问与数据

- 天气数据和城市搜索由 [Open-Meteo](https://open-meteo.com/) 提供。天气 Widget 会向 Open-Meteo 发送所搜索的城市名以及所选城市的经纬度。
- 世界时钟仅使用 Open-Meteo 的城市地理编码服务确定时区，时间在本机计算。
- 日历按用户操作从 [`tigertall/chinese-calendar`](https://github.com/tigertall/chinese-calendar) 的公开数据源获取中国大陆节假日信息，并在本地缓存。
- 日历 Widget 通过 GNOME Shell CalendarServer 读取 Evolution Data Server 中的日程；使用 `＋` 新建的安排写入用户的默认系统日历。
- 便笺内容、Widget 设置和布局保存在本机，不会由本项目上传到服务器。
- 照片 Widget 仅扫描用户在原生文件夹选择器中明确选定的本机目录；图片不会发送给任何第三方。
- 音乐 Widget 只通过本机会话 D-Bus/MPRIS 与播放器通信；不读取账号凭据，网络封面由播放器提供的地址显示。
- 系统监控 Widget 只读取本机 `/proc`、`/sys` 和可选的 NVIDIA 驱动工具，不会上传硬件或流量数据。

Open-Meteo 的免费端点、数据许可及使用限制以其[官方条款](https://open-meteo.com/en/terms)为准；用于商业场景前请自行确认适用方案。

## 致谢

- [Sergio Costas（Rastersoft）](https://gitlab.com/rastersoft/desktop-icons-ng)：Desktop Icons NG (DING) 的主要作者。本项目的桌面图标基础、GNOME Shell 集成和大量现有代码来自 DING。
- Carlos Soriano：原始 Desktop Icons 相关代码作者，相关版权说明由上游项目保留。
- [smedius/desktop-icons-ng](https://gitlab.com/smedius/desktop-icons-ng)：GTK4 DING 与桌面 Widget 架构参考。
- Canonical 的 Debian/Ubuntu 打包贡献者：上游 `debian/` 目录中的相关贡献。
- [tigertall/chinese-calendar](https://github.com/tigertall/chinese-calendar)：中国大陆节假日公开数据和缓存方式参考。
- [Open-Meteo](https://open-meteo.com/)：天气预报和城市地理编码服务。
- [freedesktop.org MPRIS](https://specifications.freedesktop.org/mpris/latest/)：音乐 Widget 与已安装播放器之间的标准 D-Bus 接口。
- [Resources](https://apps.gnome.org/zh-CN/Resources/)：系统监控项目和信息层级的功能参考。本项目未复制其 Rust 源代码或图标。

详细归属和第三方服务说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。感谢所有上游作者和开源社区贡献者。

## 许可证与商标声明

本项目作为 DING 的衍生作品，继续以 **GNU General Public License v3.0 only** 发布，完整文本见 [`COPYING`](COPYING)。再分发修改版本时必须继续遵守 GPL‑3.0 的源代码与版权声明要求。

“受 macOS 视觉风格启发”只描述一般设计方向。本项目不包含 Apple 的源代码、图标或其他专有素材，与 Apple Inc. 无隶属、授权或背书关系。Mac 和 macOS 是 Apple Inc. 的商标；GNOME、Ubuntu、Canonical 等名称和商标归各自权利人所有。

## 开发与构建

本地 Meson 构建：

```bash
meson setup --prefix="$HOME/.local" \
  --localedir="share/gnome-shell/extensions/ding-with-widgets@yanjing_chen.qq.com/locale" \
  .build
ninja -C .build install
```

创建 GNOME 扩展 ZIP：

```bash
./export-zip.sh
```

调试、已知范围和验收步骤见 [`WIDGETS-LOCAL-TEST.md`](WIDGETS-LOCAL-TEST.md)。
