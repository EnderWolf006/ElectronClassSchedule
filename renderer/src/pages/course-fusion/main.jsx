import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox } from '@fluentui/react-components';
import { AppTheme } from '../../common/theme.jsx';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { query } from '../../common/query.js';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './course-fusion.css';

// 只能融合主窗当前正在加载的课表（使用“加载临时课表”时即为临时日程）
const initialDayIndex = Number(query.get('dayIndex'));
const dayIndex = Number.isInteger(initialDayIndex) ? initialDayIndex : 0;
const isTemporary = query.get('temp') === '1';

function CourseFusionApp() {
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState([]);
  const [target, setTarget] = useState(null);
  const [ignoreBreak, setIgnoreBreak] = useState(false);
  const [status, setStatus] = useState('');

  const days = Array.isArray(config?.daily_class) ? config.daily_class : [];
  const currentDay = days[dayIndex] || null;
  const classList = Array.isArray(currentDay?.classList) ? currentDay.classList : [];
  const hasLessons = !!currentDay && classList.length > 0;

  // “融合成”的可选范围：课表配置编辑器“科目名称”页中列举的所有科目
  const subjectEntries = Object.entries(config?.subject_name || {}).filter(([key]) => key !== '');

  const subjectName = (value) => config?.subject_name?.[value] || value || '未知课程';
  const displayValue = (value) => (
    Array.isArray(value) ? value.map(subjectName).join(' / ') : subjectName(value)
  );

  useEffect(() => {
    let cancelled = false;
    ipcRenderer.invoke('read-config-file').then((data) => {
      if (cancelled) return;
      setConfig(data);
      const list = Array.isArray(data?.daily_class?.[dayIndex]?.classList)
        ? data.daily_class[dayIndex].classList
        : [];
      setStatus(list.length ? '请选择两节课作为融合范围。' : '当前加载的课表中没有可融合的课程。');
    }).catch(() => {
      if (!cancelled) {
        setLoadError(true);
        setStatus('读取课程配置失败。');
      }
    });
    return () => { cancelled = true; };
  }, []);

  const selectLesson = (index) => {
    let next;
    if (selected.length === 2 && !selected.includes(index)) {
      next = [];
    } else if (selected.includes(index)) {
      next = selected.filter((item) => item !== index);
    } else {
      next = [...selected, index];
    }
    next.sort((a, b) => a - b);
    setSelected(next);
    setTarget(null);
    if (next.length !== 2) {
      setStatus('请选择两节课作为融合范围。');
      return;
    }
    setStatus(`已选择第 ${next[0] + 1} 节至第 ${next[1] + 1} 节，请选择融合成的科目。`);
  };

  const choicesVisible = selected.length === 2;
  const canApply = choicesVisible && target !== null;

  const applyFusion = () => {
    if (!canApply) return;
    const [start, end] = selected;
    ipcRenderer.send('course-fusion-result', {
      dayIndex,
      start,
      end,
      target,
      ignoreBreak,
    });
    setStatus('融合已应用到当前课表。');
  };

  const resetFusion = () => {
    ipcRenderer.send('course-fusion-result', null);
    setStatus('已恢复原课表。');
  };

  const dayLabel = currentDay?.Chinese || `日程 ${dayIndex + 1}`;
  const dayEnglish = currentDay?.English || '';

  return (
    <>
      <TitleBar title="课程融合" />
      <main className="fusion-app">
        <p className="fusion-intro">
          以下为主界面当前加载的课表{isTemporary ? '（临时课表）' : ''}，选择其中两节课，融合区间内的课程会显示为一节。此操作仅在本次运行中生效，重启后自动恢复。
        </p>
        <section className="fusion-panel">
          <div className="fusion-current">
            <span className="fusion-field-label">当前课表</span>
            <strong>
              {dayLabel}{dayEnglish ? ` · ${dayEnglish}` : ''}
              {isTemporary && <em className="fusion-temp-tag">临时</em>}
            </strong>
          </div>

          {hasLessons ? (
            <div className="lessons">
              {classList.map((value, index) => (
                <button
                  type="button"
                  key={index}
                  className={`lesson${selected.includes(index) ? ' selected' : ''}`}
                  onClick={() => selectLesson(index)}
                >
                  <small>第 {index + 1} 节</small>
                  {displayValue(value)}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty fusion-empty">当前加载的课表中没有可融合的课程。</div>
          )}

          <div className={`choices${choicesVisible ? ' visible' : ''}`}>
            <label className="fusion-field-label">融合成哪一科目</label>
            <p className="fusion-intro" style={{ margin: '4px 0 10px' }}>
              可选项来自“课表配置编辑器 - 科目名称”中配置的全部科目，融合区间内的课程将统一显示为所选科目。
            </p>
            <div className="target-list">
              {subjectEntries.length === 0 ? (
                <div className="empty fusion-empty">“科目名称”中暂无科目，请先在课表配置编辑器中添加。</div>
              ) : subjectEntries.map(([shortName, fullName]) => (
                <button
                  type="button"
                  key={shortName}
                  className={`target${target === shortName ? ' selected' : ''}`}
                  onClick={() => { setTarget(shortName); }}
                >
                  <input type="radio" readOnly checked={target === shortName} tabIndex={-1} />
                  {displayValue(shortName)}
                  {fullName ? `：${fullName}` : ''}
                </button>
              ))}
            </div>
            <label className="fusion-option">
              <Checkbox checked={ignoreBreak} onChange={(event, data) => setIgnoreBreak(data.checked)} />
              忽略融合区间内的下课时间
            </label>
          </div>

          <div className="fusion-status">{status}</div>
          <div className="fusion-actions">
            <Button onClick={resetFusion}>恢复原课表</Button>
            <Button className="win-primary fusion-apply" appearance="primary" disabled={!canApply || loadError || !hasLessons} onClick={applyFusion}>
              应用融合
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <AppTheme>
    <CourseFusionApp />
  </AppTheme>,
);
