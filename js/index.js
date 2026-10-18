let scheduleConfig = {
    countdown_target: 'hidden',
    time_source: 'offset',
    week_display: true,
    subject_name: {
        '': '未知课表'
    },
    timetable: {
        workday: {
            '00:00-23:59': 0
        }
    },
    divider: {
        workday: []
    },
    daily_class: [{
        Chinese: '今日',
        English: 'TODAY',
        classList: [''],
        timetable: 'workday'
    }],
};
let settings = {
    rotation_offset: {
        2: 0,
        3: 0,
        4: 0
    },
    semester_start_date: '',
    semester_start_week: 1,
    rotation_mode: 'timetable',
    multi_rotation_entries: [],
    custom_text: '自定义文本',
    component_layout: [['schedule', 'week', 'countdown']],
    css_style: {}
};
let runtimeCourseFusion = null;
// 运行时覆盖层（仅本次运行有效，由主进程内存兜底跨窗口刷新，重启软件后不恢复）：
// - runtimeTempChanges：右键“临时调课”的当天课程替换，跨天自动失效
// - runtimeEarlyDismissal：托盘“提前放学”设置的当天放学时间，跨天自动失效
var runtimeTempChanges = null;
var runtimeEarlyDismissal = null;
window.scheduleConfig = scheduleConfig;
window.settings = settings;

// 轮换配置分两处维护（自本版本起）：
// - 每天加载（daily_rotation_mode / daily_rotation）由课表配置编辑器写入 scheduleConfig.js；
//   旧版整周轮换序列 multi_rotation_entries 仍在 settings.js，作为升级兜底沿用
// - 学期级配置（semester_start_date / semester_start_week / rotation_offset 整体偏移）
//   由软件设置基础设置页写入 settings.js
function readRotationConfig(key) {
    if (scheduleConfig && scheduleConfig[key] !== undefined) return scheduleConfig[key];
    return settings ? settings[key] : undefined;
}

// 学期级轮换配置只认 settings.js（软件设置基础设置页维护）
function readSemesterConfig(key) {
    return settings ? settings[key] : undefined;
}

// 轮换偏移：按轮换周期分别设置（rotation_offset = { 2: x, 3: y, 4: z }，单位周），
// 双周/三周/四周轮换互不影响；数字为上一版“整体偏移”的兼容格式（各周期同值）。
// 取该周期对应的偏移值，未配置时为 0
function readRotationOffset(cycle) {
    const value = readSemesterConfig('rotation_offset');
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (value && typeof value === 'object') {
        const legacy = Number(value[cycle]);
        if (Number.isFinite(legacy)) return Math.round(legacy);
    }
    return 0;
}

// 该星期的轮换模式：'multi' 多课表轮换 / 'timetable' 课表内轮换。
// 每天独立配置存于 scheduleConfig.daily_rotation_mode（缺省项 = 课表内轮换）；
// 该字段整体不存在时（编辑器从未保存过新模型）兜底旧版全局 settings.rotation_mode
function getDayRotationMode(dayOfWeek) {
    const modeMap = scheduleConfig && scheduleConfig.daily_rotation_mode;
    if (modeMap && typeof modeMap === 'object') {
        return modeMap[String(dayOfWeek)] === 'multi' ? 'multi' : 'timetable';
    }
    return settings && settings.rotation_mode === 'multi' ? 'multi' : 'timetable';
}

// “当天”日期键（不带时间偏移）：运行时覆盖层（临时调课/提前放学）按自然日失效
function getRuntimeTodayKey(date = new Date()) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// 提前放学：仅当天生效的临时放学时间（{ date, time }），跨天后日期不匹配自动失效
function getActiveEarlyDismissal() {
    if (!runtimeEarlyDismissal || !runtimeEarlyDismissal.time) return null;
    return runtimeEarlyDismissal.date === getRuntimeTodayKey() ? runtimeEarlyDismissal : null;
}

