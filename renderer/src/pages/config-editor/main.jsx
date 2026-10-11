import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input } from '@fluentui/react-components';
import { AppTheme } from '../../common/theme.jsx';
import { useThemePack } from '../../common/themePack.js';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { Svg, ICONS } from '../../common/icons.jsx';
import SubjectPage from './SubjectPage.jsx';
import TimetablePage from './TimetablePage.jsx';
import DailyPage from './DailyPage.jsx';
import {
  collectTimetableCards,
  createCardId,
  getInvalidCardIndexes,
  getTimetableSlotCount,
  mergeImportedTimetable,
  migrateLegacyDividers,
  parseTimetableEntry,
  sortCardsByTime,
} from './config-utils.js';
import { csesToConfig, configToCses } from './cses.js';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './config-editor.css';

const NAV_ITEMS = [
  { page: 'subject', label: '科目名称', icon: ICONS.subject },
  { page: 'timetable', label: '时间表', icon: ICONS.timetable },
  { page: 'daily', label: '课表', icon: ICONS.daily },
];

// 每天加载配置（daily_rotation_mode 每天轮换模式 / daily_rotation 每天轮换序列）
// 由本编辑器维护并随“保存到 scheduleConfig.js”一起落盘。旧版在 settings.js 保存
// “整周多课表轮换”（rotation_mode==='multi' + multi_rotation_entries），在此幂等
// 迁移为 7 天相同序列的多课表轮换。学期级字段（开学日期/轮换偏移）自本版起由
// 软件设置基础设置页维护（settings.js），草稿中清除旧版本迁移残留，避免写回
// scheduleConfig.js 造成两处配置歧义
function applyRotationDefaults(data, settingsData) {
  if (!data || typeof data !== 'object') return;
  const s = settingsData || {};
  if (!data.daily_rotation_mode || typeof data.daily_rotation_mode !== 'object') {
    data.daily_rotation_mode = {};
  }
  if (!data.daily_rotation || typeof data.daily_rotation !== 'object') {
    data.daily_rotation = {};
  }
  const legacyMulti = s.rotation_mode === 'multi';
  const legacyEntries = Array.isArray(s.multi_rotation_entries) ? s.multi_rotation_entries : [];
  if (legacyMulti && legacyEntries.length >= 2
    && Object.keys(data.daily_rotation_mode).length === 0
    && Object.keys(data.daily_rotation).length === 0) {
    for (let day = 0; day <= 6; day += 1) {
      data.daily_rotation_mode[String(day)] = 'multi';
      data.daily_rotation[String(day)] = legacyEntries.slice();
    }
  }
  delete data.rotation_mode;
  delete data.semester_start_date;
  delete data.semester_start_week;
  delete data.rotation_offset;
  delete data.multi_rotation_entries;
}

