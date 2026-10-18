import { useCallback, useEffect, useState } from 'react';
import { Button, Switch } from '@fluentui/react-components';
import { ipcRenderer } from '../../common/electron.js';
import { Svg, ICONS } from '../../common/icons.jsx';

// “主题”页：
// 扫描 Theme 文件夹，每个含 index.json 的子文件夹显示为一个主题开关。
// 最多启用一个开关（单选语义）；全部关闭时加载默认主题。
export default function ThemePacksPage({ activeTheme, onSelectTheme }) {
  const [packs, setPacks] = useState([]);

  const reloadPacks = useCallback(() => {
    ipcRenderer.invoke('list-theme-packs')
      .then((list) => setPacks(Array.isArray(list) ? list : []))
      .catch((error) => console.error('读取主题列表失败:', error));
  }, []);

  useEffect(() => {
    reloadPacks();
    // 用户直接在 Theme 文件夹里增删子文件夹后，切回本窗口即静默刷新列表
    const onFocus = () => reloadPacks();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadPacks]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">主题</h1>
        <p className="page-intro">
          每个主题是 Theme 文件夹中的一个子文件夹（含 index.json 索引、css 文件与字体）。
          同一时间只能启用一个主题；全部关闭时使用默认外观。
        </p>
      </div>
      <div className="panel">
        <div className="theme-packs-toolbar">
          <h3>已安装主题</h3>
          <Button
            className="win-small"
            icon={<Svg size={16} viewBox="0 0 24 24" html={ICONS.folder} />}
            onClick={() => ipcRenderer.send('open-theme-folder')}
          >
            打开 Theme 文件夹
          </Button>
        </div>
        {packs.length === 0 ? (
          <div className="empty theme-packs-empty">
            Theme 文件夹中还没有主题。点击右上角“打开 Theme 文件夹”，
            把包含 index.json 的主题子文件夹放进去，回到此页面即可看到开关。
          </div>
        ) : (
          <div className="theme-pack-list">
            {packs.map((pack) => {
              const checked = activeTheme === pack.id;
              return (
                <div
                  key={pack.id}
                  className={`theme-pack-card${checked ? ' active' : ''}`}
                  onClick={() => onSelectTheme(checked ? '' : pack.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectTheme(checked ? '' : pack.id);
                    }
                  }}
                >
                  <div className="theme-pack-info">
                    <div className="theme-pack-name">{pack.id}</div>
                    <div className="theme-pack-meta">
                      {pack.css.length} 个样式文件 · {pack.fonts.length} 个字体
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    aria-label={`启用主题 ${pack.id}`}
                    onChange={(_event, data) => onSelectTheme(data.checked ? pack.id : '')}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        )}
        <p className="field-help">
          新增或删除主题文件夹后，重新打开此页面即可刷新列表。
        </p>
      </div>
    </>
  );
}
