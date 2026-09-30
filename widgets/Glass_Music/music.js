'use strict';

const LAYOUT_PRESETS = {
  compact: {width: 240, height: 260},
  medium: {width: 500, height: 240},
  large: {width: 500, height: 360},
};
const defaults = {
  layoutPreset: 'medium',
  opacity: 1,
  selectionMode: 'auto',
  preferredDesktopId: '',
  preferredIdentity: '',
  preferredName: '',
  showBrowserPlayers: true,
};

const elements = Object.fromEntries([
  'cover', 'cover-fallback', 'track-title', 'track-artist', 'track-album',
  'position', 'elapsed', 'duration', 'previous', 'play-pause', 'next',
  'shuffle', 'repeat', 'volume', 'player-status', 'open-player',
  'settings-button', 'settings', 'close-settings', 'layout-options',
  'selected-source', 'auto-source', 'running-players', 'show-browsers',
  'application-search', 'application-options', 'settings-status',
  'opacity', 'opacity-value',
].map(id => [id, document.getElementById(id)]));
const musicCard = document.querySelector('.music');
const coverShell = document.querySelector('.cover-shell');

let config = copy(defaults);
let players = [];
let applications = [];
let applicationsLoaded = false;
let activePlayer = null;
let refreshBusy = false;
let refreshQueued = false;
let scrubbing = false;
let positionBaseUs = 0;
let positionBaseAt = performance.now();
let artworkSerial = 0;
let artworkUri = '';
let refreshTimer = 0;
let progressTimer = 0;
const artworkCache = new Map();

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function cleanConfig(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  return {
    layoutPreset: Object.hasOwn(LAYOUT_PRESETS, value.layoutPreset)
      ? value.layoutPreset : 'medium',
    opacity: Math.min(1, Math.max(.35, Number(value.opacity) || 1)),
    selectionMode: value.selectionMode === 'preferred' ? 'preferred' : 'auto',
    preferredDesktopId: typeof value.preferredDesktopId === 'string'
      ? value.preferredDesktopId : '',
    preferredIdentity: typeof value.preferredIdentity === 'string'
      ? value.preferredIdentity : '',
    preferredName: typeof value.preferredName === 'string'
      ? value.preferredName : '',
    showBrowserPlayers: value.showBrowserPlayers !== false,
  };
}

function normalizeDesktopId(value) {
  return String(value ?? '').toLowerCase().replace(/\.desktop$/, '');
}

function applyAppearance() {
  musicCard.dataset.layout = config.layoutPreset;
  musicCard.style.setProperty('--widget-opacity', String(config.opacity));
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
  elements['show-browsers'].checked = config.showBrowserPlayers;
  for (const button of document.querySelectorAll('.layout-option'))
    button.classList.toggle('selected', button.dataset.preset === config.layoutPreset);
}

function saveConfig() {
  return window.ding?.setConfig(copy(config));
}

function playerMatchesPreference(player) {
  const preferredDesktop = normalizeDesktopId(config.preferredDesktopId);
  const playerDesktop = normalizeDesktopId(player.desktopEntry);
  if (preferredDesktop && playerDesktop && preferredDesktop === playerDesktop)
    return true;
  return !!config.preferredIdentity && player.identity === config.preferredIdentity;
}

function selectPlayer() {
  const candidates = config.showBrowserPlayers
    ? players
    : players.filter(player => !player.browser);
  if (config.selectionMode === 'preferred')
    return candidates.find(playerMatchesPreference) ?? null;
  return candidates.find(player => player.playbackStatus === 'Playing') ??
    candidates.find(player => player.playbackStatus === 'Paused') ??
    candidates[0] ?? null;
}