function setCourseFusion(fusion) {
    if (!fusion) {
        runtimeCourseFusion = null;
        return;
    }
    const dayIndex = Number(fusion.dayIndex);
    const start = Number(fusion.start);
    const end = Number(fusion.end);
    if (![dayIndex, start, end].every(Number.isInteger) || start < 0 || end <= start) {
        return;
    }
    // target 为“科目名称”配置中的科目简称字符串；兼容旧版本的整数课节索引
    let target = fusion.target;
    if (typeof target === 'number') {
        if (!Number.isInteger(target) || target < 0) return;
    } else if (typeof target === 'string') {
        target = target.trim();
        if (!target) return;
    } else {
        return;
    }
    runtimeCourseFusion = {
        dayIndex,
        start,
        end,
        target,
        ignoreBreak: fusion.ignoreBreak === true
    };
}

async function loadScheduleConfig() {
    const fallbackConfig = JSON.parse(JSON.stringify(scheduleConfig));
    const fallbackSettings = JSON.parse(JSON.stringify(settings));

    try {
        const [configResponse, settingsResponse] = await Promise.all([
            fetch('js/scheduleConfig.js?_=' + Date.now(), { cache: 'no-store' }),
            fetch('js/settings.js?_=' + Date.now(), { cache: 'no-store' })
        ]);
        const [configCode, settingsCode] = await Promise.all([
            configResponse.text(),
            settingsResponse.text()
        ]);
        const result = new Function(`${configCode}; ${settingsCode}; return { _scheduleConfig, scheduleConfig, _settings, settings };`)();
        const loaded = result && (result.scheduleConfig || result._scheduleConfig || fallbackConfig);
        const loadedSettings = result && (result.settings || result._settings || fallbackSettings);
        if (!loaded || !Array.isArray(loaded.daily_class)) {
            throw new Error('Invalid config structure');
        }
        scheduleConfig = JSON.parse(JSON.stringify(loaded));
        settings = JSON.parse(JSON.stringify(loadedSettings));
        window.scheduleConfig = scheduleConfig;
        window.settings = settings;
        return scheduleConfig;
    } catch (error) {
        console.error('Failed to load scheduleConfig.js or settings.js, using fallback config:', error);
        scheduleConfig = JSON.parse(JSON.stringify(fallbackConfig));
        settings = JSON.parse(JSON.stringify(fallbackSettings));
        window.scheduleConfig = scheduleConfig;
        window.settings = settings;
        return scheduleConfig;
    }
}

var timeOffset = localStorage.getItem('timeOffset')
if (timeOffset === null) localStorage.setItem('timeOffset', '0')
timeOffset = Number(localStorage.getItem('timeOffset'))

var dayOffset = localStorage.getItem('dayOffset')
if (dayOffset === null) localStorage.setItem('dayOffset', '-1')
dayOffset = Number(localStorage.getItem('dayOffset'))

var setDayOffsetLastDay = localStorage.getItem('setDayOffsetLastDay')
if (setDayOffsetLastDay === null) localStorage.setItem('setDayOffsetLastDay', '-1')
setDayOffsetLastDay = Number(localStorage.getItem('setDayOffsetLastDay'))

