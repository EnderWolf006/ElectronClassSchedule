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
    custom_text: '自定义文本',
    component_layout: [['schedule', 'week', 'countdown']],
    css_style: {}
};
let runtimeCourseFusion = null;
window.scheduleConfig = scheduleConfig;
window.settings = settings;

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

function getRotationWeekNumber(rotationWeeks) {
    const anchors = readRotationAnchors();
    const now = new Date();
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


function getCurrentEditedDate() {
    let d = new Date();
    d.setSeconds(d.getSeconds() + timeOffset)
    return d;
}

function getCurrentEditedDay(date) {
    if (dayOffset === -1) 
        return date.getDay();
    if (setDayOffsetLastDay == new Date().getDay()) {
        return dayOffset;
    }
    localStorage.setItem('dayOffset', '-1')
    localStorage.setItem('setDayOffsetLastDay', '-1')
    dayOffset = -1
    setDayOffsetLastDay = -1
    return date.getDay();
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

function resolveWeeklySubject(subject, weekNumber) {
    if (Array.isArray(subject)) {
        if (!subject.length) return '';
        const safeWeekNumber = Number.isInteger(weekNumber)
            ? weekNumber
            : getRotationWeekNumber(subject.length);
        const configuredOffset = Number(settings.rotation_offset?.[subject.length]);
        const offset = Number.isInteger(configuredOffset) ? configuredOffset : 0;
        const rotationIndex = ((safeWeekNumber + offset) % subject.length + subject.length) % subject.length;
        return stripWeekRotationLabel(subject[rotationIndex]);
    }
    return stripWeekRotationLabel(subject);
}

function getCurrentDayScheduleConfig(dayOffset = 0) {
    const date = getCurrentEditedDate();
    const currentDayOfWeek = getCurrentEditedDay(date); // 0 = Sunday, 1 = Monday, ...
    const dayOfWeek = (currentDayOfWeek + dayOffset + 7) % 7;
    const schedules = Array.isArray(scheduleConfig.daily_class) ? scheduleConfig.daily_class : [];
    const scheduleIndex = Array.isArray(scheduleConfig.daily_schedule) &&
        scheduleConfig.daily_schedule[dayOfWeek] !== undefined
        ? Number(scheduleConfig.daily_schedule[dayOfWeek])
        : dayOfWeek;

    return Number.isInteger(scheduleIndex) ? schedules[scheduleIndex] : null;
}

function getCurrentDayScheduleIndex(dayOffset = 0) {
    const date = getCurrentEditedDate();
    const currentDayOfWeek = getCurrentEditedDay(date);
    const dayOfWeek = (currentDayOfWeek + dayOffset + 7) % 7;
    const schedules = Array.isArray(scheduleConfig.daily_class) ? scheduleConfig.daily_class : [];
    const scheduleIndex = Array.isArray(scheduleConfig.daily_schedule) &&
        scheduleConfig.daily_schedule[dayOfWeek] !== undefined
        ? Number(scheduleConfig.daily_schedule[dayOfWeek])
        : dayOfWeek;
    return Number.isInteger(scheduleIndex) && schedules[scheduleIndex] ? scheduleIndex : -1;
}

function getCurrentDaySchedule() {
    const dailyClass = getCurrentDayScheduleConfig();
    if (!dailyClass) return [];
    return dailyClass.classList.map(subject => resolveWeeklySubject(subject));
}

function getDaySchedule(dayOffset) {
    const dailyClass = getCurrentDayScheduleConfig(dayOffset);
    if (!dailyClass) return [];
    return dailyClass.classList.map(subject => resolveWeeklySubject(subject));
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

function getNextDayScheduleData() {
    const dayConfig = getCurrentDayScheduleConfig(1);
    const currentSchedule = getDaySchedule(1);
    const timetable = dayConfig?.timetable;
    const dayTimetable = timetable && scheduleConfig.timetable?.[timetable];
    const divider = (scheduleConfig.divider?.[timetable] || [])
        .map(position => Number(position) + 1)
        .filter(position => Number.isInteger(position));
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
    const divider = (scheduleConfig.divider[timetable] || [])
        .map(position => Number(position) + 1)
        .filter(position => Number.isInteger(position));
    let scheduleArray = [];
    let currentHighlight = { index: null, type: null, fullName: null, countdown: null, countdownText: null };
    Object.keys(dayTimetable).forEach((timeRange, index) => {
        const [startTime, endTime] = timeRange.split('-');
        const classIndex = dayTimetable[timeRange];

        if (typeof classIndex === 'number') {
            const subjectShortName = currentSchedule[classIndex];
            const subjectFullName = scheduleConfig.subject_name?.[subjectShortName] || subjectShortName || '未知课表';
            scheduleArray.push(subjectShortName);
            if (fusion && scheduleArray.length - 1 === fusion.end) fusionEndTime = endTime;

            if (isClassCurrent(startTime, endTime, currentTime)) {
                currentHighlight.index = scheduleArray.length - 1;
                currentHighlight.type = 'current';
                currentHighlight.fullName = subjectFullName;
                currentHighlight.countdown = calculateCountdown(endTime, currentTime);
                currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
            }
        } else if (currentHighlight.index === null && isBreakTime(startTime, endTime, currentTime)) {
            const breakIndex = scheduleArray.length;
            if (fusion && fusion.ignoreBreak && breakIndex > fusion.start && breakIndex <= fusion.end) return;
            let highlighted = false;
            for (let i = index + 1; i < Object.keys(dayTimetable).length; i++) {
                const nextTimeRange = Object.keys(dayTimetable)[i];
                const nextClassIndex = dayTimetable[nextTimeRange];
                if (typeof nextClassIndex === 'number') {
                    currentHighlight.index = scheduleArray.length;
                    currentHighlight.type = 'upcoming';
                    currentHighlight.isBreak = true;
                    const nextSubjectShortName = currentSchedule[nextClassIndex];
                    const nextSubjectFullName = scheduleConfig.subject_name?.[nextSubjectShortName] || nextSubjectShortName || '未知课表';
                    currentHighlight.fullName = dayTimetable[timeRange];
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
                currentHighlight.fullName = dayTimetable[timeRange];
                currentHighlight.countdown = calculateCountdown(timeRange.split('-')[1], currentTime);
                currentHighlight.countdownText = formatCountdown(currentHighlight.countdown);
            }
        } else if (currentHighlight.index === null && !dayTimetable[timeRange]) {
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
    return { scheduleArray, currentHighlight, timetable, divider, fusion: fusion ? { ...fusion, subject: fusionSubject } : null };
}


// Generated by ChatGPT4 
function calculateCountdown(targetTime, currentTime) {
    const [targetH, targetM] = targetTime.split(':').map(Number);
    const [currentH, currentM, currentS = '00'] = currentTime.split(':').map(Number);

    const targetTotalSeconds = targetH * 3600 + targetM * 60;
    const currentTotalSeconds = currentH * 3600 + currentM * 60 + currentS;

    return targetTotalSeconds - currentTotalSeconds;
}

// Generated by ChatGPT4 
function formatCountdown(countdownSeconds) {
    const minutes = Math.floor(countdownSeconds / 60);
    const seconds = countdownSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

