'use strict';

// Mainland statutory holiday data follows tigertall/chinese-calendar's
// public JSON feed and cache model:
// https://github.com/tigertall/chinese-calendar

const HOLIDAY_URL = 'https://tigertall.github.io/chinese-calendar/data/holidays_cn.json';
const defaults = {
  showLunar: true,
  showFestivals: true,
  showStatutory: true,
  showWorkdays: true,
  weekStartsMonday: true,
  opacity: 1,
  holidayCache: null,
  holidayLastUpdate: '',
};
const lunarMonthNumbers = {
  '正月': 1, '一月': 1, '二月': 2, '三月': 3, '四月': 4,
  '五月': 5, '六月': 6, '七月': 7, '八月': 8, '九月': 9,
  '十月': 10, '十一月': 11, '冬月': 11, '十二月': 12, '腊月': 12,
};
const lunarFestivals = new Map([
  ['1-1', '春节'], ['1-15', '元宵节'], ['2-2', '龙抬头'],
  ['3-3', '上巳节'], ['5-5', '端午节'], ['7-7', '七夕节'],
  ['7-15', '中元节'], ['8-15', '中秋节'], ['9-9', '重阳节'],
  ['12-8', '腊八节'], ['12-23', '小年'],
]);
const solarTermNames = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];
const solarTermMinutes = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
  173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
  353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
];
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  year: 'numeric', month: 'long', day: 'numeric',
});
const calendar = document.getElementById('calendar');
const elements = Object.fromEntries([
  'weekday', 'month', 'previous', 'today-button', 'next', 'settings-button',
  'week', 'days', 'day-detail', 'calendar-status', 'settings', 'close-settings',
  'show-lunar', 'show-festivals', 'show-statutory', 'show-workdays',
  'week-monday', 'opacity', 'opacity-value', 'last-update', 'update-holidays',
  'update-status',
].map(id => [id, document.getElementById(id)]));

let config = {...defaults};
let holidayMap = new Map();
let viewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sameDate(left, right) {
  return dateKey(left) === dateKey(right);
}

function cleanConfig(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  return {
    ...defaults,
    ...value,
    showLunar: value.showLunar !== false,
    showFestivals: value.showFestivals !== false,
    showStatutory: value.showStatutory !== false,
    showWorkdays: value.showWorkdays !== false,
    weekStartsMonday: value.weekStartsMonday !== false,
    opacity: clamp(value.opacity ?? 1, .35, 1),
    holidayCache: value.holidayCache && typeof value.holidayCache === 'object'
      ? value.holidayCache : null,
    holidayLastUpdate: typeof value.holidayLastUpdate === 'string'
      ? value.holidayLastUpdate : '',
  };
}

function lunarParts(date) {
  try {
    const parts = lunarFormatter.formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value ?? '';
    const monthText = get('month');
    return {
      relatedYear: get('relatedYear'),
      yearName: get('yearName'),
      monthText,
      month: lunarMonthNumbers[monthText.replace(/^闰/, '')] || 0,
      leap: monthText.startsWith('闰'),
      day: Number(get('day')) || 0,
    };
  } catch (_error) {
    return {relatedYear: '', yearName: '', monthText: '', month: 0, leap: false, day: 0};
  }
}

function lunarDayName(day) {
  const names = [
    '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九',
    '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九',
    '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
  ];
  return names[day] || '';
}

function solarTerm(date) {
  const year = date.getFullYear();
  if (year < 1900 || year > 2100)
    return '';
  for (let index = 0; index < solarTermNames.length; index++) {
    const instant = new Date(
      31556925974.7 * (year - 1900) +
      solarTermMinutes[index] * 60000 + Date.UTC(1900, 0, 6, 2, 5)
    );
    if (instant.getUTCMonth() === date.getMonth() &&
        instant.getUTCDate() === date.getDate())
      return solarTermNames[index];
  }
  return '';
}

