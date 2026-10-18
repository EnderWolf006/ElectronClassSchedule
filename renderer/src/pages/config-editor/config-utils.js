// 与旧 config-editor.html 内的纯函数逻辑保持一致

export function normalizeTimeText(text) {
  const cleaned = String(text ?? '').replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeToMinutes(text) {
  const normalized = normalizeTimeText(text);
  if (!normalized) return -1;
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

// 分钟数 → "HH:MM"（钳制在一天之内）
export function minutesToTimeText(totalMinutes) {
  const clamped = Math.max(0, Math.min(Math.round(totalMinutes), 23 * 60 + 59));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// 分割线在 timetable 中的存储形式：单点时间 key（"HH:MM"，不含 "-"），
// value 仅为可读性标记。识别以 key 形状为准，避免与课间字符串冲突。
export const DIVIDER_MARKER = 'divider';

export function isDividerKey(key) {
  const text = String(key ?? '').trim();
  return !text.includes('-') && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text);
}

// config.timetable 的条目 → 可编辑卡片
// "HH:MM-HH:MM": number → 上课；string → 课间；"HH:MM" 单点 → 分割线
export function parseTimetableEntry(range, value) {
  if (isDividerKey(range)) {
    return { type: 'divider', start: normalizeTimeText(range), end: '', name: '' };
  }
  const parts = String(range ?? '').split('-');
  const start = normalizeTimeText(parts[0]);
  const end = normalizeTimeText(parts.slice(1).join('-'));
  if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
    return { type: 'class', start, end, name: '' };
  }
  return { type: 'break', start, end, name: String(value ?? '') };
}

let cardSeq = 0;
export function createCardId() {
  cardSeq += 1;
  return `card-${Date.now()}-${cardSeq}`;
}

export function getTimetableSlotCount(timetable) {
  if (!timetable || typeof timetable !== 'object') return 0;
  return Object.values(timetable).filter((value) => typeof value === 'number').length;
}

// 卡片数组 → config.timetable 的某个分组，并做与旧版一致的校验/自动编号。
// 上课/课间是 "HH:MM-HH:MM" 区间；分割线是 "HH:MM" 单点（值为 DIVIDER_MARKER）。
// 区间之间不允许时间重叠（首尾相接可以，用于相邻时间段联动拖动）。
export function collectTimetableCards(cards) {
  const group = {};
  const errors = [];
  const seenKeys = new Set();
  const orderedEntries = [];
  const classEntries = [];
  const intervalEntries = [];

  cards.forEach((card, domIndex) => {
    const start = normalizeTimeText(card.start);

    if (card.type === 'divider') {
      if (!start) {
        errors.push(`第 ${domIndex + 1} 个分割线的时间无效，请选择时间。`);
        return;
      }
      if (seenKeys.has(start)) {
        errors.push(`存在重复的分割线时间 ${start}，请调整后再保存。`);
        return;
      }
      seenKeys.add(start);
      orderedEntries.push({ key: start, type: 'divider' });
      return;
    }

    const end = normalizeTimeText(card.end);
    let valid = Boolean(start && end);
    if (valid && timeToMinutes(start) >= timeToMinutes(end)) valid = false;
    if (!valid) {
      errors.push(`第 ${domIndex + 1} 个时间段的时间无效，请选择开始和结束时间（开始需早于结束）。`);
      return;
    }
    const key = `${start}-${end}`;
    if (seenKeys.has(key)) {
      errors.push(`存在重复的时间段 ${key}，请调整后再保存。`);
      return;
    }
    seenKeys.add(key);
    intervalEntries.push({
      domIndex,
      key,
      startMinutes: timeToMinutes(start),
      endMinutes: timeToMinutes(end),
    });
    if (card.type === 'break') {
      orderedEntries.push({ key, type: 'break', name: String(card.name || '').trim() || '课间' });
    } else {
      const entry = { key, type: 'class', start, domIndex };
      orderedEntries.push(entry);
      classEntries.push(entry);
    }
  });

  // 重叠检测：任意两个时间段区间相交（不含首尾相接）即视为无效，无法保存
  intervalEntries.forEach((a, i) => {
    intervalEntries.slice(i + 1).forEach((b) => {
      if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
        errors.push(`时间段 ${a.key} 与 ${b.key} 时间重叠（第 ${a.domIndex + 1} / ${b.domIndex + 1} 项），请调整后再保存。`);
      }
    });
  });

  classEntries
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || a.domIndex - b.domIndex)
    .forEach((entry, index) => { entry.classIndex = index; });

  orderedEntries.forEach((entry) => {
    if (entry.type === 'class') group[entry.key] = entry.classIndex;
    else if (entry.type === 'divider') group[entry.key] = DIVIDER_MARKER;
    else group[entry.key] = entry.name;
  });

  return { group, errors, invalidIndexes: errors.map((_, i) => i) };
}

// 返回校验失败的卡片序号集合（用于红框提示）：时间无效、重复、或与其它时间段重叠
export function getInvalidCardIndexes(cards) {
  const invalid = new Set();
  const seenKeys = new Set();
  const intervals = [];
  cards.forEach((card, domIndex) => {
    const start = normalizeTimeText(card.start);
    if (card.type === 'divider') {
      if (!start || seenKeys.has(start)) invalid.add(domIndex);
      if (start) seenKeys.add(start);
      return;
    }
    const end = normalizeTimeText(card.end);
    let valid = Boolean(start && end);
    if (valid && timeToMinutes(start) >= timeToMinutes(end)) valid = false;
    if (!valid) {
      invalid.add(domIndex);
      return;
    }
    const key = `${start}-${end}`;
    if (seenKeys.has(key)) {
      invalid.add(domIndex);
      return;
    }
    seenKeys.add(key);
    intervals.push({ domIndex, startMinutes: timeToMinutes(start), endMinutes: timeToMinutes(end) });
  });
  intervals.forEach((a, i) => {
    intervals.slice(i + 1).forEach((b) => {
      if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
        invalid.add(a.domIndex);
        invalid.add(b.domIndex);
      }
    });
  });
  return invalid;
}

