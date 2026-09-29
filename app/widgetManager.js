/* DING: Desktop Icons New Generation for GNOME Shell
 *
 * Desktop widget support for the rastersoft GTK4 code base.
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';

import * as Prefs from './preferences.js';

const Gettext = imports.gettext.domain('ding');
const _ = Gettext.gettext;

const STATE_VERSION = 1;
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
        // Keep the chooser focused on this fork's three bundled Chinese
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
                const manifest = readJson(directory.get_child('widget.json'));
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
        if (!state || state.version !== STATE_VERSION || !Array.isArray(state.instances))
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

    _gridForMonitor(monitor) {
        return this._grids.find(grid => grid.widgetMonitor === monitor) ??
            this._grids.find(grid =>
                grid.widgetMonitor === this._desktopManager.primaryMonitorIndex
            ) ?? this._grids[0] ?? null;
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

    createInstance(widgetId, monitor = null) {
        const descriptor = this._descriptors.get(widgetId);
        const grid = this._targetGrid ?? this._grids[0];
        if (!descriptor || !grid)
            return;

        const sameMonitorCount = Array.from(this._instances.values())
            .filter(item => item.monitor === grid.widgetMonitor).length;
        const offset = (sameMonitorCount % 8) * 28;
        const instance = {
            instanceId: GLib.uuid_string_random(),
            widgetId,
            monitor: monitor ?? grid.widgetMonitor,
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
        const grid = this._gridForMonitor(instance.monitor);
        if (!descriptor || !grid)
            return;

        const temporarilyRelocated = instance.monitor !== grid.widgetMonitor;
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
        const oldX = sourceRecord.x;
        const oldY = sourceRecord.y;
        this._frames.delete(instance.instanceId);
        instance.monitor = destination.grid.widgetMonitor;
        instance.x = destination.x;
        instance.y = destination.y;
        const targetRecord = this._mountInstance(instance);
        if (!targetRecord) {
            instance.monitor = oldMonitor;
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
        }
    };
})();`;
    }

    _extractMessage(result) {
        try {
            const value = typeof result.get_js_value === 'function'
                ? result.get_js_value()
                : result.get_value();
            const json = value?.is_string?.()
                ? value.to_string()
                : value?.to_json?.(0) ?? value?.to_string?.();
            if (typeof json !== 'string')
                return null;
            let payload = JSON.parse(json);
            if (typeof payload === 'string')
                payload = JSON.parse(payload);
            return payload;
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
                this._saveState();
                this._evaluate(instance.instanceId,
                    `window.ding?._setConfig(${JSON.stringify(instance.config)});`);
            }
            break;
        case 'createWidget':
            if (payload.widgetId === instance.widgetId)
                this.createInstance(instance.widgetId, instance.monitor);
            break;
        case 'removeWidget':
            this.removeInstance(instance.instanceId);
            break;
        case 'setEditMode':
            this.setEditMode(!!payload.editing);
            break;
        case 'log':
            console.log(`DING widget ${instance.widgetId}: ${payload.message ?? ''}`);
            break;
        }
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
    }
}
