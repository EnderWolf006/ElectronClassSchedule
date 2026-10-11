import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox, Input, Select, Switch } from '@fluentui/react-components';
import { AppTheme, initialThemeFromQuery } from '../../common/theme.jsx';
import { useThemePack } from '../../common/themePack.js';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { Svg, ICONS } from '../../common/icons.jsx';
import ComponentsPage, { createComponentId, getConfiguredComponentRows } from './ComponentsPage.jsx';
import ThemePacksPage from './ThemePacksPage.jsx';
import PluginsPage from './PluginsPage.jsx';
import SecurityPage from './SecurityPage.jsx';
import AutomationPage from './AutomationPage.jsx';
import WeatherPage from './WeatherPage.jsx';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './software-settings.css';

const NAV_ITEMS = [
  { page: 'basic', label: '基础设置', icon: ICONS.basicSettings },
  { page: 'components', label: '组件设置', icon: ICONS.components },
  { page: 'appearance', label: '外观', icon: ICONS.style },
  { page: 'reminder', label: '提醒', icon: ICONS.reminder },
  { page: 'weather', label: '天气', icon: ICONS.componentWeather },
  { page: 'automation', label: '自动化', icon: ICONS.automation },
  // 分割线：以上为常规设置，以下为安全与扩展
  { divider: true },
  { page: 'security', label: '安全设置', icon: ICONS.lock },
  { page: 'themes', label: '主题', icon: ICONS.palette },
  { page: 'plugins', label: '插件', icon: ICONS.plugin },
];

// ==== 课程提醒（即将上课/上课/下课）卡片定义 ====
// 每项支持：独立开关、独立语音、课前秒数（仅即将上课）、提醒文字（次级提醒）、遮罩文字（强提醒遮罩）
const CLASS_REMINDER_DEFS = [
  { key: 'upcoming', title: '在课前准备时发出提醒', desc: '在上课前一段时间发出醒目提醒，提示做好上课准备。', defaultText: '即将上课' },
  { key: 'start', title: '在上课时发出提醒', desc: '每节课开始时发出醒目提醒。', defaultText: '上课' },
  { key: 'end', title: '在下课时发出提醒', desc: '每节课结束时发出醒目提醒。', defaultText: '下课' },
];

// 外观参数规格。unit='px' 表示长度值：文本框里只填数字（多个数字用空格分隔，
// 如内边距 "8 14"），保存时自动给每个数字补 px；背景透明度是无单位数字。
const CSS_VAR_SPECS = [
  { var: '--center-font-size', label: '中心字号', unit: 'px' },
  { var: '--corner-font-size', label: '角标字号', unit: 'px' },
  { var: '--countdown-font-size', label: '倒计时字号', unit: 'px' },
  { var: '--global-border-radius', label: '全局圆角', unit: 'px' },
  { var: '--global-bg-opacity', label: '背景透明度', unit: '' },
  { var: '--container-bg-padding', label: '容器内边距', unit: 'px' },
  { var: '--countdown-bg-padding', label: '倒计时内边距', unit: 'px' },
  { var: '--container-space', label: '组件间距', unit: 'px' },
  { var: '--top-space', label: '顶部间距', unit: 'px' },
  { var: '--main-horizontal-space', label: '主水平间距', unit: 'px' },
  { var: '--divider-width', label: '分隔线宽度', unit: 'px' },
  { var: '--divider-margin', label: '分隔线边距', unit: 'px' },
  { var: '--triangle-size', label: '三角尺寸', unit: 'px' },
  { var: '--sub-font-size', label: '副文字号', unit: 'px' },
];

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

// 设置页内试听提醒音效：内置“叮咚”用 WebAudio 合成，自定义走本地音频文件
function previewReminderSound(advanced) {
  try {
    if (advanced && advanced.sound_source === 'custom' && advanced.sound_file) {
      const url = encodeURI(`file:///${String(advanced.sound_file).replace(/\\/g, '/')}`);
      const audio = new Audio(url);
      audio.volume = 0.9;
      audio.play().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [{ f: 880, t: 0 }, { f: 659.25, t: 0.28 }].forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0, now + n.t);
      gain.gain.linearRampToValueAtTime(0.35, now + n.t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + 0.6);
    });
  } catch (error) { /* 试听失败不影响页面 */ }
}

// 文件里存的是 "8px 14px"，输入框里只显示 "8 14"
function cssValueToDraft(spec, rawValue) {
  const text = String(rawValue ?? '').trim();
  if (!text) return '';
  if (spec.unit === 'px') return text.replace(/px/gi, '').replace(/\s+/g, ' ').trim();
  return text;
}

// 把输入框草稿转回 CSS 值；含非法数字时返回 null
function draftToCssValue(spec, draft) {
  const tokens = String(draft ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (spec.unit === 'px') {
    if (!tokens.every((token) => NUMBER_RE.test(token))) return null;
    return tokens.map((token) => `${token}px`).join(' ');
  }
  if (tokens.length !== 1 || !NUMBER_RE.test(tokens[0])) return null;
  return tokens[0];
}

// 轮换偏移按轮换周期分别设置（{2:x,3:y,4:z}，单位周）；数字为上一版“整体偏移”
// 的兼容格式（各周期同值）。归一化为对象（与 js/index.js 的 readRotationOffset 一致）
function normalizeRotationOffsets(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const same = Math.round(value);
    return { 2: same, 3: same, 4: same };
  }
  const pick = (cycle) => (value && typeof value === 'object' && Number.isFinite(Number(value[cycle]))
    ? Math.round(Number(value[cycle])) : 0);
  return { 2: pick(2), 3: pick(3), 4: pick(4) };
}

// 与 js/index.js 一致的周一锚点推算（file:// 页面共享同一 localStorage 锚点）
function getRotationWeekStart(date) {
  const weekStart = new Date(date);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getRotationWeekNumber(rotationWeeks, date = new Date()) {
  let anchors = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('rotationWeekAnchors') || '{}');
    if (parsed && typeof parsed === 'object') anchors = parsed;
  } catch (error) { /* 锚点缺失时按“本周为第 1 周”处理 */ }
  const now = date instanceof Date ? date : new Date();
  const currentWeekStart = getRotationWeekStart(now);
  let anchor = Number(anchors[rotationWeeks]);
  if (!Number.isFinite(anchor) || anchor > now.getTime()) {
    anchor = currentWeekStart.getTime();
  } else {
    anchor = getRotationWeekStart(new Date(anchor)).getTime();
  }
  return Math.max(0, Math.round((currentWeekStart.getTime() - anchor) / (7 * 24 * 60 * 60 * 1000)));
}

