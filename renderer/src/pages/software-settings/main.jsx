import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input, Select, Switch } from '@fluentui/react-components';
import { AppTheme, initialThemeFromQuery } from '../../common/theme.jsx';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { Svg, ICONS } from '../../common/icons.jsx';
import ComponentsPage, { createComponentId, getConfiguredComponentRows } from './ComponentsPage.jsx';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './software-settings.css';

const NAV_ITEMS = [
  { page: 'basic', label: '基础设置', icon: ICONS.basicSettings },
  { page: 'components', label: '组件设置', icon: ICONS.components },
  { page: 'theme', label: '主题', icon: ICONS.style },
  { page: 'reminder', label: '提醒', icon: ICONS.reminder },
];

const WEEK_COUNTS = [2, 3, 4];

// ==== 多周轮换偏移 ====
// 与主界面 js/index.js 的锚点逻辑保持一致（file:// 页面共享同一 localStorage）
function getRotationWeekStart(date) {
  const weekStart = new Date(date);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getRotationWeekNumber(rotationWeeks) {
  let anchors = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('rotationWeekAnchors') || '{}');
    if (parsed && typeof parsed === 'object') anchors = parsed;
  } catch (error) { /* 锚点缺失时按“本周为第 1 周”处理 */ }
  const now = new Date();
  const currentWeekStart = getRotationWeekStart(now);
  let anchor = Number(anchors[rotationWeeks]);
  if (!Number.isFinite(anchor) || anchor > now.getTime()) {
    anchor = currentWeekStart.getTime();
  } else {
    anchor = getRotationWeekStart(new Date(anchor)).getTime();
  }
  return Math.max(0, Math.round((currentWeekStart.getTime() - anchor) / (7 * 24 * 60 * 60 * 1000)));
}

// 本周实际生效的轮换周次（0 基）：主界面按 (周数 + 偏移) % 周数 取科目，这里保持一致
function getEffectiveRotationWeek(rotationWeeks, rotationOffset) {
  const configured = Number(rotationOffset?.[rotationWeeks]);
  const offset = Number.isInteger(configured) ? configured : 0;
  const weekNumber = getRotationWeekNumber(rotationWeeks);
  return (((weekNumber + offset) % rotationWeeks) + rotationWeeks) % rotationWeeks;
}

const CSS_VAR_LABELS = [
  { var: '--center-font-size', label: '中心字号' },
  { var: '--corner-font-size', label: '角标字号' },
  { var: '--countdown-font-size', label: '倒计时字号' },
  { var: '--global-border-radius', label: '全局圆角' },
  { var: '--global-bg-opacity', label: '背景透明度' },
  { var: '--container-bg-padding', label: '容器内边距' },
  { var: '--countdown-bg-padding', label: '倒计时内边距' },
  { var: '--container-space', label: '组件间距' },
  { var: '--top-space', label: '顶部间距' },
  { var: '--main-horizontal-space', label: '主水平间距' },
  { var: '--divider-width', label: '分隔线宽度' },
  { var: '--divider-margin', label: '分隔线边距' },
  { var: '--triangle-size', label: '三角尺寸' },
  { var: '--sub-font-size', label: '副文字号' },
];

