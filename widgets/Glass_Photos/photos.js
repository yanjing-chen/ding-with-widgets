'use strict';

const LAYOUT_PRESETS = {
  compact: {width: 220, height: 250},
  landscape: {width: 500, height: 320},
  collage: {width: 500, height: 320},
};
const defaults = {
  layoutPreset: 'landscape',
  folderPath: '',
  folderName: '',
  opacity: 1,
  intervalSeconds: 60,
};

const elements = Object.fromEntries([
  'photo-stage', 'photo-caption', 'settings', 'settings-button',
  'close-settings', 'folder-name', 'choose-folder', 'rescan-folder',
  'photo-status', 'layout-options', 'interval', 'opacity', 'opacity-value',
].map(id => [id, document.getElementById(id)]));
const photosCard = document.querySelector('.photos');

let config = copy(defaults);
let images = [];
let currentIndex = 0;
let slideshowTimer = 0;
let renderSerial = 0;
const imageCache = new Map();
const MAX_CACHED_IMAGES = 4;

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function cleanConfig(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  const interval = [30, 60, 300, 900].includes(Number(value.intervalSeconds))
    ? Number(value.intervalSeconds)
    : 60;
  return {
    layoutPreset: Object.hasOwn(LAYOUT_PRESETS, value.layoutPreset)
      ? value.layoutPreset
      : 'landscape',
    folderPath: typeof value.folderPath === 'string' ? value.folderPath : '',
    folderName: typeof value.folderName === 'string' ? value.folderName : '',
    opacity: Math.min(1, Math.max(.35, Number(value.opacity) || 1)),
    intervalSeconds: interval,
  };
}

function applySettings() {
  photosCard.dataset.layout = config.layoutPreset;
  photosCard.style.setProperty('--widget-opacity', String(config.opacity));
  elements['folder-name'].textContent = config.folderName || '尚未选择';
  elements.interval.value = String(config.intervalSeconds);
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
  for (const button of document.querySelectorAll('.layout-option'))
    button.classList.toggle('selected', button.dataset.preset === config.layoutPreset);
}

function saveConfig() {
  return window.ding?.setConfig(copy(config));
}

function emptyStage(title, detail) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const icon = document.createElement('span');
  icon.textContent = '▧';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('small');
  text.textContent = detail;
  empty.append(icon, heading, text);
  elements['photo-stage'].replaceChildren(empty);
  elements['photo-caption'].textContent = '';
}

async function imageData(item) {
  if (imageCache.has(item.path))
    return imageCache.get(item.path);
  const response = await window.ding.loadPhotoImage(item.path);
  const dataUrl = String(response?.dataUrl ?? '');
  if (!dataUrl.startsWith('data:image/'))
    throw new Error('照片数据无效');
  imageCache.set(item.path, dataUrl);
  while (imageCache.size > MAX_CACHED_IMAGES)
    imageCache.delete(imageCache.keys().next().value);
  return dataUrl;
}

function visibleItems() {
  if (!images.length)
    return [];
  const count = config.layoutPreset === 'collage' ? Math.min(3, images.length) : 1;
  return Array.from({length: count}, (_value, offset) =>
    images[(currentIndex + offset) % images.length]
  );
}

async function renderPhotos() {
  const serial = ++renderSerial;
  if (!config.folderPath) {
    emptyStage('选择照片文件夹', '打开右上角设置选择本机图片文件夹');
    return;
  }
  if (!images.length) {
    emptyStage('文件夹中没有照片', '支持 JPG、PNG、WebP、GIF、BMP、SVG 和 AVIF');
    return;
  }

  const items = visibleItems();
  const tiles = items.map((item, index) => {
    const figure = document.createElement('figure');
    figure.className = `photo-tile photo-${index + 1}`;
    const image = document.createElement('img');
    image.alt = item.name;
    image.draggable = false;
    figure.append(image);
    return {item, figure, image};
  });
  elements['photo-stage'].replaceChildren(...tiles.map(tile => tile.figure));
  elements['photo-caption'].textContent = items[0]?.name ?? '';

  await Promise.all(tiles.map(async tile => {
    try {
      const source = await imageData(tile.item);
      if (serial === renderSerial)
        tile.image.src = source;
    } catch (_error) {
      tile.figure.classList.add('load-error');
    }
  }));
}

function restartSlideshow() {
  clearInterval(slideshowTimer);
  slideshowTimer = 0;
  if (images.length > 1) {
    slideshowTimer = setInterval(() => {
      currentIndex = (currentIndex + 1) % images.length;
      renderPhotos();
    }, config.intervalSeconds * 1000);
  }
}

async function scanFolder(showStatus = false) {
  if (!config.folderPath) {
    images = [];
    restartSlideshow();
    renderPhotos();
    return;
  }
  if (showStatus)
    elements['photo-status'].textContent = '正在扫描…';
  try {
    const response = await window.ding.listPhotoImages(config.folderPath);
    images = Array.isArray(response?.images) ? response.images : [];
    currentIndex = 0;
    imageCache.clear();
    await renderPhotos();
    restartSlideshow();
    elements['photo-status'].textContent = `找到 ${images.length} 张照片`;
  } catch (error) {
    images = [];
    restartSlideshow();
    emptyStage('无法读取照片文件夹', error.message);
    elements['photo-status'].textContent = `扫描失败：${error.message}`;
  }
}

elements['settings-button'].addEventListener('click', () => {
  applySettings();
  elements.settings.hidden = false;
});
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements['choose-folder'].addEventListener('click', async () => {
  elements['photo-status'].textContent = '正在打开文件夹选择器…';
  try {
    const result = await window.ding.choosePhotoFolder();
    if (result?.cancelled) {
      elements['photo-status'].textContent = '';
      return;
    }
    config.folderPath = String(result?.path ?? '');
    config.folderName = String(result?.name ?? '照片');
    await saveConfig();
    applySettings();
    await scanFolder(true);
  } catch (error) {
    elements['photo-status'].textContent = `选择失败：${error.message}`;
  }
});
elements['rescan-folder'].addEventListener('click', () => scanFolder(true));
elements['layout-options'].addEventListener('click', async event => {
  const button = event.target.closest('.layout-option');
  const preset = button?.dataset.preset;
  if (!Object.hasOwn(LAYOUT_PRESETS, preset))
    return;
  config.layoutPreset = preset;
  applySettings();
  await saveConfig();
  const size = LAYOUT_PRESETS[preset];
  window.ding?.setSize?.(size.width, size.height);
  elements.settings.hidden = true;
  renderPhotos();
});
elements.interval.addEventListener('change', async () => {
  config.intervalSeconds = Number(elements.interval.value) || 60;
  await saveConfig();
  restartSlideshow();
});
elements.opacity.addEventListener('input', async () => {
  config.opacity = Math.min(1, Math.max(.35, Number(elements.opacity.value) / 100));
  applySettings();
  await saveConfig();
});
elements['photo-stage'].addEventListener('click', () => {
  if (images.length < 2)
    return;
  currentIndex = (currentIndex + 1) % images.length;
  renderPhotos();
  restartSlideshow();
});

async function start() {
  config = cleanConfig(await window.ding?.getConfig?.());
  applySettings();
  await scanFolder();
}

start();
