import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@fluentui/react-components';
import { AppTheme } from '../../common/theme.jsx';
import TitleBar from '../../common/TitleBar.jsx';
import { ipcRenderer } from '../../common/electron.js';
import { getQueryData } from '../../common/query.js';
import '../../common/tokens.css';
import '../../common/chrome.css';
import './exit-confirm.css';

function ExitConfirmApp() {
  const payload = getQueryData();
  const title = payload.title || '请确认';
  const message = payload.message || '你确定要退出程序吗?';
  const cancelText = (payload.buttons && payload.buttons[0]) || '取消';
  const confirmText = (payload.buttons && payload.buttons[1]) || '确定';

  useEffect(() => {
    document.title = title;
  }, [title]);

  // 防止重复发送（按钮点击/快捷键/原生标题栏关闭都会走到这里）
  let settled = false;
  const sendResult = (result) => {
    if (settled) return;
    settled = true;
    ipcRenderer.send('exit-confirm-result', result);
    window.close();
  };

  // Esc = 取消，Enter = 确定；标题栏关闭按钮等同取消
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') sendResult(0);
      if (event.key === 'Enter') sendResult(1);
    };
    // 亚克力窗口保留了 DWM 原生标题栏按钮：原生关闭等同"再想一想"
    const onBeforeUnload = () => {
      if (!settled) ipcRenderer.send('exit-confirm-result', 0);
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
      <TitleBar title={title} maximize={false} onClose={() => sendResult(0)} />
      <div className="dialog">
        <h1 className="dialog-title">{title}</h1>
        <p className="dialog-subtitle">{message}</p>
        <div className="dialog-toolbar">
          <Button onClick={() => sendResult(0)}>{cancelText}</Button>
          <Button className="win-primary" appearance="primary" onClick={() => sendResult(1)}>{confirmText}</Button>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <AppTheme>
    <ExitConfirmApp />
  </AppTheme>,
);
