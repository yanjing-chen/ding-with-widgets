# DING with Widgets 1.0.0

这是 DING with Widgets 的第一个正式版本。项目以 Desktop Icons NG 为基础，为 GNOME Shell 50/51 的 Wayland 桌面加入可移动、可缩放、可持久保存的中文 Widget。

## Widget

- 便笺：可编辑标题、富文本、字体、字号、颜色、Checklist 和透明度。
- 世界时钟：通过城市名称搜索时区，支持多城市、数显、表显和 12/24 小时制。
- 日历：三种尺寸，支持翻页、农历、传统节日、二十四节气、中国大陆休假/补班和系统日程。
- 天气：三种尺寸，支持城市搜索、当前天气、逐小时预报和五日预报。
- 设备电量：显示笔记本电池以及由 UPower 报告电量的蓝牙设备。
- 照片：从用户指定的本机文件夹轮播，支持单图和拼贴布局。
- 音乐播放器：通过 MPRIS 控制已安装的播放器，支持封面、进度和播放控制。
- 系统监控：显示 CPU、内存、AMD/NVIDIA 显卡、磁盘容量与读写速度，以及网络上下行。

## 桌面与多屏幕

- 保留 DING 的桌面图标、自由排列、拖放、右键菜单和文件操作。
- Widget 可在任一屏幕创建，并可在屏幕之间直接拖动。
- 位置、尺寸、内容和设置在登录、睡眠、重启扩展后恢复。
- 使用物理显示器厂商、型号、序列号及连接器信息记录屏幕归属，避免 GNOME 重新编号后整批跳屏。
- 副屏断开时，其内容只临时显示在主屏；同一块副屏接回后恢复原屏幕和原位置。
- 支持不同分辨率、不同缩放比例和主屏切换。

## 升级说明

0.7.17 Alpha 7.2 及更早版本只保存数字屏幕编号。首次升级到 1.0.0 时，无法可靠判断这些旧编号对应的物理屏幕，因此旧桌面图标和 Widget 会一次性迁移到当前 GNOME 主屏。请在安装前确认系统主屏设置正确，再将需要留在副屏的项目拖过去一次。

从 Alpha 7.3 升级时，物理屏幕身份已经保存，不需要再次迁移。

## 系统要求

- GNOME Shell 50 或 51
- Wayland
- GTK 4、GJS、Meson、Ninja
- WebKitGTK 6 GObject Introspection
- 新建系统日程需要 ECal 2.0 与 ICalGLib 3.0 GObject Introspection

## 安装

```bash
sudo apt update
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0 gir1.2-ecal-2.0 gir1.2-ical-3.0
unzip -o ding-with-widgets-v1.0.0-gnome50-51.zip
cd ding-with-widgets
chmod +x install-local-test.sh
./install-local-test.sh
```

## 许可证与致谢

本项目是 Desktop Icons NG 的非官方衍生版本，以 GPL-3.0-only 发布。上游作者、参考项目、第三方服务、数据来源和商标声明见 README、`COPYING` 与 `THIRD_PARTY_NOTICES.md`。
