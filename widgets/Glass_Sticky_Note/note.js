'use strict';

const DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, Noto Sans CJK SC, Noto Sans, sans-serif';
const defaults = {
  contentHtml: '',
  text: '',
  fontSize: 18,
  titleFontSize: 15,
  fontFamily: DEFAULT_FONT,
  noteColor: 'yellow',
  noteTitle: '',
  opacity: 1,
  updatedAt: '',
};
const allowedColors = new Set(['yellow', 'pink', 'mint', 'blue', 'peach', 'lavender']);
const note = document.getElementById('note');
const editor = document.getElementById('editor');
const titleInput = document.getElementById('note-title');
const status = document.getElementById('status');
const panel = document.getElementById('format-panel');
const formatToggle = document.getElementById('format-toggle');
const fontFamily = document.getElementById('font-family');
const fontSizeLabel = document.getElementById('font-size-label');
const titleFontSize = document.getElementById('title-font-size');
const titleFontSizeValue = document.getElementById('title-font-size-value');
const palette = document.getElementById('palette');
const opacity = document.getElementById('opacity');
const opacityValue = document.getElementById('opacity-value');
const linkDialog = document.getElementById('link-dialog');
const linkForm = document.getElementById('link-form');
const linkInput = document.getElementById('link-input');
const linkCancel = document.getElementById('link-cancel');

let config = {...defaults};
let saveTimer = 0;
let checkpointTimer = 0;
let savedRange = null;
let loaded = false;
let lastSavedSnapshot = '';

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  for (const node of template.content.querySelectorAll('script, style, iframe, object, embed'))
    node.remove();
  for (const node of template.content.querySelectorAll('*')) {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc')
        node.removeAttribute(attribute.name);
      if (name === 'href' && !/^(https?:|mailto:)/i.test(attribute.value))
        node.removeAttribute(attribute.name);
    }
  }
  return template.innerHTML;
}

function cleanConfig(saved) {
  const candidate = saved && typeof saved === 'object' ? saved : {};
  const legacyHtml = typeof candidate.text === 'string' && !candidate.contentHtml
    ? escapeHtml(candidate.text)
    : '';
  return {
    ...defaults,
    ...candidate,
    contentHtml: sanitizeHtml(candidate.contentHtml || legacyHtml),
    text: typeof candidate.text === 'string' ? candidate.text : '',
    fontSize: clamp(candidate.fontSize ?? defaults.fontSize, 12, 34),
    titleFontSize: clamp(candidate.titleFontSize ?? defaults.titleFontSize, 11, 28),
    fontFamily: typeof candidate.fontFamily === 'string'
      ? candidate.fontFamily : DEFAULT_FONT,
    noteColor: allowedColors.has(candidate.noteColor || candidate.color)
      ? candidate.noteColor || candidate.color : 'yellow',
    noteTitle: typeof candidate.noteTitle === 'string' ? candidate.noteTitle : '',
    opacity: clamp(candidate.opacity ?? 1, .35, 1),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
  };
}

function backupKey() {
  const instanceId = window.ding?.getInstanceId?.() || 'default';
  return `ding-mac-sticky-note-backup:${instanceId}`;
}

function readBackup() {
  try {
    const value = JSON.parse(localStorage.getItem(backupKey()));
    return value && typeof value === 'object' ? value : null;
  } catch (_error) {
    return null;
  }
}

function writeBackup(value) {
  try {
    localStorage.setItem(backupKey(), JSON.stringify(value));
  } catch (_error) {
    // The host bridge remains the primary persistence path.
  }
}

function newestConfig(hostConfig, backupConfig) {
  if (!backupConfig)
    return hostConfig;
  const hostTime = Date.parse(hostConfig?.updatedAt || '') || 0;
  const backupTime = Date.parse(backupConfig.updatedAt || '') || 0;
  return backupTime > hostTime
    ? {...hostConfig, ...backupConfig}
    : hostConfig;
}

