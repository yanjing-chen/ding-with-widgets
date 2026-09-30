/* DING with Widgets system monitor data provider
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const decoder = new TextDecoder();
const CACHE_INTERVAL_US = 750000;
const VENDORS = new Map([
    ['0x1002', 'AMD'],
    ['0x10de', 'NVIDIA'],
    ['0x8086', 'Intel'],
]);

function readText(path) {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        return ok ? decoder.decode(contents).trim() : '';
    } catch (_error) {
        return '';
    }
}

function readNumber(path) {
    const value = Number(readText(path));
    return Number.isFinite(value) ? value : null;
}

function listDirectory(path) {
    const names = [];
    try {
        const directory = Gio.File.new_for_path(path);
        const enumerator = directory.enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
        enumerator.close(null);
    } catch (_error) {
        // Hot-plugged virtual files can disappear during enumeration.
    }
    return names;
}

function parseKeyValues(path) {
    const values = {};
    for (const line of readText(path).split('\n')) {
        const separator = line.indexOf('=');
        if (separator > 0)
            values[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return values;
}

function percentage(value) {
    if (!Number.isFinite(Number(value)))
        return null;
    return Math.min(100, Math.max(0, Number(value)));
}

function counterRate(previous, current, seconds) {
    if (!Number.isFinite(previous) || current < previous || seconds <= 0)
        return 0;
    return Math.max(0, (current - previous) / seconds);
}

function normalizePciSlot(value) {
    const text = String(value ?? '').toLowerCase();
    const match = text.match(/(?:[0-9a-f]{4,8}:)?([0-9a-f]{2}:[0-9a-f]{2}\.[0-7])$/);
    return match ? match[1] : text;
}

function commandExists(name) {
    return Boolean(GLib.find_program_in_path(name));
}

function runCommand(argv, timeoutMs = 1800) {
    return new Promise((resolve, reject) => {
        let process;
        let timeoutId = 0;
        let settled = false;
        const finish = (error, output = '') => {
            if (settled)
                return;
            settled = true;
            if (timeoutId)
                GLib.source_remove(timeoutId);
            if (error)
                reject(error);
            else
                resolve(output);
        };
        try {
            process = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_PIPE,
            });
            process.init(null);
        } catch (error) {
            finish(error);
            return;
        }
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            timeoutId = 0;
            try {
                process.force_exit();
            } catch (_error) {
                // Process may already have exited.
            }
            finish(new Error(`${argv[0]} 查询超时`));
            return GLib.SOURCE_REMOVE;
        });
        process.communicate_utf8_async(null, null, (source, result) => {
            if (settled)
                return;
            try {
                const [ok, stdout, stderr] = source.communicate_utf8_finish(result);
                if (!ok || !source.get_successful())
                    throw new Error(String(stderr || `${argv[0]} 查询失败`).trim());
                finish(null, String(stdout ?? ''));
            } catch (error) {
                finish(error);
            }
        });
    });
}

export class SystemMonitorProvider {
    constructor() {
        this._previousCpu = null;
        this._previousDisks = new Map();
        this._previousNetworks = new Map();
        this._lastCounterTimeUs = 0;
        this._lastSampleTimeUs = 0;
        this._cachedSnapshot = null;
        this._pendingSample = null;
        this._gpuDescriptors = [];
        this._gpuScanTimeUs = 0;
        this._nvidiaAvailable = commandExists('nvidia-smi');
    }

    async snapshot(forceDeviceScan = false) {
        const nowUs = GLib.get_monotonic_time();
        if (!forceDeviceScan && this._cachedSnapshot &&
            nowUs - this._lastSampleTimeUs < CACHE_INTERVAL_US)
            return this._cachedSnapshot;
        if (this._pendingSample)
            return this._pendingSample;
        this._pendingSample = this._collect(forceDeviceScan).finally(() => {
            this._pendingSample = null;
        });
        return this._pendingSample;
    }

    async _collect(forceDeviceScan) {
        const nowUs = GLib.get_monotonic_time();
        const elapsed = this._lastCounterTimeUs
            ? Math.max(.001, (nowUs - this._lastCounterTimeUs) / 1000000) : 0;
        if (forceDeviceScan || !this._gpuScanTimeUs ||
            nowUs - this._gpuScanTimeUs > 30000000) {
            this._gpuDescriptors = this._scanGpus();
            this._gpuScanTimeUs = nowUs;
            this._nvidiaAvailable = commandExists('nvidia-smi');
        }

        const snapshot = {
            timestamp: Date.now(),
            cpu: this._sampleCpu(),
            memory: this._sampleMemory(),
            storage: this._sampleStorage(),
            disks: this._sampleDisks(elapsed),
            networks: this._sampleNetworks(elapsed),
            gpus: await this._sampleGpus(),
            capabilities: {nvidiaSmi: this._nvidiaAvailable},
        };
        this._lastCounterTimeUs = nowUs;
        this._lastSampleTimeUs = nowUs;
        this._cachedSnapshot = snapshot;
        return snapshot;
    }

    _sampleCpu() {
        const text = readText('/proc/stat');
        const fields = (text.split('\n')[0] ?? '').trim()
            .split(/\s+/).slice(1).map(Number);
        if (fields.length < 4 || fields.some(value => !Number.isFinite(value)))
            return {usage: null, logicalCpus: 0};
        const idle = fields[3] + (fields[4] ?? 0);
        // guest counters are already included in user/nice.
        const total = fields.slice(0, 8).reduce((sum, value) => sum + value, 0);
        let usage = null;
        if (this._previousCpu) {
            const totalDelta = total - this._previousCpu.total;
            const idleDelta = idle - this._previousCpu.idle;
            if (totalDelta > 0)
                usage = percentage((1 - idleDelta / totalDelta) * 100);
        }
        this._previousCpu = {idle, total};
        return {
            usage,
            logicalCpus: text.split('\n').filter(line => /^cpu\d+\s/.test(line)).length,
        };
    }

    _sampleMemory() {
        const values = {};
        for (const line of readText('/proc/meminfo').split('\n')) {
            const match = line.match(/^([^:]+):\s+(\d+)/);
            if (match)
                values[match[1]] = Number(match[2]) * 1024;
        }
        const total = values.MemTotal ?? 0;
        const available = values.MemAvailable ??
            ((values.MemFree ?? 0) + (values.Buffers ?? 0) + (values.Cached ?? 0));
        const used = Math.max(0, total - available);
        return {
            total,
            used,
            available,
            usage: total > 0 ? percentage(used / total * 100) : null,
        };
    }

    _sampleStorage() {
        try {
            const info = Gio.File.new_for_path('/').query_filesystem_info(
                'filesystem::size,filesystem::free', null
            );
            const total = Number(info.get_attribute_uint64('filesystem::size'));
            const free = Number(info.get_attribute_uint64('filesystem::free'));
            const used = Math.max(0, total - free);
            return {
                mountPoint: '/',
                total,
                used,
                free,
                usage: total > 0 ? percentage(used / total * 100) : null,
            };
        } catch (_error) {
            return {mountPoint: '/', total: 0, used: 0, free: 0, usage: null};
        }
    }

    _sampleDisks(seconds) {
        const currentIds = new Set();
        const result = [];
        for (const name of listDirectory('/sys/block').sort()) {
            if (/^(loop|ram|zram|fd|sr)\d*/.test(name))
                continue;
            const base = `/sys/block/${name}`;
            const stat = readText(`${base}/stat`).split(/\s+/).map(Number);
            if (stat.length < 7 || stat.some(value => !Number.isFinite(value)))
                continue;
            const counters = {read: stat[2] * 512, write: stat[6] * 512};
            const previous = this._previousDisks.get(name);
            const vendor = readText(`${base}/device/vendor`).replace(/\s+/g, ' ');
            const model = readText(`${base}/device/model`).replace(/\s+/g, ' ');
            currentIds.add(name);
            result.push({
                id: name,
                name,
                label: [vendor, model].filter(Boolean).join(' ').trim() || name,
                readBytesPerSecond: previous
                    ? counterRate(previous.read, counters.read, seconds) : 0,
                writeBytesPerSecond: previous
                    ? counterRate(previous.write, counters.write, seconds) : 0,
            });
            this._previousDisks.set(name, counters);
        }
        for (const id of this._previousDisks.keys()) {
            if (!currentIds.has(id))
                this._previousDisks.delete(id);
        }
        return result;
    }

    _sampleNetworks(seconds) {
        const counters = new Map();
        for (const line of readText('/proc/net/dev').split('\n')) {
            const match = line.match(/^\s*([^:]+):\s*(.*)$/);
            if (!match)
                continue;
            const fields = match[2].trim().split(/\s+/).map(Number);
            if (fields.length >= 16)
                counters.set(match[1].trim(), {received: fields[0], sent: fields[8]});
        }
        const currentIds = new Set();
        const result = [];
        for (const name of [...counters.keys()].sort()) {
            if (name === 'lo')
                continue;
            const current = counters.get(name);
            const previous = this._previousNetworks.get(name);
            currentIds.add(name);
            result.push({
                id: name,
                name,
                label: this._networkLabel(name),
                operstate: readText(`/sys/class/net/${name}/operstate`) || 'unknown',
                downloadBytesPerSecond: previous
                    ? counterRate(previous.received, current.received, seconds) : 0,
                uploadBytesPerSecond: previous
                    ? counterRate(previous.sent, current.sent, seconds) : 0,
            });
            this._previousNetworks.set(name, current);
        }
        for (const id of this._previousNetworks.keys()) {
            if (!currentIds.has(id))
                this._previousNetworks.delete(id);
        }
        return result;
    }

    _networkLabel(name) {
        if (/^(wl|wlan)/.test(name))
            return `无线网络 · ${name}`;
        if (/^(en|eth)/.test(name))
            return `有线网络 · ${name}`;
        if (/^(ww|rmnet)/.test(name))
            return `移动网络 · ${name}`;
        return name;
    }

    _scanGpus() {
        const result = [];
        for (const card of listDirectory('/sys/class/drm')
            .filter(name => /^card\d+$/.test(name)).sort()) {
            const base = `/sys/class/drm/${card}/device`;
            const vendorId = readText(`${base}/vendor`).toLowerCase();
            if (!vendorId)
                continue;
            const uevent = parseKeyValues(`${base}/uevent`);
            const vendor = VENDORS.get(vendorId) ?? '其他';
            const product = readText(`${base}/product_name`) ||
                readText(`${base}/product`) || '';
            result.push({
                id: card,
                card,
                base,
                vendor,
                driver: String(uevent.DRIVER ?? '').toLowerCase(),
                pciSlot: String(uevent.PCI_SLOT_NAME ?? ''),
                name: product || `${vendor} GPU (${card})`,
            });
        }
        return result;
    }

    async _sampleGpus() {
        const nvidia = this._gpuDescriptors.filter(item => item.vendor === 'NVIDIA');
        let nvidiaRows = [];
        const shouldQuery = this._nvidiaAvailable && nvidia.some(item =>
            readText(`${item.base}/power/runtime_status`) !== 'suspended');
        if (shouldQuery) {
            try {
                const output = await runCommand([
                    'nvidia-smi',
                    '--query-gpu=index,pci.bus_id,name,utilization.gpu,memory.used,memory.total',
                    '--format=csv,noheader,nounits',
                ]);
                nvidiaRows = output.split('\n').map(line => line.trim())
                    .filter(Boolean).map(line => {
                        const fields = line.split(',').map(value => value.trim());
                        return {
                            pciSlot: normalizePciSlot(fields[1]),
                            name: fields[2] || 'NVIDIA GPU',
                            usage: percentage(Number(fields[3])),
                            memoryUsed: Number(fields[4]) * 1024 * 1024,
                            memoryTotal: Number(fields[5]) * 1024 * 1024,
                        };
                    });
            } catch (_error) {
                nvidiaRows = [];
            }
        }

        return this._gpuDescriptors.map(gpu => {
            const runtimeStatus = readText(`${gpu.base}/power/runtime_status`) || 'active';
            if (gpu.vendor === 'NVIDIA') {
                const slot = normalizePciSlot(gpu.pciSlot);
                const index = nvidia.findIndex(item => item.id === gpu.id);
                const row = nvidiaRows.find(item => item.pciSlot === slot) ??
                    nvidiaRows[index] ?? null;
                return {
                    id: gpu.id,
                    vendor: gpu.vendor,
                    driver: gpu.driver,
                    name: row?.name ?? gpu.name,
                    usage: runtimeStatus === 'suspended' ? null : row?.usage ?? null,
                    memoryUsed: row?.memoryUsed ?? null,
                    memoryTotal: row?.memoryTotal ?? null,
                    status: runtimeStatus === 'suspended' ? 'suspended'
                        : row ? 'active' : 'unavailable',
                };
            }
            const usage = readNumber(`${gpu.base}/gpu_busy_percent`);
            return {
                id: gpu.id,
                vendor: gpu.vendor,
                driver: gpu.driver,
                name: gpu.name,
                usage: percentage(usage),
                memoryUsed: readNumber(`${gpu.base}/mem_info_vram_used`),
                memoryTotal: readNumber(`${gpu.base}/mem_info_vram_total`),
                status: runtimeStatus === 'suspended' ? 'suspended'
                    : usage === null ? 'unavailable' : 'active',
            };
        });
    }
}