function formatTime(microseconds) {
  const seconds = Math.max(0, Math.floor(Number(microseconds) / 1000000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function currentPosition() {
  if (!activePlayer)
    return 0;
  let position = positionBaseUs;
  if (activePlayer.playbackStatus === 'Playing')
    position += (performance.now() - positionBaseAt) * 1000 * (activePlayer.rate || 1);
  return Math.max(0, Math.min(activePlayer.lengthUs || position, position));
}

function renderProgress() {
  if (!activePlayer || scrubbing)
    return;
  const length = Number(activePlayer.lengthUs) || 0;
  const position = currentPosition();
  elements.position.value = length ? String(Math.round(position / length * 1000)) : '0';
  elements.elapsed.textContent = formatTime(position);
  elements.duration.textContent = formatTime(length);
}

function setArtworkFallback() {
  elements.cover.hidden = true;
  elements.cover.removeAttribute('src');
  coverShell.classList.remove('has-cover');
}

async function updateArtwork(uri) {
  const normalized = String(uri ?? '');
  if (normalized === artworkUri)
    return;
  artworkUri = normalized;
  const serial = ++artworkSerial;
  setArtworkFallback();
  if (!normalized)
    return;
  try {
    let source = artworkCache.get(normalized);
    if (!source) {
      const result = await window.ding.loadMediaArtwork(normalized);
      source = String(result?.url ?? '');
      if (!source)
        throw new Error('封面地址无效');
      artworkCache.set(normalized, source);
      while (artworkCache.size > 5)
        artworkCache.delete(artworkCache.keys().next().value);
    }
    if (serial !== artworkSerial)
      return;
    elements.cover.onload = () => {
      if (serial !== artworkSerial)
        return;
      elements.cover.hidden = false;
      coverShell.classList.add('has-cover');
    };
    elements.cover.onerror = () => {
      if (serial === artworkSerial)
        setArtworkFallback();
    };
    elements.cover.src = source;
  } catch (_error) {
    if (serial === artworkSerial)
      setArtworkFallback();
  }
}

function setControlsEnabled(player) {
  elements.previous.disabled = !player?.canGoPrevious;
  elements.next.disabled = !player?.canGoNext;
  elements['play-pause'].disabled = !player ||
    !(player.canPlay || player.canPause);
  elements.position.disabled = !player?.canSeek || !player?.lengthUs;
  elements.shuffle.disabled = !player?.canControl;
  elements.repeat.disabled = !player?.canControl;
  elements.volume.disabled = !player?.canControl;
}

function renderPlayer() {
  activePlayer = selectPlayer();
  if (!activePlayer) {
    elements['track-title'].textContent = config.selectionMode === 'preferred' &&
      config.preferredName ? config.preferredName : '未连接播放器';
    elements['track-artist'].textContent = config.selectionMode === 'preferred'
      ? '应用尚未运行或不支持 MPRIS'
      : '打开播放器后会自动连接';
    elements['track-album'].textContent = '';
    elements['player-status'].textContent = config.preferredDesktopId
      ? '点击右上角箭头启动所选应用'
      : '可在设置中选择后端应用';
    elements['play-pause'].textContent = '▶';
    elements['play-pause'].title = '播放';
    elements['play-pause'].setAttribute('aria-label', '播放');
    elements.shuffle.classList.remove('active');
    elements.repeat.classList.remove('active');
    elements.repeat.textContent = '↻';
    elements.repeat.title = '循环播放';
    elements.volume.value = '100';
    elements['open-player'].disabled = !(config.selectionMode === 'preferred' &&
      config.preferredDesktopId);
    positionBaseUs = 0;
    positionBaseAt = performance.now();
    elements.position.value = '0';
    elements.elapsed.textContent = '0:00';
    elements.duration.textContent = '0:00';
    setControlsEnabled(null);
    updateArtwork('');
    renderSettingsSources();
    return;
  }

  positionBaseUs = Number(activePlayer.positionUs) || 0;
  positionBaseAt = performance.now();
  elements['track-title'].textContent = activePlayer.title || '未知曲目';
  elements['track-artist'].textContent = activePlayer.artist || '未知艺术家';
  elements['track-album'].textContent = activePlayer.album || activePlayer.identity;
  elements['player-status'].textContent = `${activePlayer.identity} · ${
    activePlayer.playbackStatus === 'Playing' ? '正在播放' :
    activePlayer.playbackStatus === 'Paused' ? '已暂停' : '已停止'}`;
  const playing = activePlayer.playbackStatus === 'Playing';
  elements['play-pause'].textContent = playing ? 'Ⅱ' : '▶';
  elements['play-pause'].title = playing ? '暂停' : '播放';
  elements['play-pause'].setAttribute('aria-label', playing ? '暂停' : '播放');
  elements.shuffle.classList.toggle('active', activePlayer.shuffle);
  elements.repeat.classList.toggle('active', activePlayer.loopStatus !== 'None');
  elements.repeat.textContent = activePlayer.loopStatus === 'Track' ? '↻¹' : '↻';
  elements.repeat.title = activePlayer.loopStatus === 'Track'
    ? '单曲循环' : activePlayer.loopStatus === 'Playlist'
      ? '列表循环' : '不循环';
  elements.volume.value = String(Math.round(Math.min(1, activePlayer.volume) * 100));
  elements['open-player'].disabled = !(activePlayer.canRaise ||
    (config.selectionMode === 'preferred' && config.preferredDesktopId));
  setControlsEnabled(activePlayer);
  renderProgress();
  updateArtwork(activePlayer.artUrl);
  renderSettingsSources();
}

async function refreshPlayers() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  refreshBusy = true;
  try {
    const result = await window.ding.getMediaPlayers();
    players = Array.isArray(result?.players) ? result.players : [];
    renderPlayer();
  } catch (error) {
    elements['player-status'].textContent = `无法读取播放器：${error.message}`;
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      setTimeout(refreshPlayers, 80);
    }
  }
}

async function mediaCommand(action, value) {
  if (!activePlayer)
    return;
  try {
    await window.ding.controlMediaPlayer(activePlayer.busName, action, value);
    elements['player-status'].textContent = '';
    setTimeout(refreshPlayers, 100);
  } catch (error) {
    elements['player-status'].textContent = `操作失败：${error.message}`;
  }
}

function selectRunningPlayer(player) {
  config.selectionMode = 'preferred';
  config.preferredDesktopId = player.desktopEntry
    ? `${normalizeDesktopId(player.desktopEntry)}.desktop` : '';
  config.preferredIdentity = player.identity;
  config.preferredName = player.identity;
  saveConfig();
  renderPlayer();
}

function selectApplication(app) {
  config.selectionMode = 'preferred';
  config.preferredDesktopId = app.desktopId;
  config.preferredIdentity = '';
  config.preferredName = app.name;
  saveConfig();
  renderPlayer();
  renderApplications();
  elements['settings-status'].textContent = `已选择 ${app.name}；可点击主界面右上角箭头启动。`;
}

function renderSettingsSources() {
  if (!elements.settings || elements.settings.hidden)
    return;
  elements['auto-source'].classList.toggle('selected', config.selectionMode === 'auto');
  elements['selected-source'].textContent = config.selectionMode === 'auto'
    ? '自动选择'
    : config.preferredName || config.preferredDesktopId || '固定播放器';

  const visible = config.showBrowserPlayers
    ? players : players.filter(player => !player.browser);
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-option';
    empty.textContent = '当前没有检测到 MPRIS 播放器';
    elements['running-players'].replaceChildren(empty);
    return;
  }
  const rows = visible.map(player => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'player-option';
    button.classList.toggle('selected', config.selectionMode === 'preferred' &&
      playerMatchesPreference(player));
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = player.identity;
    const detail = document.createElement('small');
    detail.textContent = `${player.browser ? '浏览器媒体 · ' : ''}${
      player.playbackStatus === 'Playing' ? '正在播放' :
      player.playbackStatus === 'Paused' ? '已暂停' : '已停止'}`;
    text.append(name, detail);
    const dot = document.createElement('i');
    dot.className = `status-dot ${player.playbackStatus === 'Playing' ? 'playing' : ''}`;
    button.append(text, dot);
    button.addEventListener('click', () => selectRunningPlayer(player));
    return button;
  });
  elements['running-players'].replaceChildren(...rows);
}

