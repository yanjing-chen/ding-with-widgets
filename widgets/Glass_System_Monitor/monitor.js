'use strict';

const LAYOUT_PRESETS = {
  compact: {width: 280, height: 470},
};
const METRICS = ['cpu', 'memory', 'gpu', 'disk', 'network'];
const defaults = {
  layoutPreset: 'compact', opacity: 1, refreshInterval: 1,
  visibleMetrics: [...METRICS], gpuDevice: 'auto', diskDevice: 'all',
  networkDevice: 'auto', metricVisibilityCustomized: false,
};
const elements = Object.fromEntries([
  'updated', 'refresh-button', 'settings-button', 'dashboard', 'gauges-card',
  'cpu-panel', 'cpu-ring', 'cpu-value', 'cpu-detail', 'gpu-panel', 'gpu-ring',
  'cpu-row-value', 'cpu-chart', 'gpu-label', 'gpu-row-label', 'gpu-value',
  'gpu-row-value', 'gpu-name', 'gpu-chart', 'resources-column', 'memory-card',
  'memory-ring', 'memory-value', 'memory-progress', 'memory-percent', 'disk-card',
  'memory-chart', 'storage-ring', 'storage-value', 'storage-progress', 'disk-chart',
  'disk-read', 'disk-write',
  'disk-label', 'network-card', 'network-label', 'network-down', 'network-up',
  'network-chart', 'network-upload-chart', 'empty-state', 'status', 'settings', 'close-settings',
  'refresh-devices', 'metric-options', 'gpu-device',
  'disk-device', 'network-device', 'refresh-interval', 'opacity',
  'opacity-value', 'settings-status',
].map(id => [id, document.getElementById(id)]));
const card = document.querySelector('.system-monitor');
const history = {
  cpu: [], gpu: [], memory: [], storage: [], download: [], upload: [],
};
let config = copy(defaults);
let snapshot = null;
let refreshTimer = 0;
let refreshing = false;
let configNeedsSave = false;
let layoutNeedsResize = false;

function copy(value) { return JSON.parse(JSON.stringify(value ?? {})); }

function cleanConfig(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  let visibleMetrics = Array.isArray(value.visibleMetrics)
    ? value.visibleMetrics.filter(item => METRICS.includes(item)) : [...METRICS];
  const visibilityCustomized = value.metricVisibilityCustomized === true;
  // Alpha 7.1 could inherit an incomplete list and hide both gauges as soon as
  // the asynchronous config arrived. Restore the complete default once; any
  // later checkbox change marks the list as explicitly customized.
  if (!visibilityCustomized &&
      (!visibleMetrics.includes('cpu') || !visibleMetrics.includes('gpu'))) {
    visibleMetrics = [...METRICS];
    configNeedsSave = true;
  }
  const refreshInterval = [1, 2, 3, 5].includes(Number(value.refreshInterval))
    ? Number(value.refreshInterval) : 1;
  const layoutPreset = defaults.layoutPreset;
  if (value.layoutPreset && value.layoutPreset !== layoutPreset) {
    configNeedsSave = true;
    layoutNeedsResize = true;
  }
  return {
    ...defaults, ...value, visibleMetrics: [...new Set(visibleMetrics)], refreshInterval,
    layoutPreset,
    opacity: Math.min(1, Math.max(.35, Number(value.opacity) || 1)),
    gpuDevice: String(value.gpuDevice || 'auto'),
    diskDevice: String(value.diskDevice || 'all'),
    networkDevice: String(value.networkDevice || 'auto'),
    metricVisibilityCustomized: visibilityCustomized || configNeedsSave,
  };
}

