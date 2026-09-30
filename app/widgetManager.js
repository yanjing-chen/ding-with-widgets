/* DING: Desktop Icons New Generation for GNOME Shell
 *
 * Desktop widget support for the rastersoft GTK4 code base.
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';

import * as Prefs from './preferences.js';
import {SystemMonitorProvider} from './systemMonitor.js';

const Gettext = imports.gettext.domain('ding');
const _ = Gettext.gettext;

const STATE_VERSION = 2;
const LEGACY_STATE_VERSION = 1;
const MAX_WIDGET_SIZE = 1200;
const MIN_WIDGET_SIZE = 80;

function readJson(file) {
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return null;

        return JSON.parse(new TextDecoder().decode(contents));
    } catch (e) {
        console.warn(`DING widgets: unable to read ${file.get_path()}: ${e.message}`);
        return null;
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
}

function clamp(value, lower, upper) {
    return Math.min(Math.max(Number(value) || 0, lower), Math.max(lower, upper));
}

export class WidgetManager {
    constructor(desktopManager, mainApp, codePath) {
        this._desktopManager = desktopManager;
        this._mainApp = mainApp;
        this._codePath = codePath;
        this._WebKit = null;
        this._available = false;
        this._ready = false;
        this._editMode = false;
        this._descriptors = new Map();
        this._instances = new Map();
        this._frames = new Map();
        this._prefsWindows = new Map();
        this._grids = [];
        this._targetGrid = null;
        this._chooser = null;
        this._calendarQueue = Promise.resolve();
        this._calendarResultCache = null;
        this._calendarSignalSilenceUntil = 0;
        this._calendarChangedSignalId = 0;
        this._calendarRemovedSignalId = 0;
        this._calendarChangedDebounceId = 0;
        this._mediaPropertiesSignalId = 0;
        this._mediaOwnerSignalId = 0;
        this._mediaChangedDebounceId = 0;
        this._systemMonitor = new SystemMonitorProvider();
        this._enabled = Prefs.desktopSettings.get_boolean('show-desktop-widgets');

        this._dataDir = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'ding-with-widgets',
        ]);
        this._statePath = GLib.build_filenamev([
            this._dataDir,
            'widgets-state.json',
        ]);
        this._legacyStatePath = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'ding',
            'widgets-state.json',
        ]);
        GLib.mkdir_with_parents(this._dataDir, 0o700);

        this._settingsId = Prefs.desktopSettings.connect(
            'changed::show-desktop-widgets',
            () => {
                this._enabled = Prefs.desktopSettings.get_boolean(
                    'show-desktop-widgets'
                );
                this._syncFrames();
            }
        );
        this._sleepSignalId = 0;
        try {
            this._sleepSignalId = Gio.DBus.system.signal_subscribe(
                'org.freedesktop.login1',
                'org.freedesktop.login1.Manager',
                'PrepareForSleep',
                '/org/freedesktop/login1',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _interface, _signal, params) => {
                    const [sleeping] = params.deepUnpack();
                    if (sleeping) {
                        this._saveState();
                    } else {
                        // Recreate the WebViews so the injected API starts with
                        // the latest saved config after a long suspend.
                        this._syncFrames();
                    }
                }
            );
        } catch (e) {
            console.warn(`DING widgets: sleep monitor unavailable: ${e.message}`);
        }

        try {
            this._calendarChangedSignalId = Gio.DBus.session.signal_subscribe(
                null,
                'org.gnome.Shell.CalendarServer',
                'EventsAddedOrUpdated',
                '/org/gnome/Shell/CalendarServer',
                null,
                Gio.DBusSignalFlags.NONE,
                () => this._scheduleCalendarChangedNotification()
            );
            this._calendarRemovedSignalId = Gio.DBus.session.signal_subscribe(
                null,
                'org.gnome.Shell.CalendarServer',
                'EventsRemoved',
                '/org/gnome/Shell/CalendarServer',
                null,
                Gio.DBusSignalFlags.NONE,
                () => this._scheduleCalendarChangedNotification()
            );
        } catch (e) {
            console.warn(`DING widgets: calendar change monitor unavailable: ${e.message}`);
        }

        try {
            this._mediaPropertiesSignalId = Gio.DBus.session.signal_subscribe(
                null,
                'org.freedesktop.DBus.Properties',
                'PropertiesChanged',
                '/org/mpris/MediaPlayer2',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, sender, _path, _interface, _signal, parameters) => {
                    const [changedInterface] = parameters.deepUnpack();
                    if (String(sender ?? '').startsWith(':') &&
                        String(changedInterface ?? '').startsWith('org.mpris.MediaPlayer2'))
                        this._scheduleMediaChangedNotification();
                }
            );
            this._mediaOwnerSignalId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _interface, _signal, parameters) => {
                    const [name] = parameters.deepUnpack();
                    if (String(name ?? '').startsWith('org.mpris.MediaPlayer2.'))
                        this._scheduleMediaChangedNotification();
                }
            );
        } catch (e) {
            console.warn(`DING widgets: media player monitor unavailable: ${e.message}`);
        }

        this._initialize().catch(e => {
            console.error(`DING widgets: initialization failed: ${e.message}\n${e.stack}`);
        });
    }

    get available() {
        return this._available;
    }

    get enabled() {
        return this._enabled;
    }

    get editMode() {
        return this._editMode;
    }

    async _initialize() {
        try {
            const module = await import('gi://WebKit?version=6.0');
            this._WebKit = module.default ?? module;
        } catch (e) {
            console.warn(
                'DING widgets: WebKitGTK 6.0 is unavailable. ' +
                'Install gir1.2-webkit-6.0 to enable desktop widgets.'
            );
            return;
        }

        this._scanWidgets();
        this._loadState();
        this._available = this._descriptors.size > 0;
        this._ready = true;
        this._syncFrames();
    }

    _scanWidgets() {
        this._descriptors.clear();
        // Keep the chooser focused on this fork's bundled Chinese
        // Bundled glass-style widgets. Existing Gtk4 DING widget files remain intact.
        const roots = [GLib.build_filenamev([this._codePath, 'widgets'])];

        for (const rootPath of roots) {
            const root = Gio.File.new_for_path(rootPath);
            if (!root.query_exists(null))
                continue;

            let enumerator;
            try {
                enumerator = root.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
            } catch (e) {
                console.warn(`DING widgets: cannot scan ${rootPath}: ${e.message}`);
                continue;
            }

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                    continue;

                const directory = root.get_child(info.get_name());
                const manifestFile = directory.get_child('widget.json');
                if (!manifestFile.query_exists(null))
                    continue;
                const manifest = readJson(manifestFile);
                if (!manifest || typeof manifest.id !== 'string')
                    continue;

                const entryName = typeof manifest.entry === 'string'
                    ? manifest.entry
                    : 'index.html';
                const entry = directory.get_child(entryName);
                if (!entry.query_exists(null))
                    continue;

                const width = clamp(
                    manifest.defaultWidth ?? 320,
                    MIN_WIDGET_SIZE,
                    MAX_WIDGET_SIZE
                );
                const height = clamp(
                    manifest.defaultHeight ?? 240,
                    MIN_WIDGET_SIZE,
                    MAX_WIDGET_SIZE
                );
                const minimumWidth = clamp(
                    manifest.minimumWidth ?? MIN_WIDGET_SIZE,
                    MIN_WIDGET_SIZE,
                    width
                );
                const minimumHeight = clamp(
                    manifest.minimumHeight ?? MIN_WIDGET_SIZE,
                    MIN_WIDGET_SIZE,
                    height
                );
                this._descriptors.set(manifest.id, {
                    ...manifest,
                    width,
                    height,
                    minimumWidth,
                    minimumHeight,
                    directory,
                    entry,
                });
            }
            enumerator.close(null);
        }
    }

    _loadState() {
        const stateFile = Gio.File.new_for_path(this._statePath);
        const legacyStateFile = Gio.File.new_for_path(this._legacyStatePath);
        if (!stateFile.query_exists(null) && !legacyStateFile.query_exists(null))
            return;
        const state = readJson(
            stateFile.query_exists(null) ? stateFile : legacyStateFile
        );
        if (!state ||
            ![LEGACY_STATE_VERSION, STATE_VERSION].includes(state.version) ||
            !Array.isArray(state.instances))
            return;

        for (const saved of state.instances) {
            if (!saved || typeof saved.instanceId !== 'string' ||
                !this._descriptors.has(saved.widgetId))
                continue;

            const descriptor = this._descriptors.get(saved.widgetId);
            this._instances.set(saved.instanceId, {
                instanceId: saved.instanceId,
                widgetId: saved.widgetId,
                monitor: Number.isInteger(saved.monitor) ? saved.monitor : 0,
                monitorId: typeof saved.monitorId === 'string' && saved.monitorId
                    ? saved.monitorId : null,
                x: Number(saved.x) || 24,
                y: Number(saved.y) || 24,
                width: clamp(saved.width ?? descriptor.width,
                    descriptor.minimumWidth, MAX_WIDGET_SIZE),
                height: clamp(saved.height ?? descriptor.height,
                    descriptor.minimumHeight, MAX_WIDGET_SIZE),
                config: {
                    ...clone(descriptor.defaultConfig),
                    ...clone(saved.config),
                },
            });
        }
        // Holiday data is a common Mainland China dataset, not a per-card
        // preference. Reuse the newest cache for every calendar instance.
        const calendars = [...this._instances.values()].filter(item =>
            item.widgetId === 'ding.mac.calendar');
        const cacheOwner = calendars
            .filter(item => item.config?.holidayCache)
            .sort((left, right) => String(right.config.holidayLastUpdate ?? '')
                .localeCompare(String(left.config.holidayLastUpdate ?? '')))[0];
        if (cacheOwner) {
            for (const item of calendars) {
                item.config.holidayCache = clone(cacheOwner.config.holidayCache);
                item.config.holidayLastUpdate = cacheOwner.config.holidayLastUpdate ?? '';
            }
        }
        if (!stateFile.query_exists(null) && this._instances.size > 0)
            this._saveState();
    }

    _saveState() {
        const state = {
            version: STATE_VERSION,
            instances: Array.from(this._instances.values()).map(instance => ({
                instanceId: instance.instanceId,
                widgetId: instance.widgetId,
                monitor: instance.monitor,
                monitorId: instance.monitorId,
                x: Math.round(instance.x),
                y: Math.round(instance.y),
                width: Math.round(instance.width),
                height: Math.round(instance.height),
                config: clone(instance.config),
            })),
        };

        try {
            GLib.file_set_contents(this._statePath, JSON.stringify(state, null, 2));
        } catch (e) {
            console.error(`DING widgets: unable to save state: ${e.message}`);
        }
    }

    setTargetGrid(gridOrContainer) {
        const clickedGrid = this._grids.find(grid =>
            grid === gridOrContainer || grid.widgetContainer === gridOrContainer
        ) ?? this._grids[0] ?? null;
        this._targetGrid = clickedGrid;
    }

    attachToGrids(grids) {
        this._removeAllFrames();
        this._grids = Array.from(grids ?? []);
        if (!this._grids.includes(this._targetGrid))
            this._targetGrid = this._grids[0] ?? null;
        this._migrateLegacyMonitorIds();
        this._syncFrames();
    }

    detachFromGrids() {
        this._removeAllFrames();
        this._grids = [];
        this._targetGrid = null;
    }

    _syncFrames() {
        this._removeAllFrames();
        if (!this._ready || !this._available || !this._enabled)
            return;

        this._migrateLegacyMonitorIds();
        for (const instance of this._instances.values())
            this._mountInstance(instance);
    }

    _removeAllFrames() {
        for (const record of this._frames.values()) {
            try {
                record.grid.removeWidget(record.frame);
            } catch (_e) {
                // The old grid may already have been destroyed.
            }
        }
        this._frames.clear();
    }

    _primaryGrid() {
        return this._grids.find(grid =>
            grid.widgetMonitorId === this._desktopManager.primaryMonitorId
        ) ?? this._grids.find(grid =>
            grid.widgetMonitor === this._desktopManager.primaryMonitorIndex
        ) ?? this._grids[0] ?? null;
    }

    _migrateLegacyMonitorIds() {
        const primaryGrid = this._primaryGrid();
        if (!primaryGrid?.widgetMonitorIdentityStable)
            return;

        let changed = false;
        for (const instance of this._instances.values()) {
            if (instance.monitorId)
                continue;
            instance.monitorId = primaryGrid.widgetMonitorId;
            instance.monitor = primaryGrid.widgetMonitor;
            changed = true;
        }
        if (changed)
            this._saveState();
    }

    _gridForMonitor(monitorId, monitor) {
        return this._grids.find(grid =>
            monitorId
                ? grid.widgetMonitorId === monitorId
                : grid.widgetMonitor === monitor
        ) ??
            this._primaryGrid();
    }

    pointIsInsideWidget(grid, x, y) {
        if (!this._enabled)
            return false;
        for (const [instanceId, record] of this._frames) {
            if (record.grid !== grid)
                continue;
            const instance = this._instances.get(instanceId);
            if (!instance)
                continue;
            const frameX = record.x ?? instance.x;
            const frameY = record.y ?? instance.y;
            if (x >= frameX && x <= frameX + instance.width &&
                y >= frameY && y <= frameY + instance.height)
                return true;
        }
        return false;
    }

    createInstance(widgetId, monitorId = null) {
        const descriptor = this._descriptors.get(widgetId);
        const grid = this._grids.find(item =>
            item.widgetMonitorId === monitorId
        ) ?? this._targetGrid ?? this._primaryGrid();
        if (!descriptor || !grid)
            return;

        const sameMonitorCount = Array.from(this._instances.values())
            .filter(item => grid.widgetMonitorIdentityStable
                ? item.monitorId === grid.widgetMonitorId
                : item.monitor === grid.widgetMonitor).length;
        const offset = (sameMonitorCount % 8) * 28;
        const instance = {
            instanceId: GLib.uuid_string_random(),
            widgetId,
            monitor: grid.widgetMonitor,
            monitorId: grid.widgetMonitorIdentityStable
                ? grid.widgetMonitorId : null,
            x: 24 + offset,
            y: 24 + offset,
            width: descriptor.width,
            height: descriptor.height,
            config: clone(descriptor.defaultConfig),
        };
        this._instances.set(instance.instanceId, instance);
        this._saveState();
        this._mountInstance(instance);
    }

    removeInstance(instanceId) {
        this._prefsWindows.get(instanceId)?.close();
        const record = this._frames.get(instanceId);
        if (record) {
            record.grid.removeWidget(record.frame);
            this._frames.delete(instanceId);
        }
        this._instances.delete(instanceId);
        this._saveState();
    }

    _mountInstance(instance) {
        if (this._frames.has(instance.instanceId) || !this._enabled)
            return;

        const descriptor = this._descriptors.get(instance.widgetId);
        const grid = this._gridForMonitor(instance.monitorId, instance.monitor);
        if (!descriptor || !grid)
            return;

        const temporarilyRelocated = instance.monitorId
            ? instance.monitorId !== grid.widgetMonitorId
            : instance.monitor !== grid.widgetMonitor;
        const displayX = clamp(
            instance.x,
            0,
            grid.widgetWidth - instance.width
        );
        const displayY = clamp(
            instance.y,
            0,
            grid.widgetHeight - instance.height
        );
        if (!temporarilyRelocated) {
            instance.monitor = grid.widgetMonitor;
            instance.x = displayX;
            instance.y = displayY;
        }

        const userContentManager = new this._WebKit.UserContentManager();
        userContentManager.register_script_message_handler('dingWidget', null);
        const apiScript = this._makeApiScript(instance);
        userContentManager.add_script(this._WebKit.UserScript.new(
            apiScript,
            this._WebKit.UserContentInjectedFrames.ALL_FRAMES,
            this._WebKit.UserScriptInjectionTime.START,
            null,
            null
        ));

        const webView = new this._WebKit.WebView({
            user_content_manager: userContentManager,
        });
        webView.set_background_color(new Gdk.RGBA({
            red: 0,
            green: 0,
            blue: 0,
            alpha: 0,
        }));
        webView.set_hexpand(true);
        webView.set_vexpand(true);

        const frame = new Gtk.Overlay({
            width_request: instance.width,
            height_request: instance.height,
        });
        frame.add_css_class('ding-widget-frame');
        frame.set_child(webView);

        const chrome = this._createEditChrome(instance, descriptor, grid, frame);
        frame.add_overlay(chrome.bar);
        frame.add_overlay(chrome.moveArea);
        for (const resizeGrip of chrome.resizeGrips)
            frame.add_overlay(resizeGrip);
        chrome.bar.set_visible(this._editMode);

        userContentManager.connect(
            'script-message-received::dingWidget',
            (_manager, result) => this._onWidgetMessage(instance, result)
        );

        grid.putWidget(frame, displayX, displayY);
        const record = {
            frame,
            chrome,
            webView,
            grid,
            userContentManager,
            x: displayX,
            y: displayY,
            temporarilyRelocated,
        };
        this._frames.set(instance.instanceId, record);
        webView.load_uri(descriptor.entry.get_uri());
        this._pushHostState(instance.instanceId);
        return record;
    }

    _addMoveGesture(target, instance, grid, frame) {
        let sourceGrid = grid;
        let originX = instance.x;
        let originY = instance.y;
        let grabOffsetX = 0;
        let grabOffsetY = 0;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let destination = null;
        let preview = null;
        let active = false;
        const drag = new Gtk.GestureDrag({button: 1});
        target.add_controller(drag);
        drag.connect('drag-begin', (_gesture, startX, startY) => {
            const record = this._frames.get(instance.instanceId);
            if (!record || record.frame !== frame)
                return;

            active = true;
            sourceGrid = record.grid;
            originX = record.x ?? instance.x;
            originY = record.y ?? instance.y;
            grabOffsetX = startX;
            grabOffsetY = startY;
            [pointerStartX, pointerStartY] = this._gridLocalToGlobal(
                sourceGrid,
                originX + grabOffsetX,
                originY + grabOffsetY
            );
            destination = null;
            preview = null;
        });
        drag.connect('drag-update', (_gesture, offsetX, offsetY) => {
            if (!active)
                return;

            const pointer = this._gestureGlobalLocation(
                _gesture,
                pointerStartX + offsetX * sourceGrid.widgetScale,
                pointerStartY + offsetY * sourceGrid.widgetScale
            );
            const targetGrid = pointer.grid ??
                this._gridForGlobalPoint(pointer.x, pointer.y);
            if (!targetGrid)
                return;

            const [pointerX, pointerY] = this._globalToGridLocal(
                targetGrid,
                pointer.x,
                pointer.y
            );
            const x = clamp(
                pointerX - grabOffsetX,
                0,
                targetGrid.widgetWidth - instance.width
            );
            const y = clamp(
                pointerY - grabOffsetY,
                0,
                targetGrid.widgetHeight - instance.height
            );

            if (targetGrid === sourceGrid) {
                if (preview) {
                    this._removeCrossScreenPreview(preview);
                    preview = null;
                }
                destination = null;
                const record = this._frames.get(instance.instanceId);
                if (record?.frame !== frame)
                    return;
                record.x = x;
                record.y = y;
                instance.x = x;
                instance.y = y;
                sourceGrid.moveWidget(frame, x, y);
                return;
            }

            if (!preview || preview.grid !== targetGrid) {
                if (preview)
                    this._removeCrossScreenPreview(preview);
                preview = this._createCrossScreenPreview(
                    frame,
                    targetGrid,
                    x,
                    y,
                    instance
                );
            } else {
                preview.grid.moveWidget(preview.widget, x, y);
            }
            destination = {grid: targetGrid, x, y};
            sourceGrid.moveWidget(
                frame,
                -Math.max(instance.width, 1) - 64,
                -Math.max(instance.height, 1) - 64
            );
        });
        drag.connect('drag-end', () => {
            if (!active)
                return;
            active = false;

            if (destination && preview) {
                this._commitCrossScreenMove(
                    instance,
                    frame,
                    destination,
                    preview
                );
                preview = null;
                destination = null;
                return;
            }

            if (preview)
                this._removeCrossScreenPreview(preview);
            preview = null;
            const record = this._frames.get(instance.instanceId);
            if (record?.frame === frame) {
                record.grid.moveWidget(frame, record.x, record.y);
                instance.monitor = record.grid.widgetMonitor;
                instance.monitorId = record.grid.widgetMonitorIdentityStable
                    ? record.grid.widgetMonitorId : null;
                instance.x = record.x;
                instance.y = record.y;
                this._saveState();
            }
        });
    }

    _gridForSurface(surface) {
        if (!surface)
            return null;

        return this._grids.find(grid => {
            try {
                return grid.Window.get_surface() === surface;
            } catch (_e) {
                return false;
            }
        }) ?? null;
    }

    _gridForGlobalPoint(x, y) {
        return this._grids.find(grid => {
            const rect = grid.gridGlobalRectangle;
            const scale = Number(grid.widgetScale) || 1;
            return x >= rect.x && x < rect.x + rect.width * scale &&
                y >= rect.y && y < rect.y + rect.height * scale;
        }) ?? null;
    }

    _gridLocalToGlobal(grid, x, y) {
        const rect = grid.gridGlobalRectangle;
        const scale = Number(grid.widgetScale) || 1;
        const [windowX, windowY] = grid.coordinatesLocalToGlobal(x, y);
        return [
            rect.x + (windowX - rect.x) * scale,
            rect.y + (windowY - rect.y) * scale,
        ];
    }

    _globalToGridLocal(grid, x, y) {
        const rect = grid.gridGlobalRectangle;
        const scale = Number(grid.widgetScale) || 1;
        return grid.coordinatesGlobalToLocal(
            rect.x + (x - rect.x) / scale,
            rect.y + (y - rect.y) / scale
        );
    }

    _pointerGlobalLocation(fallbackX, fallbackY) {
        const pointer = this._pointerSurfaceLocation();
        const grid = pointer ? this._gridForSurface(pointer.surface) : null;
        if (!pointer || !grid)
            return {grid: null, x: fallbackX, y: fallbackY};

        return {
            grid,
            x: grid.gridGlobalRectangle.x + pointer.x * grid.widgetScale,
            y: grid.gridGlobalRectangle.y + pointer.y * grid.widgetScale,
        };
    }

    _gestureGlobalLocation(gesture, fallbackX, fallbackY) {
        // Under Wayland an implicit pointer grab can make a seat query keep
        // reporting the source surface after the pointer has crossed onto a
        // second monitor. The current GdkEvent still carries surface-relative
        // coordinates outside that source window, so it is the authoritative
        // source for cross-monitor hit testing.
        try {
            const sequence = gesture.get_last_updated_sequence();
            const event = gesture.get_last_event(sequence);
            const position = event?.get_position?.();
            const surface = event?.get_surface?.();
            const grid = this._gridForSurface(surface);
            if (grid && Array.isArray(position) && position.length >= 2) {
                const x = Number(position[position.length - 2]);
                const y = Number(position[position.length - 1]);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    const scale = Number(grid.widgetScale) || 1;
                    const globalX = grid.gridGlobalRectangle.x + x * scale;
                    const globalY = grid.gridGlobalRectangle.y + y * scale;
                    return {
                        grid: this._gridForGlobalPoint(globalX, globalY),
                        x: globalX,
                        y: globalY,
                    };
                }
            }
        } catch (_e) {
            // Fall through to the device/fallback coordinate path.
        }

        return this._pointerGlobalLocation(fallbackX, fallbackY);
    }

    _createCrossScreenPreview(frame, grid, x, y, instance) {
        const widget = new Gtk.Picture({
            paintable: new Gtk.WidgetPaintable({widget: frame}),
            width_request: Math.round(instance.width),
            height_request: Math.round(instance.height),
        });
        widget.set_can_shrink(false);
        grid.putWidget(widget, x, y);
        return {widget, grid};
    }

    _removeCrossScreenPreview(preview) {
        try {
            preview.grid.removeWidget(preview.widget);
        } catch (_e) {
            // A display reconfiguration may already have removed the grid.
        }
    }

    _afterWidgetPaint(widget, callback) {
        let finished = false;
        let fallbackId = 0;
        const finish = () => {
            if (finished)
                return;
            finished = true;
            if (fallbackId) {
                GLib.Source.remove(fallbackId);
                fallbackId = 0;
            }
            callback();
        };

        widget.queue_draw();
        widget.add_tick_callback(() => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                finish();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
        fallbackId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            120,
            () => {
                fallbackId = 0;
                finish();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _commitCrossScreenMove(instance, sourceFrame, destination, preview) {
        const sourceRecord = this._frames.get(instance.instanceId);
        if (!sourceRecord || sourceRecord.frame !== sourceFrame) {
            this._removeCrossScreenPreview(preview);
            return;
        }

        const oldMonitor = instance.monitor;
        const oldMonitorId = instance.monitorId;
        const oldX = sourceRecord.x;
        const oldY = sourceRecord.y;
        this._frames.delete(instance.instanceId);
        instance.monitor = destination.grid.widgetMonitor;
        instance.monitorId = destination.grid.widgetMonitorIdentityStable
            ? destination.grid.widgetMonitorId : null;
        instance.x = destination.x;
        instance.y = destination.y;
        const targetRecord = this._mountInstance(instance);
        if (!targetRecord) {
            instance.monitor = oldMonitor;
            instance.monitorId = oldMonitorId;
            instance.x = oldX;
            instance.y = oldY;
            this._frames.set(instance.instanceId, sourceRecord);
            sourceRecord.grid.moveWidget(sourceFrame, oldX, oldY);
            this._removeCrossScreenPreview(preview);
            return;
        }

        targetRecord.frame.set_opacity(0);
        preview.grid.removeWidget(preview.widget);
        preview.grid.putWidget(preview.widget, destination.x, destination.y);
        this._saveState();

        let ready = false;
        let loadSignalId = 0;
        let timeoutId = 0;
        const reveal = () => {
            if (ready)
                return;
            ready = true;
            if (loadSignalId) {
                targetRecord.webView.disconnect(loadSignalId);
                loadSignalId = 0;
            }
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
                timeoutId = 0;
            }
            targetRecord.frame.set_opacity(1);
            this._afterWidgetPaint(targetRecord.frame, () => {
                this._removeCrossScreenPreview(preview);
                try {
                    sourceRecord.grid.removeWidget(sourceFrame);
                } catch (_e) {
                    // The old monitor may have disappeared while loading.
                }
            });
        };
        loadSignalId = targetRecord.webView.connect(
            'load-changed',
            (_webView, loadEvent) => {
                if (loadEvent === this._WebKit.LoadEvent.FINISHED)
                    reveal();
            }
        );
        timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            5000,
            () => {
                timeoutId = 0;
                reveal();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _pointerSurfaceLocation() {
        try {
            const display = Gdk.Display.get_default();
            const pointer = display?.get_default_seat?.()?.get_pointer?.();
            const result = pointer?.get_surface_at_position?.();
            if (!Array.isArray(result) || result.length < 3)
                return null;
            const x = Number(result[result.length - 2]);
            const y = Number(result[result.length - 1]);
            if (!Number.isFinite(x) || !Number.isFinite(y))
                return null;
            return {surface: result[0], x, y};
        } catch (_error) {
            return null;
        }
    }

    _pointerSurfacePoint() {
        const pointer = this._pointerSurfaceLocation();
        return pointer ? [pointer.x, pointer.y] : null;
    }

    _addResizeGesture(target, edge, instance, descriptor, grid, frame) {
        let originX = instance.x;
        let originY = instance.y;
        let originWidth = instance.width;
        let originHeight = instance.height;
        let pointerStart = null;
        let activeGrid = grid;
        let active = false;
        const drag = new Gtk.GestureDrag({button: 1});
        target.add_controller(drag);
        drag.connect('drag-begin', () => {
            active = true;
            const record = this._frames.get(instance.instanceId);
            activeGrid = record?.grid ?? grid;
            originX = record?.x ?? instance.x;
            originY = record?.y ?? instance.y;
            originWidth = instance.width;
            originHeight = instance.height;
            pointerStart = this._pointerSurfacePoint();
        });
        drag.connect('drag-update', (_gesture, offsetX, offsetY) => {
            if (!active)
                return;
            const pointer = this._pointerSurfacePoint();
            if (!pointerStart && pointer) {
                pointerStart = [
                    pointer[0] - offsetX,
                    pointer[1] - offsetY,
                ];
            }
            if (pointerStart && pointer) {
                offsetX = pointer[0] - pointerStart[0];
                offsetY = pointer[1] - pointerStart[1];
            }
            let x = originX;
            let y = originY;
            let width = originWidth;
            let height = originHeight;
            if (edge.includes('w')) {
                x = clamp(
                    originX + offsetX,
                    0,
                    originX + originWidth - descriptor.minimumWidth
                );
                width = originWidth + originX - x;
            } else if (edge.includes('e')) {
                width = clamp(
                    originWidth + offsetX,
                    descriptor.minimumWidth,
                    Math.min(MAX_WIDGET_SIZE, activeGrid.widgetWidth - originX)
                );
            }
            if (edge.includes('n')) {
                y = clamp(
                    originY + offsetY,
                    0,
                    originY + originHeight - descriptor.minimumHeight
                );
                height = originHeight + originY - y;
            } else if (edge.includes('s')) {
                height = clamp(
                    originHeight + offsetY,
                    descriptor.minimumHeight,
                    Math.min(MAX_WIDGET_SIZE, activeGrid.widgetHeight - originY)
                );
            }

            instance.x = x;
            instance.y = y;
            instance.width = width;
            instance.height = height;
            const record = this._frames.get(instance.instanceId);
            if (record) {
                record.x = x;
                record.y = y;
            }
            activeGrid.moveWidget(frame, x, y);
            frame.set_size_request(
                Math.round(width),
                Math.round(height)
            );
        });
        drag.connect('drag-end', () => {
            if (active)
                this._saveState();
            active = false;
        });
    }

    _createResizeGrip(edge, instance, descriptor, grid, frame) {
        const north = edge.includes('n');
        const south = edge.includes('s');
        const west = edge.includes('w');
        const east = edge.includes('e');
        const corner = edge.length === 2;
        const grip = new Gtk.Box({
            halign: west ? Gtk.Align.START : east ? Gtk.Align.END : Gtk.Align.FILL,
            valign: north ? Gtk.Align.START : south ? Gtk.Align.END : Gtk.Align.FILL,
            width_request: corner ? 12 : west || east ? 5 : -1,
            height_request: corner ? 12 : north || south ? 5 : -1,
            margin_start: !corner && (north || south) ? 12 : 0,
            margin_end: !corner && (north || south) ? 12 : 0,
            margin_top: !corner && (west || east) ? 12 : 0,
            margin_bottom: !corner && (west || east) ? 12 : 0,
        });
        grip.add_css_class('ding-widget-resizehandle');
        grip.add_css_class(corner ? 'corner' : 'edge');
        grip.add_css_class(`resize-${edge}`);
        grip.tooltip_text = '拖动以调整大小';
        grip.set_cursor_from_name(`${edge}-resize`);
        this._addResizeGesture(
            grip,
            edge,
            instance,
            descriptor,
            grid,
            frame
        );
        return grip;
    }

    _createEditChrome(instance, descriptor, grid, frame) {
        const bar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.START,
            hexpand: true,
        });
        bar.add_css_class('ding-widget-editbar');

        const dragArea = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            hexpand: true,
        });
        const label = new Gtk.Label({
            label: descriptor.name ?? descriptor.id,
            ellipsize: 3,
            hexpand: true,
            xalign: 0,
        });
        dragArea.append(label);
        bar.append(dragArea);

        if (typeof descriptor.prefs === 'string') {
            const prefsFile = descriptor.directory.get_child(descriptor.prefs);
            if (prefsFile.query_exists(null)) {
                const settings = new Gtk.Button({
                    icon_name: 'emblem-system-symbolic',
                    tooltip_text: '小组件设置',
                    has_frame: false,
                });
                settings.connect('clicked', () =>
                    this._openPreferences(instance, descriptor, prefsFile));
                bar.append(settings);
            }
        }

        const remove = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: '移除小组件',
            has_frame: false,
        });
        remove.connect('clicked', () => this.removeInstance(instance.instanceId));
        bar.append(remove);

        const moveArea = new Gtk.Box({
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.START,
            hexpand: true,
            height_request: 14,
        });
        moveArea.add_css_class('ding-widget-movearea');
        moveArea.tooltip_text = '按住顶部拖动小组件';
        moveArea.set_cursor_from_name('move');
        this._addMoveGesture(moveArea, instance, grid, frame);

        const resizeGrips = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
            .map(edge => this._createResizeGrip(
                edge,
                instance,
                descriptor,
                grid,
                frame
            ));
        return {bar, moveArea, resizeGrips};
    }

    _openPreferences(instance, descriptor, prefsFile) {
        const existing = this._prefsWindows.get(instance.instanceId);
        if (existing) {
            existing.present();
            return;
        }

        const userContentManager = new this._WebKit.UserContentManager();
        userContentManager.register_script_message_handler('dingWidget', null);
        userContentManager.add_script(this._WebKit.UserScript.new(
            this._makeApiScript(instance),
            this._WebKit.UserContentInjectedFrames.ALL_FRAMES,
            this._WebKit.UserScriptInjectionTime.START,
            null,
            null
        ));
        userContentManager.connect(
            'script-message-received::dingWidget',
            (_manager, result) => this._onWidgetMessage(instance, result)
        );

        const webView = new this._WebKit.WebView({
            user_content_manager: userContentManager,
        });
        webView.set_hexpand(true);
        webView.set_vexpand(true);
        const window = new Gtk.ApplicationWindow({
            application: this._mainApp,
            title: `${descriptor.name ?? descriptor.id} — 设置`,
            default_width: 560,
            default_height: 640,
            transient_for: this._targetGrid?.Window ?? this._grids[0]?.Window,
        });
        window.set_child(webView);
        window.connect('close-request', () => {
            this._prefsWindows.delete(instance.instanceId);
            return false;
        });
        this._prefsWindows.set(instance.instanceId, window);
        webView.load_uri(prefsFile.get_uri());
        window.present();
    }

    _makeApiScript(instance) {
        const instanceId = JSON.stringify(instance.instanceId);
        const initialConfig = JSON.stringify(instance.config);
        const hostState = JSON.stringify(this._hostState(instance));
        return `
(function () {
    'use strict';
    let config = ${initialConfig};
    let hostState = ${hostState};
    const configListeners = new Set();
    const hostListeners = new Set();
    const calendarListeners = new Set();
    const mediaListeners = new Set();
    const pendingRequests = new Map();
    let nextRequestId = 1;
    function copy(value) { return JSON.parse(JSON.stringify(value || {})); }
    const storageKey = 'ding-widget-config:' + ${instanceId};
    function loadLocalConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            if (saved && typeof saved === 'object')
                config = Object.assign({}, config, saved);
        } catch (_error) {}
    }
    function saveLocalConfig() {
        try { localStorage.setItem(storageKey, JSON.stringify(config)); }
        catch (_error) {}
    }
    loadLocalConfig();
    function post(type, extra) {
        const payload = Object.assign({type, instanceId: ${instanceId}}, extra || {});
        window.webkit.messageHandlers.dingWidget.postMessage(payload);
    }
    function request(type, extra) {
        return new Promise((resolve, reject) => {
            const requestId = String(nextRequestId++);
            pendingRequests.set(requestId, {resolve, reject});
            post(type, Object.assign({requestId}, extra || {}));
        });
    }
    window.ding = {
        apiVersion: 1,
        instanceId: ${instanceId},
        mode: 'widget',
        post(payload) {
            if (!payload || typeof payload !== 'object') return;
            const message = Object.assign({instanceId: ${instanceId}}, payload);
            window.webkit.messageHandlers.dingWidget.postMessage(message);
        },
        getInstanceId() { return this.instanceId; },
        getConfig() { return Promise.resolve(copy(config)); },
        getConfigSync() { return copy(config); },
        saveConfig(next) {
            config = copy(next);
            saveLocalConfig();
            post('updateConfig', {config});
        },
        setConfig(next) {
            this.saveConfig(next);
            return Promise.resolve();
        },
        setSize(width, height) {
            post('resizeWidget', {
                width: Math.round(Number(width) || 0),
                height: Math.round(Number(height) || 0)
            });
        },
        getCalendarEvents(start, end) {
            return request('calendarGetEvents', {
                start: Math.trunc(Number(start) || 0),
                end: Math.trunc(Number(end) || 0)
            });
        },
        createCalendarEvent(event) {
            return request('calendarCreateEvent', {event: copy(event)});
        },
        getPowerDevices() {
            return request('powerGetDevices');
        },
        choosePhotoFolder() {
            return request('photoChooseFolder');
        },
        listPhotoImages(folderPath) {
            return request('photoListImages', {folderPath: String(folderPath || '')});
        },
        loadPhotoImage(path) {
            return request('photoLoadImage', {path: String(path || '')});
        },
        getMediaPlayers() {
            return request('mediaGetPlayers');
        },
        getMediaPlayerState(busName) {
            return request('mediaGetPlayerState', {busName: String(busName || '')});
        },
        controlMediaPlayer(busName, action, value) {
            return request('mediaControl', {
                busName: String(busName || ''),
                action: String(action || ''),
                value
            });
        },
        listMediaApplications() {
            return request('mediaListApplications');
        },
        launchMediaApplication(desktopId) {
            return request('mediaLaunchApplication', {
                desktopId: String(desktopId || '')
            });
        },
        loadMediaArtwork(uri) {
            return request('mediaLoadArtwork', {uri: String(uri || '')});
        },
        getSystemMonitorState(forceDeviceScan) {
            return request('systemMonitorGetState', {
                forceDeviceScan: forceDeviceScan === true
            });
        },
        onCalendarChanged(callback) {
            if (typeof callback !== 'function') return function () {};
            calendarListeners.add(callback);
            return () => calendarListeners.delete(callback);
        },
        onMediaChanged(callback) {
            if (typeof callback !== 'function') return function () {};
            mediaListeners.add(callback);
            return () => mediaListeners.delete(callback);
        },
        onConfigChanged(callback) {
            if (typeof callback !== 'function') return function () {};
            configListeners.add(callback);
            callback(copy(config), {reason: 'initial'});
            return () => configListeners.delete(callback);
        },
        getHostState() { return copy(hostState); },
        onHostStateChanged(callback) {
            if (typeof callback !== 'function') return function () {};
            hostListeners.add(callback);
            callback(copy(hostState));
            return () => hostListeners.delete(callback);
        },
        onHostState(callback) { return this.onHostStateChanged(callback); },
        createWidget(widgetId) { post('createWidget', {widgetId}); },
        removeWidget() { post('removeWidget'); },
        log(message) { post('log', {message: String(message)}); },
        setDraggableRegions() {},
        _setHostState(patch) {
            hostState = Object.assign({}, hostState, patch || {});
            hostListeners.forEach(callback => callback(copy(hostState)));
        },
        _setConfig(next) {
            config = copy(next);
            saveLocalConfig();
            configListeners.forEach(callback => callback(copy(config), {reason: 'saved'}));
        },
        _resolveRequest(requestId, result, error) {
            const pending = pendingRequests.get(String(requestId));
            if (!pending) return;
            pendingRequests.delete(String(requestId));
            if (error) pending.reject(new Error(String(error)));
            else pending.resolve(copy(result));
        },
        _notifyCalendarChanged() {
            calendarListeners.forEach(callback => callback());
        },
        _notifyMediaChanged() {
            mediaListeners.forEach(callback => callback());
        }
    };
})();`;
    }

    _extractMessage(result) {
        try {
            // WebKitGTK 6 may pass JSC.Value directly, while older typelib
            // revisions wrap it in an object exposing get_js_value() or
            // get_value(). Accept all three forms.
            let value = result;
            if (typeof result?.get_js_value === 'function')
                value = result.get_js_value();
            else if (typeof result?.get_value === 'function')
                value = result.get_value();

            if (typeof value?.deepUnpack === 'function')
                value = value.deepUnpack();
            if (value && typeof value === 'object' &&
                typeof value.to_json !== 'function' &&
                typeof value.to_string !== 'function')
                return value;

            const json = typeof value === 'string'
                ? value
                : value?.is_string?.()
                    ? value.to_string()
                    : value?.to_json?.(0) ?? value?.to_string?.();
            if (typeof json !== 'string')
                return null;
            let payload = JSON.parse(json);
            if (typeof payload === 'string')
                payload = JSON.parse(payload);
            return payload && typeof payload === 'object' ? payload : null;
        } catch (e) {
            console.warn(`DING widgets: invalid widget message: ${e.message}`);
            return null;
        }
    }

    _onWidgetMessage(instance, result) {
        const payload = this._extractMessage(result);
        if (!payload || payload.instanceId !== instance.instanceId)
            return;

        switch (payload.type) {
        case 'updateConfig':
            if (payload.config && typeof payload.config === 'object') {
                instance.config = clone(payload.config);
                const changedInstances = [instance];
                if (instance.widgetId === 'ding.mac.calendar' &&
                    instance.config.holidayCache) {
                    for (const target of this._instances.values()) {
                        if (target === instance || target.widgetId !== instance.widgetId)
                            continue;
                        target.config.holidayCache = clone(instance.config.holidayCache);
                        target.config.holidayLastUpdate =
                            instance.config.holidayLastUpdate ?? '';
                        changedInstances.push(target);
                    }
                }
                this._saveState();
                for (const target of changedInstances) {
                    this._evaluate(target.instanceId,
                        `window.ding?._setConfig(${JSON.stringify(target.config)});`);
                }
            }
            break;
        case 'createWidget':
            if (payload.widgetId === instance.widgetId)
                this.createInstance(instance.widgetId, instance.monitorId);
            break;
        case 'removeWidget':
            this.removeInstance(instance.instanceId);
            break;
        case 'resizeWidget':
            this._resizeWidget(instance, payload);
            break;
        case 'calendarGetEvents':
            this._queueCalendarQuery(instance, payload);
            break;
        case 'calendarCreateEvent':
            this._createCalendarEvent(payload.event)
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'powerGetDevices':
            this._getPowerDevices()
                .then(devices => this._replyToWidget(
                    instance, payload.requestId, {devices}
                ))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'photoChooseFolder':
            if (instance.widgetId !== 'ding.mac.photos') {
                this._replyToWidget(instance, payload.requestId, null,
                    '只有照片小组件可以选择照片文件夹');
                break;
            }
            this._choosePhotoFolder(instance)
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'photoListImages':
            try {
                this._replyToWidget(instance, payload.requestId, {
                    images: this._listPhotoImages(instance, payload.folderPath),
                });
            } catch (error) {
                this._replyToWidget(instance, payload.requestId, null, error.message);
            }
            break;
        case 'photoLoadImage':
            this._loadPhotoImage(instance, payload.path)
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'mediaGetPlayers':
            this._mediaRequest(instance, () => this._getMediaPlayers())
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'mediaGetPlayerState':
            this._mediaRequest(instance, () =>
                this._getMediaPlayer(String(payload.busName ?? '')))
                .then(player => this._replyToWidget(instance, payload.requestId, {player}))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'mediaControl':
            this._mediaRequest(instance, () => this._controlMediaPlayer(
                String(payload.busName ?? ''),
                String(payload.action ?? ''),
                payload.value
            ))
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'mediaListApplications':
            try {
                const applications = this._mediaRequestSync(
                    instance, () => this._listMediaApplications()
                );
                this._replyToWidget(instance, payload.requestId, {applications});
            } catch (error) {
                this._replyToWidget(instance, payload.requestId, null, error.message);
            }
            break;
        case 'mediaLaunchApplication':
            this._mediaRequest(instance, () =>
                this._launchMediaApplication(String(payload.desktopId ?? '')))
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'mediaLoadArtwork':
            this._mediaRequest(instance, () =>
                this._loadMediaArtwork(String(payload.uri ?? '')))
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'systemMonitorGetState':
            if (instance.widgetId !== 'ding.mac.system-monitor') {
                this._replyToWidget(instance, payload.requestId, null,
                    '只有系统监控小组件可以读取系统性能信息');
                break;
            }
            this._systemMonitor.snapshot(payload.forceDeviceScan === true)
                .then(value => this._replyToWidget(instance, payload.requestId, value))
                .catch(error => this._replyToWidget(
                    instance, payload.requestId, null, error.message
                ));
            break;
        case 'setEditMode':
            this.setEditMode(!!payload.editing);
            break;
        case 'log':
            console.log(`DING widget ${instance.widgetId}: ${payload.message ?? ''}`);
            break;
        }
    }

    _replyToWidget(instance, requestId, result = null, error = '') {
        if (typeof requestId !== 'string' || !this._frames.has(instance.instanceId))
            return;
        this._evaluate(instance.instanceId,
            `window.ding?._resolveRequest(${JSON.stringify(requestId)}, ` +
            `${JSON.stringify(result)}, ${JSON.stringify(error)});`);
    }

    _scheduleCalendarChangedNotification() {
        if (GLib.get_monotonic_time() < this._calendarSignalSilenceUntil)
            return;
        this._calendarResultCache = null;
        if (this._calendarChangedDebounceId)
            GLib.source_remove(this._calendarChangedDebounceId);
        this._calendarChangedDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            350,
            () => {
                this._calendarChangedDebounceId = 0;
                for (const [instanceId, instance] of this._instances) {
                    if (instance.widgetId === 'ding.mac.calendar')
                        this._evaluate(instanceId, 'window.ding?._notifyCalendarChanged();');
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _queueCalendarQuery(instance, payload) {
        const start = Math.trunc(Number(payload.start) || 0);
        const end = Math.trunc(Number(payload.end) || 0);
        if (typeof payload.requestId !== 'string' || start <= 0 || end <= start) {
            this._replyToWidget(instance, payload.requestId, null, '日历查询范围无效');
            return;
        }

        const cacheKey = `${start}:${end}`;
        const now = GLib.get_monotonic_time();
        if (this._calendarResultCache?.key === cacheKey &&
            now - this._calendarResultCache.savedAt < 10 * GLib.USEC_PER_SEC) {
            this._replyToWidget(instance, payload.requestId, {
                events: clone(this._calendarResultCache.events),
            });
            return;
        }

        this._calendarQueue = this._calendarQueue
            .catch(() => {})
            .then(() => {
                const queuedNow = GLib.get_monotonic_time();
                if (this._calendarResultCache?.key === cacheKey &&
                    queuedNow - this._calendarResultCache.savedAt <
                        10 * GLib.USEC_PER_SEC)
                    return clone(this._calendarResultCache.events);
                return this._fetchCalendarEvents(start, end);
            });
        this._calendarQueue
            .then(events => {
                this._calendarResultCache = {
                    key: cacheKey,
                    savedAt: GLib.get_monotonic_time(),
                    events: clone(events),
                };
                this._replyToWidget(instance, payload.requestId, {events});
            })
            .catch(error => this._replyToWidget(
                instance, payload.requestId, null, error.message
            ));
    }

    _fetchCalendarEvents(start, end) {
        return new Promise((resolve, reject) => {
            const connection = Gio.DBus.session;
            const events = new Map();
            let signalId = 0;
            let timeoutId = 0;
            let finished = false;
            let callCompleted = false;
            let receivedEvents = false;

            const cleanup = () => {
                if (signalId)
                    connection.signal_unsubscribe(signalId);
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                signalId = 0;
                timeoutId = 0;
            };
            const finish = error => {
                if (finished)
                    return;
                finished = true;
                cleanup();
                if (error)
                    reject(error);
                else
                    resolve([...events.values()].sort((a, b) => a.start - b.start));
            };
            const scheduleFinish = delay => {
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                timeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    delay,
                    () => {
                        timeoutId = 0;
                        finish(null);
                        return GLib.SOURCE_REMOVE;
                    }
                );
            };

            signalId = connection.signal_subscribe(
                null,
                'org.gnome.Shell.CalendarServer',
                'EventsAddedOrUpdated',
                '/org/gnome/Shell/CalendarServer',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _interface, _signal, parameters) => {
                    try {
                        const unpack = value =>
                            typeof value?.deepUnpack === 'function'
                                ? value.deepUnpack()
                                : value;
                        const tuple = unpack(parameters);
                        const rows = unpack(tuple?.[0]) ?? [];
                        if ((rows ?? []).length)
                            receivedEvents = true;
                        for (const rawRow of rows ?? []) {
                            const row = unpack(rawRow);
                            const id = unpack(row?.[0]);
                            const title = unpack(row?.[1]);
                            const numericStart = Number(unpack(row?.[2]));
                            const numericEnd = Number(unpack(row?.[3]));
                            if (!Number.isFinite(numericStart) ||
                                !Number.isFinite(numericEnd) ||
                                numericEnd <= start || numericStart >= end)
                                continue;
                            const localStart = new Date(numericStart * 1000);
                            const localEnd = new Date(numericEnd * 1000);
                            events.set(String(id), {
                                id: String(id),
                                title: String(title || '无标题日程'),
                                start: numericStart,
                                end: numericEnd,
                                // GNOME's event ID starts with the calendar
                                // source. Hashing only that first line made
                                // every event in the default calendar red.
                                // Use the complete stable ID so individual
                                // schedules receive stable, varied colors.
                                color: this._calendarColor(String(id)),
                                allDay: localStart.getHours() === 0 &&
                                    localStart.getMinutes() === 0 &&
                                    localEnd.getHours() === 0 &&
                                    localEnd.getMinutes() === 0 &&
                                    (numericEnd - numericStart) % 86400 === 0,
                            });
                        }
                        if (callCompleted && receivedEvents)
                            scheduleFinish(900);
                    } catch (error) {
                        console.warn(`DING widgets: invalid calendar event data: ${error.message}`);
                    }
                }
            );

            this._calendarSignalSilenceUntil = GLib.get_monotonic_time() +
                6 * GLib.USEC_PER_SEC;
            connection.call(
                'org.gnome.Shell.CalendarServer',
                '/org/gnome/Shell/CalendarServer',
                'org.gnome.Shell.CalendarServer',
                'SetTimeRange',
                new GLib.Variant('(xxb)', [start, end, true]),
                null,
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (source, result) => {
                    try {
                        source.call_finish(result);
                        callCompleted = true;
                        // CalendarServer populates its EDS views asynchronously.
                        // A non-empty result can settle soon after the last batch.
                        // On a cold EDS start CalendarServer may need several
                        // seconds before emitting its first event batch. Keep the
                        // empty-result window aligned with the verified 10-second
                        // D-Bus monitor instead of prematurely caching no events.
                        scheduleFinish(receivedEvents ? 900 : 9500);
                    } catch (error) {
                        finish(new Error(
                            `无法读取 GNOME 系统日历：${error.message}`
                        ));
                    }
                }
            );
        });
    }

    _calendarColor(sourceId) {
        const palette = ['#ff5570', '#3478f6', '#ffae22', '#30c978', '#a45de8', '#00a9b8'];
        let hash = 0;
        for (const character of sourceId)
            hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
        return palette[Math.abs(hash) % palette.length];
    }

    _getPowerDevices() {
        const connection = Gio.DBus.system;
        return new Promise((resolve, reject) => {
            connection.call(
                'org.freedesktop.UPower',
                '/org/freedesktop/UPower',
                'org.freedesktop.UPower',
                'EnumerateDevices',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (source, result) => {
                    let paths;
                    try {
                        const reply = source.call_finish(result);
                        [paths] = reply.deepUnpack();
                    } catch (error) {
                        reject(new Error(`无法读取系统电源设备：${error.message}`));
                        return;
                    }

                    Promise.all((paths ?? []).map(path =>
                        this._getPowerDevice(String(path)).catch(() => null)
                    )).then(devices => resolve(devices.filter(Boolean)));
                }
            );
        });
    }

    _getPowerDevice(path) {
        const connection = Gio.DBus.system;
        return new Promise((resolve, reject) => {
            connection.call(
                'org.freedesktop.UPower',
                path,
                'org.freedesktop.DBus.Properties',
                'GetAll',
                new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']),
                null,
                Gio.DBusCallFlags.NONE,
                4000,
                null,
                (source, result) => {
                    try {
                        const reply = source.call_finish(result);
                        const [rawProperties] = reply.deepUnpack();
                        const unpack = value =>
                            typeof value?.deepUnpack === 'function'
                                ? value.deepUnpack()
                                : value;
                        const property = name => unpack(rawProperties?.[name]);
                        const type = Number(property('Type')) || 0;
                        const percentage = Number(property('Percentage'));
                        const isPresent = property('IsPresent') !== false;

                        // Skip AC adapters and devices without usable charge
                        // data. EnumerateDevices returns the physical laptop
                        // battery, so no composite DisplayDevice is needed.
                        if (!isPresent || type === 0 || type === 1 ||
                            !Number.isFinite(percentage)) {
                            resolve(null);
                            return;
                        }

                        const typeInfo = this._powerDeviceType(type);
                        const model = String(property('Model') ?? '').trim();
                        const vendor = String(property('Vendor') ?? '').trim();
                        const nativePath = String(property('NativePath') ?? '').trim();
                        let name = type === 2 && property('PowerSupply') === true
                            ? '笔记本电脑'
                            : model;
                        if (!name && type === 2)
                            name = vendor || '笔记本电脑';
                        if (!name)
                            name = typeInfo.label;

                        resolve({
                            id: path,
                            name,
                            vendor,
                            model,
                            nativePath,
                            type,
                            kind: typeInfo.kind,
                            typeLabel: typeInfo.label,
                            percentage: Math.max(0, Math.min(100, percentage)),
                            state: Number(property('State')) || 0,
                            powerSupply: property('PowerSupply') === true,
                            iconName: String(property('IconName') ?? ''),
                        });
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    _powerDeviceType(type) {
        const types = {
            2: ['battery', '笔记本电脑'],
            3: ['battery', 'UPS'],
            4: ['monitor', '显示器'],
            5: ['mouse', '鼠标'],
            6: ['keyboard', '键盘'],
            7: ['phone', '掌上设备'],
            8: ['phone', '手机'],
            9: ['media-player', '媒体播放器'],
            10: ['tablet', '平板电脑'],
            11: ['computer', '电脑'],
            12: ['gamepad', '游戏控制器'],
            13: ['pen', '手写笔'],
            14: ['touchpad', '触控板'],
            15: ['modem', '调制解调器'],
            16: ['network', '网络设备'],
            17: ['headset', '耳麦'],
            18: ['speaker', '扬声器'],
            19: ['headset', '耳机'],
            20: ['camera', '视频设备'],
            21: ['speaker', '音频设备'],
            22: ['remote', '遥控器'],
            23: ['printer', '打印机'],
            24: ['scanner', '扫描仪'],
            25: ['camera', '相机'],
            26: ['wearable', '可穿戴设备'],
            27: ['gamepad', '玩具'],
            28: ['bluetooth', '蓝牙设备'],
        };
        const [kind, label] = types[type] ?? ['battery', '其他设备'];
        return {kind, label};
    }

    _mediaRequest(instance, callback) {
        if (instance.widgetId !== 'ding.mac.music')
            return Promise.reject(new Error('只有音乐小组件可以访问播放器'));
        return Promise.resolve().then(callback);
    }

    _mediaRequestSync(instance, callback) {
        if (instance.widgetId !== 'ding.mac.music')
            throw new Error('只有音乐小组件可以访问播放器');
        return callback();
    }

    _scheduleMediaChangedNotification() {
        if (this._mediaChangedDebounceId)
            GLib.source_remove(this._mediaChangedDebounceId);
        this._mediaChangedDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            160,
            () => {
                this._mediaChangedDebounceId = 0;
                for (const [instanceId, instance] of this._instances) {
                    if (instance.widgetId === 'ding.mac.music')
                        this._evaluate(instanceId, 'window.ding?._notifyMediaChanged();');
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _dbusCall(connection, busName, objectPath, interfaceName, methodName,
        parameters = null, timeout = 4000) {
        return new Promise((resolve, reject) => {
            connection.call(
                busName,
                objectPath,
                interfaceName,
                methodName,
                parameters,
                null,
                Gio.DBusCallFlags.NONE,
                timeout,
                null,
                (source, result) => {
                    try {
                        resolve(source.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    _dbusValue(value) {
        if (typeof value?.deepUnpack === 'function')
            return this._dbusValue(value.deepUnpack());
        if (typeof value === 'bigint')
            return Number(value);
        if (Array.isArray(value))
            return value.map(item => this._dbusValue(item));
        if (value && typeof value === 'object') {
            const unpacked = {};
            for (const [key, item] of Object.entries(value))
                unpacked[key] = this._dbusValue(item);
            return unpacked;
        }
        return value;
    }

    async _dbusGetAll(busName, interfaceName) {
        const reply = await this._dbusCall(
            Gio.DBus.session,
            busName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            new GLib.Variant('(s)', [interfaceName])
        );
        const [properties] = reply.deepUnpack();
        return this._dbusValue(properties ?? {});
    }

    _isMediaBusName(busName) {
        return typeof busName === 'string' && busName.length < 256 &&
            /^org\.mpris\.MediaPlayer2\.[A-Za-z0-9_.-]+$/.test(busName);
    }

    async _getMediaPlayer(busName) {
        if (!this._isMediaBusName(busName))
            throw new Error('播放器标识无效');
        const [root, player] = await Promise.all([
            this._dbusGetAll(busName, 'org.mpris.MediaPlayer2'),
            this._dbusGetAll(busName, 'org.mpris.MediaPlayer2.Player'),
        ]);
        const metadata = player.Metadata && typeof player.Metadata === 'object'
            ? player.Metadata
            : {};
        const rawArtists = metadata['xesam:artist'];
        const artists = Array.isArray(rawArtists)
            ? rawArtists.map(String).filter(Boolean)
            : rawArtists ? [String(rawArtists)] : [];
        const desktopEntry = String(root.DesktopEntry ?? '').trim();
        const identity = String(root.Identity ??
            busName.slice('org.mpris.MediaPlayer2.'.length)).trim();
        const browserText = `${desktopEntry} ${identity} ${busName}`.toLowerCase();
        const browser = ['firefox', 'chrome', 'chromium', 'brave', 'edge', 'vivaldi']
            .some(name => browserText.includes(name));
        const number = value => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : 0;
        };
        return {
            busName,
            identity: identity || '媒体播放器',
            desktopEntry,
            browser,
            playbackStatus: String(player.PlaybackStatus ?? 'Stopped'),
            loopStatus: String(player.LoopStatus ?? 'None'),
            shuffle: player.Shuffle === true,
            volume: Math.max(0, number(player.Volume)),
            rate: number(player.Rate) || 1,
            positionUs: Math.max(0, number(player.Position)),
            lengthUs: Math.max(0, number(metadata['mpris:length'])),
            trackId: String(metadata['mpris:trackid'] ?? ''),
            title: String(metadata['xesam:title'] ?? '未知曲目'),
            artists,
            artist: artists.join('、') || '未知艺术家',
            album: String(metadata['xesam:album'] ?? ''),
            artUrl: String(metadata['mpris:artUrl'] ?? ''),
            canGoNext: player.CanGoNext === true,
            canGoPrevious: player.CanGoPrevious === true,
            canPlay: player.CanPlay === true,
            canPause: player.CanPause === true,
            canSeek: player.CanSeek === true,
            canControl: player.CanControl === true,
            canRaise: root.CanRaise === true,
        };
    }

    async _getMediaPlayers() {
        const reply = await this._dbusCall(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames'
        );
        const [rawNames] = reply.deepUnpack();
        const names = (rawNames ?? []).map(String).filter(name =>
            this._isMediaBusName(name));
        const players = (await Promise.all(names.map(name =>
            this._getMediaPlayer(name).catch(() => null)
        ))).filter(Boolean);
        const statusRank = {Playing: 0, Paused: 1, Stopped: 2};
        players.sort((left, right) =>
            (statusRank[left.playbackStatus] ?? 3) -
            (statusRank[right.playbackStatus] ?? 3) ||
            left.identity.localeCompare(right.identity, 'zh-CN')
        );
        return {players};
    }

    async _controlMediaPlayer(busName, action, value) {
        if (!this._isMediaBusName(busName))
            throw new Error('播放器标识无效');
        const playerInterface = 'org.mpris.MediaPlayer2.Player';
        const simpleMethods = {
            playPause: 'PlayPause',
            play: 'Play',
            pause: 'Pause',
            stop: 'Stop',
            next: 'Next',
            previous: 'Previous',
        };
        if (simpleMethods[action]) {
            await this._dbusCall(
                Gio.DBus.session, busName, '/org/mpris/MediaPlayer2',
                playerInterface, simpleMethods[action]
            );
        } else if (action === 'setPosition') {
            const trackId = String(value?.trackId ?? '');
            const positionUs = Math.max(0, Math.round(Number(value?.positionUs) || 0));
            if (!trackId.startsWith('/'))
                throw new Error('当前曲目不支持跳转');
            await this._dbusCall(
                Gio.DBus.session, busName, '/org/mpris/MediaPlayer2',
                playerInterface, 'SetPosition',
                new GLib.Variant('(ox)', [trackId, positionUs])
            );
        } else if (action === 'setVolume') {
            const volume = Math.max(0, Math.min(1, Number(value) || 0));
            await this._setMediaProperty(busName, 'Volume', 'd', volume);
        } else if (action === 'setShuffle') {
            await this._setMediaProperty(busName, 'Shuffle', 'b', value === true);
        } else if (action === 'setLoopStatus') {
            const loopStatus = ['None', 'Track', 'Playlist'].includes(String(value))
                ? String(value)
                : 'None';
            await this._setMediaProperty(busName, 'LoopStatus', 's', loopStatus);
        } else if (action === 'raise') {
            await this._dbusCall(
                Gio.DBus.session, busName, '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2', 'Raise'
            );
        } else {
            throw new Error('不支持的播放器操作');
        }
        return {ok: true};
    }

    _setMediaProperty(busName, propertyName, signature, value) {
        return this._dbusCall(
            Gio.DBus.session,
            busName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.mpris.MediaPlayer2.Player',
                propertyName,
                new GLib.Variant(signature, value),
            ])
        );
    }

    _listMediaApplications() {
        const applications = [];
        for (const app of Gio.AppInfo.get_all()) {
            try {
                const desktopId = String(app.get_id?.() ?? '').trim();
                if (!desktopId || app.should_show?.() === false)
                    continue;
                const name = String(app.get_display_name?.() ??
                    app.get_name?.() ?? desktopId).trim();
                const description = String(app.get_description?.() ?? '').trim();
                const categories = String(app.get_categories?.() ?? '');
                const supportedTypes = app.get_supported_types?.() ?? [];
                const media = /(^|;)(AudioVideo|Audio|Music|Player)(;|$)/i
                    .test(categories) || supportedTypes.some(type =>
                        String(type).startsWith('audio/'));
                applications.push({desktopId, name, description, media});
            } catch (_error) {
                // Skip malformed desktop entries without hiding other apps.
            }
        }
        applications.sort((left, right) =>
            Number(right.media) - Number(left.media) ||
            left.name.localeCompare(right.name, 'zh-CN')
        );
        return applications;
    }

    _launchMediaApplication(desktopId) {
        return new Promise((resolve, reject) => {
            try {
                if (!desktopId.endsWith('.desktop') || desktopId.includes('/') ||
                    desktopId.includes('\0') || desktopId.length > 255)
                    throw new Error('应用标识无效');
                const app = GioUnix.DesktopAppInfo.new(desktopId);
                if (!app)
                    throw new Error('找不到该应用');
                const context = Gdk.Display.get_default()?.get_app_launch_context() ?? null;
                context?.set_timestamp(Gdk.CURRENT_TIME);
                app.launch([], context);
                resolve({launched: true, desktopId});
            } catch (error) {
                reject(new Error(`无法启动应用：${error.message}`));
            }
        });
    }

    _loadMediaArtwork(uri) {
        if (typeof uri !== 'string' || !uri)
            return Promise.reject(new Error('封面地址为空'));
        if (/^https?:\/\//i.test(uri))
            return Promise.resolve({url: uri});
        if (/^data:image\//i.test(uri) && uri.length <= 12 * 1024 * 1024)
            return Promise.resolve({url: uri});
        if (!uri.startsWith('file://'))
            return Promise.reject(new Error('不支持的封面地址'));

        const file = Gio.File.new_for_uri(uri);
        let info;
        try {
            info = file.query_info(
                'standard::type,standard::content-type,standard::size',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null
            );
            const mimeType = this._photoMimeType(info);
            if (info.get_file_type() !== Gio.FileType.REGULAR || !mimeType)
                throw new Error('封面不是支持的图片');
            if (Number(info.get_size()) > 20 * 1024 * 1024)
                throw new Error('封面图片超过 20 MB');
        } catch (error) {
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            file.load_contents_async(null, (source, result) => {
                try {
                    const [ok, contents] = source.load_contents_finish(result);
                    if (!ok)
                        throw new Error('无法读取封面');
                    resolve({
                        url: `data:${this._photoMimeType(info)};base64,` +
                            GLib.base64_encode(contents),
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _choosePhotoFolder(instance) {
        const parent = this._frames.get(instance.instanceId)?.grid?.Window ??
            this._targetGrid?.Window ?? this._grids[0]?.Window ?? null;
        if (typeof Gtk.FileDialog === 'function') {
            return new Promise((resolve, reject) => {
                const dialog = new Gtk.FileDialog({
                    title: '选择照片文件夹',
                    modal: true,
                });
                dialog.select_folder(parent, null, (source, result) => {
                    try {
                        const folder = source.select_folder_finish(result);
                        const path = folder.get_path();
                        if (!path)
                            throw new Error('请选择本机文件夹');
                        instance.photoFolderGrant = GLib.canonicalize_filename(path, null);
                        resolve({
                            cancelled: false,
                            path: instance.photoFolderGrant,
                            name: folder.get_basename(),
                        });
                    } catch (error) {
                        if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            resolve({cancelled: true});
                        else
                            reject(error);
                    }
                });
            });
        }

        return new Promise((resolve, reject) => {
            try {
                const dialog = new Gtk.FileChooserNative({
                    title: '选择照片文件夹',
                    transient_for: parent,
                    modal: true,
                    action: Gtk.FileChooserAction.SELECT_FOLDER,
                    accept_label: '选择',
                    cancel_label: '取消',
                });
                dialog.connect('response', (chooser, response) => {
                    if (response === Gtk.ResponseType.ACCEPT) {
                        const folder = chooser.get_file();
                        const path = folder?.get_path() ?? '';
                        if (!path) {
                            reject(new Error('请选择本机文件夹'));
                            chooser.destroy?.();
                            return;
                        }
                        instance.photoFolderGrant = GLib.canonicalize_filename(path, null);
                        resolve({
                            cancelled: false,
                            path: instance.photoFolderGrant,
                            name: folder?.get_basename() ?? '照片',
                        });
                    } else {
                        resolve({cancelled: true});
                    }
                    chooser.destroy?.();
                });
                dialog.show();
            } catch (error) {
                reject(error);
            }
        });
    }

    _photoMimeType(info) {
        const contentType = info.get_content_type?.() ?? '';
        const mimeType = Gio.content_type_get_mime_type(contentType) ?? contentType;
        const allowed = new Set([
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'image/bmp', 'image/svg+xml', 'image/avif',
        ]);
        return allowed.has(mimeType) ? mimeType : '';
    }

    _photoFolderPath(instance, folderPath) {
        if (instance.widgetId !== 'ding.mac.photos' ||
            typeof folderPath !== 'string' || !GLib.path_is_absolute(folderPath))
            throw new Error('照片文件夹路径无效');
        const requested = GLib.canonicalize_filename(folderPath, null);
        const configured = typeof instance.config?.folderPath === 'string' &&
            GLib.path_is_absolute(instance.config.folderPath)
            ? GLib.canonicalize_filename(instance.config.folderPath, null)
            : '';
        if (requested !== configured && requested !== instance.photoFolderGrant)
            throw new Error('未授权读取该照片文件夹');
        return requested;
    }

    _listPhotoImages(instance, folderPath) {
        const authorizedFolder = this._photoFolderPath(instance, folderPath);
        const folder = Gio.File.new_for_path(authorizedFolder);
        const folderInfo = folder.query_info(
            'standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
        if (folderInfo.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error('所选路径不是文件夹');

        const enumerator = folder.enumerate_children(
            'standard::name,standard::display-name,standard::type,' +
            'standard::content-type,standard::size,time::modified',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
        const images = [];
        try {
            let info;
            while (images.length < 2000 &&
                (info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR)
                    continue;
                const mimeType = this._photoMimeType(info);
                if (!mimeType)
                    continue;
                const name = info.get_name();
                images.push({
                    path: folder.get_child(name).get_path(),
                    name: info.get_display_name() || name,
                    mimeType,
                    size: Number(info.get_size()) || 0,
                    modified: Number(info.get_modification_date_time()?.to_unix()) || 0,
                });
            }
        } finally {
            enumerator.close(null);
        }
        images.sort((left, right) =>
            left.name.localeCompare(right.name, undefined, {numeric: true})
        );
        return images;
    }

    _loadPhotoImage(instance, path) {
        return new Promise((resolve, reject) => {
            if (typeof path !== 'string' || !GLib.path_is_absolute(path)) {
                reject(new Error('照片路径无效'));
                return;
            }
            let authorizedPath;
            try {
                const folderPath = this._photoFolderPath(
                    instance, instance.config?.folderPath ?? ''
                );
                authorizedPath = GLib.canonicalize_filename(path, null);
                if (GLib.path_get_dirname(authorizedPath) !== folderPath)
                    throw new Error('未授权读取该照片');
            } catch (error) {
                reject(error);
                return;
            }
            const file = Gio.File.new_for_path(authorizedPath);
            let info;
            try {
                info = file.query_info(
                    'standard::type,standard::content-type,standard::size',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    null
                );
                const mimeType = this._photoMimeType(info);
                if (info.get_file_type() !== Gio.FileType.REGULAR || !mimeType)
                    throw new Error('该文件不是支持的图片格式');
                if (Number(info.get_size()) > 32 * 1024 * 1024)
                    throw new Error('单张照片不能超过 32 MB');
            } catch (error) {
                reject(error);
                return;
            }

            file.load_contents_async(null, (source, result) => {
                try {
                    const [ok, contents] = source.load_contents_finish(result);
                    if (!ok)
                        throw new Error('无法读取照片');
                    resolve({
                        path: authorizedPath,
                        dataUrl: `data:${this._photoMimeType(info)};base64,` +
                            GLib.base64_encode(contents),
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _createCalendarEvent(event) {
        return new Promise((resolve, reject) => {
            const title = typeof event?.title === 'string' ? event.title.trim() : '';
            const start = Math.trunc(Number(event?.start) || 0);
            const end = Math.trunc(Number(event?.end) || 0);
            if (!title || start <= 0 || end <= start) {
                reject(new Error('日程标题或时间无效'));
                return;
            }

            const helper = GLib.build_filenamev([
                this._codePath,
                'calendarBackend.js',
            ]);
            const argv = ['gjs', '-m', helper, JSON.stringify({
                title,
                location: typeof event.location === 'string' ? event.location : '',
                start,
                end,
            })];
            let process;
            let stdoutStream;
            let timeoutId = 0;
            let settled = false;
            const settle = (error, value = null) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                timeoutId = 0;
                try {
                    stdoutStream?.close(null);
                } catch (_error) {
                    // The child may already have closed the pipe.
                }
                if (error)
                    reject(error);
                else {
                    this._calendarResultCache = null;
                    resolve(value);
                }
            };
            try {
                process = new Gio.Subprocess({
                    argv,
                    flags: Gio.SubprocessFlags.STDOUT_PIPE |
                        Gio.SubprocessFlags.STDERR_PIPE,
                });
                process.init(null);
            } catch (error) {
                settle(new Error(`无法启动系统日历后端：${error.message}`));
                return;
            }

            timeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                30000,
                () => {
                    timeoutId = 0;
                    try {
                        process.force_exit();
                    } catch (_error) {
                        // The process may have exited between the timeout and here.
                    }
                    settle(new Error(
                        '系统日历在 30 秒内没有响应，请检查默认日历账户或 EDS 服务'
                    ));
                    return GLib.SOURCE_REMOVE;
                }
            );

            // Read the helper's first JSON line as soon as it is printed. Do
            // not wait for GJS to tear down ECal/ICalGLib objects: on some
            // versions that teardown hangs or crashes after a successful write.
            stdoutStream = new Gio.DataInputStream({
                base_stream: process.get_stdout_pipe(),
                close_base_stream: true,
            });
            stdoutStream.read_line_async(
                GLib.PRIORITY_DEFAULT,
                null,
                (source, result) => {
                    if (settled)
                        return;
                    try {
                        const finished = source.read_line_finish_utf8(result);
                        const line = Array.isArray(finished) ? finished[0] : finished;
                        if (!line)
                            throw new Error('系统日历后端未返回结果');
                        const response = JSON.parse(line);
                        if (response.ok) {
                            try {
                                process.force_exit();
                            } catch (_error) {
                                // It may have exited immediately after printing.
                            }
                            settle(null, response);
                            return;
                        }
                        throw new Error(response.error || '系统日历拒绝了该日程');
                    } catch (error) {
                        settle(new Error(error.message));
                    }
                }
            );
        });
    }

    _resizeWidget(instance, payload) {
        const descriptor = this._descriptors.get(instance.widgetId);
        const record = this._frames.get(instance.instanceId);
        if (!descriptor || !record)
            return;

        const grid = record.grid;
        const width = clamp(
            payload.width,
            descriptor.minimumWidth,
            Math.min(MAX_WIDGET_SIZE, grid.widgetWidth)
        );
        const height = clamp(
            payload.height,
            descriptor.minimumHeight,
            Math.min(MAX_WIDGET_SIZE, grid.widgetHeight)
        );
        const x = clamp(record.x, 0, grid.widgetWidth - width);
        const y = clamp(record.y, 0, grid.widgetHeight - height);

        instance.x = x;
        instance.y = y;
        instance.width = width;
        instance.height = height;
        record.x = x;
        record.y = y;
        grid.moveWidget(record.frame, x, y);
        record.frame.set_size_request(Math.round(width), Math.round(height));
        this._saveState();
    }

    _hostState(instance = null) {
        return {
            editMode: this._editMode,
            widgetEditMode: this._editMode,
            selected: false,
            theme: Gtk.Settings.get_default()?.gtk_application_prefer_dark_theme
                ? 'dark'
                : 'light',
        };
    }

    _evaluate(instanceId, script) {
        const webView = this._frames.get(instanceId)?.webView;
        if (!webView)
            return;
        try {
            webView.evaluate_javascript(
                script,
                -1,
                null,
                null,
                null,
                (view, result) => {
                    try {
                        view.evaluate_javascript_finish(result);
                    } catch (_e) {
                        // The page may be reloading or closing.
                    }
                }
            );
        } catch (_e) {
            // The page may not have completed loading yet.
        }
    }

    _pushHostState(instanceId) {
        const instance = this._instances.get(instanceId);
        if (!instance)
            return;
        const state = JSON.stringify(this._hostState(instance));
        this._evaluate(instanceId, `window.ding?._setHostState(${state});`);
    }

    setEditMode(enabled) {
        this._editMode = !!enabled;
        for (const [instanceId, record] of this._frames) {
            record.chrome.bar.set_visible(this._editMode);
            this._pushHostState(instanceId);
        }
    }

    toggleEditMode() {
        this.setEditMode(!this._editMode);
    }

    showChooser() {
        if (!this._ready || !this._available)
            return;
        if (this._chooser) {
            this._chooser.present();
            return;
        }

        const window = new Gtk.ApplicationWindow({
            application: this._mainApp,
            title: '添加小组件',
            default_width: 480,
            default_height: 480,
            modal: true,
            transient_for: this._targetGrid?.Window ?? this._grids[0]?.Window,
        });
        const scroller = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        list.add_css_class('boxed-list');

        for (const descriptor of this._descriptors.values()) {
            const row = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 12,
                margin_end: 12,
            });
            const text = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 3,
                hexpand: true,
            });
            text.append(new Gtk.Label({
                label: descriptor.name ?? descriptor.id,
                xalign: 0,
            }));
            text.append(new Gtk.Label({
                label: descriptor.description ?? '',
                xalign: 0,
                wrap: true,
                css_classes: ['dim-label'],
            }));
            const button = new Gtk.Button({label: '添加'});
            button.connect('clicked', () => {
                this.createInstance(descriptor.id);
                window.close();
            });
            row.append(text);
            row.append(button);
            list.append(row);
        }
        scroller.set_child(list);
        window.set_child(scroller);
        window.connect('close-request', () => {
            this._chooser = null;
            return false;
        });
        this._chooser = window;
        window.present();
    }

    destroy() {
        this._saveState();
        this._removeAllFrames();
        if (this._chooser)
            this._chooser.destroy();
        for (const window of this._prefsWindows.values())
            window.destroy();
        this._prefsWindows.clear();
        if (this._settingsId)
            Prefs.desktopSettings.disconnect(this._settingsId);
        if (this._sleepSignalId)
            Gio.DBus.system.signal_unsubscribe(this._sleepSignalId);
        if (this._calendarChangedSignalId)
            Gio.DBus.session.signal_unsubscribe(this._calendarChangedSignalId);
        if (this._calendarRemovedSignalId)
            Gio.DBus.session.signal_unsubscribe(this._calendarRemovedSignalId);
        if (this._calendarChangedDebounceId)
            GLib.source_remove(this._calendarChangedDebounceId);
        if (this._mediaPropertiesSignalId)
            Gio.DBus.session.signal_unsubscribe(this._mediaPropertiesSignalId);
        if (this._mediaOwnerSignalId)
            Gio.DBus.session.signal_unsubscribe(this._mediaOwnerSignalId);
        if (this._mediaChangedDebounceId)
            GLib.source_remove(this._mediaChangedDebounceId);
    }
}
