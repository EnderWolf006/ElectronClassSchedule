import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@fluentui/react-components';
import { AppTheme } from '../../common/theme.jsx';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { getQueryData } from '../../common/query.js';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './schedule-dialog.css';

function ScheduleDialogApp() {
  const payload = getQueryData();
  const title = payload.title || '配置课表';
  const message = payload.message || '请选择操作';
  const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];
  const defaultIndex = Number.isInteger(payload.defaultIndex) ? payload.defaultIndex : 0;

  useEffect(() => {
    document.title = title;
  }, [title]);

  // 防止重复发送（按钮点击/快捷键/原生标题栏关闭都会走到这里）
  let settled = false;
  const finish = (index) => {
    if (settled) return;
    settled = true;
    ipcRenderer.send('schedule-dialog-result', index);
    window.close();
  };

  const choose = (index) => finish(index);
  const cancel = () => finish(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') cancel();
    };
    // 亚克力窗口保留了 DWM 原生标题栏按钮：点原生关闭或任何方式卸载页面时，
    // 也要给出"取消"结果，避免主进程等待对话框回复导致后续对话框无法弹出
    const onBeforeUnload = () => {
      if (!settled) ipcRenderer.send('schedule-dialog-result', null);
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <TitleBar title={title} />
      <div className="dialog">
        <h1 className="dialog-title">{title}</h1>
        <p className="dialog-subtitle">{message}</p>
        <div className="button-list">
          {buttons.map((label, index) => (
            <Button
              key={index}
              className={`option-btn${index === defaultIndex ? ' option-default' : ''}`}
              onClick={() => choose(index)}
            >
              {String(label)}
            </Button>
          ))}
        </div>
        <div className="dialog-toolbar">
          <Button onClick={cancel}>取消</Button>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <AppTheme>
    <ScheduleDialogApp />
  </AppTheme>,
);