function renderApplications() {
  const query = elements['application-search'].value.trim().toLocaleLowerCase('zh-CN');
  const filtered = applications.filter(app => !query ||
    `${app.name} ${app.description} ${app.desktopId}`.toLocaleLowerCase('zh-CN')
      .includes(query)).slice(0, 80);
  const rows = filtered.map(app => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `app-option${app.media ? ' media' : ''}`;
    button.classList.toggle('selected', config.selectionMode === 'preferred' &&
      normalizeDesktopId(app.desktopId) === normalizeDesktopId(config.preferredDesktopId));
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = app.name;
    const detail = document.createElement('small');
    detail.textContent = app.description || app.desktopId;
    text.append(name, detail);
    const badge = document.createElement('em');
    badge.textContent = app.media ? '媒体' : '其他';
    button.append(text, badge);
    button.addEventListener('click', () => selectApplication(app));
    return button;
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-option';
    empty.textContent = applicationsLoaded ? '没有找到匹配应用' : '正在读取应用…';
    elements['application-options'].replaceChildren(empty);
  } else {
    elements['application-options'].replaceChildren(...rows);
  }
}

async function loadApplications() {
  if (applicationsLoaded)
    return;
  renderApplications();
  try {
    const result = await window.ding.listMediaApplications();
    applications = Array.isArray(result?.applications) ? result.applications : [];
    applicationsLoaded = true;
    renderApplications();
  } catch (error) {
    applicationsLoaded = true;
    elements['settings-status'].textContent = `无法读取应用列表：${error.message}`;
  }
}

