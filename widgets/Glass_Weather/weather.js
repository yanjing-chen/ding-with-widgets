const LAYOUT_PRESETS = {
  compact: {width: 190, height: 220},
  medium: {width: 500, height: 235},
  large: {width: 500, height: 350},
};

const defaults = {
  layoutPreset: 'large',
  opacity: 1,
  location: {
    name: '上海',
    admin1: '上海',
    country: '中国',
    latitude: 31.2304,
    longitude: 121.4737,
    timezone: 'Asia/Shanghai',
  },
  cache: null,
};

const elements = Object.fromEntries([
  'location-name', 'updated', 'weather-icon', 'temperature', 'condition',
  'high-low', 'apparent', 'humidity', 'wind', 'hourly', 'forecast', 'status',
  'settings', 'settings-button', 'close-settings', 'search-form',
  'city-input', 'search-status', 'search-results', 'opacity', 'opacity-value',
  'layout-options',
].map(id => [id, document.getElementById(id)]));
const weatherCard = document.querySelector('.weather');

let config = copy(defaults);
let refreshTimer = 0;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyAppearance() {
  if (!Object.hasOwn(LAYOUT_PRESETS, config.layoutPreset))
    config.layoutPreset = 'large';
  config.opacity = Math.min(1, Math.max(.35, Number(config.opacity) || 1));
  weatherCard.dataset.layout = config.layoutPreset;
  weatherCard.style.setProperty('--widget-opacity', String(config.opacity));
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
  for (const button of document.querySelectorAll('.layout-option'))
    button.classList.toggle('selected', button.dataset.preset === config.layoutPreset);
}

function weatherInfo(code) {
  if (code === 0) return ['晴朗', '☀️'];
  if (code === 1) return ['大致晴朗', '🌤️'];
  if (code === 2) return ['局部多云', '⛅'];
  if (code === 3) return ['阴天', '☁️'];
  if ([45, 48].includes(code)) return ['有雾', '🌫️'];
  if ([51, 53, 55, 56, 57].includes(code)) return ['毛毛雨', '🌦️'];
  if ([61, 63, 65, 66, 67].includes(code)) return ['下雨', '🌧️'];
  if ([71, 73, 75, 77].includes(code)) return ['下雪', '🌨️'];
  if ([80, 81, 82].includes(code)) return ['阵雨', '🌦️'];
  if ([85, 86].includes(code)) return ['阵雪', '🌨️'];
  if ([95, 96, 99].includes(code)) return ['雷暴', '⛈️'];
  return ['天气变化', '🌤️'];
}

function number(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : '--';
}

function locationLabel(location) {
  const details = [location.admin1, location.country]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  return details.length ? `${location.name} · ${details.join('，')}` : location.name;
}

function render(data) {
  const current = data?.current;
  const daily = data?.daily;
  if (!current || !daily)
    return;
  const [condition, icon] = weatherInfo(Number(current.weather_code));
  elements['location-name'].textContent = locationLabel(config.location);
  elements['weather-icon'].textContent = icon;
  elements.temperature.textContent = number(current.temperature_2m);
  elements.condition.textContent = condition;
  elements['high-low'].textContent =
    `最高 ${number(daily.temperature_2m_max?.[0])}° · ` +
    `最低 ${number(daily.temperature_2m_min?.[0])}°`;
  elements.apparent.textContent = `${number(current.apparent_temperature)}°`;
  elements.humidity.textContent = `${number(current.relative_humidity_2m)}%`;
  elements.wind.textContent = `${number(current.wind_speed_10m)} km/h`;
  const updatedAt = new Date(config.cache?.fetchedAt ?? Date.now());
  elements.updated.textContent = `更新于 ${updatedAt.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit',
  })}`;

  const hourlyCards = [];
  const hourly = data?.hourly;
  if (Array.isArray(hourly?.time)) {
    const currentTime = String(current.time ?? '');
    let startIndex = hourly.time.findIndex(time => String(time) >= currentTime);
    if (startIndex < 0)
      startIndex = 0;
    for (let offset = 0; offset < 5; offset++) {
      const index = startIndex + offset;
      if (index >= hourly.time.length)
        break;
      const [text, hourIcon] = weatherInfo(Number(hourly.weather_code?.[index]));
      const card = document.createElement('article');
      const time = document.createElement('strong');
      time.textContent = offset === 0
        ? '现在'
        : `${String(hourly.time[index]).slice(11, 13)}时`;
      const symbol = document.createElement('span');
      symbol.className = 'hourly-icon';
      symbol.textContent = hourIcon;
      symbol.title = text;
      const temperature = document.createElement('small');
      temperature.textContent = `${number(hourly.temperature_2m?.[index])}°`;
      card.append(time, symbol, temperature);
      hourlyCards.push(card);
    }
  }
  elements.hourly.replaceChildren(...hourlyCards);

  const cards = [];
  for (let index = 0; index < Math.min(5, daily.time?.length ?? 0); index++) {
    const [text, dayIcon] = weatherInfo(Number(daily.weather_code[index]));
    const card = document.createElement('article');
    const day = document.createElement('strong');
    day.textContent = new Intl.DateTimeFormat('zh-CN', {weekday: 'short'})
      .format(new Date(`${daily.time[index]}T12:00:00`));
    const symbol = document.createElement('span');
    symbol.className = 'forecast-icon';
    symbol.textContent = dayIcon;
    symbol.title = text;
    const temperatures = document.createElement('small');
    temperatures.textContent =
      `${number(daily.temperature_2m_max[index])}° / ` +
      `${number(daily.temperature_2m_min[index])}°`;
    card.append(day, symbol, temperatures);
    cards.push(card);
  }
  elements.forecast.replaceChildren(...cards);
}