function applyAppearance() {
  note.dataset.color = config.noteColor;
  note.style.setProperty('--widget-opacity', String(config.opacity));
  editor.style.fontFamily = config.fontFamily;
  editor.style.fontSize = `${config.fontSize}px`;
  titleInput.style.fontSize = `${config.titleFontSize}px`;
  fontSizeLabel.textContent = `${config.fontSize} 像素`;
  titleFontSize.value = String(config.titleFontSize);
  titleFontSizeValue.value = `${config.titleFontSize} 像素`;
  titleFontSizeValue.textContent = titleFontSizeValue.value;
  opacity.value = String(Math.round(config.opacity * 100));
  opacityValue.value = `${Math.round(config.opacity * 100)}%`;
  opacityValue.textContent = opacityValue.value;
  if (Array.from(fontFamily.options).some(option => option.value === config.fontFamily))
    fontFamily.value = config.fontFamily;
  for (const button of palette.querySelectorAll('[data-color]'))
    button.classList.toggle('selected', button.dataset.color === config.noteColor);
  if (document.activeElement !== titleInput)
    titleInput.value = config.noteTitle;
}

function collectConfig() {
  config.contentHtml = sanitizeHtml(editor.innerHTML);
  config.text = editor.innerText || '';
  const titleValue = typeof titleInput?.value === 'string'
    ? titleInput.value
    : titleInput?.textContent || '';
  config.noteTitle = titleValue.trim().slice(0, 60);
}

function currentSnapshot() {
  const titleValue = typeof titleInput?.value === 'string'
    ? titleInput.value
    : titleInput?.textContent || '';
  return JSON.stringify({
    contentHtml: editor.innerHTML,
    text: editor.innerText || '',
    noteTitle: titleValue,
    fontSize: config.fontSize,
    titleFontSize: config.titleFontSize,
    fontFamily: config.fontFamily,
    noteColor: config.noteColor,
    opacity: config.opacity,
  });
}

function saveNow() {
  if (!loaded)
    return;
  try {
    clearTimeout(saveTimer);
    collectConfig();
    config.updatedAt = new Date().toISOString();
    const payload = copy(config);
    // Keep an independent fallback before crossing the WebKit/GJS bridge.
    writeBackup(payload);
    if (typeof window.ding?.saveConfig === 'function')
      window.ding.saveConfig(payload);
    else if (typeof window.ding?.setConfig === 'function')
      window.ding.setConfig(payload);
    else
      throw new Error('保存接口不可用');
    lastSavedSnapshot = currentSnapshot();
    status.textContent = '已保存';
  } catch (error) {
    status.textContent = '保存失败';
    window.ding?.log?.(`便笺保存失败：${error.message}`);
  }
}

function scheduleSave() {
  if (!loaded)
    return;
  status.textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}

function selectionList() {
  const selection = window.getSelection();
  let node = selection?.anchorNode;
  if (node?.nodeType !== Node.ELEMENT_NODE)
    node = node?.parentElement;
  return node?.closest?.('ul, ol') ?? null;
}