function formatBytes(value, perSecond = false) {
  let number = Math.max(0, Number(value) || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
  const digits = number >= 100 || index === 0 ? 0 : number >= 10 ? 1 : 2;
  return `${number.toFixed(digits)} ${units[index]}${perSecond ? '/s' : ''}`;
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : '--%';
}

function safePercentage(value) {
  return Number.isFinite(Number(value))
    ? Math.min(100, Math.max(0, Number(value))) : 0;
}

function setRing(element, value) {
  element.style.setProperty('--usage', `${safePercentage(value) * 3.6}deg`);
}

function setProgress(element, value) {
  element.style.width = `${safePercentage(value)}%`;
}

function isVisible(metric) { return config.visibleMetrics.includes(metric); }
function saveConfig() { return window.ding?.setConfig(copy(config)); }

function applyAppearance() {
  card.dataset.layout = defaults.layoutPreset;
  card.style.setProperty('--widget-opacity', String(config.opacity));
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
  elements['refresh-interval'].value = String(config.refreshInterval);
  elements['metric-options'].querySelectorAll('input').forEach(input => {
    input.checked = isVisible(input.value);
  });
  document.querySelectorAll('[data-metric]').forEach(item => {
    item.hidden = !isVisible(item.dataset.metric);
  });

  const gaugesVisible = isVisible('cpu') || isVisible('gpu');
  const resourcesVisible = isVisible('memory') || isVisible('disk');
  elements['gauges-card'].hidden = !gaugesVisible;
  elements['resources-column'].hidden = !resourcesVisible;
  elements['gauges-card'].classList.toggle('single', isVisible('cpu') !== isVisible('gpu'));
  elements['resources-column'].classList.toggle('only-memory',
    isVisible('memory') && !isVisible('disk'));
  elements['resources-column'].classList.toggle('only-disk',
    isVisible('disk') && !isVisible('memory'));
  elements.dashboard.classList.toggle('no-gauges', !gaugesVisible);
  elements.dashboard.classList.toggle('no-resources', !resourcesVisible);
  elements.dashboard.classList.toggle('no-network', !isVisible('network'));
  elements['empty-state'].hidden = METRICS.some(isVisible);
}

function chooseGpu(gpus) {
  if (!gpus.length) return null;
  if (config.gpuDevice !== 'auto')
    return gpus.find(item => item.id === config.gpuDevice) ?? gpus[0];
  return [...gpus].sort((left, right) => {
    const active = Number(right.status === 'active') - Number(left.status === 'active');
    return active || (Number(right.usage) || 0) - (Number(left.usage) || 0);
  })[0];
}

function chooseDisks(disks) {
  let selected = config.diskDevice === 'all'
    ? disks : disks.filter(item => item.id === config.diskDevice);
  if (!selected.length) selected = disks;
  return {
    label: config.diskDevice === 'all' ? '全部物理磁盘'
      : selected[0]?.label || selected[0]?.name || '所选磁盘',
    read: selected.reduce((sum, item) => sum + Number(item.readBytesPerSecond || 0), 0),
    write: selected.reduce((sum, item) => sum + Number(item.writeBytesPerSecond || 0), 0),
  };
}

function chooseNetworks(networks) {
  let selected;
  if (config.networkDevice === 'auto') {
    const active = networks.filter(item => item.operstate === 'up' ||
      item.downloadBytesPerSecond > 0 || item.uploadBytesPerSecond > 0);
    selected = active.length ? active : networks;
  } else {
    selected = networks.filter(item => item.id === config.networkDevice);
    if (!selected.length) selected = networks;
  }
  return {
    label: config.networkDevice === 'auto'
      ? (selected.length === 1 ? selected[0].label : '活动网络合计')
      : selected[0]?.label || selected[0]?.name || '所选网络',
    download: selected.reduce((sum, item) =>
      sum + Number(item.downloadBytesPerSecond || 0), 0),
    upload: selected.reduce((sum, item) =>
      sum + Number(item.uploadBytesPerSecond || 0), 0),
  };
}

function drawChart(canvas, series, minimumMaximum = 1024) {
  if (!canvas || canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  const maximum = Math.max(minimumMaximum,
    ...series.flatMap(item => item.values));
  for (const item of series) {
    if (item.values.length < 2) continue;
    const step = width / Math.max(59, item.values.length - 1);
    context.beginPath();
    item.values.forEach((value, index) => {
      const x = width - (item.values.length - 1 - index) * step;
      const y = height - 2 * ratio - value / maximum * (height - 7 * ratio);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.strokeStyle = item.color;
    context.lineWidth = (item.width ?? 1.7) * ratio;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();
    if (item.fill) {
      context.lineTo(width, height);
      context.lineTo(width - (item.values.length - 1) * step, height);
      context.closePath();
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, item.fill);
      gradient.addColorStop(1, 'rgba(46,145,255,0)');
      context.fillStyle = gradient;
      context.fill();
    }
  }
}

function drawCharts() {
  drawChart(elements['cpu-chart'], [
    {values: history.cpu, color: '#24bf7b', fill: 'rgba(36,191,123,.16)', width: 1.8},
  ], 100);
  drawChart(elements['gpu-chart'], [
    {values: history.gpu, color: '#348cff', fill: 'rgba(52,140,255,.16)', width: 1.8},
  ], 100);
  drawChart(elements['memory-chart'], [
    {values: history.memory, color: '#8757eb', fill: 'rgba(135,87,235,.15)', width: 1.8},
  ], 100);
  drawChart(elements['disk-chart'], [
    {values: history.storage, color: '#9b63e8', fill: 'rgba(155,99,232,.15)', width: 1.8},
  ], 100);

  drawChart(elements['network-chart'], [
    {values: history.download, color: '#318fff', fill: 'rgba(49,143,255,.20)', width: 2},
    {values: history.upload, color: '#35c98d', width: 2},
  ]);
}

function appendHistory(name, value) {
  history[name].push(Math.max(0, Number(value) || 0));
  if (history[name].length > 60) history[name].shift();
}

function render(data, addHistory = true) {
  if (!data) return;
  setRing(elements['cpu-ring'], data.cpu?.usage);
  elements['cpu-value'].textContent = formatPercent(data.cpu?.usage);
  elements['cpu-row-value'].textContent = formatPercent(data.cpu?.usage);
  elements['cpu-detail'].textContent = `${data.cpu?.logicalCpus || '--'} 个逻辑处理器`;

  const gpu = chooseGpu(Array.isArray(data.gpus) ? data.gpus : []);
  if (gpu) {
    elements['gpu-label'].textContent = gpu.vendor === '其他' ? 'GPU' : `${gpu.vendor} GPU`;
    elements['gpu-row-label'].textContent = elements['gpu-label'].textContent;
    elements['gpu-name'].textContent = gpu.status === 'suspended'
      ? `${gpu.name} · 休眠` : gpu.name;
    elements['gpu-name'].title = gpu.name;
    elements['gpu-value'].textContent = gpu.status === 'suspended'
      ? '休眠' : formatPercent(gpu.usage);
    elements['gpu-row-value'].textContent = elements['gpu-value'].textContent;
    setRing(elements['gpu-ring'], gpu.usage);
  } else {
    elements['gpu-label'].textContent = 'GPU';
    elements['gpu-row-label'].textContent = 'GPU';
    elements['gpu-name'].textContent = '没有检测到 DRM 显卡';
    elements['gpu-value'].textContent = '--%';
    elements['gpu-row-value'].textContent = '--%';
    setRing(elements['gpu-ring'], 0);
  }

  const memory = data.memory ?? {};
  elements['memory-value'].textContent =
    `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`;
  elements['memory-percent'].textContent = formatPercent(memory.usage);
  setRing(elements['memory-ring'], memory.usage);
  setProgress(elements['memory-progress'], memory.usage);

  const storage = data.storage ?? {};
  elements['storage-value'].textContent =
    `${formatBytes(storage.used)} / ${formatBytes(storage.total)}`;
  setRing(elements['storage-ring'], storage.usage);
  setProgress(elements['storage-progress'], storage.usage);
  const disk = chooseDisks(Array.isArray(data.disks) ? data.disks : []);
  elements['disk-label'].textContent = disk.label;
  elements['disk-read'].textContent = formatBytes(disk.read, true);
  elements['disk-write'].textContent = formatBytes(disk.write, true);

  const network = chooseNetworks(Array.isArray(data.networks) ? data.networks : []);
  elements['network-label'].textContent = network.label;
  elements['network-down'].textContent = formatBytes(network.download, true);
  elements['network-up'].textContent = formatBytes(network.upload, true);
  if (addHistory) {
    appendHistory('cpu', data.cpu?.usage);
    appendHistory('gpu', gpu?.status === 'suspended' ? 0 : gpu?.usage);
    appendHistory('memory', memory.usage);
    appendHistory('storage', storage.usage);
    appendHistory('download', network.download);
    appendHistory('upload', network.upload);
  }
  drawCharts();
  elements.updated.textContent = new Date(Number(data.timestamp) || Date.now())
    .toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  elements.status.textContent = data.gpus?.some(item =>
    item.vendor === 'NVIDIA' && item.status === 'unavailable')
    ? 'NVIDIA 使用率不可用，请确认驱动附带的 nvidia-smi 可以运行' : '';
}

function replaceOptions(select, first, items, selectedValue) {
  const options = [first, ...items].map(item => {
    const option = document.createElement('option');
    option.value = item.value; option.textContent = item.label; return option;
  });
  select.replaceChildren(...options);
  select.value = options.some(item => item.value === selectedValue)
    ? selectedValue : first.value;
}

function renderDeviceOptions(data) {
  const gpus = Array.isArray(data?.gpus) ? data.gpus : [];
  const disks = Array.isArray(data?.disks) ? data.disks : [];
  const networks = Array.isArray(data?.networks) ? data.networks : [];
  replaceOptions(elements['gpu-device'], {value: 'auto', label: '自动选择'},
    gpus.map(item => ({value: item.id, label: `${item.vendor} · ${item.name}`})),
    config.gpuDevice);
  replaceOptions(elements['disk-device'], {value: 'all', label: '全部物理磁盘'},
    disks.map(item => ({value: item.id, label: item.label || item.name})),
    config.diskDevice);
  replaceOptions(elements['network-device'], {value: 'auto', label: '自动选择活动网络'},
    networks.map(item => ({value: item.id, label: item.label || item.name})),
    config.networkDevice);
}

async function refresh(forceDeviceScan = false, manual = false) {
  if (refreshing) return;
  refreshing = true;
  elements['refresh-button'].disabled = true;
  if (manual) elements['settings-status'].textContent = '正在刷新系统设备…';
  try {
    if (typeof window.ding?.getSystemMonitorState !== 'function')
      throw new Error('当前宿主不支持系统监控接口');
    snapshot = await window.ding.getSystemMonitorState(forceDeviceScan);
    render(snapshot, true);
    renderDeviceOptions(snapshot);
    elements['settings-status'].textContent = manual ? '设备和数据已刷新' : '';
  } catch (error) {
    elements.status.textContent = `读取失败：${error.message}`;
    elements['settings-status'].textContent = `读取失败：${error.message}`;
  } finally {
    refreshing = false;
    elements['refresh-button'].disabled = false;
  }
}

function restartTimer() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(), config.refreshInterval * 1000);
}

elements['settings-button'].addEventListener('click', () => {
  elements.settings.hidden = false;
  if (snapshot) renderDeviceOptions(snapshot);
});
elements['close-settings'].addEventListener('click', () => { elements.settings.hidden = true; });
elements['refresh-button'].addEventListener('click', () => refresh(false, true));
elements['refresh-devices'].addEventListener('click', () => refresh(true, true));
elements['metric-options'].addEventListener('change', async event => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  const selected = new Set(config.visibleMetrics);
  if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
  config.visibleMetrics = METRICS.filter(item => selected.has(item));
  config.metricVisibilityCustomized = true;
  applyAppearance(); render(snapshot, false); await saveConfig();
});
for (const [id, property] of [
  ['gpu-device', 'gpuDevice'], ['disk-device', 'diskDevice'],
  ['network-device', 'networkDevice'],
]) {
  elements[id].addEventListener('change', async () => {
    config[property] = elements[id].value;
    if (property === 'networkDevice') {
      history.download.length = 0; history.upload.length = 0;
    }
    render(snapshot, false); await saveConfig();
  });
}
elements['refresh-interval'].addEventListener('change', async () => {
  config.refreshInterval = Number(elements['refresh-interval'].value) || 1;
  restartTimer(); await saveConfig();
});
elements.opacity.addEventListener('input', async () => {
  config.opacity = Math.min(1, Math.max(.35, Number(elements.opacity.value) / 100));
  applyAppearance(); await saveConfig();
});
window.addEventListener('resize', () => requestAnimationFrame(drawCharts));

async function start() {
  config = cleanConfig(await window.ding?.getConfig?.());
  if (configNeedsSave) await saveConfig();
  applyAppearance();
  if (layoutNeedsResize)
    window.ding?.setSize?.(LAYOUT_PRESETS.compact.width,
      LAYOUT_PRESETS.compact.height);
  await refresh(true);
  restartTimer();
}

start();
