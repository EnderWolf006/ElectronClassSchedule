// 主题包加载器（React 窗口共用）。
// 主题包由主进程从 Theme 文件夹扫描得到：
//   { id, name, css: [file://...css], fonts: [{ family, src: file://...font, weight, style }] }
// 字体通过 FontFace API 注册，css 通过带 data-theme-pack 标记的 <link> 注入；
// 切换/关闭主题时先卸载旧包，保证“最多启用一个、全关即默认”。
import { useEffect } from 'react';
import { ipcRenderer } from './electron.js';

let loadedFonts = [];
let loadedLinks = [];

export function unloadThemePack() {
  loadedFonts.forEach((face) => {
    try { document.fonts.delete(face); } catch (error) { /* 忽略 */ }
  });
  loadedLinks.forEach((link) => link.remove());
  loadedFonts = [];
  loadedLinks = [];
}

export async function applyThemePack(pack) {
  unloadThemePack();
  if (!pack) return;
  const fonts = Array.isArray(pack.fonts) ? pack.fonts : [];
  for (const font of fonts) {
    try {
      const face = new FontFace(
        font.family,
        `url("${font.src}")`,
        { weight: font.weight || 'normal', style: font.style || 'normal' },
      );
      await face.load();
      document.fonts.add(face);
      loadedFonts.push(face);
    } catch (error) {
      console.error('[theme-pack] 字体加载失败:', font.family, error);
    }
  }
  (Array.isArray(pack.css) ? pack.css : []).forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.themePack = '1';
    document.head.appendChild(link);
    loadedLinks.push(link);
  });
}

// 挂载时取当前启用主题，并跟随设置变更热切换
export function useThemePack() {
  useEffect(() => {
    ipcRenderer.invoke('get-active-theme-pack')
      .then((pack) => applyThemePack(pack))
      .catch((error) => console.error('[theme-pack] 初始加载失败:', error));
    const onChange = (_event, pack) => { applyThemePack(pack); };
    ipcRenderer.on('active-theme-changed', onChange);
    return () => {
      ipcRenderer.removeListener('active-theme-changed', onChange);
    };
  }, []);
}