async function openSelectedPlayer() {
  if (activePlayer?.canRaise) {
    await mediaCommand('raise');
    return;
  }
  if (config.selectionMode !== 'preferred' || !config.preferredDesktopId)
    return;
  elements['player-status'].textContent = `正在打开 ${config.preferredName || '播放器'}…`;
  try {
    await window.ding.launchMediaApplication(config.preferredDesktopId);
    setTimeout(refreshPlayers, 900);
  } catch (error) {
    elements['player-status'].textContent = error.message;
  }
}

elements['settings-button'].addEventListener('click', () => {
  elements.settings.hidden = false;
  applyAppearance();
  renderSettingsSources();
  loadApplications();
});
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements['layout-options'].addEventListener('click', async event => {
  const button = event.target.closest('.layout-option');
  const preset = button?.dataset.preset;
  if (!Object.hasOwn(LAYOUT_PRESETS, preset))
    return;
  config.layoutPreset = preset;
  applyAppearance();
  await saveConfig();
  const size = LAYOUT_PRESETS[preset];
  window.ding?.setSize?.(size.width, size.height);
  elements.settings.hidden = true;
});
elements['auto-source'].addEventListener('click', () => {
  config.selectionMode = 'auto';
  saveConfig();
  renderPlayer();
});
elements['show-browsers'].addEventListener('change', () => {
  config.showBrowserPlayers = elements['show-browsers'].checked;
  saveConfig();
  renderPlayer();
});
elements['application-search'].addEventListener('input', renderApplications);
elements.opacity.addEventListener('input', () => {
  config.opacity = Math.min(1, Math.max(.35, Number(elements.opacity.value) / 100));
  applyAppearance();
  saveConfig();
});
elements['open-player'].addEventListener('click', openSelectedPlayer);
elements.previous.addEventListener('click', () => mediaCommand('previous'));
elements.next.addEventListener('click', () => mediaCommand('next'));
elements['play-pause'].addEventListener('click', () => mediaCommand('playPause'));
elements.shuffle.addEventListener('click', () =>
  mediaCommand('setShuffle', !activePlayer?.shuffle));
elements.repeat.addEventListener('click', () => {
  const nextStatus = activePlayer?.loopStatus === 'None' ? 'Playlist'
    : activePlayer?.loopStatus === 'Playlist' ? 'Track' : 'None';
  mediaCommand('setLoopStatus', nextStatus);
});
elements.position.addEventListener('pointerdown', () => {
  scrubbing = true;
});
elements.position.addEventListener('input', () => {
  if (!activePlayer?.lengthUs)
    return;
  elements.elapsed.textContent = formatTime(
    activePlayer.lengthUs * Number(elements.position.value) / 1000
  );
});
elements.position.addEventListener('change', () => {
  if (!activePlayer?.lengthUs)
    return;
  const positionUs = Math.round(
    activePlayer.lengthUs * Number(elements.position.value) / 1000
  );
  scrubbing = false;
  mediaCommand('setPosition', {trackId: activePlayer.trackId, positionUs});
});
elements.position.addEventListener('pointerup', () => {
  scrubbing = false;
});
elements.volume.addEventListener('change', () =>
  mediaCommand('setVolume', Number(elements.volume.value) / 100));

async function start() {
  config = cleanConfig(await window.ding?.getConfig?.());
  applyAppearance();
  setControlsEnabled(null);
  await refreshPlayers();
  window.ding?.onMediaChanged?.(() => refreshPlayers());
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshPlayers, 10000);
  clearInterval(progressTimer);
  progressTimer = setInterval(renderProgress, 250);
}

start();
