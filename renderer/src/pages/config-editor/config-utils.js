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

// config.timetable 的 "HH:MM-HH:MM": value 条目 → 可编辑卡片
export function parseTimetableEntry(range, value) {
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

// 卡片数组 → config.timetable 的某个分组，并做与旧版一致的校验/自动编号
export function collectTimetableCards(cards) {
  const group = {};
  const errors = [];
  const seenKeys = new Set();
  const orderedEntries = [];
  const classEntries = [];

  cards.forEach((card, domIndex) => {
    const start = normalizeTimeText(card.start);
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
    if (card.type === 'break') {
      orderedEntries.push({ key, type: 'break', name: String(card.name || '').trim() || '课间' });
    } else {
      const entry = { key, type: 'class', start, domIndex };
      orderedEntries.push(entry);
      classEntries.push(entry);
    }
  });

  classEntries
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || a.domIndex - b.domIndex)
    .forEach((entry, index) => { entry.classIndex = index; });

  orderedEntries.forEach((entry) => {
    group[entry.key] = entry.type === 'class' ? entry.classIndex : entry.name;
  });

  return { group, errors, invalidIndexes: errors.map((_, i) => i) };
}

// 返回校验失败的卡片序号集合（用于红框提示）
export function getInvalidCardIndexes(cards) {
  const invalid = new Set();
  const seenKeys = new Set();
  cards.forEach((card, domIndex) => {
    const start = normalizeTimeText(card.start);
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
