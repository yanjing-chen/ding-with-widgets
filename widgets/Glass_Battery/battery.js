'use strict';

const defaults = {
  opacity: 1,
  selectedDeviceIds: [],
  selectionInitialized: false,
};

const elements = Object.fromEntries([
  'devices', 'updated', 'settings', 'settings-button', 'refresh-button',
  'close-settings',
  'device-options', 'refresh-devices', 'settings-status', 'opacity',
  'opacity-value',
].map(id => [id, document.getElementById(id)]));
const batteryCard = document.querySelector('.battery');

let config = copy(defaults);
let devices = [];
let refreshTimer = 0;
let refreshing = false;

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function cleanConfig(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  const selected = Array.isArray(value.selectedDeviceIds)
    ? [...new Set(value.selectedDeviceIds.filter(id => typeof id === 'string'))]
    : [];
  return {
    opacity: Math.min(1, Math.max(.35, Number(value.opacity) || 1)),
    selectedDeviceIds: selected,
    selectionInitialized: value.selectionInitialized === true,
  };
}

function applyAppearance() {
  batteryCard.style.setProperty('--widget-opacity', String(config.opacity));
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
}

function iconSvg(kind) {
  const paths = {
    battery: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M9 21h6M12 18v3"/>',
    computer: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/>',
    monitor: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    mouse: '<rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 2v6M7 9h10"/>',
    keyboard: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M5 10h1m3 0h1m3 0h1m3 0h1M5 14h14M7 17h10"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 5h4M11 19h2"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="19" r=".7"/>',
    headset: '<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="12" width="4" height="7" rx="2"/><rect x="17" y="12" width="4" height="7" rx="2"/>',
    speaker: '<path d="M5 9h4l5-4v14l-5-4H5zM17 9a5 5 0 0 1 0 6"/>',
    gamepad: '<path d="M7 8h10a5 5 0 0 1 4 7l-1 3a2 2 0 0 1-3 1l-3-2h-4l-3 2a2 2 0 0 1-3-1l-1-3a5 5 0 0 1 4-7z"/><path d="M7 12v4M5 14h4M16 13h.01M19 15h.01"/>',
    pen: '<path d="m5 19 2-6L17 3l4 4-10 10zM7 13l4 4"/>',
    camera: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="4"/>',
    bluetooth: '<path d="m8 7 8 10V3L8 13l8 8V7z"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[kind] ?? '<rect x="5" y="4" width="13" height="16" rx="2"/><path d="M18 9h2v6h-2"/>';
  return svg;
}

function deviceState(device) {
  const states = {
    1: '正在充电',
    2: '正在使用电池',
    3: '电量耗尽',
    4: '已充满',
    5: '等待充电',
    6: '等待放电',
  };
  if (states[device.state])
    return states[device.state];
  return device.powerSupply ? '电池电量' : '已连接';
}

function chargeColor(percentage) {
  if (percentage <= 20)
    return '#ff5148';
  if (percentage <= 40)
    return '#ffb020';
  return '#28c878';
}

function createDeviceCard(device) {
  const percentage = Math.round(device.percentage);
  const card = document.createElement('article');
  card.className = 'device-card';
  card.title = `${device.name}：${percentage}%`;

  const ring = document.createElement('div');
  ring.className = 'charge-ring';
  ring.style.setProperty('--charge-angle', `${percentage * 3.6}deg`);
  ring.style.setProperty('--charge-color', chargeColor(percentage));
  const ringInner = document.createElement('div');
  ringInner.className = 'ring-inner';
  ringInner.append(iconSvg(device.kind));
  ring.append(ringInner);

  const name = document.createElement('strong');
  name.textContent = device.name;
  const level = document.createElement('span');
  level.textContent = `${percentage}%`;
  const state = document.createElement('small');
  state.textContent = deviceState(device);
  card.append(ring, name, level, state);
  return card;
}

function renderDevices() {
  const selected = new Set(config.selectedDeviceIds);
  const visible = devices.filter(device => selected.has(device.id));
  elements.devices.dataset.count = String(visible.length);
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.append(iconSvg('battery'));
    const title = document.createElement('strong');
    title.textContent = devices.length ? '尚未选择显示设备' : '没有检测到电量设备';
    const hint = document.createElement('span');
    hint.textContent = devices.length
      ? '请打开右上角设置进行选择'
      : '连接设备后点击设置中的“刷新设备”';
    empty.append(title, hint);
    elements.devices.replaceChildren(empty);
    return;
  }
  elements.devices.replaceChildren(...visible.map(createDeviceCard));
}

