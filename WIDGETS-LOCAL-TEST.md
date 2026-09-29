# DING with Widgets 0.7.16 测试与验收

## 0.7.16 跨屏命中修复

- 保持 0.7.15 基于 0.7.7 的 GtkGestureDrag 本体拖动机制不变。
- 跨屏判断改为读取当前 Gdk 拖动事件的窗口坐标，不再依赖 Wayland 指针表面查询。
- 鼠标越过原桌面窗口边界后，继续将事件坐标换算为全局坐标并命中目标屏幕。
- 仅修复跨屏目标识别，不调整同屏拖动动画、Widget 功能或设置。
- 保留 0.7.10 的多屏窗口校正、跨屏拖放和安全拔屏逻辑。

这个版本基于 `rastersoft/desktop-icons-ng`，使用独立 UUID 安装，不会覆盖或删除 Ubuntu 在 `/usr` 下提供的原版 DING。

- 显示名称：`DING with Widgets`
- UUID：`ding-with-widgets@yanjing_chen.qq.com`
- GNOME Shell：50、51
- 设置 Schema：`org.gnome.shell.extensions.dingwithwidgets`
- 版本：0.7.16

## 已实现

- Ubuntu 原生 DING 内的 HTML Widget 管理层（WebKitGTK 6）。
- 桌面右键菜单中的“添加小组件…”和“编辑小组件”。
- 非编辑模式下悬停后可拖动顶部中央的小把手；编辑模式下可拖动顶部控制条。
- 结束拖动时保存显示器与坐标。
- 可从四边和四角的透明窄感应区自由缩放，并保存最后尺寸。
- 登录、DING 重启和睡眠/唤醒后恢复最后位置。
- Widget 内部按钮和输入控件可直接操作，不会触发桌面框选。
- 便笺富文本、待办清单、字体、字号、颜色和内容自动保存；无需打开单独的编辑窗口。
- 玻璃质感世界时钟可同时显示多个城市，并直接增删地点、切换 12/24 小时制。
- 四个统一玻璃质感的中文内置 Widget：便笺、世界时钟、日历、天气。
- 天气支持搜索并保存城市、当前天气、体感温度、湿度、风速和四日预报。
- 日历支持月份翻页、农历、传统节日、二十四节气，以及联网更新的中国大陆休假/补班数据。
- 四个 Widget 均提供独立的透明度设置。
- 添加窗口只显示这四个中文内置 Widget，不再导入 Gtk4 DING 的英文 Widget。

## 安装测试

先安装构建及运行依赖：

```bash
sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0
```

进入本目录后执行：

```bash
chmod +x install-local-test.sh
./install-local-test.sh
```

脚本只安装到 `~/.local`。如果第一版测试包曾经以 `ding@rastersoft.com` 安装，脚本会先把它移到带时间戳的备份目录，从而解除与 Ubuntu 原版的覆盖冲突。Ubuntu 的 `/usr` 下原版不会被删除。

由于两个扩展都会管理整张桌面，安装脚本会禁用 Ubuntu 原版，然后启用 `DING with Widgets`，不会让两个版本同时运行。需要恢复原版时执行：

```bash
gnome-extensions disable ding-with-widgets@yanjing_chen.qq.com
gnome-extensions enable ding@rastersoft.com
```

打开新版设置：

```bash
gnome-extensions prefs ding-with-widgets@yanjing_chen.qq.com
```

Wayland 下如果右键菜单没有立即更新，请注销并重新登录。

## 验收步骤

1. 桌面空白处右键，选择“添加小组件…”。
2. 添加“便笺”，直接点击正文输入内容，等待左下角显示“已保存”。
3. 退出编辑模式，把鼠标移到 Widget 上，拖动顶部中央把手，确认鼠标与组件不再偏移。
4. 点击便笺右上角“`Aa`”，测试格式、Checklist、颜色和透明度；输入正文并确认自动保存。
5. 添加“世界时钟”，点击右上角齿轮，增删城市并切换 24 小时制。
6. 分别拖动四条边和四个角的透明窄感应区改变大小，确认没有粗蓝色边框。
7. 添加“天气”，搜索并选择城市，确认天气和四日预报正常显示。
8. 添加“日历”，测试前后翻月、回到今天、农历开关，并在设置中更新中国大陆节假日数据。
9. 注销再登录，确认内容、格式、颜色、城市、透明度、位置与尺寸全部恢复。
10. 再移动一次后让电脑睡眠并唤醒，确认位置仍然保持。

状态保存在 `~/.local/share/ding-with-widgets/widgets-state.json`。程序会自动迁移第一版保存在 `~/.local/share/ding/widgets-state.json` 的内容。删除新版状态文件可以清空 Widget 布局和内容。

## 当前范围

本地测试版只提供便笺、世界时钟、日历和天气，不加载播放器、系统监控等旧 Gtk4 DING 英文 Widget。
