// CSES（The Course Schedule Exchange Schema，课程表交换格式）与本应用配置的双向转换
// 现行正式版为 CSES v1：
//   version: 1
//   subjects: [{ name, simplified_name?, teacher?, room? }]
//   schedules: [{ name, enable_day(1-7 周一~周日), weeks(all/odd/even), classes: [{ subject, start_time, end_time }] }]
// 注意：CSES v1 只支持单/双周轮换，且不支持课间/午休等“休息时间段”和分隔线。

const DAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const DAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THR', 'FRI', 'SAT'];
// enable_day 可能是规范要求的 1-7 整数，也兼容 jscses 等早期库使用的 mon-sun 字符串
const ENABLE_DAY_MAP = { mon: 1, tue: 2, wed: 3, thu: 4, thr: 4, fri: 5, sat: 6, sun: 7 };

function normalizeEnableDay(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7) return value;
  const key = String(value ?? '').trim().toLowerCase();
  return ENABLE_DAY_MAP[key] || null;
}

// "HH:MM" / "HH:MM:SS" → 分钟数，无效返回 -1
function toMinutes(text) {
  const match = String(text ?? '').trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return -1;
  return hours * 60 + minutes;
}

// 规范化为 CSES 要求的 HH:MM:SS
function toSecondsText(text) {
  const match = String(text ?? '').trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = match[3] === undefined ? 0 : Number(match[3]);
  if (h > 23 || m > 59 || s > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 应用时间表使用 HH:MM；CSES 时间落盘时秒位一般为 00，这里截掉秒位
function toMinuteText(text) {
  const normalized = toSecondsText(text);
  return normalized ? normalized.slice(0, 5) : '';
}

// 去掉旧版 "(单周)数学" / "（双周）语文" 这类前缀标签
function stripWeekLabel(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/^\s*[(（][^\)）]*[)）]\s*/, '').trim();
}

// ========== 应用配置 → CSES ==========
export function configToCses(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('当前没有可导出的课表配置');
  }
  const subjectNameMap = config.subject_name && typeof config.subject_name === 'object' ? config.subject_name : {};
  const timetableMap = config.timetable && typeof config.timetable === 'object' ? config.timetable : {};
  const days = Array.isArray(config.daily_class) ? config.daily_class : [];
  const dayMapping = Array.isArray(config.daily_schedule) ? config.daily_schedule : null;

  const subjects = [];
  const subjectSeen = new Set();
  const addSubjectByKey = (key) => {
    const k = String(key ?? '');
    if (!k || subjectSeen.has(k)) return;
    subjectSeen.add(k);
    const fullName = subjectNameMap[k] || k;
    const subject = { name: fullName };
    if (k !== fullName) subject.simplified_name = k;
    subjects.push(subject);
  };
  // 导出配置中定义的全部科目（即使当前课表未排到）
  Object.keys(subjectNameMap).forEach((key) => addSubjectByKey(key));

  // 取某时间表分组中按开始时间排序的“课程”时间段（数值编号），休息时间段不导出
  const buildClassSlots = (group) => Object.entries(group)
    .filter(([, value]) => typeof value === 'number')
    .map(([range, index]) => {
      const [start, end] = range.split('-');
      return { range, index: Number(index), start, end, order: toMinutes(start) };
    })
    .filter((slot) => slot.order >= 0 && toMinutes(slot.end) >= 0)
    .sort((a, b) => a.order - b.order || a.index - b.index);

  const schedules = [];
  const warnings = [];

  for (let enableDay = 1; enableDay <= 7; enableDay++) {
    const jsDay = enableDay % 7; // CSES 周一=1 … 周日=7；JS 周日=0
    const mappedIndex = dayMapping && dayMapping[jsDay] !== undefined
      ? Number(dayMapping[jsDay])
      : null;
    const day = Number.isInteger(mappedIndex) ? days[mappedIndex] : null;
    if (!day || !day.timetable || !timetableMap[day.timetable]) continue;

    const classSlots = buildClassSlots(timetableMap[day.timetable]);
    if (!classSlots.length) continue;
    const classList = Array.isArray(day.classList) ? day.classList : [];

    // 该日是否存在轮换，以及最大轮换周数
    let maxRotationWeeks = 1;
    classSlots.forEach((slot) => {
      const raw = classList[slot.index];
      if (Array.isArray(raw)) maxRotationWeeks = Math.max(maxRotationWeeks, raw.length);
    });

    const buildClasses = (weekIndex) => {
      const items = [];
      classSlots.forEach((slot) => {
        const raw = classList[slot.index];
        let key = '';
        if (Array.isArray(raw)) key = stripWeekLabel(raw[weekIndex]);
        else if (weekIndex === 0) key = stripWeekLabel(raw);
        if (!key) return;
        addSubjectByKey(key);
        items.push({
          subject: subjectNameMap[key] || key,
          start_time: toSecondsText(slot.start),
          end_time: toSecondsText(slot.end),
        });
      });
      return items;
    };

    const dayName = DAY_CN[jsDay];
    if (maxRotationWeeks <= 1) {
      const classes = buildClasses(0);
      if (classes.length) schedules.push({ name: dayName, enable_day: enableDay, weeks: 'all', classes });
    } else if (maxRotationWeeks === 2) {
      // 应用数组第 0/1 项分别对应单周(odd)/双周(even)
      const variants = [
        { weeks: 'odd', label: '单周', weekIndex: 0 },
        { weeks: 'even', label: '双周', weekIndex: 1 },
      ];
      variants.forEach((variant) => {
        const classes = buildClasses(variant.weekIndex);
        if (classes.length) {
          schedules.push({ name: `${dayName}（${variant.label}）`, enable_day: enableDay, weeks: variant.weeks, classes });
        }
      });
    } else {
      // CSES v1 无法表达 3/4 周轮换：退化为按第 1 周导出并给出明确提示
      warnings.push(`${dayName}存在 ${maxRotationWeeks} 周轮换，CSES v1 仅支持单/双周，已按第 1 周课表导出`);
      const classes = buildClasses(0);
      if (classes.length) schedules.push({ name: dayName, enable_day: enableDay, weeks: 'all', classes });
    }
  }

  return { cses: { version: 1, subjects, schedules }, warnings };
}