function createDeviceOption(device) {
  const row = document.createElement('label');
  row.className = 'device-option';
  const icon = document.createElement('span');
  icon.className = 'option-icon';
  icon.append(iconSvg(device.kind));
  const text = document.createElement('span');
  text.className = 'option-text';
  const name = document.createElement('strong');
  name.textContent = device.name;
  const detail = document.createElement('small');
  detail.textContent = `${device.typeLabel} · ${Math.round(device.percentage)}%`;
  text.append(name, detail);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = config.selectedDeviceIds.includes(device.id);
  checkbox.addEventListener('change', () => {
    const selected = new Set(config.selectedDeviceIds);
    if (checkbox.checked)
      selected.add(device.id);
    else
      selected.delete(device.id);
    config.selectedDeviceIds = [...selected];
    config.selectionInitialized = true;
    saveConfig();
    renderDevices();
  });
  row.append(icon, text, checkbox);
  return row;
}

function renderSettings() {
  if (devices.length) {
    elements['device-options'].replaceChildren(...devices.map(createDeviceOption));
  } else {
    const empty = document.createElement('p');
    empty.className = 'options-empty';
    empty.textContent = '当前没有检测到可报告电量的设备。';
    elements['device-options'].replaceChildren(empty);
  }
}

function saveConfig() {
  return window.ding?.setConfig(copy(config));
}

async function refreshDevices(manual = false) {
  if (refreshing)
    return;
  refreshing = true;
  elements['refresh-button'].disabled = true;
  elements['refresh-button'].setAttribute('aria-busy', 'true');
  if (manual)
    elements['settings-status'].textContent = '正在刷新…';
  try {
    if (typeof window.ding?.getPowerDevices !== 'function')
      throw new Error('当前宿主不支持电量接口');
    const result = await window.ding.getPowerDevices();
    devices = Array.isArray(result?.devices)
      ? result.devices.filter(device => device && typeof device.id === 'string')
      : [];
    devices.sort((left, right) => {
      if (left.powerSupply !== right.powerSupply)
        return left.powerSupply ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    if (!config.selectionInitialized && devices.length) {
      config.selectedDeviceIds = devices.map(device => device.id);
      config.selectionInitialized = true;
      await saveConfig();
    }
    renderDevices();
    renderSettings();
    const now = new Date();
    elements.updated.textContent = `更新于 ${now.toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit',
    })}`;
    elements['settings-status'].textContent = manual ? '已刷新' : '';
  } catch (error) {
    elements['settings-status'].textContent = `读取失败：${error.message}`;
    if (!devices.length) {
      elements.updated.textContent = '暂时无法读取系统电量';
      renderDevices();
    }
  } finally {
    refreshing = false;
    elements['refresh-button'].disabled = false;
    elements['refresh-button'].removeAttribute('aria-busy');
  }
}

elements['settings-button'].addEventListener('click', () => {
  elements.settings.hidden = false;
  renderSettings();
  refreshDevices(true);
});
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements['refresh-devices'].addEventListener('click', () => refreshDevices(true));
elements['refresh-button'].addEventListener('click', () => refreshDevices(true));
elements.opacity.addEventListener('input', () => {
  config.opacity = Math.min(1, Math.max(.35, Number(elements.opacity.value) / 100));
  applyAppearance();
  saveConfig();
});

async function start() {
  config = cleanConfig(await window.ding?.getConfig?.());
  applyAppearance();
  renderDevices();
  await refreshDevices();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refreshDevices(), 30000);
}

start();
