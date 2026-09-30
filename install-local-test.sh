#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
user_prefix="${HOME:?}/.local"
extension_uuid="ding-with-widgets@yanjing_chen.qq.com"
original_uuid="ding@rastersoft.com"
extension_dir="${user_prefix}/share/gnome-shell/extensions/${extension_uuid}"
legacy_local_dir="${user_prefix}/share/gnome-shell/extensions/${original_uuid}"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_root="${user_prefix}/share/ding-with-widgets/backups"
backup_dir="${backup_root}/${extension_uuid}-${timestamp}"
legacy_backup_dir="${backup_root}/${original_uuid}-widgets-v1-${timestamp}"
failed_dir="${backup_root}/${extension_uuid}-failed-${timestamp}"
build_dir="$(mktemp -d -t ding-widgets-build-XXXXXX)"
install_succeeded=0

mkdir -p -- "${backup_root}"

cleanup() {
    exit_status=$?
    if [[ -d "${build_dir}" && "${build_dir}" == /tmp/ding-widgets-build-* ]]; then
        rm -rf -- "${build_dir}"
    fi
    if [[ ${install_succeeded} -eq 0 && -e "${extension_dir}" ]]; then
        mv -- "${extension_dir}" "${failed_dir}"
    fi
    if [[ ${install_succeeded} -eq 0 && -d "${backup_dir}" ]]; then
        mv -- "${backup_dir}" "${extension_dir}"
        echo "安装失败，已恢复原来的 DING with Widgets。"
    fi
    if [[ ${install_succeeded} -eq 0 && -d "${legacy_backup_dir}" && ! -e "${legacy_local_dir}" ]]; then
        mv -- "${legacy_backup_dir}" "${legacy_local_dir}"
        echo "安装失败，已恢复第一版测试扩展。"
    fi
    trap - EXIT
    exit "${exit_status}"
}
trap cleanup EXIT

required_commands=(gjs meson ninja glib-compile-schemas gnome-extensions)
for command_name in "${required_commands[@]}"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "缺少命令：${command_name}"
        echo "请先执行：sudo apt install gjs meson ninja-build libglib2.0-bin gir1.2-webkit-6.0"
        exit 1
    fi
done

if ! gjs -c "imports.gi.versions.WebKit='6.0'; imports.gi.WebKit;" >/dev/null 2>&1; then
    echo "缺少 WebKitGTK 6 的 GObject Introspection 包。"
    echo "请先执行：sudo apt install gir1.2-webkit-6.0"
    exit 1
fi

if [[ -e "${extension_dir}" ]]; then
    mv -- "${extension_dir}" "${backup_dir}"
    echo "已备份现有本地 DING：${backup_dir}"
fi

# Version 1 used Ubuntu DING's UUID and shadowed the system extension. Move it
# aside so the distribution-provided extension becomes visible again.
if [[ -e "${legacy_local_dir}" ]]; then
    mv -- "${legacy_local_dir}" "${legacy_backup_dir}"
    echo "已移走与 Ubuntu 原版冲突的第一版：${legacy_backup_dir}"
fi

meson setup \
    --prefix="${user_prefix}" \
    --localedir="share/gnome-shell/extensions/${extension_uuid}/locale" \
    "${build_dir}" \
    "${project_dir}"
ninja -C "${build_dir}" install

installed_widget_dir="${extension_dir}/app/widgets"
if [[ ! -f "${installed_widget_dir}/Glass_Sticky_Note/widget.json" ]]; then
    echo "安装校验失败：Widget 目录位置不正确。"
    exit 1
fi

if ! grep -q '"locations"' "${installed_widget_dir}/Glass_Clock/widget.json"; then
    echo "安装校验失败：多地世界时钟没有正确安装。"
    exit 1
fi

if [[ ! -f "${installed_widget_dir}/Glass_Weather/widget.json" ]]; then
    echo "安装校验失败：天气小组件没有正确安装。"
    exit 1
fi

if ! grep -q 'layoutPreset' "${installed_widget_dir}/Glass_Weather/widget.json" ||
   ! grep -q 'hourly' "${installed_widget_dir}/Glass_Weather/weather.js"; then
    echo "安装校验失败：三尺寸天气小组件没有正确安装。"
    exit 1
