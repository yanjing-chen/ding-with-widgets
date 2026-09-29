const locale = navigator.language || 'zh-CN';
const defaults = {
  hour12: false,
  opacity: 1,
  locations: [
    {label: '上海', timeZone: 'Asia/Shanghai'},
    {label: '阿姆斯特丹', timeZone: 'Europe/Amsterdam'},
    {label: '纽约', timeZone: 'America/New_York'},
  ],
};

const locations = document.getElementById('locations');
const settings = document.getElementById('settings');
const settingsButton = document.getElementById('settings-button');
const closeSettings = document.getElementById('close-settings');
const locationEditor = document.getElementById('location-editor');
const searchForm = document.getElementById('city-search');
const cityQuery = document.getElementById('city-query');
const searchButton = document.getElementById('search-button');
const searchResults = document.getElementById('search-results');
const hour24 = document.getElementById('hour-24');
const error = document.getElementById('error');
const clock = document.querySelector('.clock');
const opacity = document.getElementById('opacity');
const opacityValue = document.getElementById('opacity-value');
let config = copy(defaults);
let timer = 0;
let searchController = null;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanConfig(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const savedLocations = Array.isArray(candidate.locations)
    ? candidate.locations.filter(item => item && typeof item.label === 'string' &&
      typeof item.timeZone === 'string' && isTimeZone(item.timeZone))
    : [];
  return {
    hour12: candidate.hour12 === true,
    opacity: Math.min(1, Math.max(.35, Number(candidate.opacity) || 1)),
    locations: savedLocations.length ? savedLocations.slice(0, 12) : copy(defaults.locations),
  };
}

function applyAppearance() {
  clock.style.setProperty('--widget-opacity', String(config.opacity));
  opacity.value = String(Math.round(config.opacity * 100));
  opacityValue.value = `${Math.round(config.opacity * 100)}%`;
  opacityValue.textContent = opacityValue.value;
}

function isTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en', {timeZone}).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function timeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: config.hour12,
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value ?? '';
  const dayPeriod = value('dayPeriod');
  return `${value('hour')}:${value('minute')}${dayPeriod ? ` ${dayPeriod}` : ''}`;
}

function dateText(date, timeZone) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function zoneOffset(date, timeZone) {
  try {
    const name = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value;
    return name || timeZone;
  } catch (_error) {
    return timeZone;
  }
}

function renderClocks() {
  const now = new Date();
  locations.replaceChildren(...config.locations.map(item => {
    const row = document.createElement('article');
    row.className = 'location-row';

    const place = document.createElement('div');
    place.className = 'place';
    const name = document.createElement('strong');
    name.textContent = item.label;
    const meta = document.createElement('span');
    meta.textContent = `${dateText(now, item.timeZone)} · ${zoneOffset(now, item.timeZone)}`;
    place.append(name, meta);

    const time = document.createElement('time');
    time.textContent = timeParts(now, item.timeZone);
    row.append(place, time);
    return row;
  }));
}

function renderEditor() {
  locationEditor.replaceChildren(...config.locations.map((item, index) => {
    const row = document.createElement('div');
    row.className = 'editor-row';
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.label;
    const zone = document.createElement('span');
    zone.textContent = item.timeZone;
    text.append(name, zone);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.title = `删除 ${item.label}`;
    remove.setAttribute('aria-label', remove.title);
    remove.textContent = '−';
    remove.disabled = config.locations.length === 1;
    remove.addEventListener('click', () => {
      config.locations.splice(index, 1);
      saveAndRender();
    });
    row.append(text, remove);
    return row;
  }));
  hour24.checked = !config.hour12;
}

function saveAndRender() {
  window.ding?.setConfig(copy(config));
  applyAppearance();
  renderClocks();
  renderEditor();
}

function openSettings() {
  settings.hidden = false;
  settingsButton.setAttribute('aria-expanded', 'true');
  renderEditor();
  cityQuery.focus();
}

function hideSettings() {
  settings.hidden = true;
  settingsButton.setAttribute('aria-expanded', 'false');
}

settingsButton.addEventListener('click', openSettings);
closeSettings.addEventListener('click', hideSettings);
hour24.addEventListener('change', () => {
  config.hour12 = !hour24.checked;
  saveAndRender();
});
opacity.addEventListener('input', () => {
  config.opacity = Math.min(1, Math.max(.35, Number(opacity.value) / 100));
  saveAndRender();
});

function locationDetails(location) {
  return [location.admin1, location.country]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('，');
}

function addSearchResult(location) {
  const label = String(location.name ?? '').trim();
  const timeZone = String(location.timezone ?? '').trim();
  if (!label || !isTimeZone(timeZone))
    return;
  if (config.locations.length >= 12) {
    error.textContent = '最多显示 12 个城市。';
    return;
  }
  const alreadyAdded = config.locations.some(item =>
    item.label === label && item.timeZone === timeZone
  );
  if (alreadyAdded) {
    error.textContent = `${label} 已经在世界时钟中。`;
    return;
  }
  config.locations.push({label, timeZone});
  cityQuery.value = '';
  searchResults.replaceChildren();
  error.textContent = `已添加 ${label}`;
  saveAndRender();
}

function showSearchResults(results) {
  const validResults = results.filter(location =>
    location && typeof location.name === 'string' && isTimeZone(location.timezone)
  );
  const rows = validResults.map(location => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';

    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = location.name;
    const detail = document.createElement('small');
    detail.textContent = locationDetails(location) || location.timezone;
    text.append(title, detail);

    const add = document.createElement('span');
    add.className = 'result-add';
    add.textContent = '添加';
    button.append(text, add);
    button.addEventListener('click', () => addSearchResult(location));
    return button;
  });
  searchResults.replaceChildren(...rows);
  return rows.length;
}

searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = cityQuery.value.trim();
  if (name.length < 2) {
    error.textContent = '请输入至少两个字的城市名。';
    cityQuery.focus();
    return;
  }
  if (config.locations.length >= 12) {
    error.textContent = '最多显示 12 个城市。';
    return;
  }
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  searchButton.disabled = true;
  error.textContent = '正在搜索城市…';
  searchResults.replaceChildren();
  try {
    const query = new URLSearchParams({name, count: '10', language: 'zh'});
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${query}`,
      {signal: controller.signal}
    );
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const resultCount = showSearchResults(Array.isArray(data.results) ? data.results : []);
    error.textContent = resultCount
      ? '请选择正确的城市：'
      : '没有找到该城市，请尝试更完整的名称。';
  } catch (searchError) {
    if (searchError.name !== 'AbortError')
      error.textContent = '城市搜索失败，请检查网络后重试。';
  } finally {
    if (searchController === controller) {
      searchButton.disabled = false;
      searchController = null;
    }
  }
});

async function start() {
  const saved = await window.ding?.getConfig?.();
  config = cleanConfig(saved);
  applyAppearance();
  renderClocks();
  renderEditor();
  clearInterval(timer);
  timer = setInterval(renderClocks, 1000);
}

start();
