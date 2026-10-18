import { useEffect, useRef, useState } from 'react';
import { Button, Switch } from '@fluentui/react-components';
import { ipcRenderer } from '../../common/electron.js';
import { Svg, ICONS } from '../../common/icons.jsx';

// 插件设置挂载点：加载插件自带的 settings.js，
// 由插件通过 window.__pluginSettingsMounts[插件id](container, api) 渲染自己的设置界面
function PluginSettingsMount({ plugin, onStatus }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !plugin.settings || !plugin.enabled) return undefined;
    let disposed = false;
    container.innerHTML = '';
    const api = {
      pluginId: plugin.id,
      getSettings: () => ipcRenderer.invoke('plugin-settings-get', plugin.id),
      saveSettings: (value) => ipcRenderer.invoke('plugin-settings-save', plugin.id, value),
      invoke: (action, payload) => ipcRenderer.invoke(`plugin:${plugin.id}:${action}`, payload),
      send: (action, payload) => ipcRenderer.send(`plugin:${plugin.id}:${action}`, payload),
      openPluginsFolder: () => ipcRenderer.send('open-plugins-folder'),
      notify: (text) => onStatus?.(text),
    };
    const script = document.createElement('script');
    const separator = plugin.settings.includes('?') ? '&' : '?';
    script.src = `${plugin.settings}${separator}t=${Date.now()}`;
    let cleanup = null;
    script.onload = () => {
      if (disposed) return;
      const mount = window.__pluginSettingsMounts && window.__pluginSettingsMounts[plugin.id];
      if (typeof mount === 'function') {
        try {
          cleanup = mount(container, api);
        } catch (error) {
          console.error(error);
          container.innerHTML = `<div class="empty">插件设置界面加载失败：${error.message || error}</div>`;
        }
      } else {
        container.innerHTML = '<div class="empty">该插件未提供设置界面。</div>';
      }
    };
    script.onerror = () => {
      if (!disposed) container.innerHTML = '<div class="empty">插件设置脚本加载失败。</div>';
    };
    document.head.appendChild(script);
    return () => {
      disposed = true;
      try { script.remove(); } catch (error) { /* 忽略 */ }
      if (typeof cleanup === 'function') {
        try { cleanup(); } catch (error) { /* 忽略 */ }
      }
      if (window.__pluginSettingsMounts) delete window.__pluginSettingsMounts[plugin.id];
      container.innerHTML = '';
    };
  }, [plugin.id, plugin.settings, plugin.enabled, onStatus]);

  return <div className="plugin-settings-mount" ref={mountRef} />;
}

// “插件”页：插件列表（点击卡片进入插件详情页）+ 详情页（启用状态与该插件的设置界面）。
// 插件可以新增主窗口组件、触发提醒、扩展托盘菜单等。
export default function PluginsPage({ pluginList, onTogglePlugin, onStatus }) {
  const plugins = Array.isArray(pluginList) ? pluginList : [];
  const [openId, setOpenId] = useState(null);
  const opened = openId ? plugins.find((plugin) => plugin.id === openId) || null : null;

  // 插件被移除或列表刷新后自动退回列表页
  useEffect(() => {
    if (openId && !plugins.some((plugin) => plugin.id === openId)) setOpenId(null);
  }, [openId, plugins]);

  if (opened) {
    return (
      <>
        <div className="plugin-detail-bar">
          <Button
            className="win-small"
            icon={<Svg size={16} viewBox="0 0 24 24" html={ICONS.back} strokeWidth={1.7} />}
            onClick={() => setOpenId(null)}
          >
            返回插件列表
          </Button>
        </div>
        <div className="page-header">
          <h1 className="page-title">{opened.name}</h1>
          <p className="page-intro">
            {opened.description || '（该插件没有描述）'}
            {opened.version ? ` · v${opened.version}` : ''}
            {opened.components.length > 0 ? ` · 提供 ${opened.components.length} 个组件` : ''}
          </p>
        </div>
        <div className="panel">
          <div className="theme-packs-toolbar">
            <h3>启用状态</h3>
            <Switch
              checked={opened.enabled}
              aria-label={`启用插件 ${opened.name}`}
              onChange={(_event, data) => onTogglePlugin(opened, data.checked === true)}
            />
          </div>
          <p className="field-help">
            停用后插件立即卸载（主界面组件不再显示、托盘菜单项移除）；重新启用即恢复。
          </p>
        </div>
        {opened.enabled ? (
          opened.settings ? (
            <div className="panel plugin-settings-panel">
              <div className="theme-packs-toolbar">
                <h3>插件设置</h3>
              </div>
              <PluginSettingsMount plugin={opened} onStatus={onStatus} />
            </div>
          ) : (
            <div className="panel">
              <div className="empty">该插件没有可配置项。</div>
            </div>
          )
        ) : (
          <div className="panel">
            <div className="empty">插件未启用：打开上方开关后即可在此配置。</div>
          </div>
        )}
      </>
    );
  }

  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">插件</h1>
        <p className="page-intro">
          每个插件是 plugins 文件夹中的一个子文件夹（含 index.json 清单，可自带主进程脚本、
          主界面渲染脚本与设置界面）。启用后插件可以新增主界面组件、新的提醒内容，
          或扩展托盘菜单（如“点名”）；停用会立即卸载。点击插件卡片进入该插件的设置页面。
        </p>
      </div>
      <div className="panel">
        <div className="theme-packs-toolbar">
          <h3>已安装插件（{enabledCount}/{plugins.length} 已启用）</h3>
          <Button
            className="win-small"
            icon={<Svg size={16} viewBox="0 0 24 24" html={ICONS.folder} />}
            onClick={() => ipcRenderer.send('open-plugins-folder')}
          >
            打开 plugins 文件夹
          </Button>
        </div>
        {plugins.length === 0 ? (
          <div className="empty theme-packs-empty">
            plugins 文件夹中还没有插件。点击右上角“打开 plugins 文件夹”，
            把包含 index.json 的插件子文件夹放进去，回到此页面即可看到开关。
          </div>
        ) : (
          <div className="theme-pack-list">
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className={`theme-pack-card${plugin.enabled ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                title="点击进入该插件的设置页面"
                onClick={() => setOpenId(plugin.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setOpenId(plugin.id);
                  }
                }}
              >
                <div className="theme-pack-info">
                  <div className="theme-pack-name">
                    {plugin.name}
                    {plugin.version ? <span className="plugin-version">v{plugin.version}</span> : null}
                  </div>
                  <div className="theme-pack-meta">
                    {plugin.description || '（无描述）'}
                    {plugin.components.length > 0 && (
                      <span> · 提供 {plugin.components.length} 个组件</span>
                    )}
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <Switch
                    checked={plugin.enabled}
                    aria-label={`启用插件 ${plugin.name}`}
                    onChange={(_event, data) => onTogglePlugin(plugin, data.checked === true)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <span className="plugin-enter" aria-hidden="true">›</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="field-help">
          点击插件卡片进入插件设置；右侧开关可快速启用/停用（立即生效）。新增或删除插件文件夹后，重新打开此页面即可刷新列表。
        </p>
      </div>
    </>
  );
}