export function normalizeDayClassList(classList) {
  if (!Array.isArray(classList)) return [''];
  const normalized = classList.map((item) => (item === undefined ? '' : item));
  while (normalized.length > 1 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  return normalized.length ? normalized : [''];
}

// 时间段列表按时间自动排序（分割线为单点时间，同样参与排序）。
// 时间无效的卡片排在最后；同一时间点上分割线排在区间之前
// （与主界面“落在上课区间 → 显示在该节课之前”的语义一致）；
// 其余保持原有相对顺序（稳定排序）。
export function sortCardsByTime(cards) {
  return cards
    .map((card, index) => ({ card, index, minutes: timeToMinutes(card.start) }))
    .sort((a, b) => {
      const av = a.minutes >= 0 ? a.minutes : Number.MAX_SAFE_INTEGER;
      const bv = b.minutes >= 0 ? b.minutes : Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      const at = a.card.type === 'divider' ? 0 : 1;
      const bt = b.card.type === 'divider' ? 0 : 1;
      if (at !== bt) return at - bt;
      return a.index - b.index;
    })
    .map((entry) => entry.card);
}

// 表格/图片导入结果（schedule-import.js 的 parsed）合并进编辑器草稿：
// - grid 模式（识别到星期表头）：替换每日课表与星期映射；
// - single 模式：追加一个新课表分组与课表，不改动星期映射（可在“课表”页分配）。
// 返回新对象，不修改原 config。
export function mergeImportedTimetable(config, parsed) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (!next.timetable || typeof next.timetable !== 'object') next.timetable = {};
  let name = String(parsed?.timetableName || '').trim() || '导入课表';
  if (Object.prototype.hasOwnProperty.call(next.timetable, name)) {
    const base = name;
    let suffix = 2;
    name = `${base}（导入）`;
    while (Object.prototype.hasOwnProperty.call(next.timetable, name)) {
      name = `${base}（导入 ${suffix}）`;
      suffix += 1;
    }
  }
  next.timetable[name] = parsed?.group && typeof parsed.group === 'object' ? parsed.group : {};

  // 科目表补全（已有映射不覆盖）
  if (!next.subject_name || typeof next.subject_name !== 'object') next.subject_name = {};
  (Array.isArray(parsed?.subjects) ? parsed.subjects : []).forEach((subject) => {
    if (subject && !Object.prototype.hasOwnProperty.call(next.subject_name, subject)) {
      next.subject_name[subject] = subject;
    }
  });

  const days = (Array.isArray(parsed?.days) ? parsed.days : []).map((day) => ({
    Chinese: String(day?.name || '导入').trim() || '导入',
    English: String(day?.en || '').trim(),
    classList: Array.isArray(day?.classList) && day.classList.length ? day.classList : [''],
    timetable: name,
  }));
  if (parsed?.mode === 'grid' && days.length) {
    next.daily_class = days;
    next.daily_schedule = Array.isArray(parsed.dailySchedule) && parsed.dailySchedule.length === 7
      ? parsed.dailySchedule.map((index) => (Number.isInteger(index) ? index : 0))
      : [0, 0, 0, 0, 0, 0, 0];
  } else if (days.length) {
    next.daily_class = Array.isArray(next.daily_class) ? next.daily_class : [];
    next.daily_class = [...next.daily_class, days[0]];
  }
  return next;
}

// 旧版分割线迁移：顶层 divider: { 时间表名: [数字...] }（0 基课程序号）
// → 写入对应时间表的单点时间条目，时间取该序号课程（按开始时间排序）的下课时间。
// 迁移幂等；完成后删除顶层 divider。超出课程数范围的序号忽略。
export function migrateLegacyDividers(config) {
  if (!config || typeof config !== 'object') return config;
  const legacy = config.divider;
  if (config.timetable && typeof config.timetable === 'object') {
    Object.entries(config.timetable).forEach(([name, group]) => {
      if (!group || typeof group !== 'object') return;
      const numbers = legacy && typeof legacy === 'object' && Array.isArray(legacy[name])
        ? legacy[name]
        : null;
      if (!numbers || !numbers.length) return;
      // 按开始时间排序的上课区间下课时间（0 基 → 数组下标）
      const classEnds = Object.entries(group)
        .filter(([key]) => !isDividerKey(key))
        .filter(([, value]) => typeof value === 'number' || /^\d+$/.test(String(value)))
        .map(([key]) => {
          const end = normalizeTimeText(String(key).split('-').slice(1).join('-'));
          return end ? timeToMinutes(end) : -1;
        })
        .filter((minutes) => minutes >= 0)
        .sort((a, b) => a - b);
      numbers.forEach((raw) => {
        const index = Number(raw);
        if (!Number.isInteger(index) || index < 0 || index >= classEnds.length) return;
        const timeKey = minutesToTimeText(classEnds[index]);
        if (!Object.prototype.hasOwnProperty.call(group, timeKey)) {
          group[timeKey] = DIVIDER_MARKER;
        }
      });
    });
  }
  delete config.divider;
  return config;
}
