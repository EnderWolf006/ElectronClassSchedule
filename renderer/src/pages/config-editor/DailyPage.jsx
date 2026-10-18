import { useLayoutEffect, useRef } from 'react';
import { Button, Input, Select } from '@fluentui/react-components';
import { getTimetableSlotCount } from './config-utils.js';

const WEEK_DAYS = [
  ['星期一', 1],
  ['星期二', 2],
  ['星期三', 3],
  ['星期四', 4],
  ['星期五', 5],
  ['星期六', 6],
  ['星期日', 0],
];

export default function DailyPage({
  config,
  bump,
  activeDayIndex,
  setActiveDayIndex,
  subjectEntries,
  onAddDay,
  onDeleteDay,
  onAddSlot,
}) {
  const layoutRef = useRef(null);
  const navRef = useRef(null);
  const tablePanelRef = useRef(null);
  const propertyPanelRef = useRef(null);

  const days = Array.isArray(config?.daily_class) ? config.daily_class : [];
  const configuredSchedule = Array.isArray(config?.daily_schedule) ? config.daily_schedule : [];
  const timetableOptions = config && config.timetable ? Object.keys(config.timetable) : ['workday', 'weekend'];

  // 与旧版 applyDailyTableLayout 相同的宽度钳制
  useLayoutEffect(() => {
    const apply = () => {
      const layout = layoutRef.current;
      const tablePanel = tablePanelRef.current;
      const propertyPanel = propertyPanelRef.current;
      if (!layout || !tablePanel || !propertyPanel) return;
      if (window.matchMedia('(max-width: 980px)').matches) {
        tablePanel.style.width = '';
        tablePanel.style.maxWidth = '';
        propertyPanel.style.width = '';
        propertyPanel.style.minWidth = '';
        return;
      }
      const availableWidth = layout.clientWidth;
      const leftNavWidth = navRef.current?.offsetWidth || 180;
      const gap = 22;
      const targetWidth = Math.max(320, availableWidth - leftNavWidth - 280 - gap * 3 - 10);
      const finalTableWidth = Math.min(Math.max(320, targetWidth), 760);
      const propertyWidth = Math.min(280, Math.max(220, availableWidth - finalTableWidth - leftNavWidth - 28));
      tablePanel.style.width = `${finalTableWidth}px`;
      tablePanel.style.maxWidth = `${finalTableWidth}px`;
      propertyPanel.style.width = `${propertyWidth}px`;
      propertyPanel.style.minWidth = `${propertyWidth}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  });

  if (days.length === 0) {
    return (
      <>
        <ScheduleMap days={days} configuredSchedule={configuredSchedule} config={config} bump={bump} />
        <div className="daily-layout" ref={layoutRef}>
          <aside className="day-nav" ref={navRef}>
            <Button className="day-nav-add win-small win-primary" appearance="primary" onClick={onAddDay}>新建课表</Button>
            <div className="empty">暂无课表</div>
          </aside>
          <div className="day-editor"><div className="empty">暂无课表配置</div></div>
        </div>
      </>
    );
  }

  const dayIndex = days[activeDayIndex] ? activeDayIndex : 0;
  const day = days[dayIndex] || days[0];
  const classList = Array.isArray(day.classList) ? day.classList : [];
  const slotCount = Math.max(classList.length, 1);

  const safeTimetable = day.timetable && config?.timetable?.[day.timetable]
    ? day.timetable
    : (dayIndex === 6 && config?.timetable?.sat
      ? 'sat'
      : (config?.timetable?.workday ? 'workday' : (timetableOptions[0] || 'workday')));

  const subjectOptions = [
    <option key="__empty__" value="">请选择课程</option>,
    ...subjectEntries.map(([key, name]) => (
      <option key={key} value={key}>{name || key}</option>
    )),
  ];

  const mutateDay = (mutator) => {
    mutator();
    bump();
  };

  const changeSubject = (slotIndex, weekIndex, weeks, value) => {
    const nextClassList = Array.isArray(classList) ? [...classList] : [''];
    const current = nextClassList[slotIndex];
    const values = Array.isArray(current) ? [...current] : [current || ''];
    values[weekIndex] = value;
    nextClassList[slotIndex] = weeks === 1 ? values[0] : values;
    day.classList = nextClassList;
    bump();
  };

  const changeRotationWeeks = (slotIndex, weeks) => {
    const nextClassList = Array.isArray(classList) ? [...classList] : [''];
    const current = nextClassList[slotIndex];
    const currentValues = Array.isArray(current) ? current : [current || ''];
    const resized = Array.from({ length: weeks }, (_, index) => currentValues[index] || '');
    nextClassList[slotIndex] = weeks === 1 ? resized[0] : resized;
    day.classList = nextClassList;
    bump();
  };

  const changeDayTimetable = (timetableName) => {
    if (!config?.timetable?.[timetableName]) return;
    const expectedCount = getTimetableSlotCount(config.timetable[timetableName]);
    const nextClassList = Array.isArray(day.classList) ? [...day.classList] : [];
    while (nextClassList.length < expectedCount) nextClassList.push('');
    if (nextClassList.length > expectedCount) nextClassList.length = expectedCount;
    day.classList = nextClassList;
    day.timetable = timetableName;
    bump();
  };

  return (
    <>
      <ScheduleMap days={days} configuredSchedule={configuredSchedule} config={config} bump={bump} />
      <div className="daily-layout" ref={layoutRef}>
        <aside className="day-nav" ref={navRef}>
          <Button className="day-nav-add win-small win-primary" appearance="primary" onClick={onAddDay}>新建课表</Button>
          {days.map((item, index) => (
            <button
              type="button"
              key={index}
              className={`day-nav-item${index === dayIndex ? ' active' : ''}`}
              onClick={() => setActiveDayIndex(index)}
            >
              {item.Chinese || `第${index + 1}天`} ({item.English || 'DAY'})
            </button>
          ))}
        </aside>

        <div className="day-editor">
          <div className="day-editor-card group-card" data-day-index={dayIndex}>
            <div className="day-table-panel" ref={tablePanelRef}>
              <h3>{day.Chinese || `第${dayIndex + 1}天`} ({day.English || 'DAY'})</h3>
              <table className="vertical-table">
                <thead>
                  <tr>
                    <th>节次</th>
                    <th>课程内容</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: slotCount }, (_, slotIndex) => {
                    const value = classList[slotIndex];
                    const weeklyValues = Array.isArray(value) ? value : [value];
                    const rotationWeeks = Math.min(Math.max(Array.isArray(value) ? value.length : 1, 1), 4);
                    return (
                      <tr key={slotIndex}>
                        <td>第 {slotIndex + 1} 节</td>
                        <td>
                          <div className="slot-rotation-control">
                            <label htmlFor={`rotation-weeks-${dayIndex}-${slotIndex}`}>轮换周数</label>
                            <Select
                              id={`rotation-weeks-${dayIndex}-${slotIndex}`}
                              value={String(rotationWeeks)}
                              onChange={(event) => changeRotationWeeks(slotIndex, Number(event.target.value))}
                            >
                              <option value="1">不轮换</option>
                              <option value="2">2 周</option>
                              <option value="3">3 周</option>
                              <option value="4">4 周</option>
                            </Select>
                          </div>
                          <div className="weekly-inputs" style={{ '--rotation-weeks': rotationWeeks }}>
                            {Array.from({ length: rotationWeeks }, (_, weekIndex) => (
                              <div className="weekly-input" key={weekIndex}>
                                {rotationWeeks > 1 && (
                                  <label className="weekly-label" htmlFor={`day-${dayIndex}-slot-${slotIndex}-week-${weekIndex}`}>
                                    第 {weekIndex + 1} 周
                                  </label>
                                )}
                                <Select
                                  id={`day-${dayIndex}-slot-${slotIndex}-week-${weekIndex}`}
                                  value={weeklyValues[weekIndex] ?? ''}
                                  onChange={(event) => changeSubject(slotIndex, weekIndex, rotationWeeks, event.target.value)}
                                >
                                  {subjectOptions}
                                </Select>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="inline-actions">
                <Button className="win-small" onClick={() => onAddSlot(dayIndex)}>新增一节</Button>
              </div>
            </div>

            <div className="property-panel" ref={propertyPanelRef}>
              <h3>其它设置</h3>
              <div className="field">
                <label htmlFor={`day-name-${dayIndex}`}>中文</label>
                <Input
                  id={`day-name-${dayIndex}`}
                  value={day.Chinese || ''}
                  onChange={(event) => mutateDay(() => { day.Chinese = event.target.value; })}
                />
              </div>
              <div className="field">
                <label htmlFor={`day-en-${dayIndex}`}>英文</label>
                <Input
                  id={`day-en-${dayIndex}`}
                  value={day.English || ''}
                  onChange={(event) => mutateDay(() => { day.English = event.target.value; })}
                />
              </div>
              <div className="field">
                <label htmlFor={`day-timetable-${dayIndex}`}>时间表类型</label>
                <Select
                  id={`day-timetable-${dayIndex}`}
                  value={safeTimetable}
                  onChange={(event) => changeDayTimetable(event.target.value)}
                >
                  {timetableOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              </div>
              <div className="inline-actions">
                <Button className="win-small danger-outline" onClick={() => onDeleteDay(dayIndex)}>
                  删除该日课表
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ==== 每天加载配置 ====
// 每天“轮换模式”存于 config.daily_rotation_mode[星期]（'multi' = 多课表轮换，
// 缺省 = 课表内轮换），多课表轮换序列存于 config.daily_rotation[星期]。
// 开学日期与整体轮换偏移在「软件设置 → 基础设置」维护（settings.js），此处不涉及。

function ScheduleMap({ days, configuredSchedule, config, bump }) {
  // 首帧配置可能尚未读取完成（config 为 null），渲染路径全部走可选链
  const dayRotation = config?.daily_rotation && typeof config.daily_rotation === 'object'
    ? config.daily_rotation
    : {};

  // 该天的轮换模式：缺省为课表内轮换
  const dayMode = (dayOfWeek) => (
    config?.daily_rotation_mode
    && typeof config.daily_rotation_mode === 'object'
    && config.daily_rotation_mode[String(dayOfWeek)] === 'multi'
      ? 'multi'
      : 'timetable'
  );

  // 切为多课表轮换时登记该天；切回课表内轮换时移除登记（轮换序列保留，便于再次切换）
  const changeDayMode = (dayOfWeek, mode) => {
    if (mode === 'multi') {
      if (!config.daily_rotation_mode || typeof config.daily_rotation_mode !== 'object') {
        config.daily_rotation_mode = {};
      }
      config.daily_rotation_mode[String(dayOfWeek)] = 'multi';
    } else if (config.daily_rotation_mode && typeof config.daily_rotation_mode === 'object') {
      delete config.daily_rotation_mode[String(dayOfWeek)];
    }
    bump();
  };

  const dayRotationEntries = (dayOfWeek) => {
    const entries = dayRotation[String(dayOfWeek)];
    return Array.isArray(entries) ? entries : [];
  };

  // 该天多课表轮换的周期：2/3/4 周；“不轮换”= 固定加载第 1 周所选课表（序列长度 1）
  const changeDayCycle = (dayOfWeek, cycle) => {
    if (!config.daily_rotation || typeof config.daily_rotation !== 'object') {
      config.daily_rotation = {};
    }
    if (cycle >= 2) {
      const prev = dayRotationEntries(dayOfWeek);
      config.daily_rotation[String(dayOfWeek)] = Array.from({ length: cycle }, (_, index) => prev[index] || '');
    } else {
      const prev = dayRotationEntries(dayOfWeek);
      config.daily_rotation[String(dayOfWeek)] = [prev[0] || ''];
    }
    bump();
  };

  const changeDayRotationEntry = (dayOfWeek, weekIndex, name) => {
    if (!config.daily_rotation || typeof config.daily_rotation !== 'object') {
      config.daily_rotation = {};
    }
    // “不轮换”（周期 1）时该天可能尚无序列数组：按需创建/扩容，保证第 1 周框可直接选课
    const prev = dayRotationEntries(dayOfWeek);
    const next = Array.from({ length: Math.max(weekIndex + 1, prev.length) }, (_, index) => prev[index] || '');
    next[weekIndex] = name;
    config.daily_rotation[String(dayOfWeek)] = next;
    bump();
  };

  const dayOptions = days.length
    ? days.map((day, index) => (
      <option key={index} value={index}>{day.Chinese || `第${index + 1}个课表`}</option>
    ))
    : <option value="">暂无课表</option>;

  return (
    <div className="panel schedule-map-panel">
      <h3>每天加载的课表</h3>
      <table className="schedule-map-table">
        <thead>
          <tr>
            <th style={{ width: '12%' }}>星期</th>
            <th style={{ width: '132px' }}>轮换模式</th>
            <th>需要加载的课表</th>
          </tr>
        </thead>
        <tbody>
          {WEEK_DAYS.map(([name, dayOfWeek]) => {
            const configuredIndex = configuredSchedule[dayOfWeek] === undefined
              ? dayOfWeek
              : Number(configuredSchedule[dayOfWeek]);
            const selectedIndex = Number.isInteger(configuredIndex) && days[configuredIndex]
              ? configuredIndex
              : (days.length ? 0 : -1);
            const mode = dayMode(dayOfWeek);
            const entries = dayRotationEntries(dayOfWeek);
            const cycle = entries.length >= 2 ? entries.length : 0;
            // “不轮换”（周期 1）也显示第 1 周课表框，固定加载所选课表
            const entryCount = cycle >= 2 ? cycle : 1;
            return (
              <tr key={dayOfWeek}>
                <td>{name}</td>
                <td>
                  <Select
                    id={`day-mode-${dayOfWeek}`}
                    disabled={!days.length}
                    value={mode}
                    onChange={(event) => changeDayMode(dayOfWeek, event.target.value)}
                  >
                    <option value="timetable">课表内轮换</option>
                    <option value="multi">多课表轮换</option>
                  </Select>
                </td>
                <td>
                  {mode === 'multi' ? (
                    <div className="day-rotation">
                      <div className="day-rotation-cycle">
                        <label htmlFor={`day-cycle-${dayOfWeek}`}>轮换周期</label>
                        <Select
                          id={`day-cycle-${dayOfWeek}`}
                          disabled={!days.length}
                          value={String(cycle)}
                          onChange={(event) => changeDayCycle(dayOfWeek, Number(event.target.value))}
                        >
                          <option value="0">不轮换</option>
                          <option value="2">2 周</option>
                          <option value="3">3 周</option>
                          <option value="4">4 周</option>
                        </Select>
                      </div>
                      {Array.from({ length: entryCount }, (_, weekIndex) => (
                        <div className="day-rotation-entry" key={weekIndex}>
                          <label htmlFor={`day-rot-${dayOfWeek}-${weekIndex}`}>第 {weekIndex + 1} 周</label>
                          <Select
                            id={`day-rot-${dayOfWeek}-${weekIndex}`}
                            disabled={!days.length}
                            value={entries[weekIndex] || ''}
                            onChange={(event) => changeDayRotationEntry(dayOfWeek, weekIndex, event.target.value)}
                          >
                            <option value="">（未选择）</option>
                            {dayOptions}
                          </Select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="day-load-row">
                      <Select
                        disabled={!days.length}
                        value={days.length ? String(selectedIndex) : ''}
                        onChange={(event) => {
                          if (!Array.isArray(config.daily_schedule)) {
                            config.daily_schedule = [0, 1, 2, 3, 4, 5, 6];
                          }
                          config.daily_schedule[dayOfWeek] = Number(event.target.value);
                          bump();
                        }}
                      >
                        {dayOptions}
                      </Select>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="field-help">
        「轮换模式」按天独立设置：课表内轮换 = 按星期加载所选课表，课表内单节课程可设置多周轮换；
        多课表轮换 = 该天先选轮换周期，再为每一周选择加载的课表。轮换周数由「软件设置 → 基础设置」的
        开学日期与轮换偏移推算，未设置开学日期时从本周开始推算。手动“切换日程 / 加载临时课表”仍然优先。
      </p>
    </div>
  );
}