function readRotationAnchors() {
    try {
        const value = JSON.parse(localStorage.getItem('rotationWeekAnchors') || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch (error) {
        return {};
    }
}

function getRotationWeekStart(date) {
    const weekStart = new Date(date);
    const day = weekStart.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    weekStart.setDate(weekStart.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

function getRotationWeekNumber(rotationWeeks, date = new Date()) {
    const now = date instanceof Date ? date : new Date();
    const anchors = readRotationAnchors();
    const currentWeekStart = getRotationWeekStart(now);
    let anchor = Number(anchors[rotationWeeks]);
    if (!Number.isFinite(anchor) || anchor > now.getTime()) {
        anchor = currentWeekStart.getTime();
    } else {
        anchor = getRotationWeekStart(new Date(anchor)).getTime();
    }
    if (anchors[rotationWeeks] !== anchor) {
        anchors[rotationWeeks] = anchor;
        localStorage.setItem('rotationWeekAnchors', JSON.stringify(anchors));
    }
    return Math.max(0, Math.round((currentWeekStart.getTime() - anchor) / (7 * 24 * 60 * 60 * 1000)));
}

// 学期周数推算：以开学日期为基准（开学当天默认记为第 1 周，semester_start_week
// 表示"开学日期对应的周数"），再叠加基础设置页的整体轮换偏移 rotation_offset；
// 周界按周一划分；开学日期未设置或非法时返回 null，走旧锚点逻辑
function getSemesterWeekNumber(date = new Date()) {
    const startText = String(readSemesterConfig('semester_start_date') || '').trim();
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(startText)) return null;
    const parts = startText.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(start.getTime())) return null;
    const startWeekRaw = Number(readSemesterConfig('semester_start_week'));
    const startWeek = Number.isFinite(startWeekRaw) ? Math.round(startWeekRaw) : 1;
    const diff = Math.round((getRotationWeekStart(date).getTime() - getRotationWeekStart(start).getTime())
        / (7 * 24 * 60 * 60 * 1000));
    return startWeek + diff;
}

// 多课表轮换：本周生效的轮换索引（0 基）。优先用开学日期推算；
// 未设置开学日期时按旧锚点从第 1 周开始。轮换偏移按周期分别叠加
function getMultiRotationIndex(cycle, date = new Date()) {
    const semesterWeek = getSemesterWeekNumber(date);
    if (semesterWeek !== null) {
        return ((semesterWeek - 1 + readRotationOffset(cycle)) % cycle + cycle) % cycle;
    }
    const weekNumber = getRotationWeekNumber(cycle, date);
    // 未设置开学日期：周一锚点周数 + 该周期的轮换偏移
    return ((weekNumber + readRotationOffset(cycle)) % cycle + cycle) % cycle;
}


function getCurrentEditedDate() {
    let d = new Date();
    d.setSeconds(d.getSeconds() + timeOffset)
    return d;
}

// 手动“切换日程”时，dayOffset 存的是 daily_class 数组的精确索引，
// 可以是 7、8 等命名课表（如“第一天”），绝不能当作星期几再做 % 7——
// 否则索引 7 会坍缩到 0，加载成第一个课表。
// 返回当前生效的手动索引；未选择或已跨自然天失效时返回 -1（同时清理 localStorage）
function getManualDayIndex() {
    if (dayOffset === -1) return -1;
    if (setDayOffsetLastDay == new Date().getDay()) {
        return dayOffset;
    }
    localStorage.setItem('dayOffset', '-1')
    localStorage.setItem('setDayOffsetLastDay', '-1')
    dayOffset = -1
    setDayOffsetLastDay = -1
    return -1;
}

// 供“切换日程”对话框默认高亮项使用：手动模式返回 daily_class 索引，否则返回星期几
function getCurrentEditedDay(date) {
    const manualIndex = getManualDayIndex();
    return manualIndex === -1 ? date.getDay() : manualIndex;
}

// 解析当前应加载的 daily_class 索引。
// weekdayDelta 仅在自动模式下有效（“显示次日课程”按自然日 +1）；
// 手动“切换日程/加载临时课表”只作用于今天（weekdayDelta=0），
// 次日视图始终按自然日的星期映射取课表——否则“显示次日课程”会重复显示
// 今天临时加载的那份课表（尤其是索引 ≥ 5 的临时课表）。
// 次日视图用的偏移日期：把时间偏移后的当前日期整体平移 weekdayDelta 天，
// 供星期映射与轮换周数推算共用（跨周时轮换周数随之推进）
function getEffectiveDate(weekdayDelta = 0) {
    const base = getCurrentEditedDate();
    return weekdayDelta ? new Date(base.getTime() + weekdayDelta * 86400000) : base;
}

function resolveScheduleIndex(weekdayDelta = 0) {
    const schedules = Array.isArray(scheduleConfig.daily_class) ? scheduleConfig.daily_class : [];
    const manualIndex = getManualDayIndex();
    if (manualIndex !== -1 && weekdayDelta === 0) {
        return schedules[manualIndex] ? manualIndex : -1;
    }
    const date = getEffectiveDate(weekdayDelta);
    // date 已按 weekdayDelta 平移，getDay() 即目标自然日的星期（0 = 周日 ... 6 = 周六），
    // 与 daily_class 前 7 项顺序一致；这里绝不能再叠加 weekdayDelta（会双重平移）
    const dayOfWeek = (date.getDay() + 7) % 7;
    const scheduleIndex = Array.isArray(scheduleConfig.daily_schedule) &&
        scheduleConfig.daily_schedule[dayOfWeek] !== undefined
        ? Number(scheduleConfig.daily_schedule[dayOfWeek])
        : dayOfWeek;
    if (Number.isInteger(scheduleIndex) && schedules[scheduleIndex]) {
        // 多课表轮换：该天可独立设置轮换模式与轮换序列（手动切换优先，已在上方返回）
        if (getDayRotationMode(dayOfWeek) === 'multi') {
            const multiIndex = resolveMultiRotationIndex(date);
            if (multiIndex >= 0) return multiIndex;
        }
        return scheduleIndex;
    }
    return -1;
}

// 多课表轮换：按“每天的加载分别控制”解析当前星期应加载的 daily_class 条目索引
// （0 基，按 Chinese 名称引用）。每天可配置独立的轮换序列（daily_rotation[星期]），
// 长度 ≥ 2 才轮换，周期 = 数组长度；该天未配置轮换时回退普通按星期加载。
// 旧版整周配置（multi_rotation_entries）作为兜底沿用，保证升级后不断轮换
function resolveMultiRotationIndex(date) {
    const dailyMap = readRotationConfig('daily_rotation');
    let entries = dailyMap && typeof dailyMap === 'object'
        ? dailyMap[String(date.getDay())]
        : null;
    if (!Array.isArray(entries)) {
        entries = readRotationConfig('multi_rotation_entries');
    }
    const cycle = Array.isArray(entries) ? entries.length : 0;
    // 周期 1 = 多课表轮换下选择“不轮换”：固定加载第 1 周所选课表；
    // 无序列（该天未配置且无旧版整周序列）时回退 daily_schedule
    if (cycle < 1 || !Array.isArray(scheduleConfig.daily_class)) return -1;
    const name = entries[getMultiRotationIndex(cycle, date)];
    if (!name) return -1;
    const index = scheduleConfig.daily_class.findIndex(
        (day) => day && String(day.Chinese || '') === String(name)
    );
    return index >= 0 ? index : -1;
}

function getCurrentDayScheduleConfig(dayOffset = 0) {
    const schedules = Array.isArray(scheduleConfig.daily_class) ? scheduleConfig.daily_class : [];
    const scheduleIndex = resolveScheduleIndex(dayOffset);
    return scheduleIndex >= 0 ? schedules[scheduleIndex] : null;
}

function getCurrentDayScheduleIndex(dayOffset = 0) {
    return resolveScheduleIndex(dayOffset);
}

function timeToSeconds(time) {
    const [hours, minutes, seconds = 0] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
}

function isBreakTime(startTime, endTime, currentTime) {
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    const currentSeconds = timeToSeconds(currentTime);

    return currentSeconds >= startSeconds && currentSeconds < endSeconds;
}

// Generated by ChatGPT4 
function getNextClassIndex(timetable, currentIndex) {
    // 从当前时间点的下一个时间段开始，找到下一个课程的索引
    const timeKeys = Object.keys(timetable);
    for (let i = currentIndex + 1; i < timeKeys.length; i++) {
        if (typeof timetable[timeKeys[i]] === 'number') {
            return timetable[timeKeys[i]];
        }
    }
    return null; // 如果没有下一堂课，返回 null
}

// Generated by ChatGPT4 
function stripWeekRotationLabel(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return String(value);
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.replace(/^\s*[(（][^\)）]*[)）]\s*/, '').trim();
}

function resolveWeeklySubject(subject, date = new Date()) {
    if (Array.isArray(subject)) {
        if (!subject.length) return '';
        const length = subject.length;
        // 该天为多课表轮换时禁用课表内的多周轮换：固定取第一项
        if (getDayRotationMode((date.getDay() + 7) % 7) === 'multi') return stripWeekRotationLabel(subject[0]);
        // 优先用开学日期推算周数，再叠加该周期的轮换偏移
        const semesterWeek = getSemesterWeekNumber(date);
        if (semesterWeek !== null) {
            const rotationIndex = ((semesterWeek - 1 + readRotationOffset(length)) % length + length) % length;
            return stripWeekRotationLabel(subject[rotationIndex]);
        }
        // 未设置开学日期：沿用周一锚点 + 该周期的轮换偏移
        const safeWeekNumber = getRotationWeekNumber(length, date);
        const rotationIndex = ((safeWeekNumber + readRotationOffset(length)) % length + length) % length;
        return stripWeekRotationLabel(subject[rotationIndex]);
    }
    return stripWeekRotationLabel(subject);
}

function getCurrentDaySchedule() {
    const dailyClass = getCurrentDayScheduleConfig();
    if (!dailyClass) return [];
    const result = dailyClass.classList.map(subject => resolveWeeklySubject(subject, getEffectiveDate(0)));
    // 当天“临时调课”覆盖层：仅当覆盖层属于今天且作用于当前解析出的课表条目时生效。
    // 数据保存在主进程内存（窗口刷新不丢），关闭软件后不恢复，跨天后日期不匹配自动失效；
    // dayIndex 取“当时解析到的课表条目”，切换临时课表后旧替换自然不再显示
    if (runtimeTempChanges && runtimeTempChanges.date === getRuntimeTodayKey()
        && Array.isArray(runtimeTempChanges.items)) {
        const dayIndex = resolveScheduleIndex(0);
        runtimeTempChanges.items.forEach((item) => {
            if (item && item.dayIndex === dayIndex && Number.isInteger(item.slotIndex)
                && item.slotIndex >= 0 && item.slotIndex < result.length) {
                result[item.slotIndex] = String(item.subject ?? '');
            }
        });
    }
    return result;
}

function getDaySchedule(dayOffset) {
    const dailyClass = getCurrentDayScheduleConfig(dayOffset);
    if (!dailyClass) return [];
    // 次日视图（dayOffset>0）跨周时，轮换周数也要按平移后的日期推算
    return dailyClass.classList.map(subject => resolveWeeklySubject(subject, getEffectiveDate(dayOffset)));
}

function isClassCurrent(startTime, endTime, currentTime) {
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    const currentSeconds = timeToSeconds(currentTime);

    return currentSeconds >= startSeconds && currentSeconds < endSeconds;
}

// Generated by ChatGPT4 
function getCurrentTime() {
    const now = getCurrentEditedDate();
    return [
        now.getHours().toString().padStart(2, '0'),
        now.getMinutes().toString().padStart(2, '0'),
        now.getSeconds().toString().padStart(2, '0')
    ].join(':');
}

function isTimetableFinished(dayTimetable, currentTime) {
    const currentSeconds = timeToSeconds(currentTime);
    const endTimes = Object.keys(dayTimetable || {})
        .map((timeRange) => String(timeRange).split('-')[1]?.trim())
        .filter((time) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time))
        .map(timeToSeconds)
        .filter(Number.isFinite);
    return endTimes.length > 0 && currentSeconds >= Math.max(...endTimes);
}

