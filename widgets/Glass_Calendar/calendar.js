'use strict';

// Mainland statutory holiday data follows tigertall/chinese-calendar's
// public JSON feed and cache model:
// https://github.com/tigertall/chinese-calendar

const HOLIDAY_URL = 'https://tigertall.github.io/chinese-calendar/data/holidays_cn.json';
const LAYOUT_PRESETS = {
  compact: {width: 220, height: 240},
  medium: {width: 400, height: 380},
  large: {width: 660, height: 420},
};
const defaults = {
  layoutPreset: 'medium',
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
  'compact-month', 'compact-settings', 'compact-today',
  'compact-previous-day', 'compact-next-day',
  'compact-day', 'compact-weekday',
  'compact-lunar', 'compact-markers', 'compact-add', 'month',
  'previous', 'today-button', 'next', 'settings-button', 'week', 'days',
  'selected-heading', 'selected-lunar', 'selected-events', 'add-event',
  'event-popover', 'popover-heading', 'popover-lunar', 'popover-events',
  'calendar-status', 'settings', 'close-settings', 'layout-options',
  'show-lunar', 'show-festivals', 'show-statutory', 'show-workdays',
  'week-monday', 'opacity', 'opacity-value', 'last-update',
  'update-holidays', 'update-status',
  'event-editor', 'event-form', 'close-event-editor', 'event-title',
  'event-date', 'event-start', 'event-end', 'event-location',
  'event-editor-status', 'save-event',
].map(id => [id, document.getElementById(id)]));

let config = {...defaults};
let holidayMap = new Map();
let selectedDate = new Date();
let viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
let compactDate = new Date(
  selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()
);
let calendarEvents = [];
let calendarBackendError = '';
let eventRequestSerial = 0;
let calendarChangeTimer = 0;
let calendarStatusTimer = 0;

