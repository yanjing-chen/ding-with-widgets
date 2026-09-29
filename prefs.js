
/* Desktop Icons GNOME Shell extension
 *
 * Copyright (C) 2019 Sergio Costas (rastersoft@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
// SPDX-License-Identifier: GPL-3.0-only
'use strict';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const mainAppControl = Gio.DBusActionGroup.get(
            Gio.DBus.session,
            'com.yanjingchen.dingwidgets',
            '/com/yanjingchen/dingwidgets'
        );
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'DING 桌面小组件',
            icon_name: 'preferences-desktop-symbolic',
        });
        const widgetGroup = new Adw.PreferencesGroup({
            title: '桌面小组件',
            description: 'GNOME Shell 50 / 51',
        });
        const widgetSwitch = new Adw.SwitchRow({
            title: '启用桌面小组件',
            subtitle: '在桌面图标下方显示可移动、可保存的小组件',
        });
        settings.bind(
            'show-desktop-widgets',
            widgetSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        widgetGroup.add(widgetSwitch);

        const desktopGroup = new Adw.PreferencesGroup({
            title: '桌面图标',
        });
        const desktopRow = new Adw.ActionRow({
            title: '桌面图标设置',
            subtitle: '设置图标大小、文件夹、磁盘、排列方式和标签',
        });
        const openButton = new Gtk.Button({
            label: '打开设置',
            valign: Gtk.Align.CENTER,
        });
        openButton.add_css_class('suggested-action');
        openButton.connect('clicked', () => {
            mainAppControl.activate_action(
                'changeDesktopIconSettings',
                null
            );
        });
        desktopRow.add_suffix(openButton);
        desktopRow.activatable_widget = openButton;
        desktopGroup.add(desktopRow);

        page.add(widgetGroup);
        page.add(desktopGroup);
        window.add(page);
    }
}