// ========== CSES → 应用配置 ==========
export function csesToConfig(cses, existingConfig = null) {
  if (!cses || typeof cses !== 'object' || !Array.isArray(cses.schedules)) {
    throw new Error('不是有效的 CSES 文件：缺少 schedules 课程表列表');
  }

  const subjectName = {};
  const nameToKey = new Map();
  (Array.isArray(cses.subjects) ? cses.subjects : []).forEach((subject) => {
    if (!subject || !subject.name) return;
    const name = String(subject.name).trim();
    if (!name) return;
    const key = String(subject.simplified_name || name).trim() || name;
    if (!Object.prototype.hasOwnProperty.call(subjectName, key)) subjectName[key] = name;
    if (!nameToKey.has(name)) nameToKey.set(name, key);
  });
  // CSES 课表里引用了但 subjects 未声明的科目，按同名自动补登
  const keyOfSubject = (name) => {
    const n = String(name ?? '').trim();
    if (!n) return '';
    if (nameToKey.has(n)) return nameToKey.get(n);
    subjectName[n] = n;
    nameToKey.set(n, n);
    return n;
  };

  // 按星期收集 all/odd/even 三种课程列表
  const byDay = new Map();
  cses.schedules.forEach((schedule) => {
    const enableDay = normalizeEnableDay(schedule.enable_day);
    if (enableDay === null) return;
    const weeks = ['all', 'odd', 'even'].includes(schedule.weeks) ? schedule.weeks : 'all';
    const classes = (Array.isArray(schedule.classes) ? schedule.classes : [])
      .map((item) => ({
        key: keyOfSubject(item.subject),
        start: toSecondsText(item.start_time),
        end: toSecondsText(item.end_time),
      }))
      .filter((item) => item.key && item.start && item.end && toMinutes(item.start) < toMinutes(item.end))
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end));
    if (!byDay.has(enableDay)) byDay.set(enableDay, {});
    byDay.get(enableDay)[weeks] = classes;
  });

  if (!byDay.size) {
    throw new Error('CSES 文件中没有可导入的课程安排（schedules 为空或时间均无效）');
  }

  // 时间签名相同的日期复用同一个时间表分组
  const timetable = {};
  const signatureToGroupName = new Map();
  let groupSequence = 0;
  const registerGroup = (referenceClasses) => {
    const signature = referenceClasses.map((item) => `${item.start}-${item.end}`).join('|');
    if (signatureToGroupName.has(signature)) return signatureToGroupName.get(signature);
    const groupName = groupSequence === 0 ? 'workday' : `时间表${groupSequence + 1}`;
    groupSequence += 1;
    const group = {};
    referenceClasses.forEach((item, index) => {
      group[`${toMinuteText(item.start)}-${toMinuteText(item.end)}`] = index;
    });
    timetable[groupName] = group;
    signatureToGroupName.set(signature, groupName);
    return groupName;
  };

  const dailyClass = [];
  const dailySchedule = [0, 0, 0, 0, 0, 0, 0];
  [...byDay.keys()].sort((a, b) => a - b).forEach((enableDay) => {
    const variants = byDay.get(enableDay);
    const reference = variants.all || variants.odd || variants.even || [];
    const groupName = registerGroup(reference);
    const rotated = Boolean(variants.odd || variants.even);
    const toMap = (classes) => new Map((classes || []).map((item) => [`${item.start}-${item.end}`, item.key]));
    const allMap = toMap(variants.all);
    const oddMap = toMap(variants.odd);
    const evenMap = toMap(variants.even);

    const classList = reference.map((item) => {
      const signatureKey = `${item.start}-${item.end}`;
      const common = allMap.get(signatureKey) ?? '';
      if (!rotated) return common || oddMap.get(signatureKey) || evenMap.get(signatureKey) || '';
      return [
        oddMap.get(signatureKey) ?? common ?? '',
        evenMap.get(signatureKey) ?? common ?? '',
      ];
    });

    const jsDay = enableDay % 7;
    dailyClass.push({
      Chinese: DAY_CN[jsDay],
      English: DAY_EN[jsDay],
      classList,
      timetable: groupName,
    });
    dailySchedule[jsDay] = dailyClass.length - 1;
  });

  // 保留倒计时目标等与课表无关的配置项；分隔线 CSES 不支持，置空
  return {
    ...(existingConfig && typeof existingConfig === 'object' ? existingConfig : {}),
    subject_name: subjectName,
    timetable,
    daily_class: dailyClass,
    daily_schedule: dailySchedule,
    divider: {},
  };
}