function copy(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function showCalendarStatus(message, duration = 0) {
  clearTimeout(calendarStatusTimer);
  calendarStatusTimer = 0;
  elements['calendar-status'].textContent = message;
  if (message && duration > 0) {
    calendarStatusTimer = setTimeout(() => {
      elements['calendar-status'].textContent = '';
      calendarStatusTimer = 0;
    }, duration);
  }
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
    layoutPreset: Object.hasOwn(LAYOUT_PRESETS, value.layoutPreset)
      ? value.layoutPreset : 'medium',
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

function lunarLabel(date, long = false) {
  if (!config.showLunar)
    return '';
  const lunar = lunarParts(date);
  const festival = festivalFor(date, lunar);
  const statutory = holidayMap.get(dateKey(date));
  const parts = [];
  if (long && lunar.yearName)
    parts.push(`${lunar.yearName}年`);
  parts.push(`${lunar.monthText}${lunarDayName(lunar.day)}`);
  if (festival)
    parts.push(festival);
  if (statutory && config.showStatutory && (!statutory.isWorkday || config.showWorkdays))
    parts.push(statutory.isWorkday ? '补班' : '休假');
  return parts.filter(Boolean).join(' · ');
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

function saveConfig() {
  window.ding?.setConfig(copy(config));
}

function applySettings() {
  calendar.dataset.layout = config.layoutPreset;
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
  for (const button of document.querySelectorAll('.layout-option'))
    button.classList.toggle('selected', button.dataset.preset === config.layoutPreset);
}

function daySubtitle(date, lunar) {
  const festival = festivalFor(date, lunar);
  if (festival)
    return festival;
  if (!config.showLunar)
    return '';
  return lunar.day === 1 ? lunar.monthText : lunarDayName(lunar.day);
}

function eventsForDate(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return calendarEvents.filter(event => event.start < end && event.end > start)
    .sort((left, right) => left.start - right.start || left.title.localeCompare(right.title, 'zh-CN'));
}

function emptyEvent(message) {
  const empty = document.createElement('p');
  empty.className = 'events-empty';
  empty.textContent = message;
  return empty;
}

function renderSchedules() {
  const compactEvents = eventsForDate(compactDate);
  const markers = compactEvents.slice(0, 6).map(event => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'compact-marker';
    marker.style.background = event.color || '#3478f6';
    marker.setAttribute('aria-label', `${event.time} ${event.title}`);
    marker.addEventListener('mouseenter', () =>
      showEventPopover(marker, compactDate, compactEvents));
    marker.addEventListener('mouseleave', hideEventPopover);
    marker.addEventListener('focus', () =>
      showEventPopover(marker, compactDate, compactEvents));
    marker.addEventListener('blur', hideEventPopover);
    return marker;
  });
  elements['compact-markers'].replaceChildren(...markers);

  elements['selected-heading'].textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(selectedDate);
  elements['selected-lunar'].textContent = lunarLabel(selectedDate, true);
  const selectedEvents = eventsForDate(selectedDate);
  const eventRows = selectedEvents.length
    ? selectedEvents.map(renderEvent)
    : [emptyEvent(calendarBackendError || '这一天没有安排')];
  elements['selected-events'].replaceChildren(...eventRows);
}

function renderEvent(event) {
  const row = document.createElement('article');
  row.className = 'event-row';
  const marker = document.createElement('i');
  marker.style.background = event.color || '#ff5570';
  const content = document.createElement('div');
  const title = document.createElement('strong');
  const time = document.createElement('span');
  title.textContent = event.title;
  time.textContent = event.time;
  content.append(title, time);
  row.append(marker, content);
  return row;
}

function showEventPopover(anchor, date, events) {
  if (!events.length)
    return;
  elements['popover-heading'].textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(date);
  elements['popover-lunar'].textContent = lunarLabel(date, true);
  elements['popover-events'].replaceChildren(...events.map(renderEvent));
  elements['event-popover'].hidden = false;

  const rootRect = calendar.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popover = elements['event-popover'];
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = anchorRect.left - rootRect.left + anchorRect.width / 2 - width / 2;
  left = Math.max(10, Math.min(left, rootRect.width - width - 10));
  let top = anchorRect.bottom - rootRect.top + 6;
  if (top + height > rootRect.height - 10)
    top = anchorRect.top - rootRect.top - height - 6;
  popover.style.left = `${Math.max(10, left)}px`;
  popover.style.top = `${Math.max(10, top)}px`;
}

function hideEventPopover() {
  elements['event-popover'].hidden = true;
}

function renderCompact() {
  elements['compact-month'].textContent =
    `${compactDate.getFullYear()}年${compactDate.getMonth() + 1}月`;
  elements['compact-day'].textContent = String(compactDate.getDate());
  elements['compact-weekday'].textContent = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
  }).format(compactDate);
  elements['compact-lunar'].textContent = lunarLabel(compactDate);
}

function moveCompactDate(offset) {
  hideEventPopover();
  compactDate.setDate(compactDate.getDate() + offset);
  compactDate = new Date(
    compactDate.getFullYear(), compactDate.getMonth(), compactDate.getDate()
  );
  const monthChanged = viewDate.getFullYear() !== compactDate.getFullYear() ||
    viewDate.getMonth() !== compactDate.getMonth();
  if (monthChanged) {
    viewDate = new Date(compactDate.getFullYear(), compactDate.getMonth(), 1);
    render();
    reloadEvents();
  } else {
    renderCompact();
    renderSchedules();
  }
}

function selectDate(date) {
  selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (const button of elements.days.querySelectorAll('.day'))
    button.classList.toggle('selected', button.dataset.date === dateKey(selectedDate));
  renderSchedules();
}

