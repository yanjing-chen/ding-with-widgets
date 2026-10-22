# DING with Widgets 1.2.0

1.2.0 是系统监控 Widget 的紧凑化与可读性更新，继续支持 GNOME Shell 50/51 和 Wayland。除系统监控的呈现方式外，其他 Widget、桌面图标、多屏幕、拖放和持久化功能均保持不变。

## 系统监控新布局

- 只保留一个紧凑布局，不再提供紧凑、中型、大型之间的尺寸选择。
- CPU 与 GPU 使用并排的大圆环显示实时使用率。
- 内存与磁盘并排显示容量、占用比例和进度；两个占用圆环保持水平对齐。
- 磁盘读取和写入恢复为同一行，并随卡片宽度自动调整间距。
- 网络区域在底部显示下载、上传速度以及最近一分钟的双曲线。
- 放大“已使用”“读取”“写入”“下载”“上传”和相应数值，改善高分辨率屏幕上的可读性。
- 旧的中型或大型设置会在首次加载时自动迁移到紧凑布局。

## 保持不变

- CPU、内存、AMD/NVIDIA GPU、磁盘容量和实时读写、网络上下行的数据采集逻辑。
- 显卡、磁盘、网络设备选择，刷新频率及透明度设置。
- 其余七个中文 Widget 的内容、设置与外观。
- Widget 的位置、尺寸、跨屏幕拖动、显示器身份记录和持久化。
- 桌面图标、自由排列、文件操作及右键菜单。

## 安装

```bash
sudo apt update
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0 gir1.2-ecal-2.0 gir1.2-ical-3.0
unzip -o ding-with-widgets-v1.2.0-gnome50-51.zip
cd ding-with-widgets
chmod +x install-local-test.sh
./install-local-test.sh
```

安装后如果桌面仍显示旧版效果，请注销并重新登录。

## 许可证与致谢

本项目是 Desktop Icons NG 的非官方衍生版本，以 GPL-3.0-only 发布。上游作者、参考项目、第三方服务、数据来源和商标声明见 README、`COPYING` 与 `THIRD_PARTY_NOTICES.md`。