fi

if [[ ! -f "${installed_widget_dir}/Glass_Photos/widget.json" ]] ||
   ! grep -q 'choosePhotoFolder' "${extension_dir}/app/widgetManager.js" ||
   ! grep -q 'layoutPreset' "${installed_widget_dir}/Glass_Photos/widget.json"; then
    echo "安装校验失败：照片小组件没有正确安装。"
    exit 1
fi

if [[ ! -f "${installed_widget_dir}/Glass_Music/widget.json" ]] ||
   ! grep -q 'getMediaPlayers' "${extension_dir}/app/widgetManager.js" ||
   ! grep -q 'controlMediaPlayer' "${extension_dir}/app/widgetManager.js" ||
   ! grep -q 'layoutPreset' "${installed_widget_dir}/Glass_Music/widget.json"; then
    echo "安装校验失败：音乐播放器小组件没有正确安装。"
    exit 1
fi

if [[ ! -f "${installed_widget_dir}/Glass_Battery/widget.json" ]] ||
   ! grep -q 'getPowerDevices' "${extension_dir}/app/widgetManager.js"; then
    echo "安装校验失败：设备电量小组件没有正确安装。"
    exit 1
fi

if [[ ! -f "${installed_widget_dir}/Glass_System_Monitor/widget.json" ]] ||
   [[ ! -f "${extension_dir}/app/systemMonitor.js" ]] ||
   ! grep -q 'getSystemMonitorState' "${extension_dir}/app/widgetManager.js" ||
   ! grep -q 'filesystem::size' "${extension_dir}/app/systemMonitor.js" ||
   ! grep -q 'gpu_busy_percent' "${extension_dir}/app/systemMonitor.js" ||
   ! grep -q 'nvidia-smi' "${extension_dir}/app/systemMonitor.js"; then
    echo "安装校验失败：系统监控小组件或硬件采集模块没有正确安装。"
    exit 1
fi

if ! grep -q 'holidays_cn.json' "${installed_widget_dir}/Glass_Calendar/calendar.js"; then
    echo "安装校验失败：中国大陆节假日数据源没有正确安装。"
    exit 1
fi

if ! grep -q 'monitorId' "${extension_dir}/extension.js" ||
   ! grep -q 'widgetMonitorId' "${extension_dir}/app/desktopGrid.js" ||
   ! grep -q 'monitorId' "${extension_dir}/app/widgetManager.js"; then
    echo "安装校验失败：多屏幕物理身份修复没有正确安装。"
    exit 1
fi

if ! grep -q 'layoutPreset' "${installed_widget_dir}/Glass_Calendar/widget.json" ||
   ! grep -q 'setSize(width, height)' "${extension_dir}/app/widgetManager.js" ||
   ! grep -q 'calendarGetEvents' "${extension_dir}/app/widgetManager.js" ||
   [[ ! -f "${extension_dir}/app/calendarBackend.js" ]]; then
    echo "安装校验失败：三尺寸日历没有正确安装。"
    exit 1
fi

if ! GSETTINGS_SCHEMA_DIR="${user_prefix}/share/glib-2.0/schemas" \
    gsettings list-keys org.gnome.shell.extensions.dingwithwidgets \
    | grep -qx 'show-desktop-widgets'; then
    echo "安装校验失败：新版 GSettings Schema 没有正确编译。"
    exit 1
fi
install_succeeded=1

gnome-extensions disable "${original_uuid}" >/dev/null 2>&1 || true
gnome-extensions disable "${extension_uuid}" >/dev/null 2>&1 || true
if ! gnome-extensions enable "${extension_uuid}"; then
    echo "当前会话未能即时重载扩展，请注销并重新登录。"
fi

echo
echo "安装完成：DING with Widgets (${extension_uuid})"
echo "Ubuntu 原版 DING 已禁用但没有删除。"
echo "请在桌面空白处右键，选择“Add Widget…”。"
echo "如果菜单尚未出现，请注销并重新登录一次。"
echo "Widget 状态文件：${HOME}/.local/share/ding-with-widgets/widgets-state.json"
if [[ -d "${backup_dir}" ]]; then
    echo "需要回退时，先删除当前本地扩展，再把此备份移回原位："
    echo "${backup_dir}"
fi