function renderMonth() {
  // Still required to mark today's date even though the redundant weekday
  // subtitle was removed from the header.
  const now = new Date();
  elements.month.textContent = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long',
  }).format(viewDate);
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
    const dayEvents = eventsForDate(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.date = dateKey(date);
    if (date.getMonth() !== viewDate.getMonth())
      button.classList.add('muted');
    if (sameDate(date, now))
      button.classList.add('today');
    if (config.layoutPreset === 'large' && sameDate(date, selectedDate))
      button.classList.add('selected');
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
    if (dayEvents.length) {
      const bars = document.createElement('span');
      bars.className = 'event-bars';
      for (const item of dayEvents.slice(0, 3)) {
        const bar = document.createElement('span');
        bar.style.background = item.color || '#3478f6';
        bars.append(bar);
      }
      button.append(bars);
      button.addEventListener('mouseenter', () => {
        if (config.layoutPreset === 'large')
          selectDate(date);
        else
          showEventPopover(button, date, dayEvents);
      });
      button.addEventListener('mouseleave', () => {
        if (config.layoutPreset !== 'large')
          hideEventPopover();
      });
      button.addEventListener('focus', () => {
        if (config.layoutPreset === 'large')
          selectDate(date);
        else
          showEventPopover(button, date, dayEvents);
      });
      button.addEventListener('blur', hideEventPopover);
      button.addEventListener('click', () => {
        if (config.layoutPreset === 'large')
          selectDate(date);
      });
    } else if (config.layoutPreset === 'large') {
      // Empty dates are selectable by click or keyboard, but merely crossing
      // them while moving toward the agenda pane must not erase the event date
      // that the user deliberately hovered.
      button.addEventListener('click', () => selectDate(date));
      button.addEventListener('focus', () => selectDate(date));
    }
    cells.push(button);
  }
  elements.days.replaceChildren(...cells);
}

function render() {
  renderCompact();
  renderMonth();
  renderSchedules();
}

function showSettings() {
  applySettings();
  elements.settings.hidden = false;
}

function monthRange() {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const leading = config.weekStartsMonday ? (first.getDay() + 6) % 7 : first.getDay();
  const start = new Date(first);
  start.setDate(1 - leading);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 42);
  return {start, end};
}

function normalizeCalendarEvent(event) {
  const start = Number(event?.start) * (Number(event?.start) < 100000000000 ? 1000 : 1);
  const end = Number(event?.end) * (Number(event?.end) < 100000000000 ? 1000 : 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const format = value => new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
  return {
    id: String(event.id || `${start}:${event.title || ''}`),
    title: String(event.title || '无标题日程'),
    start,
    end,
    color: String(event.color || '#3478f6'),
    time: event.allDay ? '全天' : `${format(start)}–${format(end)}`,
  };
}

async function reloadEvents() {
  const serial = ++eventRequestSerial;
  const {start, end} = monthRange();
  try {
    if (typeof window.ding?.getCalendarEvents !== 'function')
      throw new Error('当前宿主不支持系统日历接口');
    const result = await window.ding.getCalendarEvents(
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000)
    );
    if (serial !== eventRequestSerial)
      return;
    calendarEvents = (result?.events ?? []).map(normalizeCalendarEvent).filter(Boolean);
    calendarBackendError = '';
  } catch (error) {
    if (serial !== eventRequestSerial)
      return;
    calendarEvents = [];
    calendarBackendError = `系统日历暂不可用：${error.message}`;
  }
  render();
}

function editorDate() {
  return config.layoutPreset === 'compact' ? compactDate : selectedDate;
}

function openEventEditor() {
  hideEventPopover();
  const date = editorDate();
  const now = new Date();
  const defaultHour = sameDate(date, now) ? Math.min(now.getHours() + 1, 22) : 9;
  elements['event-title'].value = '';
  elements['event-date'].value = dateKey(date);
  elements['event-start'].value = `${String(defaultHour).padStart(2, '0')}:00`;
  elements['event-end'].value = `${String(Math.min(defaultHour + 1, 23)).padStart(2, '0')}:00`;
  elements['event-location'].value = '';
  elements['event-editor-status'].textContent = '';
  elements['event-editor'].hidden = false;
  requestAnimationFrame(() => elements['event-title'].focus());
}

function closeEventEditor() {
  elements['event-editor'].hidden = true;
}