function command(name) {
  editor.focus();
  switch (name) {
  case 'font-down':
    config.fontSize = clamp(config.fontSize - 2, 12, 34);
    applyAppearance();
    break;
  case 'font-up':
    config.fontSize = clamp(config.fontSize + 2, 12, 34);
    applyAppearance();
    break;
  case 'bold': document.execCommand('bold'); break;
  case 'italic': document.execCommand('italic'); break;
  case 'underline': document.execCommand('underline'); break;
  case 'strike': document.execCommand('strikeThrough'); break;
  case 'align-left': document.execCommand('justifyLeft'); break;
  case 'align-center': document.execCommand('justifyCenter'); break;
  case 'align-right': document.execCommand('justifyRight'); break;
  case 'list-ul':
    document.execCommand('insertUnorderedList');
    selectionList()?.classList.remove('checklist');
    break;
  case 'list-ol':
    document.execCommand('insertOrderedList');
    break;
  case 'checklist': {
    let list = selectionList();
    if (!list || list.tagName !== 'UL') {
      document.execCommand('insertUnorderedList');
      list = selectionList();
    }
    list?.classList.toggle('checklist');
    break;
  }
  case 'h1': document.execCommand('formatBlock', false, 'h1'); break;
  case 'h2': document.execCommand('formatBlock', false, 'h2'); break;
  case 'h3': document.execCommand('formatBlock', false, 'h3'); break;
  case 'blockquote': document.execCommand('formatBlock', false, 'blockquote'); break;
  case 'clear':
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    break;
  case 'link': {
    const selection = window.getSelection();
    savedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    linkDialog.hidden = false;
    linkInput.focus();
    return;
  }
  default: return;
  }
  saveNow();
}

function restoreRange() {
  if (!savedRange)
    return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

editor.addEventListener('input', scheduleSave);
editor.addEventListener('blur', saveNow);
titleInput.addEventListener('input', scheduleSave);
titleInput.addEventListener('change', saveNow);
titleInput.addEventListener('blur', saveNow);
titleInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    titleInput.blur();
    editor.focus();
  }
});
editor.addEventListener('keyup', scheduleSave);
editor.addEventListener('paste', scheduleSave);
editor.addEventListener('click', event => {
  const item = event.target.closest?.('ul.checklist > li');
  if (!item)
    return;
  const rect = item.getBoundingClientRect();
  if (event.clientX - rect.left <= 24) {
    event.preventDefault();
    item.classList.toggle('checked');
    saveNow();
  }
});

formatToggle.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  formatToggle.classList.toggle('active', !panel.hidden);
});

panel.addEventListener('mousedown', event => {
  if (event.target.closest('button[data-command]'))
    event.preventDefault();
});
panel.addEventListener('click', event => {
  const button = event.target.closest('button[data-command]');
  if (button)
    command(button.dataset.command);
});

fontFamily.addEventListener('change', () => {
  config.fontFamily = fontFamily.value;
  applyAppearance();
  saveNow();
});

palette.addEventListener('click', event => {
  const button = event.target.closest('button[data-color]');
  if (!button)
    return;
  config.noteColor = button.dataset.color;
  applyAppearance();
  saveNow();
});

opacity.addEventListener('input', () => {
  config.opacity = clamp(Number(opacity.value) / 100, .35, 1);
  applyAppearance();
  scheduleSave();
});

titleFontSize.addEventListener('input', () => {
  config.titleFontSize = clamp(titleFontSize.value, 11, 28);
  applyAppearance();
  scheduleSave();
});

linkCancel.addEventListener('click', () => {
  linkDialog.hidden = true;
  savedRange = null;
  editor.focus();
});
linkForm.addEventListener('submit', event => {
  event.preventDefault();
  const url = linkInput.value.trim();
  linkDialog.hidden = true;
  editor.focus();
  restoreRange();
  if (/^(https?:|mailto:)/i.test(url))
    document.execCommand('createLink', false, url);
  linkInput.value = '';
  savedRange = null;
  saveNow();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden')
    saveNow();
});
window.addEventListener('pagehide', saveNow);
window.addEventListener('beforeunload', saveNow);

async function start() {
  const hostConfig = await window.ding?.getConfig?.();
  config = cleanConfig(newestConfig(hostConfig, readBackup()));
  editor.innerHTML = config.contentHtml;
  loaded = true;
  applyAppearance();
  lastSavedSnapshot = currentSnapshot();
  status.textContent = '自动保存';
  clearInterval(checkpointTimer);
  checkpointTimer = setInterval(() => {
    if (currentSnapshot() !== lastSavedSnapshot)
      saveNow();
  }, 1000);
}

start().catch(error => {
  status.textContent = `加载失败：${error.message}`;
});