// "HH:MM"（或 "HH:MM:SS"）→ 当天分钟数；无法解析返回 null
function timeTextToMinutesOfDay(timeText) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeText || '').trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

// 计算分割线在课程列表中的插入位置（0 基：返回 n 表示线插在第 n 节课之前，
// 即已有 n 节课排列在线的上方）。
// 规则：
// - 时间点落在上课区间 [start, end) 内（含上课开始）→ 该节课之前（上一节课之后）；
// - 时间点落在课间区间内（含课间开始，即上一节课的下课时刻）→ 上一节课之后；
// - 时间点晚于所有时间段 → 最后一节课之后。
// timetable 中的分割线为单点 key "HH:MM"、value 为 'divider'。
// 兼容旧版独立 divider 数字数组：数字 n（0 基，0=第一节）→ 第 n 节课的下课时间。
function computeDividerPositions(dayTimetable, legacyDivider) {
    if (!dayTimetable || typeof dayTimetable !== 'object') return [];
    const ranges = [];
    const points = [];
    Object.keys(dayTimetable).forEach((key) => {
        const hyphenIndex = key.indexOf('-');
        if (hyphenIndex === -1) {
            if (dayTimetable[key] === 'divider') {
                const point = timeTextToMinutesOfDay(key);
                if (point !== null) points.push(point);
            }
            return;
        }
        const start = timeTextToMinutesOfDay(key.slice(0, hyphenIndex).trim());
        const end = timeTextToMinutesOfDay(key.slice(hyphenIndex + 1).trim());
        if (start === null || end === null || end <= start) return;
        ranges.push({ start, end, isClass: typeof dayTimetable[key] === 'number' });
    });
    const classRanges = ranges.filter((range) => range.isClass)
        .sort((a, b) => a.start - b.start);
    // 旧版数字 divider：n → 第 n 节上课区间的下课时间
    (Array.isArray(legacyDivider) ? legacyDivider : []).forEach((value) => {
        const index = Number(value);
        if (Number.isInteger(index) && index >= 0 && index < classRanges.length) {
            points.push(classRanges[index].end);
        }
    });
    if (!points.length) return [];
    ranges.sort((a, b) => a.start - b.start);
    const positions = points.map((point) => {
        let passedClasses = 0;
        for (const range of ranges) {
            if (range.isClass) {
                if (point >= range.end) {
                    passedClasses += 1;
                    continue;
                }
                // point 落在该节课开始之前或上课区间内：线在该节课之前
                break;
            }
            // 课间：point 越过课间结束则继续；否则（课间开始前/课间内，
            // 含上一节课的下课时刻）线停留在上一节课之后
            if (point > range.end) continue;
            break;
        }
        return passedClasses;
    });
    return [...new Set(positions)].sort((a, b) => a - b);
}

