import { useEffect, useState } from 'react';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';

// 与旧窗口 Win11 token 完全一致的品牌色
const FONT_STACK = '"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif';
const MONO_STACK = 'Consolas,"Microsoft YaHei",monospace';

const LIGHT_BRAND = { brand: '#0067c0', hover: '#1975c5', pressed: '#005a9e', onBrand: '#ffffff' };
const DARK_BRAND = { brand: '#4cc2ff', hover: '#6ccbff', pressed: '#3fb5ef', onBrand: '#00223c' };
// 重命名时间表窗口沿用深蓝渐变主题
const NAVY_BRAND = { brand: '#72d6ff', hover: '#8fe0ff', pressed: '#5fc8f5', onBrand: '#081423' };

function buildTheme(base, c) {
  return {
    ...base,
    fontFamilies: { ...base.fontFamilies, base: FONT_STACK, monospace: MONO_STACK },
    colorBrandBackground: c.brand,
    colorBrandBackgroundHover: c.hover,
    colorBrandBackgroundPressed: c.pressed,
    colorBrandBackgroundSelected: c.brand,
    colorCompoundBrandBackground: c.brand,
    colorCompoundBrandBackgroundHover: c.hover,
    colorCompoundBrandBackgroundPressed: c.pressed,
    colorNeutralForegroundOnBrand: c.onBrand,
    colorBrandForeground1: c.brand,
    colorBrandForeground2: c.brand,
    colorBrandForegroundLink: c.brand,
    colorBrandForegroundLinkHover: c.hover,
    colorBrandForegroundLinkPressed: c.pressed,
    colorBrandForegroundLinkSelected: c.brand,
    colorCompoundBrandForeground1: c.brand,
    colorCompoundBrandForeground1Hover: c.hover,
    colorCompoundBrandForeground1Pressed: c.pressed,
    colorBrandStroke1: c.brand,
    colorCompoundBrandStroke: c.brand,
    colorCompoundBrandStrokeHover: c.hover,
    colorCompoundBrandStrokePressed: c.pressed,
  };
}

function useSystemDark() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(media.matches);
  useEffect(() => {
    const onChange = (event) => setDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [media]);
  return dark;
}

// 主进程创建窗口时会把已保存的主题模式通过 URL 参数注入（?themeMode=dark|light|auto），
// 渲染层首帧即可用正确主题，避免“先 auto 挂载、再异步读取切换”造成的深浅色闪烁或错配。
export function initialThemeFromQuery() {
  try {
    const value = new URLSearchParams(window.location.search).get('themeMode');
    return value === 'dark' || value === 'light' || value === 'auto' ? value : '';
  } catch {
    return '';
  }
}

export function AppTheme({ variant, mode, children }) {
  const systemDark = useSystemDark();
  // 若调用方未显式传 mode，则优先用 URL 参数，再异步从 settings 读取用户设置的 theme_mode
  const [resolvedMode, setResolvedMode] = useState(mode || initialThemeFromQuery() || 'auto');
  useEffect(() => {
    if (mode) {
      setResolvedMode(mode);
      return;
    }
    let cancelled = false;
    const cleanup = [];
    import('../common/electron.js').then(({ ipcRenderer }) => {
      if (cancelled) return;
      ipcRenderer.invoke('read-settings-file').then((s) => {
        if (!cancelled) setResolvedMode(s?.theme_mode || 'auto');
      }).catch(() => {});
      // 其他窗口（软件设置）保存主题后，主进程广播：已打开的本窗口立即跟随切换
      const onThemeChanged = (_event, nextMode) => {
        if (!cancelled && (nextMode === 'dark' || nextMode === 'light' || nextMode === 'auto')) {
          setResolvedMode(nextMode);
        }
      };
      ipcRenderer.on('settings-theme-changed', onThemeChanged);
      cleanup.push(() => ipcRenderer.removeListener('settings-theme-changed', onThemeChanged));
    }).catch(() => {});
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, [mode]);

  let theme;
  if (variant === 'navy') {
    theme = buildTheme(webDarkTheme, NAVY_BRAND);
  } else {
    const useDark = resolvedMode === 'dark' ? true : resolvedMode === 'light' ? false : systemDark;
    theme = buildTheme(useDark ? webDarkTheme : webLightTheme, useDark ? DARK_BRAND : LIGHT_BRAND);
  }
  // 同步 data-theme 到 html 根元素，使 tokens.css 的 [data-theme] 覆盖块生效；
  // 同时把当前主题模式通知主进程，同步亚克力窗口的 DWM 材质深浅色。
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedMode === 'dark') root.setAttribute('data-theme', 'dark');
    else if (resolvedMode === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    let cancelled = false;
    import('../common/electron.js').then(({ ipcRenderer }) => {
      if (!cancelled) ipcRenderer.send('acrylic-theme-changed', resolvedMode);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [resolvedMode]);

  // 挂载时向主进程查询当前窗口是否已启用亚克力材质：
  // 启用则为 <html> 添加 .acrylic 类，由 tokens.css 切换为透明底 + 半透明面板；
  // 未启用（非 Windows / 原生模块加载失败）时保持原有不透明外观。
  useEffect(() => {
    let cancelled = false;
    import('../common/electron.js').then(({ ipcRenderer }) => {
      ipcRenderer.invoke('window-acrylic-state').then((state) => {
        if (!cancelled && state && state.enabled) {
          document.documentElement.classList.add('acrylic');
        }
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return <FluentProvider theme={theme}>{children}</FluentProvider>;
}
