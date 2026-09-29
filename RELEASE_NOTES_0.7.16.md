# DING with Widgets 0.7.16

首个公开测试版本，面向 GNOME Shell 50/51 和 Wayland。

## 主要功能

- 在 Ubuntu DING 基础上集成四个中文桌面 Widget：便笺、世界时钟、日历和天气。
- Widget 支持直接拖动、八方向缩放、透明度设置和持久化。
- 支持多显示器：可在创建所在屏幕出现，也可跨屏拖动；副屏断开后安全迁回可用屏幕。
- 保持基于 GtkGestureDrag 的原位拖动效果，避免拖动副本、提示卡片和释放闪烁。
- 便笺支持可编辑标题、富文本、字体、字号、颜色和 Checklist。
- 世界时钟支持输入城市名搜索、多个城市和 12/24 小时制。
- 日历支持翻月、农历、传统节日、二十四节气以及中国大陆休假/补班信息。
- 天气支持城市搜索、当前天气和四日预报。
- Widget 的内容、设置、位置、屏幕和尺寸会在重启或睡眠后恢复。

## 安装

下载 `ding-with-widgets-v0.7.16-gnome50-51.zip`，解压后进入目录执行：

```bash
sudo apt update
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0
chmod +x install-local-test.sh
./install-local-test.sh
```

如果桌面右键菜单没有立即更新，请注销并重新登录。

## 注意

- 安装脚本会禁用 Ubuntu 原版 `ding@rastersoft.com`，但不会删除系统文件。
- 不要同时启用原版 DING 和 DING with Widgets。
- 本版本仅明确支持 GNOME Shell 50 和 51。
- 天气、城市搜索和节假日更新需要网络连接。

完整致谢、第三方数据来源和许可证说明见仓库中的 `README.md`、`THIRD_PARTY_NOTICES.md` 与 `COPYING`。