// 本周学期周序数 - 1（开学日期未设置或非法时返回 null，走锚点）
function getSemesterWeekBase(settingsData) {
  const startText = String(settingsData?.semester_start_date || '').trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(startText)) return null;
  const parts = startText.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(start.getTime())) return null;
  const week = Number(settingsData?.semester_start_week);
  const startWeek = Number.isFinite(week) ? Math.round(week) : 1;
  const diff = Math.round((getRotationWeekStart(new Date()).getTime() - getRotationWeekStart(start).getTime())
    / (7 * 24 * 60 * 60 * 1000));
  return startWeek + diff - 1;
}

const ROTATION_WEEK_COUNTS = [2, 3, 4];

function SoftwareSettingsApp({ onThemeModeChange }) {
  const configRef = useRef(null);
  const settingsRef = useRef(null);

  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((tick) => tick + 1), []);
  const [activePage, setActivePage] = useState(() => {
    // 允许通过 URL 参数直接打开指定页面（插件浮窗的“设置”按钮 -> 插件页）
    try {
      const page = new URLSearchParams(window.location.search).get('page');
      return NAV_ITEMS.some((item) => item.page === page) ? page : 'basic';
    } catch (error) {
      return 'basic';
    }
  });
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [cssStyleObj, setCssStyleObj] = useState({});
  const [reminderClass, setReminderClass] = useState({});
  const [reminderCustom, setReminderCustom] = useState([]);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderWeather, setReminderWeather] = useState({});
  const [reminderDismissal, setReminderDismissal] = useState({});
  const [reminderAdvanced, setReminderAdvanced] = useState({});
  // 提醒页：提供方 / 高级设置 两个页签；提供方列表点击进入详情
  const [reminderSectionTab, setReminderSectionTab] = useState('providers');
  const [openProvider, setOpenProvider] = useState(null);
  const [reminderAdvancedTab, setReminderAdvancedTab] = useState('sound');
  const [activeTheme, setActiveTheme] = useState('');
  const [pluginList, setPluginList] = useState([]);
  const [automationRules, setAutomationRules] = useState([]);
  const [timeOffsetText, setTimeOffsetText] = useState('0');
  // 学期与轮换（存 settings.js，供主界面课表内轮换/多课表轮换推算轮换周数）
  const [semesterStartDate, setSemesterStartDate] = useState('');
  const [rotationOffsets, setRotationOffsets] = useState({ 2: 0, 3: 0, 4: 0 });
  // 首帧与 URL 参数（主进程读磁盘注入）保持一致，避免挂载时 effect 先把 auto
  // 推给 Root 造成浅色闪帧；若之后 loadSettings 回包慢/失败，窗口就会残留浅色
  const [themeMode, setThemeMode] = useState(() => initialThemeFromQuery() || 'auto');
  const [positionMode, setPositionMode] = useState('top');
  const [countdownStyle, setCountdownStyle] = useState('floating');
  // 启动设置（存主进程 store）：高优先级启动依赖开机启动
  const [launchSettings, setLaunchSettings] = useState({ autoLaunch: true, highPriority: false });
  const [launchHint, setLaunchHint] = useState('');
  // 首次读取完成前，各类“即改即生效”的自动保存不能误触发
  const loadedRef = useRef(false);
  // 各设置域共用的防抖定时器
  const persistTimersRef = useRef(new Map());
  // 左侧导航折叠状态持久化（file:// 下 localStorage 与主界面共享，使用独立键名）
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('softwareSettingsNavCollapsed') === '1');
  const toggleNav = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('softwareSettingsNavCollapsed', next ? '1' : '0');
      return next;
    });
  }, []);
  // 打开“安全设置”页需要验证密码：同一窗口内验证通过后不再重复询问
  const securityUnlockedRef = useRef(false);
  const openPage = useCallback((page) => {
    const go = () => { setActivePage(page); setStatus(''); };
    if (page !== 'security' || securityUnlockedRef.current) {
      go();
      return;
    }
    ipcRenderer.invoke('security-verify-module', 'security').then((res) => {
      if (res && res.ok) {
        securityUnlockedRef.current = true;
        go();
      } else {
        setStatus('已取消密码验证，未打开“安全设置”');
      }
    }).catch(() => setStatus('密码验证失败'));
  }, []);

  const settings = settingsRef.current;
  const config = configRef.current;

  const loadSettings = useCallback(() => {
    loadedRef.current = false;
    Promise.all([
      ipcRenderer.invoke('read-config-file'),
      ipcRenderer.invoke('read-settings-file'),
      ipcRenderer.invoke('list-plugins'),
    ]).then(([data, settingsData, pluginData]) => {
      configRef.current = data;
      settingsRef.current = settingsData;
      settingsRef.current.component_layout = getConfiguredComponentRows(settingsData, data);
      setRows(settingsRef.current.component_layout);
      setSelectedId(null);
      setPluginList(Array.isArray(pluginData?.plugins) ? pluginData.plugins : []);
      // 外观参数以“去掉 px 的草稿”形式放进输入框
      const drafts = {};
      CSS_VAR_SPECS.forEach((spec) => {
        const draft = cssValueToDraft(spec, settingsData?.css_style?.[spec.var]);
        if (draft !== '') drafts[spec.var] = draft;
      });
      setCssStyleObj(drafts);
      setReminderClass(settingsData?.reminder_class || {});
      setReminderCustom(Array.isArray(settingsData?.reminder_custom) ? settingsData.reminder_custom : []);
      // 总开关缺省为开；旧配置文件没有这些键时按默认值展示
      setReminderEnabled(settingsData?.reminder_enabled !== false);
      setReminderWeather(settingsData?.reminder_weather || {});
      setReminderDismissal(settingsData?.reminder_dismissal || {});
      setReminderAdvanced(settingsData?.reminder_advanced || {});
      setAutomationRules(Array.isArray(settingsData?.automation_rules) ? settingsData.automation_rules : []);
      setThemeMode(settingsData?.theme_mode || 'auto');
      setPositionMode(settingsData?.window_position || 'top');
      setCountdownStyle(settingsData?.countdown_style === 'inline' ? 'inline' : 'floating');
      setActiveTheme(settingsData?.active_theme || '');
      setTimeOffsetText(String(Number(localStorage.getItem('timeOffset') || 0)));
      setSemesterStartDate(String(settingsData?.semester_start_date || ''));
      setRotationOffsets(normalizeRotationOffsets(settingsData?.rotation_offset));
      setStatus('');
      loadedRef.current = true;
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('读取配置文件失败');
    });
  }, [bump]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 启动设置存在主进程 store（不在 settings.js），单独读取
  useEffect(() => {
    ipcRenderer.invoke('launch-settings-get').then((data) => {
      if (!data) return;
      setLaunchSettings({
        autoLaunch: data.autoLaunch !== false,
        highPriority: data.highPriority === true,
      });
    }).catch(() => { /* 读取失败时保持默认展示 */ });
  }, []);

  // 系统强调色：提醒"遮罩颜色"未自定义时的默认色展示（实际取色在触发时进行）
  const [accentColor, setAccentColor] = useState('');
  useEffect(() => {
    ipcRenderer.invoke('get-system-accent').then((value) => {
      if (typeof value === 'string' && value) setAccentColor(value);
    }).catch(() => { /* 获取失败时使用 Windows 默认强调蓝兜底 */ });
  }, []);

  // 主进程请求切换页面（如插件浮窗齿轮 -> 插件页）
  useEffect(() => {
    const onNavigate = (_event, page) => {
      if (NAV_ITEMS.some((item) => item.page === page)) {
        openPage(page);
      }
    };
    ipcRenderer.on('settings-navigate', onNavigate);
    return () => ipcRenderer.removeListener('settings-navigate', onNavigate);
  }, [openPage]);

  // 通过 URL 参数直接打开“安全设置”（?page=security）时同样需要验证密码
  useEffect(() => {
    if (activePage === 'security' && !securityUnlockedRef.current) {
      setActivePage('basic');
      openPage('security');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (onThemeModeChange) onThemeModeChange(themeMode);
  }, [themeMode, onThemeModeChange]);

  // ===== 统一持久化：所有设置操作后立即（或短暂防抖）写入并生效，无需保存按钮 =====
  // options.skipReload：该项变更已通过专用预览通道热应用（如窗口位置），
  // 落盘后不需要主窗口整页 reload
  const persistSettings = useCallback((mutate, message, options) => {
    if (!settingsRef.current) return;
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
    mutate(nextSettings);
    // 乐观更新引用，连续编辑时基于最新值叠加
    settingsRef.current = nextSettings;
    ipcRenderer.invoke('save-settings-file', nextSettings, options).then(() => {
      setStatus(message || '已自动保存并生效');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('自动保存失败，请检查配置格式');
    });
  }, [bump]);

  const schedulePersist = useCallback((key, mutate, message, delay = 500) => {
    const timers = persistTimersRef.current;
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      persistSettings(mutate, message);
    }, delay));
  }, [persistSettings]);

  // 开学日期：选择后立即写入 settings.js，主窗口自动 reload 后轮换周数按新日期推算
  const changeSemesterStartDate = (value) => {
    setSemesterStartDate(value);
    persistSettings((nextSettings) => {
      nextSettings.semester_start_date = value || '';
    }, '开学日期已保存并生效');
  };

  // 本周实际生效的轮换周次（0 基）：有开学日期按学期周数，否则按周一锚点
  const currentEffectiveWeek = (weeks, offsets) => {
    const base = getSemesterWeekBase(settingsRef.current);
    const weekBase = base !== null ? base : getRotationWeekNumber(weeks);
    return ((weekBase + (Number(offsets[weeks]) || 0)) % weeks + weeks) % weeks;
  };

  // 校准某周期的轮换：下拉显示本周实际按第几周轮换，改选后反算该周期偏移并保存
  const changeRotationOffset = (weeks, selected) => {
    const offsets = normalizeRotationOffsets(settingsRef.current?.rotation_offset);
    const currentEffective = currentEffectiveWeek(weeks, offsets);
    const nextOffset = (((Number(offsets[weeks]) || 0) + selected - currentEffective) % weeks + weeks) % weeks;
    const next = { ...offsets, [weeks]: nextOffset };
    setRotationOffsets(next);
    persistSettings((nextSettings) => {
      nextSettings.rotation_offset = next;
    }, '轮换偏移已保存并生效');
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

  // 深浅色：选择即持久化，主进程广播到全部窗口
  const changeThemeMode = (nextMode) => {
    setThemeMode(nextMode);
    persistSettings((nextSettings) => {
      nextSettings.theme_mode = nextMode;
    }, '深浅色已生效');
  };

  // 窗口位置：先经预览通道让主窗口热重排并播放 FLIP 过渡动画（不 reload），
  // 再落盘且告知主进程跳过 reload，避免整页重载把动画打断成一帧跳变
  const changePositionMode = (nextMode) => {
    setPositionMode(nextMode);
    ipcRenderer.send('window-position-preview', nextMode);
    persistSettings((nextSettings) => {
      nextSettings.window_position = nextMode;
    }, '窗口位置已生效', { skipReload: true });
  };

  // 倒计时样式：顶部居中 / 顶部靠右时可切换“下方悬浮”与“内嵌”；
  // 右侧竖排（行即列）固定内嵌，界面上禁用该项
  const changeCountdownStyle = (style) => {
    setCountdownStyle(style);
    persistSettings((nextSettings) => {
      nextSettings.countdown_style = style === 'inline' ? 'inline' : 'floating';
    }, style === 'inline' ? '已切换为内嵌倒计时' : '已切换为下方悬浮倒计时');
  };

  // 启动设置：开机启动 / 高优先级启动（后者依赖前者，由主进程统一落盘并同步系统项）
  const changeLaunchSetting = (key, value) => {
    setLaunchHint('');
    ipcRenderer.invoke('launch-settings-set', { [key]: value }).then((data) => {
      if (!data) return;
      setLaunchSettings({
        autoLaunch: data.autoLaunch !== false,
        highPriority: data.highPriority === true,
      });
      if (data.highPriority && data.applied === false) {
        setLaunchHint('高优先级启动任务创建失败，可能被系统策略或安全软件拦截。');
        return;
      }
      if (key === 'autoLaunch' && value === false) setStatus('已关闭开机启动（高优先级启动一并关闭）');
      else setStatus('启动设置已生效');
    }).catch(() => setLaunchHint('启动设置保存失败，请重试。'));
  };

  // 组件布局同时写 config（组件专属选项）与 settings（布局）
  const flushComponentSettings = useCallback(() => {
    if (!configRef.current || !settingsRef.current) return;
    const nextConfig = JSON.parse(JSON.stringify(configRef.current));
    const nextSettings = JSON.parse(JSON.stringify(settingsRef.current));
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
      settingsRef.current.component_layout = layout;
      setStatus('组件设置已自动保存并生效');
      bump();
    }).catch((error) => {
      console.error(error);
      setStatus('组件设置自动保存失败');
    });
  }, [rows, bump]);

  // rows 任意变动（增删/排序/选项）后防抖落盘，不再需要“保存组件设置”按钮
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(flushComponentSettings, 600);
    return () => clearTimeout(timer);
  }, [rows, flushComponentSettings]);

  // 外观参数：输入后防抖自动保存（px 由草稿自动补全）
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      const nextCssStyle = {};
      for (const spec of CSS_VAR_SPECS) {
        const value = draftToCssValue(spec, cssStyleObj[spec.var] ?? '');
        if (value === null) {
          setStatus(`「${spec.label}」只能填写数字${spec.unit === 'px' ? '（多个数字用空格分隔）' : ''}`);
          return;
        }
        if (value !== '') nextCssStyle[spec.var] = value;
      }
      persistSettings((nextSettings) => {
        nextSettings.css_style = nextCssStyle;
      }, '外观设置已自动保存并生效');
    }, 500);
    return () => clearTimeout(timer);
  }, [cssStyleObj, persistSettings]);

  // 提醒设置（总开关/上下课/自定义/天气/高级）统一防抖落盘。
  // blockOverride 用来传入“本次刚修改、setState 尚未生效”的最新块，避免闭包读到旧值
  const persistReminder = (classOverride, customOverride, blockOverride) => {
    const nextClass = classOverride !== undefined ? classOverride : reminderClass;
    const nextCustom = customOverride !== undefined ? customOverride : reminderCustom;
    const nextEnabled = blockOverride && blockOverride.enabled !== undefined ? blockOverride.enabled : reminderEnabled;
    const nextWeather = blockOverride && blockOverride.weather !== undefined ? blockOverride.weather : reminderWeather;
    const nextDismissal = blockOverride && blockOverride.dismissal !== undefined ? blockOverride.dismissal : reminderDismissal;
    const nextAdvanced = blockOverride && blockOverride.advanced !== undefined ? blockOverride.advanced : reminderAdvanced;
    schedulePersist('reminder', (nextSettings) => {
      nextSettings.reminder_enabled = nextEnabled;
      nextSettings.reminder_class = nextClass;
      nextSettings.reminder_custom = nextCustom;
      nextSettings.reminder_dismissal = {
        enabled: nextDismissal.enabled === true,
        text: String(nextDismissal.text || '放学了，路上注意安全'),
        duration: Number(nextDismissal.duration) || 6000,
      };
      nextSettings.reminder_weather = {
        enabled: nextWeather.enabled || false,
        time: nextWeather.time || '07:00',
        city: nextWeather.city || '',
        extreme_enabled: nextWeather.extreme_enabled || false,
        quake_enabled: nextWeather.quake_enabled || false,
      };
      nextSettings.reminder_advanced = {
        sound_enabled: nextAdvanced.sound_enabled || false,
        sound_source: nextAdvanced.sound_source === 'custom' ? 'custom' : 'builtin',
        sound_file: nextAdvanced.sound_file || '',
        ontop_enabled: nextAdvanced.ontop_enabled || false,
        fullscreen_enabled: nextAdvanced.fullscreen_enabled || false,
      };
    }, '提醒设置已自动保存并生效', 400);
  };

  // 主题包开关：最多启用一个；传空字符串表示全部关闭、恢复默认主题
  const selectTheme = (themeId) => {
    setActiveTheme(themeId);
    persistSettings((nextSettings) => {
      if (themeId) nextSettings.active_theme = themeId;
      else delete nextSettings.active_theme;
    }, themeId ? '主题已切换并立即生效' : '已恢复默认主题');
  };

  // 插件启用/停用：写入 settings.plugins_enabled，主进程随即启停插件并重载主界面
  const refreshPlugins = useCallback(() => {
    ipcRenderer.invoke('list-plugins').then((data) => {
      setPluginList(Array.isArray(data?.plugins) ? data.plugins : []);
    }).catch((error) => console.error('读取插件列表失败:', error));
  }, []);

  const togglePlugin = (plugin, enabled) => {
    setPluginList((list) => list.map((item) => (
      item.id === plugin.id ? { ...item, enabled } : item
    )));
    persistSettings((nextSettings) => {
      if (!nextSettings.plugins_enabled || typeof nextSettings.plugins_enabled !== 'object') {
        nextSettings.plugins_enabled = {};
      }
      if (enabled) nextSettings.plugins_enabled[plugin.id] = true;
      else delete nextSettings.plugins_enabled[plugin.id];
    }, enabled ? `插件“${plugin.name}”已启用并立即生效` : `插件“${plugin.name}”已停用`);
    // 主进程写入设置后才真正启停插件：稍后回读列表，保证插件设置界面能连上插件通道
    setTimeout(refreshPlugins, 600);
  };

  return (
    <>
      <TitleBar title="软件设置" />
      <div className={`app ss-app app-shell${navCollapsed ? ' nav-collapsed' : ''}`}>
        <aside className="nav-sidebar">
          <div className="nav-rail-top">
            <button
              type="button"
              className="nav-toggle"
              title={navCollapsed ? '展开菜单' : '折叠菜单'}
              aria-label={navCollapsed ? '展开菜单' : '折叠菜单'}
              onClick={toggleNav}
            >
              <Svg size={18} viewBox="0 0 20 20" html={ICONS.menu} strokeWidth={1.6} />
            </button>
            <span className="nav-rail-brand">软件设置</span>
          </div>
          <nav className="nav-list">
            {NAV_ITEMS.map((item) => (
              item.divider ? (
                <hr key="nav-divider" className="nav-divider" />
              ) : (
                <button
                  type="button"
                  key={item.page}
                  className={`nav-item${activePage === item.page ? ' active' : ''}`}
                  title={item.label}
                  onClick={() => openPage(item.page)}
                >
                  <Svg size={24} viewBox="0 0 24 24" html={item.icon} />
                  <span className="nav-label">{item.label}</span>
                </button>
              )
            ))}
          </nav>
        </aside>

        <div className="shell-body">
          <div className="shell-scroll">
            <main className="main-content">
            <section className={`ss-page${activePage === 'basic' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">基础设置</h1>
                <p className="page-intro">调整课表窗口的显示方式和倒计时。</p>
              </div>
              <div className="panel">
                <h3>启动</h3>
                <div className="settings-grid">
                  <div className="field">
                    <Switch
                      checked={launchSettings.autoLaunch}
                      onChange={(_event, data) => changeLaunchSetting('autoLaunch', data.checked === true)}
                      label="开机启动"
                    />
                    <p className="field-help">登录后自动启动课表条。</p>
                  </div>
                  <div className="field">
                    <Switch
                      checked={launchSettings.highPriority}
                      disabled={!launchSettings.autoLaunch}
                      onChange={(_event, data) => changeLaunchSetting('highPriority', data.checked === true)}
                      label="高优先级启动"
                    />
                    <p className="field-help">
                      {launchSettings.autoLaunch
                        ? '进入桌面（资源管理器加载完成）之前就启动课表，进入桌面后立即可见；以最高权限运行。'
                        : '需先开启“开机启动”后才能设置。'}
                    </p>
                  </div>
                </div>
                {launchHint && <p className="field-help">{launchHint}</p>}
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
                <h3>学期与轮换</h3>
                <div className="settings-grid">
                  <div className="field">
                    <label htmlFor="semesterStartDateInput">开学日期</label>
                    <Input
                      id="semesterStartDateInput"
                      type="date"
                      value={semesterStartDate}
                      onChange={(event) => changeSemesterStartDate(event.target.value)}
                    />
                    <p className="field-help">开学当天记为第 1 周，每周一自动推进；课表内轮换与多课表轮换的周数均按此推算。</p>
                  </div>
                  <div className="field">
                    <label htmlFor="rotationOffsetInput">轮换偏移</label>
                    {ROTATION_WEEK_COUNTS.map((weeks) => (
                      <div key={weeks} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ flex: '0 0 64px', fontSize: 12.5, color: 'var(--muted)' }}>
                          {weeks === 2 ? '二周轮换' : weeks === 3 ? '三周轮换' : '四周轮换'}
                        </span>
                        <Select
                          id={`rotationOffset${weeks}`}
                          value={String(currentEffectiveWeek(weeks, rotationOffsets))}
                          onChange={(event) => changeRotationOffset(weeks, Number(event.target.value))}
                        >
                          {Array.from({ length: weeks }, (_, index) => (
                            <option key={index} value={index}>第 {index + 1} 周</option>
                          ))}
                        </Select>
                      </div>
                    ))}
                    <p className="field-help">分别校准二/三/四周轮换：显示本周实际按第几周轮换，若不符选择本周周次即可，双周/三周/四周互不影响，对所有课表内轮换和多课表轮换生效。</p>
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
                    onChange={(event) => changePositionMode(event.target.value)}
                  >
                    <option value="top">顶部居中</option>
                    <option value="top-right">顶部靠右</option>
                    <option value="right">右侧竖排</option>
                  </Select>
                  <p className="field-help">控制课表条在屏幕上的排列位置：顶部居中、顶部靠右（每行右对齐），或右侧竖排（各行从右到左、行内组件自上而下），选择后立即生效并自动保存。</p>
                </div>
                <div className="field">
                  <label htmlFor="countdownStyleSelect">倒计时样式</label>
                  <Select
                    id="countdownStyleSelect"
                    value={countdownStyle}
                    disabled={positionMode === 'right'}
                    onChange={(event) => changeCountdownStyle(event.target.value)}
                  >
                    <option value="floating">下方弹出悬浮倒计时</option>
                    <option value="inline">内嵌倒计时（课程格内展开）</option>
                  </Select>
                  <p className="field-help">
                    {positionMode === 'right'
                      ? '右侧竖排模式下固定使用内嵌倒计时，无法单独设置。'
                      : '“下方弹出悬浮”在课表下方弹出倒计时框；“内嵌”在当前课程/课间格内展开倒计时。课表行下方还有其它组件时始终内嵌，避免遮挡。'}
                  </p>
                </div>
              </div>

              <div className="panel">
                <h3>深浅色</h3>
                <div className="field">
                  <label htmlFor="themeModeSelect">主题模式</label>
                  <Select
                    id="themeModeSelect"
                    value={themeMode}
                    onChange={(event) => changeThemeMode(event.target.value)}
                  >
                    <option value="auto">跟随系统</option>
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                  </Select>
                  <p className="field-help">控制主界面课表条和所有设置窗口的深浅色，选择后立即生效并自动保存。</p>
                </div>
              </div>

              <div className="panel">
                <h3>快捷方式</h3>
                <div className="field">
                  <Button
                    onClick={() => ipcRenderer.invoke('create-desktop-shortcut')}
                  >
                    创建桌面快捷方式
                  </Button>
                  <p className="field-help">在桌面创建 eSchedule 的快捷方式，方便快速启动。</p>
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
                pluginComponents={pluginList
                  .filter((plugin) => plugin.enabled)
                  .flatMap((plugin) => plugin.components || [])}
              />
            </section>

            <section className={`ss-page${activePage === 'appearance' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">外观</h1>
                <p className="page-intro">调整主界面样式参数，只需填写数字（长度单位 px 会自动添加），修改后立即生效。</p>
              </div>
              <div className="panel">
                <h3>样式参数</h3>
                <div className="settings-grid">
                  {CSS_VAR_SPECS.map((spec) => (
                    <div className="field" key={spec.var}>
                      <label htmlFor={`cssVar-${spec.var}`}>{spec.label}</label>
                      <div className="unit-field">
                        <Input
                          id={`cssVar-${spec.var}`}
                          type={spec.unit === 'px' ? 'text' : 'number'}
                          inputMode="decimal"
                          step={spec.unit === 'px' ? undefined : '0.1'}
                          min={spec.unit === 'px' ? undefined : 0}
                          max={spec.unit === 'px' ? undefined : 1}
                          placeholder={spec.unit === 'px' ? '如 8 或 8 14' : '0 - 1'}
                          value={cssStyleObj[spec.var] || ''}
                          onChange={(event) => {
                            // 长度框只允许数字、小数点、负号和空格；单位 px 不允许手输
                            const v = spec.unit === 'px'
                              ? event.target.value.replace(/[^\d.\s-]/g, '')
                              : event.target.value;
                            setCssStyleObj((prev) => {
                              const next = { ...prev };
                              if (v === '') delete next[spec.var];
                              else next[spec.var] = v;
                              return next;
                            });
                          }}
                        />
                        {spec.unit === 'px' && <span className="unit-suffix">px</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="field-help">内边距等需要两个数值的参数，用空格分隔（如“8 14”）；留空则恢复默认值。</p>
              </div>
            </section>

            <section className={`ss-page${activePage === 'themes' ? ' active' : ''}`}>
              <ThemePacksPage
                activeTheme={activeTheme}
                onSelectTheme={selectTheme}
              />
            </section>

            <section className={`ss-page${activePage === 'plugins' ? ' active' : ''}`}>
              <PluginsPage
                pluginList={pluginList}
                onTogglePlugin={togglePlugin}
                onStatus={setStatus}
              />
            </section>

            <section className={`ss-page${activePage === 'security' ? ' active' : ''}`}>
              <SecurityPage onStatus={setStatus} settingsRef={settingsRef} />
            </section>

            <section className={`ss-page${activePage === 'weather' ? ' active' : ''}`}>
              <WeatherPage onStatus={setStatus} />
            </section>

            <section className={`ss-page${activePage === 'reminder' ? ' active' : ''}`}>
              <div className="page-header">
                <h1 className="page-title">提醒</h1>
                <p className="page-intro">在主界面课表条上触发提醒遮罩；每个提醒提供方都可以单独启停，点击卡片进入详情配置。</p>
              </div>

              {/* 总开关：关闭后所有提醒提供方一律不触发 */}
              <div className={`panel reminder-master${reminderEnabled ? '' : ' is-off'}`}>
                <div className="reminder-master-row">
                  <div>
                    <h3>启用提醒</h3>
                    <p className="field-help">启用提醒后，将会在对应事件发生时发出提醒；关闭后所有提醒提供方一律不触发，高级设置也不生效。</p>
                  </div>
                  <Switch
                    checked={reminderEnabled}
                    onChange={(e, d) => {
                      setReminderEnabled(d.checked);
                      persistReminder(undefined, undefined, { enabled: d.checked });
                    }}
                  />
                </div>
              </div>

              {/* 提醒提供方 / 高级设置 */}
              <div className={`panel${reminderEnabled ? '' : ' panel-disabled'}`}>
                <div className="sub-tabs" role="tablist">
                  {[
                    { key: 'providers', label: '提醒提供方' },
                    { key: 'advanced', label: '高级设置' },
                  ].map((tab) => (
                    <button
                      type="button"
                      key={tab.key}
                      role="tab"
                      aria-selected={reminderSectionTab === tab.key}
                      className={`sub-tab${reminderSectionTab === tab.key ? ' active' : ''}`}
                      onClick={() => { setReminderSectionTab(tab.key); setOpenProvider(null); }}
                    >{tab.label}</button>
                  ))}
                </div>

                {reminderSectionTab === 'providers' && !openProvider && (
                  <div className="reminder-provider-list">
                    <div
                      className="reminder-provider-row"
                      role="button"
                      tabIndex={0}
                      title="点击进入配置"
                      onClick={() => setOpenProvider('class')}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenProvider('class'); } }}
                    >
                      <span className="reminder-provider-icon" aria-hidden="true">🎓</span>
                      <div className="reminder-provider-text">
                        <strong>上下课提醒</strong>
                        <span>在准备上课、上课和下课时发出提醒，并预告下一节课。</span>
                      </div>
                      <Switch
                        checked={!!(reminderClass.upcoming_enabled || reminderClass.start_enabled || reminderClass.end_enabled)}
                        aria-label="上下课提醒"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(_e, d) => {
                          const next = { ...reminderClass, upcoming_enabled: d.checked, start_enabled: d.checked, end_enabled: d.checked };
                          setReminderClass(next);
                          persistReminder(next);
                        }}
                      />
                      <span className="plugin-enter" aria-hidden="true">›</span>
                    </div>

                    <div
                      className="reminder-provider-row"
                      role="button"
                      tabIndex={0}
                      title="点击进入配置"
                      onClick={() => setOpenProvider('dismissal')}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenProvider('dismissal'); } }}
                    >
                      <span className="reminder-provider-icon" aria-hidden="true">🚸</span>
                      <div className="reminder-provider-text">
                        <strong>放学提醒</strong>
                        <span>在当天最后一节课结束后发出提醒，可自定义提醒文字与持续时间。</span>
                      </div>
                      <Switch
                        checked={reminderDismissal.enabled === true}
                        aria-label="放学提醒"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(_e, d) => {
                          const next = { ...reminderDismissal, enabled: d.checked };
                          setReminderDismissal(next);
                          persistReminder(undefined, undefined, { dismissal: next });
                        }}
                      />
                      <span className="plugin-enter" aria-hidden="true">›</span>
                    </div>

                    <div
                      className="reminder-provider-row"
                      role="button"
                      tabIndex={0}
                      title="点击进入配置"
                      onClick={() => setOpenProvider('weather')}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenProvider('weather'); } }}
                    >
                      <span className="reminder-provider-icon" aria-hidden="true">⛅</span>
                      <div className="reminder-provider-text">
                        <strong>天气预警</strong>
                        <span>按设定时间播报当天天气，并在出现极端天气时预警；城市在【天气】页面设置。</span>
                      </div>
                      <Switch
                        checked={reminderWeather.enabled === true}
                        aria-label="天气预警"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(_e, d) => {
                          const next = { ...reminderWeather, enabled: d.checked };
                          setReminderWeather(next);
                          persistReminder(undefined, undefined, { weather: next });
                        }}
                      />
                      <span className="plugin-enter" aria-hidden="true">›</span>
                    </div>

                    <div
                      className="reminder-provider-row"
                      role="button"
                      tabIndex={0}
                      title="点击进入配置"
                      onClick={() => setOpenProvider('custom')}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenProvider('custom'); } }}
                    >
                      <span className="reminder-provider-icon" aria-hidden="true">✏️</span>
                      <div className="reminder-provider-text">
                        <strong>自定义文本提醒</strong>
                        <span>在指定时间显示自定义文字的提醒，可设置颜色与持续时间。</span>
                      </div>
                      <span className="reminder-provider-meta">{reminderCustom.length} 条</span>
                      <span className="plugin-enter" aria-hidden="true">›</span>
                    </div>
                  </div>
                )}

                {reminderSectionTab === 'providers' && openProvider && (
                  <div className="plugin-detail-bar">
                    <Button
                      className="win-small"
                      icon={<Svg size={16} viewBox="0 0 24 24" html={ICONS.back} strokeWidth={1.7} />}
                      onClick={() => setOpenProvider(null)}
                    >返回提醒提供方</Button>
                  </div>
                )}

                <div className={`sub-page${openProvider === 'class' ? ' active' : ''}`}>
                  <p className="field-help">在即将上课、上课、下课时自动触发遮罩提醒，绿色=上课/即将上课，黄色=下课。遮罩文字显示在强提醒遮罩上；提醒文字显示在次级提醒中，启用语音时朗读提醒文字。</p>
                  {CLASS_REMINDER_DEFS.map((def) => {
                    const enabledKey = `${def.key}_enabled`;
                    const voiceKey = `${def.key}_voice`;
                    const textKey = `${def.key}_text`;
                    const maskKey = `${def.key}_mask_text`;
                    const enabled = reminderClass[enabledKey] || false;
                    const update = (patch) => {
                      const next = { ...reminderClass, ...patch };
                      setReminderClass(next);
                      persistReminder(next);
                    };
                    return (
                      <div className="reminder-item-card" key={def.key}>
                        <div className="reminder-item-head">
                          <div className="reminder-item-heading">
                            <div className="reminder-item-title">{def.title}</div>
                            <p className="field-help">{def.desc}</p>
                          </div>
                          <Switch
                            checked={enabled}
                            onChange={(_e, d) => update({ [enabledKey]: d.checked === true })}
                          />
                        </div>
                        {enabled && (
                          <div className="reminder-item-body">
                            <label className="checkbox-row">
                              <Checkbox
                                checked={reminderClass[voiceKey] === true}
                                onChange={(_e, d) => update({ [voiceKey]: d.checked === true })}
                              />
                              <span>启用语音</span>
                            </label>
                            {def.key === 'upcoming' && (
                              <div className="field">
                                <label>课前提醒时间（秒）</label>
                                <Input
                                  type="number"
                                  step="1"
                                  value={String(reminderClass.upcoming_seconds ?? 300)}
                                  onChange={(e) => update({ upcoming_seconds: Number(e.target.value) })}
                                />
                                <p className="field-help">距离上课剩余多少秒时提醒</p>
                              </div>
                            )}
                            <div className="field">
                              <label>提醒文字（次级提醒）</label>
                              <Input
                                type="text"
                                placeholder={def.defaultText}
                                value={reminderClass[textKey] || ''}
                                onChange={(e) => update({ [textKey]: e.target.value })}
                              />
                              <p className="field-help">强提醒结束后显示在课表组件上的次级提醒文字；启用语音时朗读该文字。</p>
                            </div>
                            <div className="field">
                              <label>遮罩文字</label>
                              <Input
                                type="text"
                                placeholder={def.defaultText}
                                value={reminderClass[maskKey] || ''}
                                onChange={(e) => update({ [maskKey]: e.target.value })}
                              />
                              <p className="field-help">强提醒遮罩上显示的大字；留空时使用提醒文字。</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className={`sub-page${openProvider === 'dismissal' ? ' active' : ''}`}>
                  <p className="field-help">当天最后一节课结束后发出提醒，每天都可触发一次（按自然日去重）。</p>
                  <div className="settings-grid">
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderDismissal.enabled === true}
                          onChange={(_e, d) => {
                            const next = { ...reminderDismissal, enabled: d.checked };
                            setReminderDismissal(next);
                            persistReminder(undefined, undefined, { dismissal: next });
                          }}
                        />
                        启用放学提醒
                      </label>
                    </div>
                    <div className="field">
                      <label>提醒文字</label>
                      <Input
                        value={reminderDismissal.text || ''}
                        placeholder="放学了，路上注意安全"
                        onChange={(e) => {
                          const next = { ...reminderDismissal, text: e.target.value };
                          setReminderDismissal(next);
                          persistReminder(undefined, undefined, { dismissal: next });
                        }}
                      />
                    </div>
                    <div className="field">
                      <label>持续时间（毫秒）</label>
                      <Input
                        type="number"
                        min={1000}
                        max={60000}
                        step={1000}
                        value={String(reminderDismissal.duration || 6000)}
                        onChange={(e) => {
                          const next = { ...reminderDismissal, duration: Number(e.target.value) || 6000 };
                          setReminderDismissal(next);
                          persistReminder(undefined, undefined, { dismissal: next });
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className={`sub-page${openProvider === 'custom' ? ' active' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p className="field-help" style={{ margin: 0 }}>每天到指定时间触发提醒，可设多条。遮罩从课表中央扩散展开并显示文字。</p>
                    <Button className="win-small" onClick={() => {
                      const id = `rc-${Date.now()}`;
                      const updated = [...reminderCustom, { id, time: '12:00', text: '', color: '#114514', duration: 5000 }];
                      setReminderCustom(updated);
                      persistReminder(undefined, updated);
                    }}>新增</Button>
                  </div>
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
                            onChange={(e) => {
                              const updated = reminderCustom.map((it, j) => j === i ? { ...it, time: e.target.value } : it);
                              setReminderCustom(updated);
                              persistReminder(undefined, updated);
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>提醒文字</label>
                          <Input
                            type="text"
                            value={item.text || ''}
                            onChange={(e) => {
                              const updated = reminderCustom.map((it, j) => j === i ? { ...it, text: e.target.value } : it);
                              setReminderCustom(updated);
                              persistReminder(undefined, updated);
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>遮罩颜色</label>
                          <input
                            type="color"
                            className="native-color"
                            value={item.color || accentColor || '#0078d4'}
                            title="取色过程中不会保存，关闭取色器或点击其它位置后才保存；未自定义时跟随系统强调色"
                            onChange={(e) => {
                              // 取色过程中只更新界面，不落盘：否则每动一下就会被保存导致取色器关闭
                              const updated = reminderCustom.map((it, j) => j === i ? { ...it, color: e.target.value } : it);
                              setReminderCustom(updated);
                            }}
                            onBlur={() => persistReminder(undefined, reminderCustom)}
                            onKeyUp={(e) => { if (e.key === 'Enter') persistReminder(undefined, reminderCustom); }}
                          />
                        </div>
                        <div className="field">
                          <label>持续毫秒</label>
                          <Input
                            type="number"
                            step="100"
                            value={String(item.duration ?? 5000)}
                            onChange={(e) => {
                              const updated = reminderCustom.map((it, j) => j === i ? { ...it, duration: Number(e.target.value) } : it);
                              setReminderCustom(updated);
                              persistReminder(undefined, updated);
                            }}
                          />
                        </div>
                        <div className="field" style={{ alignSelf: 'flex-end' }}>
                          <Button className="win-small" onClick={() => {
                            const updated = reminderCustom.filter((_, j) => j !== i);
                            setReminderCustom(updated);
                            persistReminder(undefined, updated);
                          }}>删除</Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className={`sub-page${openProvider === 'weather' ? ' active' : ''}`}>
                  <div className="settings-grid">
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderWeather.enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderWeather, enabled: d.checked };
                            setReminderWeather(next);
                            persistReminder(undefined, undefined, { weather: next });
                          }}
                        />
                        启用每日天气提醒
                      </label>
                    </div>
                    <div className="field">
                      <label htmlFor="rwTime">播报时间</label>
                      <Input
                        id="rwTime"
                        type="text"
                        placeholder="HH:MM"
                        value={reminderWeather.time || '07:00'}
                        onChange={(e) => {
                          const next = { ...reminderWeather, time: e.target.value };
                          setReminderWeather(next);
                          persistReminder(undefined, undefined, { weather: next });
                        }}
                      />
                      <p className="field-help">每天到该时间播报一次天气</p>
                    </div>
                    <div className="field">
                      <label>城市</label>
                      <p className="field-help" style={{ margin: 0 }}>
                        天气提醒使用【天气】页面设置的位置（当前为 {reminderWeather.city || '自动定位'}）；
                        如需更换城市或改用坐标定位，请到【天气】页面调整。极端天气预警会跳过【天气】页面中“排除的气象预警”关键词。
                      </p>
                    </div>
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderWeather.extreme_enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderWeather, extreme_enabled: d.checked };
                            setReminderWeather(next);
                            persistReminder(undefined, undefined, { weather: next });
                          }}
                        />
                        极端天气提醒
                      </label>
                      <p className="field-help">每 10 分钟检测一次，遇到大雨、冻雨、大雪、强阵雨、雷暴等极端天气立即提醒，同一种天气每天最多提醒一次。</p>
                    </div>
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderWeather.quake_enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderWeather, quake_enabled: d.checked };
                            setReminderWeather(next);
                            persistReminder(undefined, undefined, { weather: next });
                          }}
                        />
                        地震预警
                      </label>
                      <p className="field-help">每分钟比对中国地震台网速报，新发布的 4.0 级以上、30 分钟内发生的地震立即提醒，按事件编号去重不重复通知。</p>
                    </div>
                  </div>
                  <p className="field-help">每日播报内容形如"太原 12° 晴"；遇到雨、雪、雷、雾等天气时文案会追加"注意天气变化"提示。</p>
                </div>
              </div>

              {/* 高级设置：音效 / 置顶 / 全屏，二级菜单切换 */}
              <div className={`panel${reminderEnabled ? '' : ' panel-disabled'}`} style={{ display: reminderSectionTab === 'advanced' ? '' : 'none' }}>
                <h3>高级设置</h3>
                <div className="sub-tabs" role="tablist">
                  {[
                    { key: 'sound', label: '提醒音效' },
                    { key: 'ontop', label: '提醒置顶' },
                    { key: 'fullscreen', label: '全屏提醒' },
                  ].map((tab) => (
                    <button
                      type="button"
                      key={tab.key}
                      className={`sub-tab${reminderAdvancedTab === tab.key ? ' active' : ''}`}
                      onClick={() => setReminderAdvancedTab(tab.key)}
                    >{tab.label}</button>
                  ))}
                </div>

                <div className={`sub-page${reminderAdvancedTab === 'sound' ? ' active' : ''}`}>
                  <div className="settings-grid">
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderAdvanced.sound_enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderAdvanced, sound_enabled: d.checked };
                            setReminderAdvanced(next);
                            persistReminder(undefined, undefined, { advanced: next });
                          }}
                        />
                        提醒时播放音效
                      </label>
                    </div>
                    <div className="field">
                      <label htmlFor="rwSoundSource">声音来源</label>
                      <Select
                        id="rwSoundSource"
                        value={reminderAdvanced.sound_source === 'custom' ? 'custom' : 'builtin'}
                        onChange={(e) => {
                          const next = { ...reminderAdvanced, sound_source: e.target.value };
                          setReminderAdvanced(next);
                          persistReminder(undefined, undefined, { advanced: next });
                        }}
                      >
                        <option value="builtin">内置提示音（叮咚）</option>
                        <option value="custom">自定义音频文件</option>
                      </Select>
                    </div>
                    {reminderAdvanced.sound_source === 'custom' ? (
                      <div className="field">
                        <label>音频文件</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Input
                            type="text"
                            readOnly
                            placeholder="点击右侧选择 mp3 / wav 文件"
                            value={reminderAdvanced.sound_file || ''}
                            style={{ flex: 1 }}
                          />
                          <Button className="win-small" onClick={async () => {
                            const picked = await ipcRenderer.invoke('select-reminder-sound');
                            if (picked) {
                              const next = { ...reminderAdvanced, sound_file: picked };
                              setReminderAdvanced(next);
                              persistReminder(undefined, undefined, { advanced: next });
                            }
                          }}>选择</Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="field" style={{ alignSelf: 'flex-end' }}>
                      <Button className="win-small" onClick={() => previewReminderSound(reminderAdvanced)}>试听</Button>
                    </div>
                  </div>
                </div>

                <div className={`sub-page${reminderAdvancedTab === 'ontop' ? ' active' : ''}`}>
                  <div className="settings-grid">
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderAdvanced.ontop_enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderAdvanced, ontop_enabled: d.checked };
                            setReminderAdvanced(next);
                            persistReminder(undefined, undefined, { advanced: next });
                          }}
                        />
                        提醒期间窗口置顶
                      </label>
                      <p className="field-help">提醒弹出的几秒钟内把课表窗口临时提到最前，结束后自动恢复原来的置顶设置。</p>
                    </div>
                  </div>
                </div>

                <div className={`sub-page${reminderAdvancedTab === 'fullscreen' ? ' active' : ''}`}>
                  <div className="settings-grid">
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Switch
                          checked={reminderAdvanced.fullscreen_enabled || false}
                          onChange={(e, d) => {
                            const next = { ...reminderAdvanced, fullscreen_enabled: d.checked };
                            setReminderAdvanced(next);
                            persistReminder(undefined, undefined, { advanced: next });
                          }}
                        />
                        全屏提醒
                      </label>
                      <p className="field-help">在普通提醒（课表条遮罩与文字）的基础上，额外在全屏叠加一层提醒颜色的光效：从课表条位置向全屏扩散，持续 1 秒（前 0.3 秒渐显扩散、后 0.7 秒渐隐），与提醒时长无关；光效窗口点击穿透，不影响正常操作。</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={`ss-page${activePage === 'automation' ? ' active' : ''}`}>
              <AutomationPage
                automationRules={automationRules}
                onChange={(next) => {
                  setAutomationRules(next);
                  persistSettings((s) => { s.automation_rules = next; }, '自动化规则已保存');
                }}
              />
            </section>

            </main>
          </div>
          <div className="shell-status" aria-live="polite">{status}</div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<SoftwareSettingsRoot />);

function SoftwareSettingsRoot() {
  // 主题包（Theme 文件夹）加载
  useThemePack();
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