function festivalFor(date, lunar = lunarParts(date)) {
  if (!config.showFestivals || lunar.leap)
    return '';
  const festival = lunarFestivals.get(`${lunar.month}-${lunar.day}`);
  if (festival)
    return festival;
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next = lunarParts(tomorrow);
  if (lunar.month === 12 && next.month === 1 && next.day === 1)
    return '除夕';
  return solarTerm(date);
}

function parseHolidayCache(data) {
  const result = new Map();
  if (!data?.Years || typeof data.Years !== 'object')
    return result;
  for (const holidays of Object.values(data.Years)) {
    if (!Array.isArray(holidays))
      continue;
    for (const holiday of holidays) {
      if (!holiday?.Name || !holiday.StartDate || !holiday.EndDate)
        continue;
      const start = new Date(`${holiday.StartDate}T12:00:00`);
      const end = new Date(`${holiday.EndDate}T12:00:00`);
      for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
        result.set(dateKey(day), {
          name: holiday.Name, isHoliday: true, isWorkday: false,
        });
      }
      for (const compensation of holiday.CompDays ?? []) {
        result.set(compensation, {
          name: `${holiday.Name}（调休）`, isHoliday: false, isWorkday: true,
        });
      }
    }
  }
  return result;
}

function compressHolidayData(data) {
  const compressed = {Version: data.Version ?? '', Region: 'CN', Years: {}};
  for (const [year, holidays] of Object.entries(data.Years ?? {})) {
    if (!Array.isArray(holidays))
      continue;
    compressed.Years[year] = holidays.map(item => ({
      Name: item.Name,
      StartDate: item.StartDate,
      EndDate: item.EndDate,
      CompDays: Array.isArray(item.CompDays) ? item.CompDays : [],
    }));
  }
  return compressed;
}

function applySettings() {
  calendar.style.setProperty('--widget-opacity', String(config.opacity));
  elements['show-lunar'].checked = config.showLunar;
  elements['show-festivals'].checked = config.showFestivals;
  elements['show-statutory'].checked = config.showStatutory;
  elements['show-workdays'].checked = config.showWorkdays;
  elements['week-monday'].checked = config.weekStartsMonday;
  elements.opacity.value = String(Math.round(config.opacity * 100));
  elements['opacity-value'].value = `${Math.round(config.opacity * 100)}%`;
  elements['opacity-value'].textContent = elements['opacity-value'].value;
  elements['last-update'].textContent = config.holidayLastUpdate
    ? `上次更新：${new Date(config.holidayLastUpdate).toLocaleString('zh-CN')}`
    : '尚未更新';
}

function saveConfig() {
  window.ding?.setConfig(copy(config));
}

function daySubtitle(date, lunar) {
  const festival = festivalFor(date, lunar);
  if (festival)
    return festival;
  if (!config.showLunar)
    return '';
  return lunar.day === 1 ? lunar.monthText : lunarDayName(lunar.day);
}

function showDayDetail(date) {
  const lunar = lunarParts(date);
  const festival = festivalFor(date, lunar);
  const statutory = holidayMap.get(dateKey(date));
  const lunarText = `${lunar.relatedYear}${lunar.yearName ? ` ${lunar.yearName}年` : ''}` +
    `${lunar.monthText}${lunarDayName(lunar.day)}`;
  const parts = [
    `<strong>${new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'}).format(date)}</strong>`,
  ];
  if (config.showLunar)
    parts.push(`<span>农历 ${lunarText}</span>`);
  if (festival)
    parts.push(`<span>${festival}</span>`);
  if (statutory && config.showStatutory && (!statutory.isWorkday || config.showWorkdays))
    parts.push(`<span>${statutory.name} · ${statutory.isWorkday ? '补班' : '休假'}</span>`);
  elements['day-detail'].innerHTML = parts.join('');
  elements['day-detail'].hidden = false;
}

