# DING with Widgets 1.0.1

这是 1.0.0 正式版的外观与拖放修复版本，继续支持 GNOME Shell 50/51 和 Wayland。Widget、多屏幕、持久化及其他桌面功能没有改变。

## 修复内容

- 桌面图标选中状态与鼠标框选区域固定使用中性灰色半透明背景和白色边框，不再随 GNOME/libadwaita 的系统强调色变化。
- 拖动桌面文件时使用当前桌面项目的真实图标与文件名作为拖动预览，不再显示通用文件图标。
- 拖动预览只在拖动期间创建，结束后立即解绑，避免旧式长期持有 `Gtk.WidgetPaintable` 所带来的生命周期问题。
- 删除世界时钟右下角的蓝色装饰光晕，使卡片背景保持均匀。

## 保持不变

- 八个内置中文 Widget 及其设置、内容和数据来源。
- Widget 的位置、尺寸、跨屏幕拖动和持久化。
- 物理显示器身份识别、外接屏幕断开与重新连接时的恢复逻辑。
- 桌面图标自由排列、文件操作和右键菜单。

## 安装

```bash
sudo apt update
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0 gir1.2-ecal-2.0 gir1.2-ical-3.0
unzip -o ding-with-widgets-v1.0.1-gnome50-51.zip
cd ding-with-widgets
chmod +x install-local-test.sh
./install-local-test.sh
```

安装后如果桌面仍显示旧版效果，请注销并重新登录。

## 许可证与致谢

本项目是 Desktop Icons NG 的非官方衍生版本，以 GPL-3.0-only 发布。上游作者、参考项目、第三方服务、数据来源和商标声明见 README、`COPYING` 与 `THIRD_PARTY_NOTICES.md`。