// 插件接口：当前节次标识。
// 正在上课 → 当前节；课间/课外 → 即将开始的下一节；都取不到 → 当天兜底。
// 用于“每节课只能抽取一次”这类按节次计数/去重的插件。
function getCurrentPeriodKey() {
    const dayConfig = getCurrentDayScheduleConfig();
    const timetableName = dayConfig?.timetable || '';
    const dayTimetable = timetableName ? scheduleConfig.timetable?.[timetableName] : null;
    const nowSeconds = timeToSeconds(getCurrentTime());
    let currentStart = null;
    let nextStart = null;
    if (dayTimetable) {
        Object.keys(dayTimetable).forEach((key) => {
            if (key.indexOf('-') === -1) return;
            const [start, end] = key.split('-');
            const startSeconds = timeToSeconds(start);
            const endSeconds = timeToSeconds(end);
            if (nowSeconds >= startSeconds && nowSeconds < endSeconds) {
                currentStart = start;
            } else if (startSeconds > nowSeconds
                && (nextStart === null || startSeconds < timeToSeconds(nextStart))) {
                nextStart = start;
            }
        });
    }
    const slotStart = currentStart || nextStart;
    const date = getCurrentEditedDate();
    const dateKey = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
    return {
        key: `${dateKey}#${slotStart || 'none'}`,
        slotStart: slotStart || '',
        isDuringClass: currentStart !== null
    };
}