function SoftwareSettingsApp({ onThemeModeChange }) {
  const configRef = useRef(null);
  const settingsRef = useRef(null);

  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((tick) => tick + 1), []);
  const [activePage, setActivePage] = useState('basic');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [cssStyleObj, setCssStyleObj] = useState({});
  const [reminderClass, setReminderClass] = useState({});
  const [reminderCustom, setReminderCustom] = useState([]);
  const [timeOffsetText, setTimeOffsetText] = useState('0');
  // 首帧与 URL 参数（主进程读磁盘注入）保持一致，避免挂载时 effect 先把 auto
  // 推给 Root 造成浅色闪帧；若之后 loadSettings 回包慢/失败，窗口就会残留浅色
  const [themeMode, setThemeMode] = useState(() => initialThemeFromQuery() || 'auto');
  const [positionMode, setPositionMode] = useState('top');

  const settings = settingsRef.current;
  const config = configRef.current;
  const rotationOffset = settings?.rotation_offset || {};

  const loadSettings = useCallback(() => {
    Promise.all([
      ipcRenderer.invoke('read-config-file'),
      ipcRenderer.invoke('read-settings-file'),
    ]).then(([data, settingsData]) => {
      configRef.current = data;
      settingsRef.current = settingsData;
      settingsRef.current.component_layout = getConfiguredComponentRows(settingsData, data);
      setRows(settingsRef.current.component_layout);
      setSelectedId(null);
      setCssStyleObj(settingsData?.css_style || {});
      setReminderClass(settingsData?.reminder_class || {});
      setReminderCustom(Array.isArray(settingsData?.reminder_custom) ? settingsData.reminder_custom : []);
      setThemeMode(settingsData?.theme_mode || 'auto');
      setPositionMode(settingsData?.window_position || 'top');
      setTimeOffsetText(String(Number(localStorage.getItem('timeOffset') || 0)));
      setStatus('');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('读取配置文件失败');
    });
  }, [bump]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (onThemeModeChange) onThemeModeChange(themeMode);
  }, [themeMode, onThemeModeChange]);

  const changeRotationOffset = (weeks, selectedWeek) => {
    if (!settingsRef.current) return;
    // 语义是“本周按第 selectedWeek+1 周显示”：锚点不动，把选择换算成偏移量保存，
    // 与主界面 (周数 + 偏移) % 周数 的计算方式一致，之后每周自动顺延
    const weekNumber = getRotationWeekNumber(weeks);
    const nextOffset = (((selectedWeek - weekNumber) % weeks) + weeks) % weeks;
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
    nextSettings.rotation_offset = {
      2: Number(nextSettings.rotation_offset?.[2] ?? 0),
      3: Number(nextSettings.rotation_offset?.[3] ?? 0),
      4: Number(nextSettings.rotation_offset?.[4] ?? 0),
    };
    nextSettings.rotation_offset[weeks] = nextOffset;
    ipcRenderer.invoke('save-settings-file', nextSettings).then(() => {
      settingsRef.current = nextSettings;
      setStatus('轮换偏移已保存并生效');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('保存失败，请检查配置格式');
    });
  };

  const applyTimeOffset = () => {
    const value = Number(timeOffsetText);
    if (!Number.isFinite(value)) {
      setStatus('请输入有效的整数秒数');
      return;
    }
    const seconds = Math.trunc(value) % 10000000000000;
    // 失焦会频繁触发：与已生效值一致时不重复下发、不弹提示
    if (String(seconds) === String(localStorage.getItem('timeOffset') || '0')) {
      setTimeOffsetText(String(seconds));
      return;
    }
    localStorage.setItem('timeOffset', String(seconds));
    ipcRenderer.send('set-time-offset', seconds);
    setTimeOffsetText(String(seconds));
    setStatus('时间偏移已生效');
  };

  const saveBasicSettings = () => {
    if (!settingsRef.current) return;
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
    nextSettings.rotation_offset = {
      2: Number(nextSettings.rotation_offset?.[2] ?? 0),
      3: Number(nextSettings.rotation_offset?.[3] ?? 0),
      4: Number(nextSettings.rotation_offset?.[4] ?? 0),
    };
    nextSettings.theme_mode = themeMode;
    nextSettings.window_position = positionMode;
    ipcRenderer.invoke('save-settings-file', nextSettings).then(() => {
      settingsRef.current = nextSettings;
      setStatus('设置已保存');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('保存失败，请检查配置格式');
    });
  };

  const saveComponentSettings = () => {
    if (!configRef.current) return;
    const nextConfig = JSON.parse(JSON.stringify(configRef.current));
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current || {}));
    const layout = rows.map((row) => row.map((component) => ({
      id: component.id,
      type: component.type,
      options: { ...(component.options || {}) },
    })));
    if (!layout.some((row) => row.some((component) => component.type === 'schedule'))) {
      layout.unshift([{ id: createComponentId('schedule'), type: 'schedule', options: {} }]);
    }
    nextSettings.component_layout = layout;
    const firstOf = (type) => layout.flat().find((component) => component.type === type);
    const week = firstOf('week');
    const countdown = firstOf('countdown');
    const time = firstOf('time');
    if (week) nextConfig.week_display = week.options.display !== false;
    if (countdown) nextConfig.countdown_target = countdown.options.target || '';
    if (time) nextConfig.time_source = time.options.source === 'system' ? 'system' : 'offset';
    Promise.all([
      ipcRenderer.invoke('save-config-file', nextConfig),
      ipcRenderer.invoke('save-settings-file', nextSettings),
    ]).then(() => {
      configRef.current = nextConfig;
      settingsRef.current = nextSettings;
      const normalized = getConfiguredComponentRows(nextSettings, nextConfig);
      settingsRef.current.component_layout = normalized;
      setRows(normalized);
      setSelectedId(null);
      setStatus('组件设置已保存');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('组件设置保存失败');
    });
  };

  const saveThemeSettings = () => {
    if (!configRef.current) return;
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current || {}));
    nextSettings.css_style = cssStyleObj;
    ipcRenderer.invoke('save-settings-file', nextSettings).then(() => {
      settingsRef.current = nextSettings;
      setStatus('主题设置已保存');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('主题设置保存失败');
    });
  };

  const handleSave = () => {
    if (activePage === 'theme') saveThemeSettings();
    else if (activePage === 'components') saveComponentSettings();
    else if (activePage === 'reminder') saveReminderSettings();
    else saveBasicSettings();
  };

  const saveReminderSettings = () => {
    if (!settingsRef.current) return;
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
    nextSettings.reminder_class = reminderClass;
    nextSettings.reminder_custom = reminderCustom;
    ipcRenderer.invoke('save-settings-file', nextSettings).then(() => {
      settingsRef.current = nextSettings;
      setStatus('提醒设置已保存');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('提醒设置保存失败');
    });
  };

  // “上课/即将上课/下课”开关切换后无需点击保存：防抖自动写入设置文件，
  // 主进程保存后会重载主界面课表条，状态立即生效。
  const reminderPersistTimer = useRef(null);
  const autoPersistReminderClass = (nextClass) => {
    if (!settingsRef.current) return;
    settingsRef.current.reminder_class = nextClass;
    if (reminderPersistTimer.current) clearTimeout(reminderPersistTimer.current);
    reminderPersistTimer.current = setTimeout(() => {
      if (!settingsRef.current) return;
      const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
      nextSettings.reminder_class = settingsRef.current.reminder_class;
      nextSettings.reminder_custom = reminderCustom;
      ipcRenderer.invoke('save-settings-file', nextSettings).then(() => {
        settingsRef.current = nextSettings;
        setStatus('提醒开关已自动保存并生效');
        bump();
      }).catch((error) => {
        console.error(error);
        setStatus('提醒设置保存失败');
      });
    }, 400);
  };

  const importThemeCss = () => {
    ipcRenderer.invoke('import-theme-css-file').then((vars) => {
      if (!vars) return;
      setCssStyleObj((prev) => ({ ...prev, ...vars }));
      setStatus(`已导入 ${Object.keys(vars).length} 个 CSS 变量，点击保存后生效`);
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('导入失败：' + (error.message || '未知错误'));
    });
  };

  const saveButtonText = activePage === 'theme'
    ? '保存主题'
    : activePage === 'components'
      ? '保存组件设置'
      : activePage === 'reminder'
        ? '保存提醒设置'
        : '保存设置';

  return (
    <>
      <TitleBar title="软件设置" />
      <div className="app ss-app">
        <div className="toolbar-sticky">
          <Button onClick={loadSettings}>刷新设置</Button>
          <Button className="win-primary" appearance="primary" onClick={handleSave}>{saveButtonText}</Button>
        </div>

        <div className="settings-app">
          <aside className="nav-sidebar">
            <div className="nav-brand">软件设置</div>
            <nav className="nav-list">
              {NAV_ITEMS.map((item) => (
                <button
                  type="button"
                  key={item.page}
                  className={`nav-item${activePage === item.page ? ' active' : ''}`}
                  onClick={() => { setActivePage(item.page); setStatus(''); }}
                >
                  <Svg size={24} viewBox="0 0 24 24" html={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <main className="main-content">
            <section className={`ss-page${activePage === 'basic' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">基础设置</h1>
                <p className="page-intro">调整课表窗口的显示方式、倒计时和多周轮换。</p>
              </div>
              <div className="panel">
                <h3>多周轮换偏移</h3>
                <div className="settings-grid">
                  {WEEK_COUNTS.map((weeks) => {
                    // 显示本周实际生效的轮换周次（随锚点每周自动推进），而不是静态偏移值
                    const effective = getEffectiveRotationWeek(weeks, rotationOffset);
                    return (
                      <div className="field" key={weeks}>
                        <label htmlFor={`rotationOffset${weeks}`}>{weeks === 2 ? '二周' : weeks === 3 ? '三周' : '四周'}轮换</label>
                        <Select
                          id={`rotationOffset${weeks}`}
                          value={String(effective)}
                          onChange={(event) => changeRotationOffset(weeks, Number(event.target.value))}
                        >
                          {Array.from({ length: weeks }, (_, index) => (
                            <option key={index} value={index}>第 {index + 1} 周</option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
                <p className="field-help">显示本周实际按第几周轮换，每周自动推进到下一周；若与实际不符，选择本周应显示的周次即可校准，修改后立即生效并自动保存。</p>
              </div>

              <div className="panel">
                <h3>时间偏移</h3>
                <div className="time-offset-field">
                  <div className="field">
                    <label htmlFor="timeOffsetInput">偏移秒数</label>
                    <Input
                      id="timeOffsetInput"
                      type="number"
                      step="1"
                      value={timeOffsetText}
                      onChange={(event) => setTimeOffsetText(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') applyTimeOffset(); }}
                      onBlur={applyTimeOffset}
                    />
                    <p className="field-help">设置课表计时与系统时间的偏移秒数，正数加快、负数减慢；输入后点击其他地方或按回车即生效，重启仍然保留。</p>
                  </div>
                </div>
              </div>

              <div className="panel">
                <h3>窗口位置</h3>
                <div className="field">
                  <label htmlFor="positionModeSelect">排列方式</label>
                  <Select
                    id="positionModeSelect"
                    value={positionMode}
                    onChange={(event) => {
                      const nextMode = event.target.value;
                      setPositionMode(nextMode);
                      // 选择后立即在主界面课表条预览，无需等待保存
                      ipcRenderer.send('window-position-preview', nextMode);
                    }}
                  >
                    <option value="top">顶部居中</option>
                    <option value="top-right">顶部靠右</option>
                    <option value="right">右侧竖排</option>
                  </Select>
                  <p className="field-help">控制课表条在屏幕上的排列位置：顶部居中、顶部靠右（每行右对齐），或右侧竖排（各行从右到左、行内组件自上而下）。选择后立即生效，点击"保存设置"可永久保留。</p>
                </div>
              </div>

              <div className="panel">
                <h3>深浅色</h3>
                <div className="field">
                  <label htmlFor="themeModeSelect">主题模式</label>
                  <Select
                    id="themeModeSelect"
                    value={themeMode}
                    onChange={(event) => {
                      const nextMode = event.target.value;
                      setThemeMode(nextMode);
                      // 选择后立即在主界面课表条及所有窗口预览，无需等待保存
                      ipcRenderer.send('theme-mode-preview', nextMode);
                    }}
                  >
                    <option value="auto">跟随系统</option>
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </Select>
                  <p className="field-help">控制主界面课表条和所有设置窗口的深浅色，选择后立即生效，点击"保存设置"可永久保留。</p>
                </div>
              </div>
            </section>

            <section className={`ss-page${activePage === 'components' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">组件设置</h1>
                <p className="page-intro">管理组件的显示位置、顺序和专属选项。课表组件包含每节课的倒计时。</p>
              </div>
              <ComponentsPage
                rows={rows}
                setRows={setRows}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                settingsRef={settingsRef}
                bump={bump}
              />
            </section>

            <section className={`ss-page${activePage === 'theme' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">主题</h1>
                <p className="page-intro">调整主界面样式参数。每个参数都有中文说明，直接修改数值即可。</p>
              </div>
              <div className="panel">
                <div className="field" style={{ marginBottom: '16px' }}>
                  <Button className="win-small" onClick={importThemeCss}>导入 CSS 主题配置</Button>
                  <p className="field-help">从本地选择 .css 文件，自动提取其中的 CSS 变量并合并到下方参数中。</p>
                </div>
                <h3>样式参数</h3>
                <div className="settings-grid">
                  {CSS_VAR_LABELS.map(({ var: varName, label }) => (
                    <div className="field" key={varName}>
                      <label htmlFor={`cssVar-${varName}`}>{label}</label>
                      <Input
                        id={`cssVar-${varName}`}
                        type="text"
                        value={cssStyleObj[varName] || ''}
                        onChange={(event) => {
                          const v = event.target.value;
                          setCssStyleObj((prev) => {
                            const next = { ...prev };
                            if (v === '') delete next[varName];
                            else next[varName] = v;
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className={`ss-page${activePage === 'reminder' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">提醒</h1>
                <p className="page-intro">在主界面课表条上触发提醒遮罩，上下课自动提醒和自定义文本提醒。</p>
              </div>
              <div className="panel">
                <h3>上下课提醒</h3>
                <p className="field-help">在即将上课、上课、下课时自动触发遮罩提醒，绿色=上课/即将上课，黄色=下课。</p>
                <div className="settings-grid">
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Switch
                        checked={reminderClass.upcoming_enabled || false}
                        onChange={(e, d) => {
                          const next = { ...reminderClass, upcoming_enabled: d.checked };
                          setReminderClass(next);
                          autoPersistReminderClass(next);
                        }}
                      />
                      即将上课提醒
                    </label>
                    <Input
                      type="number"
                      step="1"
                      value={String(reminderClass.upcoming_seconds ?? 300)}
                      onChange={(e) => setReminderClass((p) => ({ ...p, upcoming_seconds: Number(e.target.value) }))}
                      style={{ marginTop: '8px' }}
                    />
                    <p className="field-help">距离上课剩余多少秒时提醒</p>
                  </div>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Switch
                        checked={reminderClass.start_enabled || false}
                        onChange={(e, d) => {
                          const next = { ...reminderClass, start_enabled: d.checked };
                          setReminderClass(next);
                          autoPersistReminderClass(next);
                        }}
                      />
                      上课提醒
                    </label>
                  </div>
                  <div className="field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Switch
                        checked={reminderClass.end_enabled || false}
                        onChange={(e, d) => {
                          const next = { ...reminderClass, end_enabled: d.checked };
                          setReminderClass(next);
                          autoPersistReminderClass(next);
                        }}
                      />
                      下课提醒
                    </label>
                  </div>
                </div>
                <div className="settings-grid" style={{ marginTop: '14px' }}>
                  <div className="field">
                    <label htmlFor="rcUpcomingText">即将上课文字</label>
                    <Input
                      id="rcUpcomingText"
                      type="text"
                      value={reminderClass.upcoming_text || ''}
                      onChange={(e) => setReminderClass((p) => ({ ...p, upcoming_text: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="rcStartText">上课文字</label>
                    <Input
                      id="rcStartText"
                      type="text"
                      value={reminderClass.start_text || ''}
                      onChange={(e) => setReminderClass((p) => ({ ...p, start_text: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="rcEndText">下课文字</label>
                    <Input
                      id="rcEndText"
                      type="text"
                      value={reminderClass.end_text || ''}
                      onChange={(e) => setReminderClass((p) => ({ ...p, end_text: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3>自定义文本提醒</h3>
                  <Button className="win-small" onClick={() => {
                    const id = `rc-${Date.now()}`;
                    setReminderCustom((prev) => [...prev, { id, time: '12:00', text: '', color: '#114514', duration: 5000 }]);
                  }}>新增</Button>
                </div>
                <p className="field-help">每天到指定时间触发提醒，可设多条。遮罩从课表中央扩散展开并显示文字。</p>
                {reminderCustom.length === 0 ? (
                  <div className="empty" style={{ padding: '12px' }}>暂无自定义提醒，点击"新增"按钮添加。</div>
                ) : (
                  reminderCustom.map((item, i) => (
                    <div key={item.id} className="settings-grid" style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--colorNeutralStroke2)' }}>
                      <div className="field">
                        <label>时间</label>
                        <Input
                          type="text"
                          placeholder="HH:MM"
                          value={item.time || ''}
                          onChange={(e) => setReminderCustom((prev) => prev.map((it, j) => j === i ? { ...it, time: e.target.value } : it))}
                        />
                      </div>
                      <div className="field">
                        <label>提醒文字</label>
                        <Input
                          type="text"
                          value={item.text || ''}
                          onChange={(e) => setReminderCustom((prev) => prev.map((it, j) => j === i ? { ...it, text: e.target.value } : it))}
                        />
                      </div>
                      <div className="field">
                        <label>遮罩颜色</label>
                        <input
                          type="color"
                          className="native-color"
                          value={item.color || '#114514'}
                          onChange={(e) => setReminderCustom((prev) => prev.map((it, j) => j === i ? { ...it, color: e.target.value } : it))}
                        />
                      </div>
                      <div className="field">
                        <label>持续毫秒</label>
                        <Input
                          type="number"
                          step="100"
                          value={String(item.duration ?? 5000)}
                          onChange={(e) => setReminderCustom((prev) => prev.map((it, j) => j === i ? { ...it, duration: Number(e.target.value) } : it))}
                        />
                      </div>
                      <div className="field" style={{ alignSelf: 'flex-end' }}>
                        <Button className="win-small" onClick={() => setReminderCustom((prev) => prev.filter((_, j) => j !== i))}>删除</Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <div className="status" aria-live="polite">{status}</div>
          </main>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<SoftwareSettingsRoot />);

function SoftwareSettingsRoot() {
  // 首帧优先使用主进程通过 URL 参数注入的已保存主题模式，避免窗口打开瞬间闪现浅色
  const [mode, setMode] = useState(() => initialThemeFromQuery() || 'auto');
  useEffect(() => {
    // URL 参数已由主进程读磁盘注入，足够可靠；若无条件异步读取，回包可能基于
    // 预览前的旧文件内容把主题错误覆盖回去（暗色残留浅色打底的竞态根因）
    if (initialThemeFromQuery()) return;
    ipcRenderer.invoke('read-settings-file').then((s) => {
      setMode(s?.theme_mode || 'auto');
    }).catch(() => {});
  }, []);
  return (
    <AppTheme mode={mode}>
      <SoftwareSettingsApp onThemeModeChange={setMode} />
    </AppTheme>
  );
}
