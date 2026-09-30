# DING with Widgets 0.7.17 Alpha 2.3

这是根据 Ubuntu 26.04 / GNOME 50 实机日志制作的 WebKitGTK 6 通信修复版，不改变三种日历布局和其他 Widget 的外观。

## 已确认的根因

WebKitGTK 6 在当前系统中将 Widget 的 `postMessage()` 内容直接作为 `JSC.Value` 传给宿主，而原有代码只接受提供 `get_js_value()` 或 `get_value()` 的包装对象，导致日志反复出现：

```text
DING widgets: invalid widget message: result.get_value is not a function
```

因为请求未到达 WidgetManager，系统日程读取和写入都无法执行。

## 修复

- 同时兼容直接 `JSC.Value`、`get_js_value()` 包装和 `get_value()` 包装三种 WebKitGTK 消息形式。
- 支持字符串、JSON 对象以及 `GLib.Variant` 数据。
- 扫描 Widget 目录时忽略没有 `widget.json` 的 `shared` 样式目录，不再输出无关警告。

## 测试重点

1. 重新登录后，9 月 30 日应显示 `DING诊断` 和 `test` 的彩色日程标记。
2. 点击 `＋` 添加日程，请求应真正进入宿主，成功后编辑器关闭并刷新。
3. 日志中不应再出现 `result.get_value is not a function`。