function getNextDayScheduleData() {
    const dayConfig = getCurrentDayScheduleConfig(1);
    const currentSchedule = getDaySchedule(1);
    const timetable = dayConfig?.timetable;
    const dayTimetable = timetable && scheduleConfig.timetable?.[timetable];
    const divider = computeDividerPositions(
        dayTimetable,
        scheduleConfig.divider?.[timetable]
    );
    return {
        scheduleArray: currentSchedule.length ? currentSchedule : [''],
        currentHighlight: {
            index: null,
            type: null,
            fullName: null,
            countdown: null,
            countdownText: null,
            isNextDay: true
        },
        timetable: dayTimetable ? timetable : null,
        divider
    };
}

// Generated by ChatGPT4 
function getScheduleData() {
    const currentSchedule = getCurrentDaySchedule();
    const currentTime = getCurrentTime();
    const dayConfig = getCurrentDayScheduleConfig();
    const dayIndex = getCurrentDayScheduleIndex();
    const fusion = runtimeCourseFusion && runtimeCourseFusion.dayIndex === dayIndex
        ? runtimeCourseFusion
        : null;
    // target 为科目简称字符串时直接使用；旧版本整数索引则从当天课表中取简称
    const fusionSubject = fusion && (typeof fusion.target === 'string'
        ? fusion.target
        : currentSchedule[fusion.target]);
    let fusionEndTime = null;
    const currentDayTimetable = dayConfig?.timetable && scheduleConfig.timetable?.[dayConfig.timetable];
    if (typeof showNextDayAfterSchool !== 'undefined' && showNextDayAfterSchool && isTimetableFinished(currentDayTimetable, currentTime)) {
        return getNextDayScheduleData();
    }
    if (!dayConfig || !dayConfig.timetable || !scheduleConfig.timetable || !scheduleConfig.timetable[dayConfig.timetable]) {
        return {
            scheduleArray: currentSchedule.length ? currentSchedule : [''],
            currentHighlight: {
                index: 0,
                type: 'upcoming',
                fullName: scheduleConfig.subject_name?.[''] || '未知课表',
                countdown: 0,
                countdownText: '00:00'
            },
            timetable: null,
            divider: [],
            fusion: null
        };
    }
    const timetable = dayConfig.timetable;
    const dayTimetable = scheduleConfig.timetable[timetable];
    // 提前放学（托盘临时功能，仅当天生效）：过滤掉放学时间之后的课程；若放学时间
    // 落在某时间段内，则将该时间段的终止时间缩短到放学时间点。
    const activeDismissal = getActiveEarlyDismissal();
    const dismissalTime = activeDismissal ? activeDismissal.time : null;
    const filteredTimetable = {};
    Object.keys(dayTimetable).forEach((timeRange) => {
        if (timeRange.indexOf('-') === -1) {
            // 分割线：时间点晚于放学时间则丢弃
            if (dismissalTime && timeRange > dismissalTime) return;
            filteredTimetable[timeRange] = dayTimetable[timeRange];
            return;
        }
        const [startTime, endTime] = timeRange.split('-');
        if (dismissalTime) {
            if (startTime >= dismissalTime) return; // 完全在放学之后
            if (endTime > dismissalTime) {
                // 跨放学时间：缩短终止时间
                filteredTimetable[`${startTime}-${dismissalTime}`] = dayTimetable[timeRange];
                return;
            }
        }
        filteredTimetable[timeRange] = dayTimetable[timeRange];
    });
    const divider = computeDividerPositions(filteredTimetable, scheduleConfig.divider?.[timetable]);
    let scheduleArray = [];
    // 显示序号 → classList 槽位索引的映射（按过滤后的时间表顺序），
    // 供“临时调课”把用户选中的第 N 节正确映射到 classList 槽位
    const slotMap = [];
    let currentHighlight = { index: null, type: null, fullName: null, countdown: null, countdownText: null };
    Object.keys(filteredTimetable).forEach((timeRange, index) => {
        // 分割线是单点时间（key 不含 '-'），不参与课程/课间计算
        if (timeRange.indexOf('-') === -1) return;
        const [startTime, endTime] = timeRange.split('-');
        const classIndex = filteredTimetable[timeRange];

        if (typeof classIndex === 'number') {
            const subjectShortName = currentSchedule[classIndex];
            const subjectFullName = scheduleConfig.subject_name?.[subjectShortName] || subjectShortName || '未知课表';
            scheduleArray.push(subjectShortName);
            slotMap.push(classIndex);
            if (fusion && scheduleArray.length - 1 === fusion.end) fusionEndTime = endTime;

            if (isClassCurrent(startTime, endTime, currentTime)) {
                currentHighlight.index = scheduleArray.length - 1;
                currentHighlight.type = 'current';
                currentHighlight.fullName = subjectFullName;
                currentHighlight.countdown = calculateCountdown(endTime, currentTime);
                currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
                currentHighlight.progress = computeSlotProgress(startTime, endTime, currentTime);
            }
        } else if (currentHighlight.index === null && isBreakTime(startTime, endTime, currentTime)) {
            const breakIndex = scheduleArray.length;
            if (fusion && fusion.ignoreBreak && breakIndex > fusion.start && breakIndex <= fusion.end) return;
            // 课间进度：从课间开始到下一节课上课
            currentHighlight.progress = computeSlotProgress(startTime, endTime, currentTime);
            let highlighted = false;
            for (let i = index + 1; i < Object.keys(filteredTimetable).length; i++) {
                const nextTimeRange = Object.keys(filteredTimetable)[i];
                const nextClassIndex = filteredTimetable[nextTimeRange];
                if (typeof nextClassIndex === 'number') {
                    currentHighlight.index = scheduleArray.length;
                    currentHighlight.type = 'upcoming';
                    currentHighlight.isBreak = true;
                    const nextSubjectShortName = currentSchedule[nextClassIndex];
                    const nextSubjectFullName = scheduleConfig.subject_name?.[nextSubjectShortName] || nextSubjectShortName || '未知课表';
                    currentHighlight.fullName = filteredTimetable[timeRange];
                    const [nextStartTime] = nextTimeRange.split('-');
                    currentHighlight.countdown = calculateCountdown(timeRange.split('-')[1], currentTime);
                    currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
                    highlighted = true;
                    break;
                }
            }
            if (!highlighted) {
                currentHighlight.index = scheduleArray.length;
                currentHighlight.type = 'upcoming';
                currentHighlight.isBreak = true;
                currentHighlight.fullName = filteredTimetable[timeRange];
                currentHighlight.countdown = calculateCountdown(timeRange.split('-')[1], currentTime);
                currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
            }
        } else if (currentHighlight.index === null && !filteredTimetable[timeRange]) {
            // 当前时间是非课程时间（如课间休息）
            currentHighlight.fullName = currentSchedule[classIndex]; // 使用时间表中的描述
        }
    });
    if (fusion && currentHighlight.index !== null && currentHighlight.index >= fusion.start && currentHighlight.index <= fusion.end) {
        currentHighlight.displayIndex = fusion.start;
        if (!currentHighlight.isBreak) {
            currentHighlight.fullName = scheduleConfig.subject_name?.[fusionSubject] || fusionSubject || currentHighlight.fullName;
        }
        if (fusion.ignoreBreak && currentHighlight.type === 'current' && fusionEndTime) {
            currentHighlight.countdown = calculateCountdown(fusionEndTime, currentTime);
            currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
        }
    }
    return { scheduleArray, slotMap, currentHighlight, timetable, divider, fusion: fusion ? { ...fusion, subject: fusionSubject } : null };
}


// Generated by ChatGPT4
function calculateCountdown(targetTime, currentTime) {
    const [targetH, targetM] = targetTime.split(':').map(Number);
    const [currentH, currentM, currentS = '00'] = currentTime.split(':').map(Number);

    const targetTotalSeconds = targetH * 3600 + targetM * 60;
    const currentTotalSeconds = currentH * 3600 + currentM * 60 + currentS;

    return targetTotalSeconds - currentTotalSeconds;
}

// 时间段（上课/课间）从开始到现在的进度，0~1；无法计算时为 null
function timeToSecondsOfDay(timeText) {
    const [h, m, s = 0] = String(timeText).split(':').map(Number);
    if (![h, m].every(Number.isFinite)) return null;
    return h * 3600 + m * 60 + s;
}

function computeSlotProgress(startTime, endTime, currentTime) {
    const start = timeToSecondsOfDay(startTime);
    const end = timeToSecondsOfDay(endTime);
    const now = timeToSecondsOfDay(currentTime);
    if (start === null || end === null || now === null || end <= start) return null;
    return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// Generated by ChatGPT4 
function formatCountdown(countdownSeconds) {
    const minutes = Math.floor(countdownSeconds / 60);
    const seconds = countdownSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

