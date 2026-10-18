import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Input } from '@fluentui/react-components';
import { AppTheme } from '../../common/theme.jsx';
import { useThemePack } from '../../common/themePack.js';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './early-dismissal.css';

// 与主界面 getRuntimeTodayKey 相同的“当天”日期键（本地时区、不带偏移）
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function EarlyDismissalApp() {
  const [timeText, setTimeText] = useState('');
  const [active, setActive] = useState(null); // { date, time } | null
  const [status, setStatus] = useState('正在读取当前状态…');

  useEffect(() => {
    let cancelled = false;
    ipcRenderer.invoke('get-temp-early-dismissal').then((value) => {
      if (cancelled) return;
      const current = value && value.date === todayKey() ? value : null;
      setActive(current);
      setTimeText(current ? current.time : '');
      setStatus(current
        ? `今天已设置提前放学，放学时间为 ${current.time}。`
        : '今天尚未设置提前放学，课程按正常时间显示。');
    }).catch(() => {
      if (!cancelled) setStatus('读取状态失败，请重试。');
    });
    const onChanged = (_event, value) => {
      const current = value && value.date === todayKey() ? value : null;
      setActive(current);
      setTimeText(current ? current.time : '');
    };
    ipcRenderer.on('early-dismissal-changed', onChanged);
    return () => {
      cancelled = true;
      ipcRenderer.removeListener('early-dismissal-changed', onChanged);
    };
  }, []);

  const apply = () => {
    const value = String(timeText || '').trim();
    if (!TIME_RE.test(value)) {
      setStatus('请输入有效的放学时间（格式 HH:MM）。');
      return;
    }
    const next = { date: todayKey(), time: value };
    setActive(next); // 主进程不回发本窗口，本地即时更新状态展示
    ipcRenderer.send('set-temp-early-dismissal', { time: value });
    setStatus(`已设置：今天 ${value} 放学。该时间点之后的课程不再显示，跨放学时间的时间段会提前结束。`);
  };

  const clear = () => {
    setActive(null);
    ipcRenderer.send('set-temp-early-dismissal', null);
    setTimeText('');
    setStatus('已恢复：今天按正常课表时间显示。');
  };

  return (
    <>
      <TitleBar title="提前放学" />
      <main className="dismissal-app">
        <p className="dismissal-intro">
          提前放学是一个临时功能：输入<b>今天</b>的放学时间，该时间点之后的课程不再显示。
          设置只在当天有效，软件重启或跨天后自动恢复，不会修改任何课表配置。
        </p>
        <section className="dismissal-panel">
          <div className="dismissal-current">
            <span className="dismissal-field-label">今日状态</span>
            <strong className={active ? 'active' : ''}>
              {active ? `已设置 · ${active.time} 放学` : '未设置 · 正常课表'}
            </strong>
          </div>

          <div className="dismissal-form">
            <label className="dismissal-field-label" htmlFor="dismissalTimeInput">今天的放学时间</label>
            <div className="dismissal-input-row">
              <Input
                id="dismissalTimeInput"
                type="time"
                value={timeText}
                onChange={(event) => setTimeText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') apply(); }}
              />
              <Button className="win-primary" appearance="primary" onClick={apply}>应用</Button>
              <Button disabled={!active} onClick={clear}>恢复</Button>
            </div>
            <p className="dismissal-help">
              例：17:00。若放学时间落在某节课的时间段内，该节课会在放学时间点结束。
            </p>
          </div>

          <div className="dismissal-status">{status}</div>
        </section>
      </main>
    </>
  );
}

function EarlyDismissalRoot() {
  useThemePack();
  return (
    <AppTheme>
      <EarlyDismissalApp />
    </AppTheme>
  );
}

createRoot(document.getElementById('root')).render(<EarlyDismissalRoot />);
