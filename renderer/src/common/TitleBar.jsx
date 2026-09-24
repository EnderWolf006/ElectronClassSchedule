import { ipcRenderer } from './electron';

// 40px 高的自定义窗口标题栏（Win11 风格），与旧 HTML 窗口逐像素一致。
// close 行为可定制（如退出确认窗口的关闭等同取消），默认发送 window-control。
export default function TitleBar({
  title = '',
  minimize = true,
  maximize = true,
  close = true,
  onClose,
}) {
  const sendControl = (action) => ipcRenderer.send('window-control', action);

  const handleDoubleClick = (event) => {
    if (event.target.closest('.window-controls')) return;
    if (maximize) sendControl('toggle-maximize');
  };

  return (
    <div className="window-titlebar" onDoubleClick={handleDoubleClick}>
      <span className="window-title">{title}</span>
      <div className="window-controls">
        {minimize && (
          <button
            type="button"
            className="window-control"
            title="最小化"
            aria-label="最小化"
            onClick={() => sendControl('minimize')}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
          </button>
        )}
        {maximize && (
          <button
            type="button"
            className="window-control"
            title="还原/最大化"
            aria-label="还原/最大化"
            onClick={() => sendControl('toggle-maximize')}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" /></svg>
          </button>
        )}
        {close && (
          <button
            type="button"
            className="window-control close"
            title="关闭"
            aria-label="关闭"
            onClick={() => (onClose ? onClose() : sendControl('close'))}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