function ConfigEditorApp() {
  const configRef = useRef(null);
  const settingsRef = useRef(null);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((tick) => tick + 1), []);
  const config = configRef.current;

  const [activePage, setActivePage] = useState('subject');
  const [subjectRows, setSubjectRows] = useState([]);
  const [activeTimetableName, setActiveTimetableName] = useState(null);
  const [ttCards, setTtCards] = useState([]);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [invalidIndexes, setInvalidIndexes] = useState(() => new Set());
  // 时间表“新增/重命名”页内弹窗：{ mode: 'add' | 'rename', oldName, value, error }
  const [nameModal, setNameModal] = useState(null);
  // “导入”来源选择弹窗
  const [importModalOpen, setImportModalOpen] = useState(false);
  // 保存按钮的临时状态提示：保存成功后按钮文字短暂变为“已保存”，不弹窗、不退出编辑器
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const saveStateTimerRef = useRef(null);
  // 左侧导航折叠状态持久化
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('configEditorNavCollapsed') === '1');
  const toggleNav = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('configEditorNavCollapsed', next ? '1' : '0');
      return next;
    });
  }, []);
  const modalInputRef = useRef(null);

  const groupNames = useMemo(
    () => (config && config.timetable ? Object.keys(config.timetable) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, activePage, ttCards],
  );
  const subjectEntries = config && config.subject_name && typeof config.subject_name === 'object'
    ? Object.entries(config.subject_name)
    : [];

  // 从配置读入的卡片同样按开始时间排序，保证打开即为时间顺序
  const cardsFromGroup = (group) => sortCardsByTime(Object.entries(group || {})
    .map(([range, value]) => ({ id: createCardId(), ...parseTimetableEntry(range, value) })));

  // 读取/导入配置时统一迁移：旧版顶层 divider 数字数组写入 timetable 单点时间，
  // 迁移后删除顶层 divider（幂等，覆盖刷新、从 js 导入、从 CSES 导入三条入口）
  const initFromConfig = useCallback((data) => {
    migrateLegacyDividers(data);
    applyRotationDefaults(data, settingsRef.current);
    configRef.current = data;
    const rows = data && data.subject_name && typeof data.subject_name === 'object'
      ? Object.entries(data.subject_name).map(([key, value]) => ({ key, value }))
      : [];
    setSubjectRows(rows);
    const names = data && data.timetable ? Object.keys(data.timetable) : [];
    const firstName = names[0] || null;
    setActiveTimetableName(firstName);
    setTtCards(firstName ? cardsFromGroup(data.timetable[firstName]) : []);
    setActiveDayIndex(0);
    setInvalidIndexes(new Set());
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  const updateCards = (next) => {
    setTtCards(next);
    setInvalidIndexes(new Set());
    syncDailySlotCounts(next, activeTimetableName);
  };

  // 时间表“课程”卡片数变化后，立即同步“课表”页引用该时间表的节次行数（无需保存）：
  // 按卡片类型统计课程数（不看时间有效性，避免编辑中途的临时无效时间误删行）；
  // 课程数增加 → 末尾补空栏；课程数减少 → 强制截掉末尾多余的节次（即使该节已有课程）。
  const syncDailySlotCounts = (cards, timetableName) => {
    const data = configRef.current;
    if (!data || !Array.isArray(data.daily_class) || !timetableName) return;
    const expectedCount = (Array.isArray(cards) ? cards : [])
      .filter((card) => card && card.type === 'class').length;
    data.daily_class.forEach((day) => {
      if (!day || day.timetable !== timetableName) return;
      const classList = Array.isArray(day.classList) ? day.classList : [];
      if (classList.length === expectedCount) return;
      const nextClassList = classList.slice(0, expectedCount);
      while (nextClassList.length < expectedCount) nextClassList.push('');
      day.classList = nextClassList;
    });
  };

  // 校验并把当前卡片写回 config.timetable（与旧版切换/保存前的收集行为一致）
  const commitActiveTimetable = () => {
    const name = activeTimetableName;
    if (!name || !configRef.current?.timetable
      || !Object.prototype.hasOwnProperty.call(configRef.current.timetable, name)) {
      return { ok: true, group: {} };
    }
    const { group, errors } = collectTimetableCards(ttCards);
    setInvalidIndexes(getInvalidCardIndexes(ttCards));
    if (errors.length) return { ok: false, errors };
    configRef.current.timetable[name] = group;
    return { ok: true, group };
  };

  const switchTimetable = (name) => {
    if (name === activeTimetableName) return;
    const result = commitActiveTimetable();
    if (!result.ok) {
      alert(`当前时间表存在无效时间段，无法切换：\n${result.errors.join('\n')}`);
      return;
    }
    setActiveTimetableName(name);
    setTtCards(cardsFromGroup(configRef.current.timetable[name]));
    setInvalidIndexes(new Set());
  };

  const openAddTimetableModal = () => {
    const groups = configRef.current && configRef.current.timetable ? configRef.current.timetable : {};
    const currentNames = Object.keys(groups);
    let candidate = '新时间表';
    let index = 1;
    while (currentNames.includes(candidate)) {
      candidate = `新时间表${index}`;
      index += 1;
    }
    setNameModal({ mode: 'add', oldName: null, value: candidate, error: '' });
  };

  const openRenameTimetableModal = (oldName) => {
    if (!configRef.current?.timetable
      || !Object.prototype.hasOwnProperty.call(configRef.current.timetable, oldName)) return;
    setNameModal({ mode: 'rename', oldName, value: oldName, error: '' });
  };

  const closeNameModal = () => setNameModal(null);

  const confirmNameModal = () => {
    if (!nameModal) return;
    const trimmedName = String(nameModal.value).trim();
    const currentNames = Object.keys(configRef.current?.timetable || {});
    if (!trimmedName) {
      setNameModal({ ...nameModal, error: '时间表名称不能为空' });
      return;
    }
    if (nameModal.mode === 'add') {
      if (currentNames.includes(trimmedName)) {
        setNameModal({ ...nameModal, error: '时间表名称已存在，请换个名称' });
        return;
      }
      if (!configRef.current.timetable) configRef.current.timetable = {};
      configRef.current.timetable[trimmedName] = {};
      setActiveTimetableName(trimmedName);
      setTtCards([]);
      setInvalidIndexes(new Set());
      setNameModal(null);
      bump();
      return;
    }

    const oldName = nameModal.oldName;
    if (trimmedName === oldName) {
      setNameModal(null);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(configRef.current.timetable, trimmedName)) {
      setNameModal({ ...nameModal, error: '时间表名称已存在，请换个名称' });
      return;
    }

    const renamedTimetables = {};
    Object.entries(configRef.current.timetable).forEach(([name, timetable]) => {
      renamedTimetables[name === oldName ? trimmedName : name] = timetable;
    });
    configRef.current.timetable = renamedTimetables;

    if (Array.isArray(configRef.current.daily_class)) {
      configRef.current.daily_class.forEach((day) => {
        if (day && day.timetable === oldName) day.timetable = trimmedName;
      });
    }
    setActiveTimetableName(trimmedName);
    setTtCards(cardsFromGroup(renamedTimetables[trimmedName]));
    setInvalidIndexes(new Set());
    setNameModal(null);
    bump();
  };

  const addDayCard = () => {
    if (!configRef.current) return;
    const days = Array.isArray(configRef.current.daily_class)
      ? configRef.current.daily_class
      : (configRef.current.daily_class = []);
    const timetableNames = configRef.current.timetable ? Object.keys(configRef.current.timetable) : [];
    const timetable = timetableNames[0] || 'workday';
    const slotCount = getTimetableSlotCount(configRef.current.timetable?.[timetable]);
    days.push({
      Chinese: `新课表${days.length + 1}`,
      English: `NEW${days.length + 1}`,
      classList: Array.from({ length: Math.max(slotCount, 1) }, () => ''),
      timetable,
    });
    setActiveDayIndex(days.length - 1);
    bump();
  };

  const deleteDayCard = (dayIndex) => {
    const cfg = configRef.current;
    if (!cfg?.daily_class) return;
    cfg.daily_class.splice(dayIndex, 1);
    if (Array.isArray(cfg.daily_schedule)) {
      cfg.daily_schedule = cfg.daily_schedule.map((scheduleIndex) => {
        const index = Number(scheduleIndex);
        if (index === dayIndex) return 0;
        return index > dayIndex ? index - 1 : index;
      });
    }
    setActiveDayIndex((current) => Math.max(0, Math.min(current, cfg.daily_class.length - 1)));
    bump();
  };

  const addSlotToDay = (dayIndex) => {
    const day = configRef.current?.daily_class?.[dayIndex];
    if (!day || !Array.isArray(day.classList)) return;
    day.classList.push('');
    bump();
  };

  // 从 CSES（课程表交换格式，ClassIsland/奶酪课程表等可导出）导入：
  // 转换后载入编辑器，检查无误再点击“保存到 scheduleConfig.js”生效
  const importFromCses = () => {
    ipcRenderer.invoke('import-cses-file').then((cses) => {
      if (!cses) return;
      try {
        const converted = csesToConfig(cses, configRef.current);
        initFromConfig(converted);
        alert('已从 CSES 文件导入，请在“时间表/课表”页面核对后点击“保存到 scheduleConfig.js”生效。');
      } catch (error) {
        console.error(error);
        alert(`CSES 导入失败：${error.message || '文件格式无效'}`);
      }
    }).catch((error) => {
      console.error(error);
      alert(`CSES 导入失败：${error.message || '读取文件失败'}`);
    });
  };

  // 导出为 CSES v1（YAML），供 ClassIsland、奶酪课程表等软件导入
  const exportToCses = () => {
    if (!configRef.current) return;
    let result;
    try {
      result = configToCses(configRef.current);
    } catch (error) {
      console.error(error);
      alert(`CSES 导出失败：${error.message || '配置无效'}`);
      return;
    }
    ipcRenderer.invoke('export-cses-file', result.cses).then((filePath) => {
      if (!filePath) return;
      const notice = result.warnings.length
        ? `\n\n需要注意：\n${result.warnings.join('\n')}`
        : '';
      alert(`已导出到：\n${filePath}${notice}`);
    }).catch((error) => {
      console.error(error);
      alert(`CSES 导出失败：${error.message || '写入文件失败'}`);
    });
  };

  const reloadConfig = () => {
    ipcRenderer.invoke('read-config-file').then((data) => {
      initFromConfig(data);
    }).catch((error) => {
      console.error(error);
    });
  };

  const importConfig = () => {
    ipcRenderer.invoke('import-config-file').then((importedConfig) => {
      if (!importedConfig) return;
      initFromConfig(importedConfig);
    }).catch((error) => {
      console.error(error);
      alert(`导入失败：${error.message || '配置文件格式无效'}`);
    });
  };

  // 从表格（Excel / CSV）或图片（Windows OCR）导入：解析结果合并进草稿，
  // 用户核对无误后再点击“保存到 scheduleConfig.js”生效
  const importFromTableOrImage = () => {
    ipcRenderer.invoke('import-schedule-table').then((result) => {
      if (!result) return;
      if (result.error) {
        alert(`导入失败：${result.error}`);
        return;
      }
      const { kind, parsed } = result;
      if (!parsed) return;
      if (kind === 'image'
        && !window.confirm(`已通过 OCR 识别图片，识别结果可能不准确。\n\n${parsed.summary}\n\n导入将替换当前编辑中的课表（未保存的内容会丢失），是否继续？`)) {
        return;
      }
      const merged = mergeImportedTimetable(configRef.current, parsed);
      initFromConfig(merged);
      alert(`已导入：${parsed.summary}。\n请在“时间表 / 课表”页面核对后点击“保存到 scheduleConfig.js”生效。`);
    }).catch((error) => {
      console.error(error);
      alert(`导入失败：${error.message || '读取文件失败'}`);
    });
  };

  const saveConfig = () => {
    if (!configRef.current) return;
    const result = commitActiveTimetable();
    if (!result.ok) {
      alert(`保存失败：${result.errors.join('\n')}`);
      return;
    }
    try {
      const nextConfig = JSON.parse(JSON.stringify(configRef.current));

      // 科目
      const subjectName = {};
      subjectRows.forEach((row) => {
        const key = String(row.key ?? '').trim();
        const value = String(row.value ?? '').trim();
        if (!key) return;
        subjectName[key] = value || key;
      });
      nextConfig.subject_name = subjectName;

      // daily_class / daily_schedule 已在编辑过程中直接写入 draft
      if (!Array.isArray(nextConfig.daily_class) || !nextConfig.daily_class.length) {
        throw new Error('daily_class is empty');
      }

      // 分割线已写入各 timetable 的单点时间条目；旧版顶层 divider 不再落盘
      delete nextConfig.divider;

      setSaveState('saving');
      ipcRenderer.invoke('save-config-file', nextConfig)
        .then(() => {
          configRef.current = nextConfig;
          // 不弹窗、不退出：按钮文字临时变为“已保存”，1.6 秒后恢复
          setSaveState('saved');
          clearTimeout(saveStateTimerRef.current);
          saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1600);
        })
        .catch((error) => {
          console.error(error);
          setSaveState('idle');
          alert('保存失败，请检查配置格式');
        });
    } catch (error) {
      console.error(error);
      alert(`保存失败：${error.message || '配置数据无效，请检查是否删除了所有课时。'}`);
    }
  };

  useEffect(() => {
    Promise.all([
      ipcRenderer.invoke('read-config-file'),
      ipcRenderer.invoke('read-settings-file').catch(() => null),
    ]).then(([data, settingsData]) => {
      settingsRef.current = settingsData;
      initFromConfig(data);
    }).catch((error) => {
      console.error(error);
      alert('读取配置文件失败，无法打开编辑器');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 弹窗打开时自动聚焦并全选名称。
  // 注意：只能在“打开瞬间”执行一次——nameModal 在每次按键时都会产生新对象，
  // 若每次都 select() 全选文本，英文输入时下一个按键会替换掉刚输入的全部内容，
  // 最终只剩最后一个字母（中文输入法在组词期间不受 select 影响，故此前未暴露）。
  const nameModalOpenRef = useRef(false);
  useEffect(() => {
    if (nameModal) {
      if (!nameModalOpenRef.current && modalInputRef.current) {
        modalInputRef.current.focus();
        modalInputRef.current.select();
      }
      nameModalOpenRef.current = true;
    } else {
      nameModalOpenRef.current = false;
    }
  }, [nameModal]);

  return (
    <>
      <TitleBar title="课表配置编辑器" />
      <div className={`app ce-app app-shell${navCollapsed ? ' nav-collapsed' : ''}`}>
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
            <span className="nav-rail-brand">配置</span>
          </div>
          <nav className="nav-list">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.page}
                className={`nav-item${activePage === item.page ? ' active' : ''}`}
                title={item.label}
                onClick={() => setActivePage(item.page)}
              >
                <Svg size={18} viewBox="0 0 20 20" html={item.icon} />
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="shell-body">
          <div className="toolbar-sticky">
            <Button onClick={reloadConfig}>刷新配置</Button>
            <Button onClick={() => setImportModalOpen(true)}>导入</Button>
            <Button onClick={exportToCses}>导出为 CSES</Button>
            <Button
              className="win-primary"
              appearance="primary"
              disabled={saveState === 'saving'}
              onClick={saveConfig}
            >
              {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '保存到 scheduleConfig.js'}
            </Button>
          </div>
          <div className="shell-scroll">
            <main className="main-content">
            <div className={`ce-page${activePage === 'subject' ? ' active' : ''}`}>
              <SubjectPage rows={subjectRows} onChange={setSubjectRows} />
            </div>
            <div className={`ce-page${activePage === 'timetable' ? ' active' : ''}`}>
              <TimetablePage
                groupNames={groupNames}
                activeName={activeTimetableName}
                onSwitch={switchTimetable}
                cards={ttCards}
                onCardsChange={updateCards}
                onAddGroup={openAddTimetableModal}
                onRenameGroup={openRenameTimetableModal}
                invalidIndexes={invalidIndexes}
              />
            </div>
            <div className={`ce-page${activePage === 'daily' ? ' active' : ''}`}>
              <div className="page-header">
                <h2>课表</h2>
                <p>新建并编辑静态课表，再设置每天需要加载的课表。</p>
              </div>
              <DailyPage
                config={config}
                bump={bump}
                activeDayIndex={activeDayIndex}
                setActiveDayIndex={setActiveDayIndex}
                subjectEntries={subjectEntries}
                onAddDay={addDayCard}
                onDeleteDay={deleteDayCard}
                onAddSlot={addSlotToDay}
              />
            </div>
            </main>
          </div>
        </div>
      </div>

      {importModalOpen && (
        <div
          className="ce-modal-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setImportModalOpen(false); }}
        >
          <div className="ce-modal-dialog import-dialog" role="dialog" aria-modal="true">
            <h3 className="ce-modal-title">导入</h3>
            <p className="field-help">请选择导入来源。</p>
            <div className="import-options">
              <button
                type="button"
                className="import-option"
                onClick={() => { setImportModalOpen(false); importConfig(); }}
              >
                <strong>从 Class Schedule 导入</strong>
                <span>导入其他 Class Schedule 实例的 scheduleConfig.js 课表配置文件。</span>
              </button>
              <button
                type="button"
                className="import-option"
                onClick={() => { setImportModalOpen(false); importFromCses(); }}
              >
                <strong>从 CSES 导入</strong>
                <span>导入 CSES 通用课表交换文件（YAML / JSON，ClassIsland、奶酪课程表等支持）。</span>
              </button>
              <button
                type="button"
                className="import-option"
                onClick={() => { setImportModalOpen(false); importFromTableOrImage(); }}
              >
                <strong>从表格 / 图片导入</strong>
                <span>支持 Excel（xlsx / xls）、CSV 表格，或课表截图（使用 Windows OCR 识别，图片结果可能有误需核对）。</span>
              </button>
            </div>
            <div className="ce-modal-actions">
              <Button onClick={() => setImportModalOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {nameModal && (
        <div
          className="ce-modal-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeNameModal(); }}
        >
          <div
            className="ce-modal-dialog"
            role="dialog"
            aria-modal="true"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeNameModal();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                confirmNameModal();
              }
            }}
          >
            <h3 className="ce-modal-title">{nameModal.mode === 'add' ? '新增时间表' : '重命名时间表'}</h3>
            <div className="field">
              <label htmlFor="ceTimetableName">时间表名称</label>
              <Input
                id="ceTimetableName"
                ref={modalInputRef}
                value={nameModal.value}
                onChange={(event) => setNameModal({ ...nameModal, value: event.target.value, error: '' })}
              />
            </div>
            <div className="ce-modal-error" aria-live="polite">{nameModal.error}</div>
            <div className="ce-modal-actions">
              <Button onClick={closeNameModal}>取消</Button>
              <Button className="win-primary" appearance="primary" onClick={confirmNameModal}>确定</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConfigEditorRoot() {
  useThemePack();
  return (
    <AppTheme>
      <ConfigEditorApp />
    </AppTheme>
  );
}

createRoot(document.getElementById('root')).render(<ConfigEditorRoot />);