function render() {
  const now = new Date();
  elements.weekday.textContent = new Intl.DateTimeFormat('zh-CN', {weekday: 'long'}).format(now);
  elements.month.textContent = new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'long'}).format(viewDate);
  elements.week.replaceChildren();
  const weekdays = config.weekStartsMonday
    ? ['一', '二', '三', '四', '五', '六', '日']
    : ['日', '一', '二', '三', '四', '五', '六'];
  for (const label of weekdays) {
    const cell = document.createElement('span');
    cell.textContent = label;
    elements.week.append(cell);
  }

  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const leading = config.weekStartsMonday ? (first.getDay() + 6) % 7 : first.getDay();
  const start = new Date(first);
  start.setDate(1 - leading);
  const cells = [];
  for (let index = 0; index < 42; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const lunar = lunarParts(date);
    const statutory = holidayMap.get(dateKey(date));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    if (date.getMonth() !== viewDate.getMonth())
      button.classList.add('muted');
    if (sameDate(date, now))
      button.classList.add('today');
    if (statutory?.isHoliday && config.showStatutory)
      button.classList.add('holiday');
    if (statutory?.isWorkday && config.showStatutory && config.showWorkdays)
      button.classList.add('workday');
    const number = document.createElement('strong');
    number.textContent = String(date.getDate());
    const subtitle = document.createElement('small');
    subtitle.textContent = daySubtitle(date, lunar);
    button.append(number, subtitle);
    if (statutory && config.showStatutory && (!statutory.isWorkday || config.showWorkdays)) {
      const badge = document.createElement('i');
      badge.textContent = statutory.isWorkday ? '班' : '休';
      button.append(badge);
    }
    button.addEventListener('click', () => showDayDetail(date));
    cells.push(button);
  }
  elements.days.replaceChildren(...cells);
}

async function updateHolidays(manual = true) {
  const button = elements['update-holidays'];
  button.disabled = true;
  button.textContent = '更新中…';
  elements['update-status'].textContent = '正在获取中国大陆节假日数据…';
  try {
    const response = await fetch(`${HOLIDAY_URL}?t=${Date.now()}`, {cache: 'no-store'});
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.Years)
      throw new Error('数据格式不正确');
    config.holidayCache = compressHolidayData(data);
    config.holidayLastUpdate = new Date().toISOString();
    holidayMap = parseHolidayCache(config.holidayCache);
    saveConfig();
    applySettings();
    render();
    elements['update-status'].textContent = '节假日数据更新成功';
  } catch (_error) {
    elements['update-status'].textContent = config.holidayCache
      ? '更新失败，继续使用上次保存的数据'
      : '更新失败，请检查网络后重试';
    if (!manual)
      elements['calendar-status'].textContent = '节假日数据尚未更新';
  } finally {
    button.disabled = false;
    button.textContent = '更新数据';
  }
}

elements.previous.addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  elements['day-detail'].hidden = true;
  render();
});
elements.next.addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  elements['day-detail'].hidden = true;
  render();
});
elements['today-button'].addEventListener('click', () => {
  const now = new Date();
  viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  showDayDetail(now);
  render();
});
elements['settings-button'].addEventListener('click', () => {
  applySettings();
  elements.settings.hidden = false;
});
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements['update-holidays'].addEventListener('click', () => updateHolidays(true));

for (const [id, key] of [
  ['show-lunar', 'showLunar'], ['show-festivals', 'showFestivals'],
  ['show-statutory', 'showStatutory'], ['show-workdays', 'showWorkdays'],
  ['week-monday', 'weekStartsMonday'],
]) {
  elements[id].addEventListener('change', () => {
    config[key] = elements[id].checked;
    saveConfig();
    render();
  });
}
elements.opacity.addEventListener('input', () => {
  config.opacity = clamp(Number(elements.opacity.value) / 100, .35, 1);
  applySettings();
  saveConfig();
});

async function start() {
  config = cleanConfig(await window.ding?.getConfig?.());
  holidayMap = parseHolidayCache(config.holidayCache);
  applySettings();
  render();
  if (!config.holidayCache)
    await updateHolidays(false);
}

start().catch(error => {
  elements['calendar-status'].textContent = `日历加载失败：${error.message}`;
});
setInterval(render, 60 * 1000);