async function saveConfig() {
  await window.ding?.setConfig(copy(config));
}

async function updateWeather() {
  const {latitude, longitude} = config.location;
  elements.status.textContent = '正在更新天气…';
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
      'weather_code', 'wind_speed_10m',
    ].join(','),
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    ].join(','),
    hourly: ['temperature_2m', 'weather_code'].join(','),
    timezone: 'auto',
    forecast_days: '5',
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    config.cache = {data, fetchedAt: new Date().toISOString()};
    render(data);
    await saveConfig();
    elements.status.textContent = '';
  } catch (_error) {
    elements.status.textContent = config.cache?.data
      ? '暂时无法更新，正在显示上次天气'
      : '天气加载失败，请检查网络后重试';
  }
}

function showSearchResults(results) {
  const rows = results.map(location => {
    const button = document.createElement('button');
    button.type = 'button';
    const title = document.createElement('strong');
    title.textContent = location.name;
    const detail = document.createElement('span');
    detail.textContent = [location.admin1, location.country]
      .filter(Boolean).join('，');
    button.append(title, detail);
    button.addEventListener('click', async () => {
      config.location = {
        name: location.name,
        admin1: location.admin1 ?? '',
        country: location.country ?? '',
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone ?? 'auto',
      };
      config.cache = null;
      elements['location-name'].textContent = locationLabel(config.location);
      await saveConfig();
      elements.settings.hidden = true;
      await updateWeather();
    });
    return button;
  });
  elements['search-results'].replaceChildren(...rows);
}

elements['settings-button'].addEventListener('click', () => {
  elements.settings.hidden = false;
  elements['city-input'].focus();
});
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements.opacity.addEventListener('input', async () => {
  config.opacity = Math.min(1, Math.max(.35, Number(elements.opacity.value) / 100));
  applyAppearance();
  await saveConfig();
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
elements['search-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const name = elements['city-input'].value.trim();
  if (name.length < 2)
    return;
  elements['search-status'].textContent = '正在搜索…';
  elements['search-results'].replaceChildren();
  try {
    const query = new URLSearchParams({name, count: '8', language: 'zh'});
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${query}`
    );
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    elements['search-status'].textContent = results.length
      ? '请选择正确的城市：'
      : '没有找到该城市，请尝试完整名称。';
    showSearchResults(results);
  } catch (_error) {
    elements['search-status'].textContent = '搜索失败，请检查网络后重试。';
  }
});

async function start() {
  const saved = await window.ding?.getConfig?.();
  config = {...copy(defaults), ...(saved && typeof saved === 'object' ? saved : {})};
  config.location = {...defaults.location, ...(config.location ?? {})};
  applyAppearance();
  elements['location-name'].textContent = locationLabel(config.location);
  if (config.cache?.data)
    render(config.cache.data);
  await updateWeather();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(updateWeather, 30 * 60 * 1000);
}

start();