async function createEventFromEditor() {
  const date = elements['event-date'].value;
  const start = new Date(`${date}T${elements['event-start'].value}:00`);
  const end = new Date(`${date}T${elements['event-end'].value}:00`);
  if (!date || !elements['event-title'].value.trim() || end <= start) {
    elements['event-editor-status'].textContent = '请填写标题，并确保结束时间晚于开始时间';
    return;
  }
  elements['save-event'].disabled = true;
  elements['event-editor-status'].textContent = '正在写入系统日历…';
  const slowTimer = setTimeout(() => {
    elements['event-editor-status'].textContent = '系统日历响应较慢，仍在尝试…';
  }, 3500);
  try {
    await window.ding.createCalendarEvent({
      title: elements['event-title'].value.trim(),
      location: elements['event-location'].value.trim(),
      start: Math.floor(start.getTime() / 1000),
      end: Math.floor(end.getTime() / 1000),
    });
    closeEventEditor();
    showCalendarStatus('已添加到系统日历', 2200);
    await reloadEvents();
  } catch (error) {
    elements['event-editor-status'].textContent = `添加失败：${error.message}`;
  } finally {
    clearTimeout(slowTimer);
    elements['save-event'].disabled = false;
  }
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
    showCalendarStatus('');
    elements['update-status'].textContent = '节假日数据更新成功';
  } catch (_error) {
    elements['update-status'].textContent = config.holidayCache
      ? '更新失败，继续使用上次保存的数据'
      : '更新失败，请检查网络后重试';
    if (!manual)
      showCalendarStatus('节假日数据尚未更新', 3500);
  } finally {
    button.disabled = false;
    button.textContent = '更新数据';
  }
}

elements.previous.addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  render();
  reloadEvents();
});
elements.next.addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  render();
  reloadEvents();
});
function goToToday() {
  const now = new Date();
  selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  compactDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
  render();
  reloadEvents();
}

elements['today-button'].addEventListener('click', goToToday);
elements['compact-today'].addEventListener('click', goToToday);
elements['settings-button'].addEventListener('click', showSettings);
elements['compact-settings'].addEventListener('click', showSettings);
elements['compact-previous-day'].addEventListener('click', () => moveCompactDate(-1));
elements['compact-next-day'].addEventListener('click', () => moveCompactDate(1));
elements['close-settings'].addEventListener('click', () => {
  elements.settings.hidden = true;
});
elements['add-event'].addEventListener('click', openEventEditor);
elements['compact-add'].addEventListener('click', openEventEditor);
elements['close-event-editor'].addEventListener('click', closeEventEditor);
elements['event-form'].addEventListener('submit', event => {
  event.preventDefault();
  createEventFromEditor();
});
elements['update-holidays'].addEventListener('click', () => updateHolidays(true));

elements['layout-options'].addEventListener('click', event => {
  const button = event.target.closest('.layout-option');
  const preset = button?.dataset.preset;
  if (!Object.hasOwn(LAYOUT_PRESETS, preset))
    return;
  config.layoutPreset = preset;
  applySettings();
  saveConfig();
  const size = LAYOUT_PRESETS[preset];
  window.ding?.setSize?.(size.width, size.height);
  elements.settings.hidden = true;
  render();
  reloadEvents();
});

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
  await reloadEvents();
  if (!config.holidayCache)
    await updateHolidays(false);
}

start().catch(error => {
  showCalendarStatus(`日历加载失败：${error.message}`, 5000);
});
setInterval(render, 60 * 1000);
window.ding?.onConfigChanged?.(next => {
  config = cleanConfig(next);
  holidayMap = parseHolidayCache(config.holidayCache);
  applySettings();
  render();
  if (config.holidayCache &&
      elements['calendar-status'].textContent === '节假日数据尚未更新')
    showCalendarStatus('');
});
window.ding?.onCalendarChanged?.(() => {
  clearTimeout(calendarChangeTimer);
  calendarChangeTimer = setTimeout(reloadEvents, 500);
});
setInterval(reloadEvents, 5 * 60 * 1000);
