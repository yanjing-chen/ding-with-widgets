# SPDX-FileCopyrightText: 2026 Sergio Costas <rastersoft@gmail.com>
#
# SPDX-License-Identifier: GPL-2.0-or-later

prefix = get_option('prefix')
extension_uuid = get_option('extension_uuid')

app_extensions_dir = join_paths(prefix, 'share', 'gnome-shell', 'extensions', extension_uuid, 'app')

install_data([
    'askRenamePopup.js',
    'autoAr.js',
    'calendarBackend.js',
    'createThumbnail.js',
    'dbusInterfaces.js',
    'dbusUtils.js',
    'desktopGrid.js',
    'desktopIconItem.js',
    'desktopIconsIntegration.js',
    'desktopIconsUtil.js',
    'desktopManager.js',
    'desktopMenu.js',
    'ding.js',
    'dndClipboardUtils.js',
    'enums.js',
    'fileItem.js',
    'fileItemMenu.js',
    'fileUtils.js',
    'menuHelper.js',
    'notifyX11UnderWayland.js',
    'preferences.js',
    'prefswindow.js',
    'promiseUtils.js',
    'showErrorPopup.js',
    'signalManager.js',
    'stackItem.js',
    'systemMonitor.js',
    'stylesheet.css',
    'templatesScriptsManager.js',
    'thumbnails.js',
    'widgetManager.js',
    'icons/hicolor/icon-theme.cache',
    'icons/hicolor/index.theme',
    'icons/hicolor/scalable/emblems/close-stack.svg',
    'icons/hicolor/scalable/emblems/open-stack.svg',
  ],
  install_dir: app_extensions_dir,
  preserve_path: true
)
