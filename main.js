const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell, powerMonitor, nativeTheme, net, safeStorage, systemPreferences } = require('electron')
const path = require('path');
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { execFile, exec } = require('child_process')
const createShortcut = require('windows-shortcuts')
const yaml = require('js-yaml')
const { parseTableFile, parseImageFile } = require('./schedule-import');
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const Store = require('electron-store');
const { DisableMinimize } = require('electron-disable-minimize');
const store = new Store();

// ===== Win11 Mica 云母材质（仅用于设置类窗口；Win10/21H2 无 Mica，回退 user32 亚克力） =====
// mica-electron 在 require 时会追加 enable-transparent-visuals 命令行开关，必须在 app.ready 之前加载。
let micaElectron = null;
let acrylicAvailable = false;
if (process.platform === 'win32') {
    try {
        micaElectron = require('mica-electron');
        acrylicAvailable = !!(micaElectron && micaElectron.MicaBrowserWindow);
    } catch (error) {
        console.log('[acrylic] mica-electron 加载失败，设置窗口将使用普通不透明背景:', error && error.message ? error.message : error);
    }
}
// 所有已启用亚克力材质的窗口，用于主题切换时批量同步 DWM 深浅色
const acrylicWindows = new Set();

// DWMWA_SYSTEMBACKDROP_TYPE（Mica/桌面亚克力系统背景）从 Win11 22H2(build 22621) 才支持。
// Win11 21H2(22000) 上设置该属性会被系统直接忽略，而 mica-electron 又强制窗口全透明，
// 结果就是窗口没有任何材质底色：有的窗口看不到亚克力、有的窗口完全透明、文字难以辨认。
// 21H2 及更早系统回退到 user32 的 SetWindowCompositionAttribute 亚克力（Win10 1803+ 均支持）。
function getWindowsBuild() {
    const parts = String(os.release()).split('.');
    const build = Number(parts[2]);
    return Number.isFinite(build) ? build : 0;
}
const dwmBackdropSupported = acrylicAvailable
    && !!micaElectron.IS_WINDOWS_11
    && getWindowsBuild() >= 22621;
// user32 亚克力的主题色 tint（ABGR 由 mica-electron 内部组装，这里传 HTML 色 + 透明度）
const USER32_ACRYLIC_TINT = {
    dark: { color: '#202020', alpha: 0.7 },
    light: { color: '#f3f3f3', alpha: 0.65 },
};
let tray = undefined;
var win = undefined;
let configEditorWin = undefined;
let softwareSettingsWin = undefined;
let courseFusionWin = undefined;
let earlyDismissalWin = undefined;

// ===== 运行时覆盖层（仅本次运行有效，保存在主进程内存） =====
// 重启软件/电脑后自然丢失；跨天后由渲染层按日期判断自动失效。
// 保存在主进程（而非渲染层）是为了让主窗口 reload（如保存配置后）后仍可拉回
let runtimeTempCourseChanges = null; // { date, items: [{ dayIndex, slotIndex, subject }] }
let runtimeEarlyDismissal = null;    // { date, time: 'HH:MM' }

function runtimeTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

ipcMain.handle('get-temp-course-changes', () => runtimeTempCourseChanges)
ipcMain.on('set-temp-course-changes', (event, payload) => {
    runtimeTempCourseChanges = (payload && typeof payload === 'object'
        && typeof payload.date === 'string' && Array.isArray(payload.items)) ? payload : null;
})

ipcMain.handle('get-temp-early-dismissal', () => runtimeEarlyDismissal)
ipcMain.on('set-temp-early-dismissal', (event, payload) => {
    const time = payload && /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(payload.time || ''))
        ? String(payload.time).slice(0, 5)
        : null;
    // date 由主进程按当天时间记录（收起时校验），渲染层按该日期判断跨天失效
    runtimeEarlyDismissal = time ? { date: runtimeTodayKey(), time } : null;
    if (win && !win.isDestroyed()) {
        win.webContents.send('early-dismissal-changed', runtimeEarlyDismissal);
    }
})
let basePath = app.isPackaged ? './resources/app/' : './'
if (!app.requestSingleInstanceLock({ key: 'classSchedule' })) {
    app.quit();
}
const createWindow = () => {
    // 按位置模式确定初始 bounds（top/top-right 全宽置顶，right 贴右垂直居中）；
    // 渲染层加载后会异步测量内容并再次上报精确尺寸
    const initialPositionMode = readWindowPositionMode();
    win = new BrowserWindow({
        ...getMainWindowBounds(initialPositionMode, null),
        frame: false,
        transparent: true,
        // 透明窗口在首帧前默认是白底，21H2 等环境启动时会闪白：
        // 显式把预渲染底色设为全透明，配合窗口自身的透明属性消除闪白
        backgroundColor: '#00000000',
        alwaysOnTop: store.get('isWindowAlwaysOnTop', true),
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        resizable: false,
        type: 'toolbar',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            // 本窗口是常驻置顶的时钟/课表条，被其它窗口遮挡或屏幕关闭时
            // Chromium 会把定时器节流到约 1 次/分钟（甚至挂起），导致放学后
            // “次日课表”等跨时间点的界面长时间不刷新；关闭后台/遮挡节流。
            backgroundThrottling: false
        },
    })
    win.__positionMode = initialPositionMode;
    win.setIgnoreMouseEvents(true, { forward: true });
    // win.webContents.openDevTools()
    win.loadFile('index.html')
    // 用 on 而不是 once：保存设置/配置后主界面会 win.reload()，
    // reload 是一次全新的页面加载，必须重新下发这三项状态，
    // 否则“显示次日课程”等开关在设置变更后会静默失效
    win.webContents.on('did-finish-load', () => {
        win.setIgnoreMouseEvents(true, { forward: true });
        win.webContents.send('ClassCountdown', store.get('isDuringClassCountdown', true))
        win.webContents.send('ClassHidden', store.get('isDuringClassHidden', false))
        win.webContents.send('NextDayAfterSchool', store.get('showNextDayAfterSchool', false))
    })
    // 主进程心跳：主进程的 setInterval 不受渲染进程节流/挂起影响，
    // 且 IPC 消息即使在渲染进程定时器被节流时也会立即派发，
    // 保证课表每秒都会重新计算（如放学后切换到次日课表）。
    const heartbeat = () => {
        if (win && !win.isDestroyed()) win.webContents.send('app-heartbeat')
    }
    setInterval(heartbeat, 1000)
    // 光标轮询驱动行级淡化：forward 穿透模式下转发的 mousemove 事件不可靠
    // （有概率长时间收不到，刚启动时尤其明显），渲染进程无法稳定感知光标。
    // 主进程每 50ms 上报光标相对窗口的位置。
    // hit-test 增加 30px margin：穿透模式下 GetCursorPos 可能因系统 hit-test
    // 延迟而返回窗口 rect 外的坐标，扩大检测区域确保滑动经过时也能命中。
    let lastCursorState = { inside: false, x: -1, y: -1 }
    setInterval(() => {
        if (!win || win.isDestroyed()) return
        const point = screen.getCursorScreenPoint()
        const bounds = win.getBounds()
        const margin = 30
        const inside = point.x >= bounds.x - margin && point.x < bounds.x + bounds.width + margin
            && point.y >= bounds.y - margin && point.y < bounds.y + bounds.height + margin
        const x = Math.round(point.x - bounds.x)
        const y = Math.round(point.y - bounds.y)
        // 始终发送：移除 dx/dy 过滤，确保渲染进程在滑动过程中也能收到心跳
        //（系统可能在滑动时节流坐标更新，缩短轮询间隔+持续发送能提高捕获率）
        if (inside !== lastCursorState.inside || inside) {
            lastCursorState = { inside, x, y }
            win.webContents.send('cursor-position', lastCursorState)
        }
    }, 50)
    // 系统休眠唤醒、解锁屏幕后立即补一次刷新
    powerMonitor.on('resume', heartbeat)
    powerMonitor.on('unlock-screen', heartbeat)
    if (store.get('isWindowAlwaysOnTop', true))
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
    guardRepaint(win)
}
// 构造快捷方式参数。
// 打包后 app.getPath('exe') 即 eSchedule.exe，可直接作为目标；
// 开发态它是 node_modules 里的 electron.exe，必须把应用目录作为参数传入，
// 否则双击快捷方式只会打开 Electron 默认欢迎页。
function buildShortcutOptions(iconPath) {
    const exePath = app.getPath('exe');
    const options = {
        target: exePath,
        workingDir: path.dirname(exePath),
    };
    if (!app.isPackaged) {
        options.args = `"${app.getAppPath()}"`;
        options.workingDir = app.getAppPath();
    }
    if (iconPath && fs.existsSync(iconPath)) {
        options.icon = iconPath;
    }
    return options;
}

function setAutoLaunch() {
    const shortcutName = '电子课表(请勿重命名).lnk'
    app.setLoginItemSettings({ // backward compatible
        openAtLogin: false,
        openAsHidden: false
    })
    if (store.get('isAutoLaunch', true)) {
        createShortcut.create(startupFolderPath + '/' + shortcutName,
            buildShortcutOptions(path.join(__dirname, 'image', 'icon.ico')),
            (e) => { e && console.log(e); })
    } else {
        fs.unlink(startupFolderPath + '/' + shortcutName, () => { })
    }

}

// ===== 高优先级启动 =====
// 用任务计划程序创建“登录时”任务（ONLOGON），在进入桌面（Explorer 加载完成）前就启动本程序，
// /RL HIGHEST 以最高权限运行；比“启动”文件夹快捷方式更早。
const HIGH_PRIORITY_TASK_NAME = 'eSchedule_HighPriority';

function highPriorityTaskCommand() {
    const options = buildShortcutOptions();
    const quotedTarget = `"${options.target}"`;
    return options.args ? `${quotedTarget} ${options.args}` : quotedTarget;
}

function runSchtasks(args, silent = false) {
    return new Promise((resolve) => {
        execFile('schtasks', args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                if (!silent) console.log('schtasks 执行失败:', String(stderr || error.message || '').trim());
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function setHighPriorityLaunch() {
    if (store.get('isHighPriorityLaunch', false) && store.get('isAutoLaunch', true)) {
        return runSchtasks([
            '/Create', '/TN', HIGH_PRIORITY_TASK_NAME,
            '/TR', highPriorityTaskCommand(),
            '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F'
        ]);
    }
    // 未启用（或开机启动已关闭）时删除任务；任务不存在属于正常情况，不打印错误
    return runSchtasks(['/Delete', '/TN', HIGH_PRIORITY_TASK_NAME, '/F'], true);
}

// 同步“开机启动 + 高优先级启动”两项设置（高优先级依赖开机启动）
function applyLaunchSettings() {
    setAutoLaunch();
    return setHighPriorityLaunch();
}

// 窗口尺寸记忆：打开时恢复上次关闭前的宽高，关闭时保存
function applyWindowSizeMemory(key, options) {
    const saved = store.get(`windowSizes.${key}`);
    const { width: maxW, height: maxH } = screen.getPrimaryDisplay().workAreaSize;
    if (saved && Number.isFinite(Number(saved.width)) && Number.isFinite(Number(saved.height))) {
        const savedW = Math.round(Number(saved.width));
        const savedH = Math.round(Number(saved.height));
        // 历史版本（亚克力窗口创建/销毁瞬间）可能把异常小尺寸写进了配置，
        // 更新后仍会读到它；明显小于设计默认尺寸的记录视为无效并清除，回退到默认大小。
        // 下限取“显式最小尺寸”与“默认尺寸 60%”中的较大者。
        const floorW = Math.max(options.minWidth || 0, Math.round((Number(options.width) || 0) * 0.6));
        const floorH = Math.max(options.minHeight || 0, Math.round((Number(options.height) || 0) * 0.6));
        if (savedW < floorW || savedH < floorH || savedW > maxW || savedH > maxH) {
            store.delete(`windowSizes.${key}`);
            return options;
        }
        options.width = Math.min(Math.max(savedW, options.minWidth || 0), maxW);
        options.height = Math.min(Math.max(savedH, options.minHeight || 0), maxH);
    }
    return options;
}

function saveWindowSizeOnClose(key, winObj) {
    winObj.on('close', () => {
        if (winObj.isDestroyed() || winObj.isMaximized()) return;
        const [width, height] = winObj.getSize();
        // 亚克力无边框窗口在创建/销毁的瞬间可能读到异常小尺寸，
        // 拒绝持久化明显不可用的尺寸，避免下次打开窗口缩成一团
        if (width < 200 || height < 150) return;
        store.set(`windowSizes.${key}`, { width, height });
    });
}

// 读取设置中的主题模式（auto/dark/light），用于决定 DWM 材质深浅色
function readThemeMode() {
    const loaded = readSettingsObject();
    return loaded.theme_mode === 'dark' || loaded.theme_mode === 'light' ? loaded.theme_mode : 'auto';
}

// ===== Theme 主题包 =====
// Theme 文件夹与 js/ 配置同级（打包后位于 resources/app/Theme）。
// 每个子文件夹是一个主题包，内含 index.json 索引、若干 css 文件与字体文件：
// { "name": "显示名", "css": ["a.css"], "fonts": [{ "file": "x.ttf", "family": "X", "weight": "normal", "style": "normal" }] }
// 载入主题时只读索引，字体经 FontFace 注册、css 经 <link> 注入。
const { pathToFileURL } = require('url');
const THEMES_DIR = path.join(__dirname, 'Theme');

function ensureThemeDir() {
    try { fs.mkdirSync(THEMES_DIR, { recursive: true }); } catch (error) { /* 忽略 */ }
}

function readSettingsObject() {
    try {
        const settingsPath = path.join(__dirname, 'js', 'settings.js');
        // 去除 BOM：个别编辑器保存的配置文件带 BOM 时，new Function 会直接抛语法错误
        const code = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
        const reader = new Function(`${code}; return { _settings, settings };`);
        const result = reader();
        return (result && (result._settings || result.settings)) || {};
    } catch (error) {
        return {};
    }
}

// 扫描 Theme 目录，返回全部主题包（资源路径已转成 file:// URL）
function readThemePacks() {
    ensureThemeDir();
    const packs = [];
    let entries = [];
    try {
        entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true });
    } catch (error) {
        return packs;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(THEMES_DIR, entry.name);
        let manifest = null;
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
        } catch (error) {
            // 没有合法 index.json 的子文件夹不是主题包，跳过
            continue;
        }
        if (!manifest || typeof manifest !== 'object') continue;
        const cssList = Array.isArray(manifest.css) ? manifest.css : [];
        const css = cssList
            .filter((f) => typeof f === 'string' && f.trim())
            // 禁止路径逃逸主题文件夹
            .filter((f) => !f.split(/[\\/]/).includes('..'))
            .map((f) => pathToFileURL(path.join(dir, f)).href);
        const fontList = Array.isArray(manifest.fonts) ? manifest.fonts : [];
        const fonts = fontList
            .filter((f) => f && typeof f.file === 'string' && typeof f.family === 'string' && f.family.trim())
            .filter((f) => !f.file.split(/[\\/]/).includes('..'))
            .map((f) => ({
                family: String(f.family),
                src: pathToFileURL(path.join(dir, f.file)).href,
                weight: f.weight ? String(f.weight) : 'normal',
                style: f.style ? String(f.style) : 'normal',
            }));
        packs.push({ id: entry.name, name: manifest.name ? String(manifest.name) : entry.name, css, fonts });
    }
    packs.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'));
    return packs;
}

function getActiveThemePack() {
    const activeId = readSettingsObject().active_theme;
    if (!activeId || typeof activeId !== 'string') return null;
    return readThemePacks().find((pack) => pack.id === activeId) || null;
}

// 设置变更后把当前启用的主题包广播给所有窗口（主窗口会 reload 自取，其余窗口靠事件热切换）
function broadcastActiveTheme() {
    const payload = getActiveThemePack();
    BrowserWindow.getAllWindows().forEach((winObj) => {
        if (!winObj.isDestroyed() && winObj.webContents && !winObj.webContents.isDestroyed()) {
            winObj.webContents.send('active-theme-changed', payload);
        }
    });
}

// ===== 插件系统 =====
// 每个插件是 plugins 文件夹中的一个子文件夹，含 index.json 清单：
// {
//   "name": "点名", "version": "1.0.0", "description": "...",
//   "main": "main.js",          // 主进程脚本：module.exports = (api) => ({ cleanup })
//   "renderer": "renderer.js",  // 主窗口脚本：用 window.pluginHost.registerComponent 注册组件/监听 tick
//   "settings": "settings.js",  // 设置界面脚本：window.__pluginSettingsMounts[插件id] = (container, api) => {}
//   "components": [{ "type": "rollcall", "name": "点名", "description": "...",
//                    "options": [{ "key": "x", "label": "X", "type": "text", "default": "" }] }]
// }
// 启用状态保存在 settings.js 的 plugins_enabled: { 插件id: true }。
// 插件可以新增主窗口组件、触发提醒（api.reminder.show）、扩展托盘菜单（api.addTrayAction）、
// 创建自己的窗口（api.createWindow）、读写自己的数据（api.storage）与设置（settings.plugins[id]）。
const PLUGINS_DIR = path.join(__dirname, 'plugins');

function ensurePluginsDir() {
    try { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); } catch (error) { /* 忽略 */ }
}

function readEnabledPluginIds() {
    const settings = readSettingsObject();
    const map = settings && settings.plugins_enabled;
    if (!map || typeof map !== 'object') return [];
    return Object.keys(map).filter((id) => map[id] === true);
}

// 扫描 plugins 目录（资源路径已转成 file:// URL）；清单非法的子文件夹忽略
function readPlugins() {
    ensurePluginsDir();
    const plugins = [];
    let entries = [];
    try {
        entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    } catch (error) {
        return plugins;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(PLUGINS_DIR, entry.name);
        let manifest = null;
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
        } catch (error) {
            continue;
        }
        if (!manifest || typeof manifest !== 'object') continue;
        // 禁止路径逃逸插件文件夹
        const safeFile = (name) => {
            if (typeof name !== 'string' || !name.trim() || name.split(/[\\/]/).includes('..')) return null;
            const full = path.join(dir, name);
            return fs.existsSync(full) ? full : null;
        };
        const mainFile = safeFile(manifest.main);
        const rendererFile = safeFile(manifest.renderer);
        const settingsFile = safeFile(manifest.settings);
        const components = (Array.isArray(manifest.components) ? manifest.components : [])
            .filter((item) => item && typeof item.type === 'string' && item.type.trim())
            .map((item) => ({
                type: String(item.type).trim(),
                name: item.name ? String(item.name) : String(item.type),
                description: item.description ? String(item.description) : '',
                options: (Array.isArray(item.options) ? item.options : [])
                    .filter((option) => option && typeof option.key === 'string' && option.key.trim())
                    .map((option) => ({
                        key: String(option.key),
                        label: option.label ? String(option.label) : String(option.key),
                        type: ['text', 'number', 'switch'].includes(option.type) ? option.type : 'text',
                        default: option.default,
                    })),
            }));
        plugins.push({
            id: entry.name,
            name: manifest.name ? String(manifest.name) : entry.name,
            version: manifest.version ? String(manifest.version) : '',
            description: manifest.description ? String(manifest.description) : '',
            components,
            mainFile,
            renderer: rendererFile ? pathToFileURL(rendererFile).href : null,
            settings: settingsFile ? pathToFileURL(settingsFile).href : null,
            dir,
        });
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'));
    return plugins;
}

// 已激活的插件实例：pluginId → { plugin, trayActions, ipcChannels, ipcListeners, windows, cleanups, settingsListeners }
const activePlugins = new Map();

// 写入某个插件的专属设置（settings.plugins[插件id]），并同步启停状态
function writePluginSettings(pluginId, value) {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const settings = readSettingsObject();
    if (!settings.plugins || typeof settings.plugins !== 'object') settings.plugins = {};
    if (value && typeof value === 'object') settings.plugins[pluginId] = value;
    else delete settings.plugins[pluginId];
    const formatted = `const _settings = ${JSON.stringify(settings, null, 4)}\n\nvar settings = JSON.parse(JSON.stringify(_settings))\n`;
    fs.writeFileSync(settingsPath, formatted, 'utf8');
    loadActivePlugins();
}

function createPluginApi(plugin, instance) {
    return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        dir: plugin.dir,
        resolve: (...parts) => path.join(plugin.dir, ...parts),
        app,
        path,
        shell,
        dialog,
        BrowserWindow,
        screen,
        store,
        // 插件在主进程设置里的专属配置：settings.plugins[插件id]
        getSettings: () => {
            const settings = readSettingsObject();
            const value = settings && settings.plugins && settings.plugins[plugin.id];
            return value && typeof value === 'object' ? value : {};
        },
        // 整个 settings.js 的内容（只读），用于读取主窗口位置等全局设置
        readAppSettings: () => readSettingsObject(),
        // 插件在主进程里保存自己的设置（不会 reload 主窗口，插件可自行响应 onSettingsChanged）
        saveSettings: (value) => {
            writePluginSettings(plugin.id, value);
            return true;
        },
        onSettingsChanged: (callback) => { instance.settingsListeners.push(callback); },
        // 插件自己的持久化数据（electron-store，按插件命名空间隔离）
        storage: {
            get: (key, fallback) => store.get(`plugin-data:${plugin.id}:${key}`, fallback),
            set: (key, value) => { store.set(`plugin-data:${plugin.id}:${key}`, value); },
        },
        // 供渲染层（设置界面 / 插件窗口）调用的请求-响应通道，自动加 plugin:<id>: 前缀并随卸载移除
        registerIpc: (channel, handler) => {
            const full = `plugin:${plugin.id}:${channel}`;
            ipcMain.removeHandler(full);
            ipcMain.handle(full, (event, payload) => handler(payload, event));
            instance.ipcChannels.push(full);
            return full;
        },
        registerIpcListener: (channel, handler) => {
            const full = `plugin:${plugin.id}:${channel}`;
            ipcMain.removeAllListeners(full);
            ipcMain.on(full, (event, payload) => handler(payload, event));
            instance.ipcListeners.push(full);
            return full;
        },
        // 托盘菜单项：点击后先收起菜单再执行 onClick（可弹自己的窗口/对话框）
        addTrayAction: (action) => {
            if (!action || !action.id || !action.label || typeof action.onClick !== 'function') return;
            instance.trayActions.push({
                id: String(action.id),
                label: String(action.label),
                svgText: action.svgText ? String(action.svgText) : (action.svg ? String(action.svg) : ''),
                icon: action.icon,
                onClick: action.onClick,
            });
        },
        createWindow: (options) => {
            const winObj = new BrowserWindow(options && options.transparent
                // 插件创建的透明窗口同样指定全透明预渲染底色，避免显示时闪白
                ? { backgroundColor: '#00000000', ...options }
                : options);
            instance.windows.push(winObj);
            guardRepaint(winObj);
            // 与软件设置窗口一致：把当前主题模式通过 URL 参数注入，
            // 让插件窗口（如点名人数选择窗）首帧就呈现正确的深浅色
            const originalLoadFile = winObj.loadFile.bind(winObj);
            winObj.loadFile = (filePath, loadOptions = {}) => {
                return originalLoadFile(filePath, {
                    ...loadOptions,
                    query: { ...(loadOptions.query || {}), themeMode: readThemeMode() },
                });
            };
            winObj.on('closed', () => {
                instance.windows = instance.windows.filter((item) => item !== winObj);
            });
            return winObj;
        },
        // 复用主界面的提醒展示（遮罩 + 光效 + 音效）
        reminder: {
            show: (payload) => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('reminder-trigger', payload || {});
                }
            },
        },
        broadcast: (channel, payload) => {
            BrowserWindow.getAllWindows().forEach((winObj) => {
                if (!winObj.isDestroyed() && winObj.webContents && !winObj.webContents.isDestroyed()) {
                    winObj.webContents.send(channel, payload);
                }
            });
        },
        getMainWindow: () => (win && !win.isDestroyed() ? win : null),
        // 打开软件设置（可指定初始页面，如 'plugins'）
        openSoftwareSettings: (page) => openSoftwareSettingsWindow(page),
        log: (...args) => console.log(`[plugin:${plugin.id}]`, ...args),
    };
}

function activatePlugin(plugin) {
    const instance = {
        plugin,
        trayActions: [],
        ipcChannels: [],
        ipcListeners: [],
        windows: [],
        cleanups: [],
        settingsListeners: [],
    };
    activePlugins.set(plugin.id, instance);
    if (!plugin.mainFile) return;
    try {
        // 支持热启停：重新启用时清掉 require 缓存，重新执行插件主脚本
        try { delete require.cache[require.resolve(plugin.mainFile)]; } catch (error) { /* 忽略 */ }
        const activator = require(plugin.mainFile);
        const result = typeof activator === 'function' ? activator(createPluginApi(plugin, instance)) : null;
        if (result && typeof result.cleanup === 'function') instance.cleanups.push(result.cleanup);
    } catch (error) {
        console.error(`[plugin] ${plugin.id} 主进程脚本加载失败:`, error);
    }
}

function unloadPlugin(pluginId) {
    const instance = activePlugins.get(pluginId);
    if (!instance) return;
    activePlugins.delete(pluginId);
    instance.cleanups.forEach((cleanup) => {
        try { cleanup(); } catch (error) { console.error(`[plugin] ${pluginId} cleanup 失败:`, error); }
    });
    instance.ipcChannels.forEach((channel) => ipcMain.removeHandler(channel));
    instance.ipcListeners.forEach((channel) => ipcMain.removeAllListeners(channel));
    instance.windows.forEach((winObj) => {
        try { if (!winObj.isDestroyed()) winObj.close(); } catch (error) { /* 忽略 */ }
    });
}

// 按 settings.plugins_enabled 同步启停（设置保存后调用；幂等）
function loadActivePlugins() {
    const enabled = new Set(readEnabledPluginIds());
    Array.from(activePlugins.keys()).forEach((pluginId) => {
        if (!enabled.has(pluginId)) unloadPlugin(pluginId);
    });
    readPlugins().forEach((plugin) => {
        if (!enabled.has(plugin.id) || activePlugins.has(plugin.id)) return;
        activatePlugin(plugin);
    });
    // 插件设置变化通知（已激活插件）
    activePlugins.forEach((instance) => {
        instance.settingsListeners.forEach((callback) => {
            try { callback(instance.plugin); } catch (error) { console.error('[plugin] 设置回调失败:', error); }
        });
    });
}

// 托盘菜单里的插件项（id 形如 plugin:<插件id>:<动作id>）
function getPluginTrayActions() {
    const items = [];
    activePlugins.forEach((instance, pluginId) => {
        instance.trayActions.forEach((action) => {
            items.push({
                id: `plugin:${pluginId}:${action.id}`,
                label: action.label,
                svgText: action.svgText,
                icon: action.icon,
            });
        });
    });
    return items;
}

function executePluginTrayAction(id) {
    const parts = String(id).split(':');
    if (parts.length < 3 || parts[0] !== 'plugin') return false;
    const instance = activePlugins.get(parts[1]);
    const action = instance && instance.trayActions.find((item) => item.id === parts.slice(2).join(':'));
    if (action) {
        // 托盘菜单收起后再执行，避免插件弹窗被菜单失焦逻辑干扰
        setTimeout(() => {
            try { action.onClick(); } catch (error) { console.error('[plugin] 托盘动作执行失败:', error); }
        }, 80);
    }
    return false;
}

// 主窗口渲染层需要的插件信息（渲染脚本 URL + 组件清单）
function getEnabledPluginRenderers() {
    const enabled = new Set(readEnabledPluginIds());
    return readPlugins()
        .filter((plugin) => enabled.has(plugin.id))
        .map((plugin) => ({
            id: plugin.id,
            name: plugin.name,
            renderer: plugin.renderer,
            components: plugin.components,
        }));
}

ipcMain.handle('list-plugins', async () => {
    const enabled = new Set(readEnabledPluginIds());
    const plugins = readPlugins().map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        components: plugin.components,
        hasMain: !!plugin.mainFile,
        settings: plugin.settings,
        renderer: plugin.renderer,
        dir: plugin.dir,
        enabled: enabled.has(plugin.id),
    }));
    return { plugins, dir: PLUGINS_DIR };
})

ipcMain.handle('get-enabled-plugins', async () => getEnabledPluginRenderers())

ipcMain.handle('plugin-settings-get', async (event, pluginId) => {
    const settings = readSettingsObject();
    const value = settings && settings.plugins && settings.plugins[pluginId];
    return value && typeof value === 'object' ? value : {};
})

// 保存某个插件的设置：写入 settings.plugins[插件id]，通知插件并 reload 主窗口
ipcMain.handle('plugin-settings-save', async (event, pluginId, value) => {
    writePluginSettings(pluginId, value);
    if (win && !win.isDestroyed()) reloadMainWindow();
    return true;
})

ipcMain.on('open-plugins-folder', async () => {
    ensurePluginsDir();
    shell.openPath(PLUGINS_DIR);
})

// （插件系统代码结束）

// ===== 安全设置：独立密码保护 =====
// 开启后：打开“软件设置 / 课表配置编辑器”需要验证密码；托盘菜单里的程序控制项
// （退出、重启、上课隐藏、窗口置顶、课上计时、显示次日课程）也要先验证。
// 密码不写入 settings.js：加盐 scrypt 哈希后用系统级加密（Electron safeStorage，
// Windows 下即 DPAPI，绑定当前系统用户）整体加密，保存到用户数据目录下的密钥文件，
// 删除该文件即可重置为无密码状态（忘记密码时的兜底）。
// 可单独开关密码保护的模块（页面 + 托盘控制项）。
// 开关键值保存在 settings.js 的 security_protect（不是机密数据）；
// 密码哈希仍只存在于加密的密钥文件中。
const SECURITY_MODULES = [
    { id: 'settings', label: '打开“软件设置”', group: 'page' },
    { id: 'editor', label: '打开“课表配置编辑器”', group: 'page' },
    { id: 'security', label: '打开“安全设置”页', group: 'page' },
    { id: 'quit', label: '退出程序', group: 'tray' },
    { id: 'restart', label: '重启', group: 'tray' },
    { id: 'hidden', label: '上课隐藏', group: 'tray' },
    { id: 'ontop', label: '窗口置顶', group: 'tray' },
    { id: 'countdown', label: '课上计时', group: 'tray' },
    { id: 'nextday', label: '显示次日课程', group: 'tray' },
];
const SECURITY_MODULE_IDS = new Set(SECURITY_MODULES.map((item) => item.id));

// 读取各模块的保护开关（缺省全部保护，保持与旧行为一致）
function readSecurityModules() {
    const settings = readSettingsObject();
    const saved = settings && settings.security_protect && typeof settings.security_protect === 'object'
        ? settings.security_protect
        : {};
    const result = {};
    SECURITY_MODULES.forEach((module) => {
        result[module.id] = saved[module.id] !== false;
    });
    return result;
}

// 某模块是否受保护：必须先启用密码保护，且该模块开关为开
function isModuleProtected(moduleId) {
    if (!SECURITY_MODULE_IDS.has(moduleId)) return false;
    if (!isSecurityEnabled()) return false;
    return readSecurityModules()[moduleId] === true;
}

function getSecurityFilePath() {
    return path.join(app.getPath('userData'), '.eschedule-lock.dat');
}

function hashSecurityPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function readSecurityRecord() {
    try {
        const raw = fs.readFileSync(getSecurityFilePath());
        if (!raw || !raw.length) return null;
        if (!safeStorage.isEncryptionAvailable()) return null;
        const record = JSON.parse(safeStorage.decryptString(raw));
        return record && record.hash && record.salt ? record : null;
    } catch (error) {
        return null;
    }
}

function isSecurityEnabled() {
    return !!readSecurityRecord();
}

// 简易防爆破：连续 5 次错误后静置 10 秒
let securityFailures = 0;
let securityBlockedUntil = 0;

function verifySecurityPassword(password) {
    if (Date.now() < securityBlockedUntil) return { ok: false, error: '尝试次数过多，请稍后再试' };
    const record = readSecurityRecord();
    if (!record) return { ok: true };
    const candidate = Buffer.from(hashSecurityPassword(password, record.salt), 'hex');
    const expected = Buffer.from(record.hash, 'hex');
    const ok = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    if (ok) {
        securityFailures = 0;
        return { ok: true };
    }
    securityFailures += 1;
    if (securityFailures >= 5) {
        securityBlockedUntil = Date.now() + 10 * 1000;
        securityFailures = 0;
    }
    return { ok: false, error: '密码不正确' };
}

let securityPromptWin = null;
let securityPromptResolve = null;
// 验证通过后验证窗的退场方式：
// - close：立即关闭（默认，如托盘开关类动作）
// - fade：淡出后关闭（页面内验证，如打开“安全设置”页）
// - handoff：先保留，等目标窗口显示时再淡出关闭（打开软件设置/配置编辑器，形成视觉过渡）
let securityPromptExitMode = 'close';
let securityPromptHandoffWin = null;
let securityPromptHandoffTimer = 0;

// 淡出并关闭验证窗（约 180ms），让“密码窗 → 目标窗”之间有过渡而不是瞬间消失
function fadeOutAndClosePrompt(winObj) {
    if (!winObj || winObj.isDestroyed()) return;
    const totalSteps = 9;
    let step = 0;
    const timer = setInterval(() => {
        step += 1;
        if (winObj.isDestroyed()) { clearInterval(timer); return; }
        try { winObj.setOpacity(Math.max(0, 1 - step / totalSteps)); } catch (error) { /* 忽略 */ }
        if (step >= totalSteps) {
            clearInterval(timer);
            winObj.close();
        }
    }, 20);
}

// 目标窗口已经显示：释放被保留的验证窗
function releaseSecurityPromptHandoff() {
    const winObj = securityPromptHandoffWin;
    securityPromptHandoffWin = null;
    if (securityPromptHandoffTimer) {
        clearTimeout(securityPromptHandoffTimer);
        securityPromptHandoffTimer = 0;
    }
    fadeOutAndClosePrompt(winObj);
}

function finishSecurityPrompt(result) {
    const winObj = securityPromptWin;
    securityPromptWin = null;
    const resolve = securityPromptResolve;
    securityPromptResolve = null;
    const mode = result === true ? securityPromptExitMode : 'close';
    securityPromptExitMode = 'close';
    if (winObj && !winObj.isDestroyed()) {
        if (mode === 'handoff') {
            // 交给随后打开的窗口：它显示后调用 releaseSecurityPromptHandoff；
            // 兜底 2.5s（目标窗口未出现时也要淡出，避免验证窗滞留）
            securityPromptHandoffWin = winObj;
            if (securityPromptHandoffTimer) clearTimeout(securityPromptHandoffTimer);
            securityPromptHandoffTimer = setTimeout(releaseSecurityPromptHandoff, 2500);
        } else if (mode === 'fade') {
            fadeOutAndClosePrompt(winObj);
        } else {
            winObj.close();
        }
    }
    if (resolve) resolve(result);
}

// 弹出密码验证窗；返回 Promise<boolean>（验证通过 / 取消）。
// options.handoff：验证通过后由目标窗口释放（带过渡）；options.fade：通过后立即淡出
function promptSecurityPassword(reason, options) {
    return new Promise((resolve) => {
        if (securityPromptWin && !securityPromptWin.isDestroyed()) {
            securityPromptWin.focus();
            resolve(false);
            return;
        }
        securityPromptExitMode = options && options.handoff ? 'handoff' : (options && options.fade ? 'fade' : 'close');
        securityPromptResolve = resolve;
        const mainWin = (win && !win.isDestroyed()) ? win : null;
        const restoreTop = () => {
            if (mainWin && store.get('isWindowAlwaysOnTop', true)) {
                mainWin.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
            }
        };
        if (mainWin) mainWin.setAlwaysOnTop(false);
        // 用局部变量持有本次验证窗：旧窗的 closed 回调不能清空新窗的引用，
        // 否则连续验证时新窗会失去引用、无法被关闭，停在“验证中…”并挡住后面的窗口
        const promptWin = new BrowserWindow({
            width: 380,
            height: 250,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            minimizable: false,
            maximizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            show: false,
            center: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false,
            },
        });
        securityPromptWin = promptWin;
        promptWin.setAlwaysOnTop(true, 'screen-saver');
        guardRepaint(promptWin);
        promptWin.loadFile('security-prompt.html', { query: { reason: String(reason || ''), themeMode: readThemeMode() } });
        promptWin.once('ready-to-show', () => {
            if (!promptWin.isDestroyed()) promptWin.show();
        });
        promptWin.on('closed', () => {
            if (securityPromptWin === promptWin) securityPromptWin = null;
            if (securityPromptHandoffWin === promptWin) {
                securityPromptHandoffWin = null;
                if (securityPromptHandoffTimer) {
                    clearTimeout(securityPromptHandoffTimer);
                    securityPromptHandoffTimer = 0;
                }
            }
            restoreTop();
            if (securityPromptResolve === resolve) {
                securityPromptResolve = null;
                resolve(false);
            }
        });
    });
}

// 已启用密码保护时先验证；未启用直接放行（options 见 promptSecurityPassword）
function withSecurity(reason, options) {
    if (!isSecurityEnabled()) return Promise.resolve(true);
    return promptSecurityPassword(reason, options);
}

// ===== 进程保护：启用密码保护后，不允许被非管理员的“任务管理器 - 结束任务”直接结束 =====
// 通过修改本进程对象的 DACL，拒绝当前用户“结束/挂起进程”的权利：任务管理器结束时会
// 显示“拒绝访问”，避免用结束进程的方式绕过密码。SYSTEM 与管理员（SeDebugPrivilege）
// 仍可管理，不影响注销/关机与系统维护；权限只挂在运行中的进程对象上，进程退出即消失，
// 不会写入任何持久化配置，也不会影响下次启动。
let processGuardActive = false;
let processGuardBusy = false;

function applyProcessGuard() {
    if (process.platform !== 'win32' || processGuardBusy) return;
    processGuardBusy = true;
    const mode = isSecurityEnabled() ? 'protect' : 'restore';
    execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'scripts', 'protect-process.ps1'),
        '-ProcessId', String(process.pid),
        '-Mode', mode,
    ], { windowsHide: true }, (error, stdout) => {
        processGuardBusy = false;
        const ok = !error && /OK/.test(String(stdout || ''));
        if (ok) processGuardActive = mode === 'protect';
        else console.log('进程保护设置失败:', String(stdout || (error && error.message) || '').trim());
    });
}

ipcMain.on('security-attempt', (event, payload) => {
    const result = verifySecurityPassword(String((payload && payload.password) || ''));
    if (result.ok) {
        finishSecurityPrompt(true);
        return;
    }
    const sender = event.sender;
    if (sender && !sender.isDestroyed()) sender.send('security-attempt-result', result);
})

ipcMain.on('security-prompt-cancel', (event) => {
    // 兜底：即使主进程引用已丢失，也能关掉发起取消的那扇验证窗，避免残留挡住界面
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin && !senderWin.isDestroyed()) senderWin.close();
    finishSecurityPrompt(false);
})

// 打开受保护页面（如“安全设置”页）前的验证：未受保护直接放行。
// 页面在已打开的窗口内，验证通过后淡出验证窗即可
ipcMain.handle('security-verify-module', async (event, moduleId) => {
    const id = String(moduleId || '');
    if (!isModuleProtected(id)) return { ok: true, required: false };
    const ok = await promptSecurityPassword('打开该页面需要验证密码', { fade: true });
    return { ok, required: true };
})

ipcMain.handle('security-status', async () => ({
    enabled: isSecurityEnabled(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    processGuard: processGuardActive,
    file: getSecurityFilePath(),
}))

ipcMain.handle('security-set-password', async (event, payload) => {
    const current = String((payload && payload.currentPassword) || '');
    const next = String((payload && payload.password) || '');
    if (next.length < 4) return { ok: false, error: '密码至少 4 位' };
    if (isSecurityEnabled()) {
        const verified = verifySecurityPassword(current);
        if (!verified.ok) return verified;
    }
    if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: '当前系统不支持安全存储（safeStorage 不可用），无法启用密码保护' };
    }
    try {
        const salt = crypto.randomBytes(16).toString('hex');
        const record = { v: 1, salt, hash: hashSecurityPassword(next, salt), updatedAt: Date.now() };
        fs.writeFileSync(getSecurityFilePath(), safeStorage.encryptString(JSON.stringify(record)));
    } catch (error) {
        return { ok: false, error: (error && error.message) || '写入密钥文件失败' };
    }
    securityFailures = 0;
    securityBlockedUntil = 0;
    // 启用密码保护后立即加上进程保护（拒绝被任务管理器结束）
    applyProcessGuard();
    return { ok: true };
})

ipcMain.handle('security-remove-password', async (event, payload) => {
    if (!isSecurityEnabled()) return { ok: true };
    const verified = verifySecurityPassword(String((payload && payload.currentPassword) || ''));
    if (!verified.ok) return verified;
    try { fs.unlinkSync(getSecurityFilePath()); } catch (error) { /* 忽略 */ }
    // 关闭密码保护后解除进程保护
    applyProcessGuard();
    return { ok: true };
})

// 各模块的保护开关（安全设置页使用）
ipcMain.handle('security-modules-get', async () => ({
    modules: SECURITY_MODULES,
    values: readSecurityModules(),
}))

ipcMain.handle('security-modules-set', async (event, payload) => {
    const moduleId = String((payload && payload.module) || '');
    if (!SECURITY_MODULE_IDS.has(moduleId)) return { ok: false, error: '未知的模块' };
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const settings = readSettingsObject();
    if (!settings.security_protect || typeof settings.security_protect !== 'object') settings.security_protect = {};
    settings.security_protect[moduleId] = payload.enabled !== false;
    const formatted = `const _settings = ${JSON.stringify(settings, null, 4)}\n\nvar settings = JSON.parse(JSON.stringify(_settings))\n`;
    fs.writeFileSync(settingsPath, formatted, 'utf8');
    return { ok: true, values: readSecurityModules() };
})

// 主窗口位置模式：top（顶部居中，默认）/ top-right（顶部靠右）/ right（右侧竖排）
function readWindowPositionMode() {
    try {
        const settingsPath = path.join(__dirname, 'js', 'settings.js');
        const code = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
        const reader = new Function(`${code}; return { _settings, settings };`);
        const result = reader();
        const loaded = result && (result._settings || result.settings);
        const mode = loaded && loaded.window_position;
        return (mode === 'top-right' || mode === 'right') ? mode : 'top';
    } catch (error) {
        return 'top';
    }
}

// 按位置模式计算主窗口 bounds。
// top / top-right：全宽置顶（top-right 的右对齐由渲染层 CSS 实现，窗口仍全宽）；
// right：按内容尺寸贴屏幕右侧并垂直居中。
function getMainWindowBounds(mode, contentSize) {
    const workArea = screen.getPrimaryDisplay().workArea;
    if (mode === 'right') {
        const width = Math.max(80, Math.min(Math.round(Number(contentSize?.width) || 420), workArea.width));
        const height = Math.max(40, Math.min(Math.round(Number(contentSize?.height) || 200), workArea.height));
        return {
            x: workArea.x + workArea.width - width,
            y: workArea.y + Math.round((workArea.height - height) / 2),
            width,
            height
        };
    }
    const height = Math.max(40, Math.min(Math.round(Number(contentSize?.height) || 200), workArea.height));
    return { x: workArea.x, y: workArea.y, width: workArea.width, height };
}

// 保存设置/配置后统一走这里 reload：reload 前从磁盘同步最新位置模式，
// 模式变化时立刻重定位，避免新页面异步测量期间窗口位置/尺寸错乱
function reloadMainWindow() {
    if (!win || win.isDestroyed()) return;
    const nextMode = readWindowPositionMode();
    if (nextMode !== win.__positionMode) {
        win.__positionMode = nextMode;
        win.setBounds(getMainWindowBounds(nextMode, null));
    }
    win.reload();
}

// 把 auto 解析为当前实际的深/浅色（user32 亚克力需要自行给 tint，系统不会自动配色）
function resolveConcreteTheme(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// 将主题模式应用到单个亚克力窗口：
//  - DWM 后端（Win11 22H2+）：交给系统材质自动呈现深浅色
//  - user32 后端（Win10 / Win11 21H2）：手动切换亚克力 tint，保证底色与可读性
function applyAcrylicTheme(winObj, mode) {
    if (!winObj || winObj.isDestroyed() || !winObj.__acrylic) return;
    const normalized = mode === 'dark' || mode === 'light' ? mode : 'auto';
    winObj.__themeMode = normalized;
    try {
        if (winObj.__acrylicBackend === 'user32') {
            const tint = USER32_ACRYLIC_TINT[resolveConcreteTheme(normalized)];
            // ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
            winObj.setCustomEffect(4, tint.color, tint.alpha);
        } else if (normalized === 'dark') {
            winObj.setDarkTheme();
        } else if (normalized === 'light') {
            winObj.setLightTheme();
        } else {
            winObj.setAutoTheme();
        }
    } catch (error) {
        console.log('[acrylic] 主题应用失败:', error && error.message ? error.message : error);
    }
}

// 系统主题在“跟随系统”模式下变化时，user32 后端窗口需要重新着色
nativeTheme.on('updated', () => {
    acrylicWindows.forEach((winObj) => {
        if (winObj.__acrylicBackend === 'user32'
            && (!winObj.__themeMode || winObj.__themeMode === 'auto')) {
            applyAcrylicTheme(winObj, 'auto');
        }
    });
});

// 把主题模式广播到主课表条与所有亚克力设置窗口（保存同步与"选择即预览"共用）
function broadcastThemeMode(mode) {
    const normalized = mode === 'dark' || mode === 'light' ? mode : 'auto';
    acrylicWindows.forEach((winObj) => {
        applyAcrylicTheme(winObj, normalized);
        if (!winObj.isDestroyed() && winObj.webContents && !winObj.webContents.isDestroyed()) {
            winObj.webContents.send('settings-theme-changed', normalized);
        }
    });
    // 主界面课表条（非亚克力窗口）：携带模式参数，渲染层直接切换 data-theme
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('theme-mode-changed', normalized);
    }
}

// 创建带 Win11 Mica 材质的设置窗口。
// 非 Windows 或 mica-electron 不可用时静默降级为普通 BrowserWindow（渲染层保持不透明外观）。
// 21H2 等环境下，透明/亚克力窗口在最小化还原或重新显示后可能整窗变白
// （DWM 表面丢失且不再重绘）。统一在 show / restore 时让渲染层失效重绘，
// 并给 user32 亚克力窗口补一次 tint，尽可能恢复到正常画面。
function guardRepaint(winObj) {
    if (!winObj || winObj.__repaintGuarded) return;
    winObj.__repaintGuarded = true;
    const repaint = () => {
        if (winObj.isDestroyed()) return;
        try {
            const contents = winObj.webContents;
            if (contents && !contents.isDestroyed()) contents.invalidate();
        } catch (error) { /* 忽略 */ }
        if (winObj.__acrylicBackend === 'user32') {
            try { applyAcrylicTheme(winObj, winObj.__themeMode || readThemeMode()); } catch (error) { /* 忽略 */ }
        }
    };
    winObj.on('restore', repaint);
    winObj.on('maximize', repaint);
    winObj.on('show', () => setTimeout(repaint, 60));
}

// 首帧渲染完成后再显示（ready-to-show），并保留 2.5s 兜底，
// 避免加载失败时窗口永不出现；透明/Mica 窗口在首帧前显示会闪一下白底
function scheduleFirstShow(winObj, deferShow) {
    if (!deferShow) return;
    let shown = false;
    const show = () => {
        if (shown || winObj.isDestroyed()) return;
        shown = true;
        winObj.show();
    };
    winObj.once('ready-to-show', show);
    setTimeout(show, 2500);
}

function createSettingsWindow(options) {
    const deferShow = options.show !== true;
    const windowOptions = deferShow ? { ...options, show: false } : options;
    if (!acrylicAvailable) {
        const winObj = new BrowserWindow(windowOptions);
        scheduleFirstShow(winObj, deferShow);
        guardRepaint(winObj);
        return winObj;
    }
    // MicaBrowserWindow 构造函数会强制 transparent=true（Electron 27-40）与透明 backgroundColor
    const winObj = new micaElectron.MicaBrowserWindow(windowOptions);
    winObj.__acrylic = true;
    try {
        if (dwmBackdropSupported) {
            // Win11 22H2+：DWM Mica 云母材质
            winObj.__acrylicBackend = 'dwm';
            winObj.setMicaEffect();
            winObj.setRoundedCorner();
        } else {
            // Win10 / Win11 21H2：user32 亚克力。
            // 21H2 不支持 DWMWA_SYSTEMBACKDROP_TYPE，若仍调用 DWM 材质接口，
            // 被强制全透明的窗口会因没有任何底色而“完全透明/看不见亚克力”。
            winObj.__acrylicBackend = 'user32';
            if (micaElectron.IS_WINDOWS_11) {
                // 圆角偏好属性 21H2(22000) 已支持
                winObj.setRoundedCorner();
            }
            applyAcrylicTheme(winObj, readThemeMode());
        }
        if (winObj.__acrylicBackend === 'dwm') {
            applyAcrylicTheme(winObj, readThemeMode());
        }
    } catch (error) {
        console.log('[acrylic] 材质应用失败，窗口仍以普通方式显示:', error && error.message ? error.message : error);
    }
    acrylicWindows.add(winObj);
    winObj.on('closed', () => acrylicWindows.delete(winObj));

    // 通过 URL 参数把已保存的主题模式告知渲染层，使窗口首帧就呈现正确的深浅色。
    // 否则渲染层先以 auto（可能为浅色）挂载、再异步读取设置文件切换，
    // 读取一旦失败或变慢，窗口就会停留在“浅色背景 + 深色标题栏”的错配状态。
    const originalLoadFile = winObj.loadFile.bind(winObj);
    winObj.loadFile = (filePath, options = {}) => {
        return originalLoadFile(filePath, {
            ...options,
            query: { ...(options.query || {}), themeMode: readThemeMode() },
        });
    };

    // mica-electron 在无边框窗口首次显示时会执行一次 hide()→修改 DWM 帧样式→show()。
    // 模态子窗口（临时调课、加载临时课表、退出确认）在这一过程中会被系统重新计算尺寸，
    // 实测会被压到最小约束（560x460 变成 420x240，无最小约束时缩成 140x115）。
    // 等它的样式处理（约 60ms）完成后，把窗口恢复为创建时预期的尺寸与居中位置；
    // 仅纠正一次，不影响用户随后手动拖拽调整（resizable 窗口的预期尺寸已含尺寸记忆）。
    let initialSizeRestored = false;
    const restoreInitialBounds = () => {
        const timer = setTimeout(() => {
            if (initialSizeRestored) return;
            initialSizeRestored = true;
            if (winObj.isDestroyed()) return;
            const expectedW = Number(options.width);
            const expectedH = Number(options.height);
            if (Number.isFinite(expectedW) && Number.isFinite(expectedH)) {
                const [currentW, currentH] = winObj.getSize();
                if (currentW !== expectedW || currentH !== expectedH) {
                    winObj.setSize(expectedW, expectedH);
                    if (options.center) winObj.center();
                }
            }
            // user32 亚克力可能在 mica 的 hide()→show() 序列后被系统重置，再补一次
            if (winObj.__acrylicBackend === 'user32') {
                applyAcrylicTheme(winObj, winObj.__themeMode || readThemeMode());
            }
        }, 160);
        winObj.on('closed', () => clearTimeout(timer));
    };
    winObj.on('show', restoreInitialBounds);

    scheduleFirstShow(winObj, deferShow);
    guardRepaint(winObj);

    return winObj;
}

function openConfigEditorWindow(unlocked) {
    // 启用密码保护且“课表配置编辑器”模块受保护时：打开前需验证
    if (isModuleProtected('editor') && unlocked !== true) {
        // handoff：验证窗保留到目标窗口显示，形成“密码窗 → 编辑器”的过渡
        withSecurity('打开课表配置编辑器需要验证密码', { handoff: true }).then((ok) => { if (ok) openConfigEditorWindow(true); });
        return;
    }
    if (configEditorWin && !configEditorWin.isDestroyed()) {
        configEditorWin.show();
        configEditorWin.focus();
        releaseSecurityPromptHandoff();
        return;
    }

    configEditorWin = createSettingsWindow(applyWindowSizeMemory('configEditor', {
        width: 1200,
        height: 820,
        center: true,
        frame: false,
        minWidth: 980,
        minHeight: 620,
        title: '课表配置编辑器',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }))
    configEditorWin.loadFile(path.join(__dirname, 'dist', 'config-editor.html'))
    saveWindowSizeOnClose('configEditor', configEditorWin)
    // 目标窗口显示后聚焦并淡出验证窗（等 mica 首次 hide→show 序列走完再淡出，避免中间空一帧）
    configEditorWin.once('show', () => {
        configEditorWin.focus();
        setTimeout(releaseSecurityPromptHandoff, 150);
    })
    configEditorWin.on('closed', () => {
        configEditorWin = undefined;
    })
}

function openSoftwareSettingsWindow(page, unlocked) {
    // 启用密码保护且“软件设置”模块受保护时：打开前需验证
    if (isModuleProtected('settings') && unlocked !== true) {
        // handoff：验证窗保留到目标窗口显示，形成“密码窗 → 软件设置”的过渡
        withSecurity('打开软件设置需要验证密码', { handoff: true }).then((ok) => { if (ok) openSoftwareSettingsWindow(page, true); });
        return;
    }
    const targetPage = typeof page === 'string' && page ? page : null;
    if (softwareSettingsWin && !softwareSettingsWin.isDestroyed()) {
        softwareSettingsWin.show();
        softwareSettingsWin.focus();
        // 已打开时通知它切换到指定页面（如插件的“常用应用”浮窗齿轮 -> 插件页）
        if (targetPage) {
            softwareSettingsWin.webContents.send('settings-navigate', targetPage);
        }
        releaseSecurityPromptHandoff();
        return;
    }

    softwareSettingsWin = createSettingsWindow(applyWindowSizeMemory('softwareSettings', {
        width: 1200,
        height: 820,
        center: true,
        frame: false,
        resizable: true,
        minWidth: 980,
        minHeight: 620,
        title: '软件设置',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));
    softwareSettingsWin.loadFile(path.join(__dirname, 'dist', 'software-settings.html'), {
        query: targetPage ? { page: targetPage } : undefined
    });
    saveWindowSizeOnClose('softwareSettings', softwareSettingsWin);
    // 目标窗口显示后聚焦并淡出验证窗（等 mica 首次 hide→show 序列走完再淡出，避免中间空一帧）
    softwareSettingsWin.once('show', () => {
        softwareSettingsWin.focus();
        setTimeout(releaseSecurityPromptHandoff, 150);
    });
    softwareSettingsWin.on('closed', () => {
        softwareSettingsWin = undefined;
    });
}

// 任意窗口请求打开软件设置（可指定初始页面，如插件浮窗的“设置”按钮）
ipcMain.on('open-software-settings', (event, page) => {
    openSoftwareSettingsWindow(typeof page === 'string' ? page : undefined);
})

async function openCourseFusionWindow() {
    if (courseFusionWin && !courseFusionWin.isDestroyed()) {
        courseFusionWin.focus();
        return;
    }

    // 融合窗只加载主窗当前正在显示的课表（使用“加载临时课表”时即为临时日程）
    let fusionContext = { dayIndex: 0, temp: 0 };
    if (win && !win.isDestroyed()) {
        try {
            fusionContext = await win.webContents.executeJavaScript(
                'JSON.stringify({dayIndex: getCurrentDayScheduleIndex(), temp: (function(){var d=new Date();return getCurrentEditedDay(d)!==d.getDay();})()})',
                true
            );
            fusionContext = JSON.parse(fusionContext);
        } catch (error) {
            console.log('[courseFusion] failed to read current day index:', error);
        }
    }

    courseFusionWin = createSettingsWindow(applyWindowSizeMemory('courseFusion', {
        width: 760,
        height: 680,
        center: true,
        frame: false,
        resizable: true,
        minWidth: 620,
        minHeight: 560,
        title: '课程融合',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));
    courseFusionWin.loadFile(path.join(__dirname, 'dist', 'course-fusion.html'), {
        query: {
            dayIndex: String(Number.isInteger(fusionContext.dayIndex) ? fusionContext.dayIndex : 0),
            temp: fusionContext.temp ? '1' : '0'
        }
    });
    saveWindowSizeOnClose('courseFusion', courseFusionWin);
    courseFusionWin.on('closed', () => {
        courseFusionWin = undefined;
    });
}

// “提前放学”临时设置窗口：输入当天的放学时间（深浅色由 createSettingsWindow
// 经 URL 参数注入，跟随软件状态）。内容只保存在主进程内存：重启后不恢复，
// 当天结束后自动恢复默认课表
function openEarlyDismissalWindow() {
    if (earlyDismissalWin && !earlyDismissalWin.isDestroyed()) {
        earlyDismissalWin.focus();
        return;
    }
    earlyDismissalWin = createSettingsWindow(applyWindowSizeMemory('earlyDismissal', {
        width: 480,
        height: 380,
        center: true,
        frame: false,
        resizable: true,
        minWidth: 420,
        minHeight: 320,
        title: '提前放学',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));
    earlyDismissalWin.loadFile(path.join(__dirname, 'dist', 'early-dismissal.html'));
    saveWindowSizeOnClose('earlyDismissal', earlyDismissalWin);
    earlyDismissalWin.on('closed', () => {
        earlyDismissalWin = undefined;
    });
}

app.whenReady().then(() => {
    ensureThemeDir()
    ensurePluginsDir()
    loadActivePlugins()
    createWindow()
    createTrayMenu()
    // 天气设置：开启“自动获取位置”且未指定城市时，启动后后台刷新一次坐标
    const weatherStartup = readWeatherSettings();
    if (weatherStartup.autoLocate && !weatherStartup.city) {
        setTimeout(() => {
            resolveGeoByIp(weatherStartup.allowInsecureHttp).then((geo) => {
                writeWeatherSettings({ latitude: geo.latitude, longitude: geo.longitude, city_name: geo.cityName || '' });
            }).catch(() => { /* 启动定位失败时沿用原坐标 */ });
        }, 4000);
    }
    Menu.setApplicationMenu(null)
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle); // Thank to peter's project https://github.com/tbvjaos510/electron-disable-minimize
    setAutoLaunch()
    setHighPriorityLaunch()
    // 已启用密码保护时恢复进程保护（拒绝任务管理器直接结束）
    applyProcessGuard()
})

function createTrayMenu() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
    }
    tray = new Tray(basePath + 'image/icon.png')
    tray.setToolTip('电子课表 - by lsl and TEG6129BEV15')
    // 左键/右键均弹出自绘菜单（按钮、字体、图标整体放大）
    tray.on('click', openTrayMenu)
    tray.on('right-click', openTrayMenu)
    // 启动即预创建并加载菜单窗口，避免首次点击时才加载导致“页面缺失/延迟”
    ensureTrayMenuWindow()
}

// ===== 自绘托盘菜单（独立的透明无边框窗口） =====
const TRAY_MENU_WIDTH = 248;
// 菜单四周预留的透明边距：容纳菜单投影，避免阴影被窗口边界硬切；
// 同时让 CSS 圆角完全落在窗口内部，配合 roundedCorners:false 消除 Win11 的 DWM 方角残影
const TRAY_MENU_SHADOW_MARGIN = 18;
const TRAY_MENU_WINDOW_WIDTH = TRAY_MENU_WIDTH + TRAY_MENU_SHADOW_MARGIN * 2;
let trayMenuWin = undefined;
let trayMenuReady = false;
// true 表示本次收到尺寸后需要定位并弹出窗口；勾选状态刷新时只更新尺寸
let trayMenuPendingShow = false;
// 组件角标点击时的弹出锚点：{ x, top, bottom, preferBelow }
let trayMenuAnchor = null;
// 最近一次实际弹出的时间戳，用于屏蔽 showInactive 瞬间的失焦抖动
let trayMenuShownAt = 0;

const iconUrl = (name) => require('url').pathToFileURL(path.join(__dirname, 'image', name)).href;

function buildTrayMenuModel() {
    const items = [
        { id: 'adjust', label: '临时调课', icon: iconUrl('adjust.png') },
        { id: 'fusion', label: '课程融合', icon: iconUrl('fusion.png') },
        { id: 'dismissal', label: '提前放学', icon: iconUrl('clock.png') },
        { id: 'temp', label: '加载临时课表', icon: iconUrl('toggle.png') },
        { type: 'separator' },
        { id: 'countdown', label: '课上计时', type: 'checkbox', checked: store.get('isDuringClassCountdown', true) },
        { id: 'ontop', label: '窗口置顶', type: 'checkbox', checked: store.get('isWindowAlwaysOnTop', true) },
        { id: 'hidden', label: '上课隐藏', type: 'checkbox', checked: store.get('isDuringClassHidden', false) },
        { id: 'nextday', label: '显示次日课程（测试）', type: 'checkbox', checked: store.get('showNextDayAfterSchool', false) },
        { type: 'separator' },
        { id: 'editor', label: '课表配置编辑器', icon: iconUrl('editor.png') },
        { id: 'settings', label: '软件设置', icon: iconUrl('setting.png') },
        { type: 'separator' }
    ];
    // 插件扩展的托盘菜单项（如“点名”）：跟随在固定项之后
    const pluginActions = getPluginTrayActions();
    pluginActions.forEach((action) => items.push(action));
    if (pluginActions.length) items.push({ type: 'separator' });
    items.push(
        { id: 'restart', label: '重启', svg: 'restart' },
        { id: 'quit', label: '退出程序', icon: iconUrl('quit.png') }
    );
    return items;
}

function sendTrayMenuData() {
    if (!trayMenuWin || trayMenuWin.isDestroyed() || !trayMenuReady) return;
    trayMenuPendingShow = true;
    pushTrayMenuData();
}

// 仅下发菜单数据（预热刷新），不把窗口标记为“待弹出”
function pushTrayMenuData() {
    if (!trayMenuWin || trayMenuWin.isDestroyed() || !trayMenuReady) return;
    trayMenuWin.webContents.send('tray-menu-data', {
        dark: nativeTheme.shouldUseDarkColors,
        items: buildTrayMenuModel()
    });
}

// 创建并预加载隐藏的菜单窗口；已存在则直接复用
function ensureTrayMenuWindow() {
    if (trayMenuWin && !trayMenuWin.isDestroyed()) return trayMenuWin;
    trayMenuReady = false;
    trayMenuPendingShow = false;
    trayMenuWin = new BrowserWindow({
        width: TRAY_MENU_WINDOW_WIDTH,
        height: 120 + TRAY_MENU_SHADOW_MARGIN * 2,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        // Win11 会给无边框窗口强制加 DWM 圆角，透明窗口四角因此出现方角/黑角残影；
        // 关闭后由页面内 CSS 圆角自绘边角
        roundedCorners: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            backgroundThrottling: false
        }
    });
    trayMenuWin.loadFile('tray-menu.html');
    guardRepaint(trayMenuWin);
    // 点击菜单外任意区域触发失焦，自动收起
    trayMenuWin.on('blur', () => {
        closeTrayMenu();
    });
    trayMenuWin.on('closed', () => {
        trayMenuWin = undefined;
        trayMenuReady = false;
    });
    return trayMenuWin;
}

function openTrayMenu() {
    if (trayMenuWin && !trayMenuWin.isDestroyed() && trayMenuWin.isVisible()) {
        closeTrayMenu();
        return;
    }
    // 窗口通常在启动时已预热完成，这里只做数据刷新与弹出
    ensureTrayMenuWindow();
    if (trayMenuReady) {
        sendTrayMenuData();
    }
    // 未就绪时：tray-menu-ready 到达后仅下发数据；预热阶段不应自动弹出，
    // 因此在 ready 处理器中按 pendingShow 决定
    trayMenuPendingShow = true;
}

function closeTrayMenu() {
    if (trayMenuWin && !trayMenuWin.isDestroyed() && trayMenuWin.isVisible()) {
        trayMenuWin.hide();
    }
    // 恢复主窗口置顶状态
    if (win && !win.isDestroyed() && store.get('isWindowAlwaysOnTop', true)) {
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
    }
}

// 执行菜单项动作；返回 true 表示菜单保持打开（勾选类）。
// unlocked=true 表示已通过密码验证（内部重入时使用）
function executeTrayAction(id, unlocked = false) {
    // 插件扩展项：plugin:<插件id>:<动作id>
    if (typeof id === 'string' && id.startsWith('plugin:')) {
        return executePluginTrayAction(id);
    }
    // 启用密码保护后，程序控制类开关需要先验证密码（按模块开关逐项判断）。
    // 打开“软件设置 / 课表配置编辑器”由各自的打开函数内部校验，这里跳过，
    // 避免同一个动作连续弹出两次验证窗（第二次窗会被旧窗的关闭事件影响而无法关闭）
    const pageOpenAction = id === 'settings' || id === 'editor';
    if (!unlocked && !pageOpenAction && SECURITY_MODULE_IDS.has(id) && isModuleProtected(id)) {
        withSecurity('执行该操作需要验证密码').then((ok) => { if (ok) executeTrayAction(id, true); });
        return false;
    }
    switch (id) {
        case 'adjust':
            win.webContents.send('openSettingDialog');
            return false;
        case 'fusion':
            openCourseFusionWindow();
            return false;
        case 'dismissal':
            openEarlyDismissalWindow();
            return false;
        case 'temp':
            win.webContents.send('setDayOffset');
            return false;
        case 'countdown': {
            const checked = !store.get('isDuringClassCountdown', true);
            store.set('isDuringClassCountdown', checked);
            win.webContents.send('ClassCountdown', checked);
            return true;
        }
        case 'ontop': {
            const checked = !store.get('isWindowAlwaysOnTop', true);
            store.set('isWindowAlwaysOnTop', checked);
            if (checked)
                win.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
            else
                win.setAlwaysOnTop(false);
            return true;
        }
        case 'hidden': {
            const checked = !store.get('isDuringClassHidden', false);
            store.set('isDuringClassHidden', checked);
            win.webContents.send('ClassHidden', checked);
            return true;
        }
        case 'nextday': {
            const checked = !store.get('showNextDayAfterSchool', false);
            store.set('showNextDayAfterSchool', checked);
            win.webContents.send('NextDayAfterSchool', checked);
            return true;
        }
        case 'editor':
            openConfigEditorWindow();
            return false;
        case 'settings':
            openSoftwareSettingsWindow();
            return false;
        case 'restart':
            // 立即退出并重新启动本程序
            app.relaunch();
            app.exit(0);
            return false;
        case 'quit':
            // 右键菜单退出无需二次确认，直接退出
            app.quit();
            return false;
        default:
            return false;
    }
}

ipcMain.on('tray-menu-ready', () => {
    trayMenuReady = true;
    // 预热启动（无弹出意图）时只下发数据，收到尺寸也不显示窗口
    if (trayMenuPendingShow) sendTrayMenuData();
    else pushTrayMenuData();
})

ipcMain.on('tray-menu-size', (event, size) => {
    if (!trayMenuWin || trayMenuWin.isDestroyed() || !size) return;
    const height = Math.max(1, Math.round(size.height || 120));

    // 勾选刷新导致的重渲染：菜单已可见时只跟随更新高度，不重复弹出
    if (trayMenuWin.isVisible()) {
        const bounds = trayMenuWin.getBounds();
        if (bounds.height !== height) {
            trayMenuWin.setBounds({
                x: bounds.x,
                y: bounds.y + bounds.height - height,
                width: TRAY_MENU_WINDOW_WIDTH,
                height
            });
        }
        return;
    }
    if (!trayMenuPendingShow) return;
    trayMenuPendingShow = false;

    // 弹出锚点：组件角标点击（向下弹）优先；否则用托盘图标（优先向上弹）
    const anchor = trayMenuAnchor;
    trayMenuAnchor = null;
    const tb = tray.getBounds();
    const anchorX = anchor ? anchor.x : Math.round(tb.x + tb.width / 2);
    const anchorTop = anchor ? anchor.top : tb.y;
    const anchorBottom = anchor ? anchor.bottom : tb.y + tb.height;
    const display = screen.getDisplayNearestPoint({ x: anchorX, y: anchorTop });
    const wa = display.workArea;
    const m = TRAY_MENU_SHADOW_MARGIN;
    let x = Math.round(anchorX - TRAY_MENU_WINDOW_WIDTH / 2);
    x = Math.max(wa.x + 4 - m, Math.min(x, wa.x + wa.width - TRAY_MENU_WINDOW_WIDTH - 4 + m));
    // 方向选择：足够空间时按偏好方向（角标=向下、托盘图标=向上）；
    // 不足时换向；两侧都不足时选空间更大的一侧，最后统一钳制在工作区内，
    // 避免出现“明明上方有空间却向下弹出”或菜单跑出屏幕的情况。
    // 窗口比菜单大一圈阴影边距 m，定位时减去 m 保证菜单与锚点间的可视间距仍为 gap
    const gap = 8;
    const spaceAbove = anchorTop - (wa.y + 4);
    const spaceBelow = (wa.y + wa.height - 4) - anchorBottom;
    const preferBelow = !!anchor && anchor.preferBelow === true;
    const below = preferBelow
        ? (spaceBelow >= height + gap || spaceBelow >= spaceAbove)
        : !(spaceAbove >= height + gap || spaceAbove >= spaceBelow);
    let y = below ? anchorBottom + gap - m : anchorTop - height - gap + m;
    y = Math.max(wa.y + 4 - m, Math.min(y, wa.y + wa.height - height - 4 + m));
    trayMenuWin.setBounds({ x, y, width: TRAY_MENU_WINDOW_WIDTH, height });
    trayMenuShownAt = Date.now();
    trayMenuWin.show();
    trayMenuWin.focus();
    // 临时取消主窗口置顶，让菜单窗口能正常获取焦点
    if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(false);
    }
})

ipcMain.on('tray-menu-action', (event, id) => {
    const keepOpen = executeTrayAction(id);
    if (keepOpen) {
        // 勾选类：保持菜单打开并刷新勾选状态
        sendTrayMenuData();
    } else {
        closeTrayMenu();
    }
})

ipcMain.on('tray-menu-close', () => {
    closeTrayMenu();
})

// ===== 天气组件：主进程代理网络请求（绕开 CORS），结果缓存 10 分钟 =====
const weatherCache = new Map(); // cityKey -> { at, data }
const WEATHER_TTL = 10 * 60 * 1000;

// WMO 天气代码 -> [中文描述, emoji]
const WEATHER_CODE_MAP = {
    0: ['晴', '☀️'],
    1: ['大致晴朗', '🌤️'], 2: ['局部多云', '⛅'], 3: ['阴', '☁️'],
    45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
    51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌧️'],
    56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
    61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
    71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
    80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
    85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷阵雨伴冰雹', '⛈️'],
};

async function fetchWeatherJson(url, timeoutMs = 8000) {
    // 显式超时：net.fetch 默认可能长时间挂起，导致组件一直停留在占位状态
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await net.fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// 上次成功结果落盘，网络全失败时兜底，避免直接显示“天气不可用”
function getWeatherDiskCachePath() {
    return path.join(app.getPath('userData'), 'weather-cache.json');
}
function readWeatherDiskCache() {
    try { return JSON.parse(fs.readFileSync(getWeatherDiskCachePath(), 'utf8')) || {}; }
    catch { return {}; }
}
function writeWeatherDiskCache(cache) {
    try { fs.writeFileSync(getWeatherDiskCachePath(), JSON.stringify(cache), 'utf8'); }
    catch { /* 磁盘不可写时忽略 */ }
}

// 兜底供应商返回的城市名多为英文，用 open-meteo geocoding 反查中文名；
// 失败或本就是中文则原样返回
async function localizeCityName(cityName) {
    if (!cityName || /[\u4e00-\u9fa5]/.test(cityName)) return cityName;
    try {
        const found = await fetchWeatherJson(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=zh&format=json`
        );
        const place = found?.results?.[0];
        if (place && place.name) return place.name;
    } catch { /* 保留原名 */ }
    return cityName;
}

// 自动定位：多供应商兜底，默认全部使用 HTTPS（TLS）。
// 天气设置页提供“不使用 TLS 协议获取天气”开关（默认关）：开启后才追加明文 HTTP 的
// ip-api 作为最后兜底，兼容无法访问 HTTPS 定位接口的网络环境。
async function resolveGeoByIp(allowInsecure = false) {
    try {
        const geo = await fetchWeatherJson('https://ipinfo.io/json');
        if (typeof geo.loc === 'string') {
            const pair = geo.loc.split(',').map(Number);
            if (pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) {
                return { latitude: pair[0], longitude: pair[1], cityName: await localizeCityName(geo.city || '') };
            }
        }
    } catch (error) {
        console.log('[weather] ipinfo.io 定位失败:', error && error.message ? error.message : error);
    }
    try {
        const geo = await fetchWeatherJson('https://ipwho.is/');
        const lat = Number(geo.latitude);
        const lon = Number(geo.longitude);
        if (geo.success !== false && Number.isFinite(lat) && Number.isFinite(lon)) {
            return { latitude: lat, longitude: lon, cityName: await localizeCityName(geo.city || '') };
        }
    } catch (error) {
        console.log('[weather] ipwho.is 定位失败:', error && error.message ? error.message : error);
    }
    try {
        const geo = await fetchWeatherJson('https://get.geojs.io/v1/ip/geo.json');
        const lat = Number(geo.latitude);
        const lon = Number(geo.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { latitude: lat, longitude: lon, cityName: await localizeCityName(geo.city || '') };
        }
    } catch (error) {
        console.log('[weather] geojs.io 定位失败:', error && error.message ? error.message : error);
    }
    // 仅在用户明确允许时使用明文 HTTP 供应商
    if (allowInsecure) {
        try {
            const geo = await fetchWeatherJson('http://ip-api.com/json/?lang=zh-CN');
            if (geo.status === 'success' && typeof geo.lat === 'number') {
                return { latitude: geo.lat, longitude: geo.lon, cityName: geo.city || geo.regionName || '' };
            }
        } catch (error) {
            console.log('[weather] ip-api（明文 HTTP）定位失败:', error && error.message ? error.message : error);
        }
    }
    throw new Error('all geo providers failed');
}

// ===== 天气设置（settings.weather）=====
// 城市、坐标、自动定位、图标包、排除的气象预警、是否允许明文 HTTP。
// 组件与提醒的天气都使用这里的城市：优先组件自身的城市设置，其次全局城市，最后自动定位。
function readWeatherSettings() {
    const settings = readSettingsObject();
    const value = settings && settings.weather && typeof settings.weather === 'object' ? settings.weather : {};
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    return {
        city: typeof value.city === 'string' ? value.city : '',
        cityName: typeof value.city_name === 'string' ? value.city_name : '',
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        autoLocate: value.auto_locate !== false,
        iconPack: value.icon_pack === 'text' ? 'text' : 'emoji',
        excludedAlerts: Array.isArray(value.excluded_alerts)
            ? value.excluded_alerts.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
            : [],
        allowInsecureHttp: value.allow_insecure_http === true,
    };
}

function writeWeatherSettings(patch) {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const settings = readSettingsObject();
    const current = settings && settings.weather && typeof settings.weather === 'object' ? settings.weather : {};
    settings.weather = { ...current, ...(patch || {}) };
    const formatted = `const _settings = ${JSON.stringify(settings, null, 4)}\n\nvar settings = JSON.parse(JSON.stringify(_settings))\n`;
    fs.writeFileSync(settingsPath, formatted, 'utf8');
    return readWeatherSettings();
}

ipcMain.handle('get-weather', async (event, cityInput) => {
    const weatherSettings = readWeatherSettings();
    const key = String(cityInput || '').trim() || String(weatherSettings.city || '').trim() || 'auto';
    const cached = weatherCache.get(key);
    if (cached && Date.now() - cached.at < WEATHER_TTL) return cached.data;
    try {
        let latitude;
        let longitude;
        let cityName;
        if (key === 'auto') {
            // 已保存过坐标时直接复用（避免每次刷新都请求定位接口）
            if (weatherSettings.latitude !== null && weatherSettings.longitude !== null) {
                latitude = weatherSettings.latitude;
                longitude = weatherSettings.longitude;
                cityName = weatherSettings.cityName;
            } else {
                ({ latitude, longitude, cityName } = await resolveGeoByIp(weatherSettings.allowInsecureHttp));
                writeWeatherSettings({ latitude, longitude, city_name: cityName || '' });
            }
        } else {
            const found = await fetchWeatherJson(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(key)}&count=1&language=zh&format=json`
            );
            const place = found?.results?.[0];
            if (!place) throw new Error('city not found');
            latitude = place.latitude;
            longitude = place.longitude;
            cityName = place.name || key;
        }
        // 预报接口偶发抖动，失败重试一次
        let weather;
        for (let attempt = 0; ; attempt++) {
            try {
                weather = await fetchWeatherJson(
                    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
                    + '&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto'
                );
                break;
            } catch (error) {
                if (attempt >= 1) throw error;
            }
        }
        // 空气质量单独接口，失败不影响天气主体
        let aqi = null;
        try {
            const air = await fetchWeatherJson(
                `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi`
            );
            const value = Number(air?.current?.us_aqi);
            if (Number.isFinite(value)) aqi = Math.round(value);
        } catch (error) { /* 忽略空气质量失败 */ }
        const code = weather?.current?.weather_code;
        const temp = Number(weather?.current?.temperature_2m);
        const humidity = Number(weather?.current?.relative_humidity_2m);
        const wind = Number(weather?.current?.wind_speed_10m);
        const [text, emoji] = WEATHER_CODE_MAP[code] || ['未知', '🌡️'];
        const data = {
            city: cityName,
            temp: Number.isFinite(temp) ? Math.round(temp) : null,
            text,
            emoji,
            code: Number.isFinite(Number(code)) ? Number(code) : null,
            humidity: Number.isFinite(humidity) ? Math.round(humidity) : null,
            wind: Number.isFinite(wind) ? Math.round(wind * 10) / 10 : null,
            aqi,
            updatedAt: Date.now(),
        };
        weatherCache.set(key, { at: Date.now(), data });
        const diskCache = readWeatherDiskCache();
        diskCache[key] = { at: Date.now(), data };
        writeWeatherDiskCache(diskCache);
        return data;
    } catch (error) {
        console.log('[weather] 获取天气失败:', error && error.message ? error.message : error);
        // 优先回落到上次成功数据；只有从未成功过才显示不可用
        const stale = readWeatherDiskCache()[key];
        if (stale && stale.data) return Object.assign({ stale: true }, stale.data);
        return { error: true };
    }
})

// 立即重新定位（天气设置页的“坐标定位”），并把坐标写回 settings.weather
ipcMain.handle('weather-locate', async () => {
    const weatherSettings = readWeatherSettings();
    try {
        const geo = await resolveGeoByIp(weatherSettings.allowInsecureHttp);
        writeWeatherSettings({
            latitude: geo.latitude,
            longitude: geo.longitude,
            city_name: geo.cityName || '',
        });
        weatherCache.clear();
        return { ok: true, latitude: geo.latitude, longitude: geo.longitude, cityName: geo.cityName || '' };
    } catch (error) {
        return { ok: false, error: (error && error.message) || '定位失败' };
    }
})

// 城市搜索（天气设置页的“选择城市”）
ipcMain.handle('weather-search-city', async (event, keyword) => {
    const query = String(keyword || '').trim();
    if (!query) return { results: [] };
    try {
        const found = await fetchWeatherJson(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=zh&format=json`
        );
        return {
            results: (found?.results || []).map((place) => ({
                name: place.name,
                admin1: place.admin1 || '',
                country: place.country || '',
                latitude: place.latitude,
                longitude: place.longitude,
            })),
        };
    } catch (error) {
        return { error: (error && error.message) || '搜索失败' };
    }
})

ipcMain.handle('weather-settings-get', async () => readWeatherSettings())

ipcMain.handle('weather-settings-save', async (event, patch) => {
    const next = writeWeatherSettings(patch || {});
    weatherCache.clear();
    if (win && !win.isDestroyed()) reloadMainWindow();
    return { ok: true, settings: next };
})

// ===== 地震速报：聚合中国地震台网正式测定（wolfx 镜像），渲染进程每分钟轮询，
//       由渲染层按震级/时间/已通知 ID 自行过滤去重 =====
let quakeCache = null; // { at, list }
const QUAKE_TTL = 60 * 1000;

function parseBeijingEpoch(text) {
    const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    // 源数据为北京时间（UTC+8），减 8 小时得到 UTC，Date.UTC 自动处理跨日
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
}

ipcMain.handle('get-earthquakes', async () => {
    if (quakeCache && Date.now() - quakeCache.at < QUAKE_TTL) return quakeCache.list;
    try {
        const json = await fetchWeatherJson('https://api.wolfx.jp/cenc_eqlist.json');
        const list = Object.keys(json)
            .filter((k) => /^No\d+$/.test(k))
            .map((k) => {
                const ev = json[k] || {};
                const magnitude = parseFloat(ev.magnitude);
                const depth = parseFloat(ev.depth);
                return {
                    id: String(ev.EventID || ''),
                    type: String(ev.type || ''),           // reviewed=正式测定 automatic=自动测定
                    location: String(ev.location || ''),
                    magnitude: Number.isFinite(magnitude) ? magnitude : null,
                    depth: Number.isFinite(depth) ? depth : null,
                    time: String(ev.time || ''),
                    epochMs: parseBeijingEpoch(ev.time),
                };
            })
            .filter((ev) => ev.id && ev.epochMs !== null && ev.magnitude !== null);
        quakeCache = { at: Date.now(), list };
        return list;
    } catch (error) {
        console.log('[quake] 获取地震速报失败:', error && error.message ? error.message : error);
        // 失败时允许渲染层继续使用不超过 5 分钟的陈旧缓存，再旧则报错
        if (quakeCache && Date.now() - quakeCache.at < 5 * 60 * 1000) return quakeCache.list;
        return { error: true };
    }
})

ipcMain.on('log', (e, arg) => {
    console.log(arg);
})

// 仅在实际变化时才调用原生 API：滑动过程中渲染进程会按悬停元素频繁
// 发送 setIgnore，重复设置会触发 Windows 重新 hit-test、打断转发事件流
// 并产生合成 mouseleave，是低速滑动闪烁/高速滑动不淡化的根源之一。
let lastIgnoreState = null
ipcMain.on('setIgnore', (e, arg) => {
    const next = !!arg
    if (next === lastIgnoreState) return
    lastIgnoreState = next
    if (next)
        win.setIgnoreMouseEvents(true, { forward: true });
    else
        win.setIgnoreMouseEvents(false);
})

// 主界面尺寸自适应：渲染进程测量内容（组件行 + 课程下方倒计时框等）后上报。
// top / top-right 只用高度（窗口全宽置顶）；right 同时使用宽度（贴右垂直居中）。
ipcMain.on('main-window-height', (e, arg) => {
    if (!win || win.isDestroyed()) return;
    const mode = win.__positionMode || 'top';
    // 兼容旧调用（纯数字高度）与新调用（{width, height}）
    const size = (arg && typeof arg === 'object')
        ? { width: Number(arg.width) || 0, height: Number(arg.height) || 0 }
        : { width: 0, height: Number(arg) || 0 };
    const current = win.getBounds();
    const next = getMainWindowBounds(mode, {
        width: size.width || current.width,
        height: size.height || current.height
    });
    if (current.x !== next.x || current.y !== next.y
        || current.width !== next.width || current.height !== next.height) {
        win.setBounds(next);
    }
})

ipcMain.on('reminder-trigger', (e, payload) => {
    if (win && !win.isDestroyed()) {
        win.webContents.send('reminder-trigger', payload || {});
    }
})

// ===== 全屏提醒：独立的透明无边框置顶窗口（主窗口在 top 模式下只有顶部一条，
//       无法承载全屏遮罩） =====
let reminderWin = undefined;
let reminderWinReady = false;
let reminderCloseTimer = null;

function ensureReminderWindow() {
    if (reminderWin && !reminderWin.isDestroyed()) return reminderWin;
    reminderWinReady = false;
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    reminderWin = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
    });
    reminderWin.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
    guardRepaint(reminderWin);
    reminderWin.loadFile('reminder.html');
    reminderWin.once('ready-to-show', () => reminderWinReady = true);
    reminderWin.webContents.on('did-finish-load', () => {
        reminderWinReady = true;
        // 光效层只看不可点：整窗鼠标穿透，不阻挡用户正常操作
        if (reminderWin && !reminderWin.isDestroyed()) reminderWin.setIgnoreMouseEvents(true);
    });
    reminderWin.on('closed', () => {
        reminderWin = undefined;
        reminderWinReady = false;
    });
    return reminderWin;
}

// 遮罩被提前关闭时：通知光效从当前状态快速淡出，随后隐藏窗口
function hideFullscreenReminder() {
    clearTimeout(reminderCloseTimer);
    if (!reminderWin || reminderWin.isDestroyed()) return;
    try { reminderWin.webContents.send('reminder-glow-hide'); } catch { /* 窗口尚未加载完成 */ }
    reminderCloseTimer = setTimeout(() => {
        if (reminderWin && !reminderWin.isDestroyed()) reminderWin.hide();
    }, 300);
}

// 光效固定播放时长：1 秒扩散+渐隐动画，与提醒时长无关
const REMINDER_GLOW_MS = 1000;

function showFullscreenReminder(payload) {
    const data = payload || {};
    const rw = ensureReminderWindow();
    clearTimeout(reminderCloseTimer);
    // 扩散原点：渲染层给出的课表条中心（主窗口客户区 DIP）换算成光效窗坐标
    const dispBounds = screen.getPrimaryDisplay().bounds;
    const winBounds = (win && !win.isDestroyed()) ? win.getBounds() : { x: dispBounds.x, y: dispBounds.y };
    const originX = Number(data.originX);
    const originY = Number(data.originY);
    const glowData = Object.assign({}, data);
    if (Number.isFinite(originX) && Number.isFinite(originY)) {
        glowData.originX = winBounds.x - dispBounds.x + originX;
        glowData.originY = winBounds.y - dispBounds.y + originY;
    }
    const push = () => rw.webContents.send('reminder-data', glowData);
    if (reminderWinReady) push();
    else rw.webContents.once('did-finish-load', push);
    if (!rw.isVisible()) rw.showInactive();
    rw.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
    // show 后部分系统会重置穿透状态，重新断言一次
    rw.setIgnoreMouseEvents(true);
    // 1 秒动画播完（终点即全透明）后直接隐藏，不再绑定提醒时长
    reminderCloseTimer = setTimeout(() => {
        if (reminderWin && !reminderWin.isDestroyed()) reminderWin.hide();
    }, REMINDER_GLOW_MS + 60);
}

ipcMain.on('reminder-fullscreen', (e, payload) => showFullscreenReminder(payload));
ipcMain.on('reminder-fullscreen-close', hideFullscreenReminder);

// ===== 提醒期间临时置顶主窗口，结束后按原设置恢复 =====
let reminderPinTimer = null;
ipcMain.on('reminder-pin', (e, arg) => {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
    clearTimeout(reminderPinTimer);
    const duration = Number(arg && arg.duration);
    const ms = Number.isFinite(duration) && duration > 0 ? duration : 5000;
    reminderPinTimer = setTimeout(() => {
        if (win && !win.isDestroyed() && store.get('isWindowAlwaysOnTop', true)) {
            win.setAlwaysOnTop(true, 'screen-saver', 9999999999999);
        } else if (win && !win.isDestroyed()) {
            win.setAlwaysOnTop(false);
        }
    }, ms + 1200);
});

// 自定义提醒音效文件选择
ipcMain.handle('select-reminder-sound', async () => {
    const result = await dialog.showOpenDialog({
        title: '选择提醒音效',
        properties: ['openFile'],
        filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return '';
    return result.filePaths[0];
});

// ===== 系统强调色：提醒"默认颜色"跟随 Windows 设置 → 个性化 → 颜色 =====
ipcMain.handle('get-system-accent', () => {
    try {
        // 实测 Windows 下返回 8 位 ARGB 十六进制（如 '006fc4e3'，可能带 # 前缀），取低 24 位 RGB
        const hex = String(systemPreferences.getAccentColor() || '').replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return '#' + hex.slice(-6).toUpperCase();
    } catch (error) { /* 平台不支持时返回空，渲染进程走兜底色 */ }
    return '';
});

// ===== 自动化动作：打开应用 / 执行命令 / 自动关机 =====
ipcMain.handle('automation-open-app', async (event, target) => {
    const p = String(target || '').trim();
    if (!p) return { ok: false, error: '路径为空' };
    try {
        const err = await shell.openPath(p);
        return { ok: !err, error: err || '' };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
});

ipcMain.handle('automation-exec', async (event, command) => {
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: false, error: '命令为空' };
    return new Promise((resolve) => {
        exec(cmd, { windowsHide: true, timeout: 30000 }, (error) => {
            resolve({ ok: !error, error: error ? String(error.message || error) : '' });
        });
    });
});

ipcMain.handle('automation-shutdown', async (event, seconds) => {
    const delay = Math.max(0, Math.min(86400, Math.round(Number(seconds) || 60)));
    return new Promise((resolve) => {
        exec(`shutdown /s /t ${delay}`, { windowsHide: true }, (error) => {
            resolve({ ok: !error, error: error ? String(error.message || error) : '' });
        });
    });
});

// ===== 自动化触发：监视指定外部程序启动（渲染进程下发监视名单，出现沿触发） =====
let watchedProcesses = [];
let watchTimer = null;
const lastWatchState = new Map(); // 小写进程名 -> 上一轮是否在运行
function pollWatchedProcesses() {
    if (!watchedProcesses.length) return;
    // 一次性枚举全部进程（CSV 首列形如 "qq.exe"），避免逐个进程名各起一个子进程
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout) return;
        const lower = String(stdout).toLowerCase();
        watchedProcesses.forEach((name) => {
            const key = name.toLowerCase().replace(/"/g, '');
            if (!key) return;
            const running = lower.includes(`"${key}"`);
            const prev = lastWatchState.get(key) || false;
            if (running && !prev && win && !win.isDestroyed()) {
                win.webContents.send('automation-app-launch', { name: key, at: Date.now() });
            }
            lastWatchState.set(key, running);
        });
    });
}
ipcMain.on('automation-watch-processes', (event, names) => {
    watchedProcesses = Array.isArray(names) ? names.map((n) => String(n).trim()).filter(Boolean) : [];
    lastWatchState.clear();
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    if (watchedProcesses.length) {
        pollWatchedProcesses();
        watchTimer = setInterval(pollWatchedProcesses, 3000);
    }
});

ipcMain.on('window-control', (event, action) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) return;

    if (action === 'close') {
        targetWindow.close();
    } else if (action === 'minimize') {
        targetWindow.minimize();
    } else if (action === 'toggle-maximize' && targetWindow.isMaximizable()) {
        if (targetWindow.isMaximized()) targetWindow.unmaximize();
        else targetWindow.maximize();
    }
})

// 渲染进程挂载时查询当前窗口是否启用了亚克力材质，据此切换半透明 CSS
ipcMain.handle('window-acrylic-state', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    return {
        enabled: !!(targetWindow && targetWindow.__acrylic),
        mode: readThemeMode()
    };
})

// 渲染进程切换主题模式（自动/深色/浅色）时，同步所有亚克力窗口的 DWM 材质深浅色
ipcMain.on('acrylic-theme-changed', (event, mode) => {
    const normalized = mode === 'dark' || mode === 'light' ? mode : 'auto';
    acrylicWindows.forEach((winObj) => applyAcrylicTheme(winObj, normalized));
})

// 基础设置中选择深/浅色后立即预览（尚未保存到文件）：主界面与所有窗口即刻切换
ipcMain.on('theme-mode-preview', (event, mode) => {
    broadcastThemeMode(mode);
});

// 基础设置中选择窗口位置后立即预览（尚未保存到文件）：主窗口即刻重排
ipcMain.on('window-position-preview', (event, mode) => {
    const normalized = (mode === 'top-right' || mode === 'right') ? mode : 'top';
    if (!win || win.isDestroyed()) return;
    win.__positionMode = normalized;
    // 渲染端完成新模式布局后会经 apply-position-bounds 一次性 setBounds 到终态
    win.webContents.send('position-mode-changed', normalized);
})

// 位置切换动画的"终态尺寸"通道：渲染端完成新模式布局后调用，
// 主窗口一次性 setBounds 到终态矩形，渲染端再播放 FLIP 动画，
// 避免"先在旧窗口里播动画、结束后再跳变尺寸"的割裂感
ipcMain.handle('apply-position-bounds', (event, contentSize) => {
    if (!win || win.isDestroyed()) return false;
    const mode = win.__positionMode || 'top';
    const next = getMainWindowBounds(mode, contentSize);
    const current = win.getBounds();
    if (current.x !== next.x || current.y !== next.y
        || current.width !== next.width || current.height !== next.height) {
        win.setBounds(next);
    }
    return next;
})

let scheduleDialog = null;

ipcMain.on('dialog', (e, arg) => {
    if (scheduleDialog && !scheduleDialog.isDestroyed()) {
        scheduleDialog.focus();
        return;
    }

    const safePayload = {
        title: arg?.options?.title || '配置课表',
        message: arg?.options?.message || '请选择操作',
        buttons: Array.isArray(arg?.options?.buttons) ? arg.options.buttons : [],
        defaultIndex: Number.isInteger(arg?.options?.defaultId) ? arg.options.defaultId : 0,
    };

    const dialogWindow = createSettingsWindow(applyWindowSizeMemory('scheduleDialog', {
        width: 560,
        height: 460,
        center: true,
        frame: false,
        resizable: true,
        minimizable: true,
        maximizable: true,
        show: false,
        title: safePayload.title,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));

    scheduleDialog = dialogWindow;
    saveWindowSizeOnClose('scheduleDialog', dialogWindow);

    dialogWindow.loadFile(path.join(__dirname, 'dist', 'schedule-dialog.html'), {
        query: {
            data: encodeURIComponent(JSON.stringify(safePayload))
        }
    });

    dialogWindow.once('ready-to-show', () => {
        dialogWindow.show();
    });

    const resultHandler = (event, index) => {
        if (event.sender !== dialogWindow.webContents) return;
        ipcMain.removeListener('schedule-dialog-result', resultHandler);
        const result = index === null || index === undefined ? -1 : Number(index);
        // 立即释放单例：渲染进程收到回复后可能立刻请求下一个对话框（如临时调课的第二步），
        // 此时旧窗口尚未触发 closed，若不置空会导致第二个对话框无法创建。
        scheduleDialog = null;
        e.reply(arg.reply, { 'arg': arg, 'index': result });
    };
    ipcMain.on('schedule-dialog-result', resultHandler);

    dialogWindow.on('closed', () => {
        ipcMain.removeListener('schedule-dialog-result', resultHandler);
        if (scheduleDialog === dialogWindow) {
            scheduleDialog = null;
        }
    });

})

ipcMain.handle('read-config-file', async () => {
    const configPath = path.join(__dirname, 'js', 'scheduleConfig.js');
    // 去除 BOM：个别编辑器保存的配置文件带 BOM 时，new Function 会直接抛语法错误
    const code = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const reader = new Function(`${code}; return { _scheduleConfig, scheduleConfig };`);
    const result = reader();
    return result && result._scheduleConfig ? result._scheduleConfig : result && result.scheduleConfig ? result.scheduleConfig : {};
})

ipcMain.handle('read-settings-file', async () => {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const code = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const reader = new Function(`${code}; return { _settings, settings };`);
    const result = reader();
    return result && result._settings ? result._settings : result && result.settings ? result.settings : {};
})

ipcMain.handle('import-config-file', async () => {
    const result = await dialog.showOpenDialog(configEditorWin, {
        title: '导入课表配置',
        properties: ['openFile'],
        filters: [
            { name: 'scheduleConfig.js', extensions: ['js'] },
            { name: 'JavaScript 文件', extensions: ['js'] }
        ]
    });

    if (result.canceled || !result.filePaths.length) return null;

    const code = fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    const reader = new Function(`${code}; return { _scheduleConfig, scheduleConfig };`);
    const imported = reader();
    const config = imported && (imported._scheduleConfig || imported.scheduleConfig);
    if (!config || !Array.isArray(config.daily_class)) {
        throw new Error('导入文件缺少有效的 daily_class 配置');
    }
    return config;
})

// 解析 CSES 文件文本：官方格式为 YAML，也接受 JSON 变体（在线编辑器支持导出 JSON）
function parseCsesText(text) {
    let data;
    try {
        data = yaml.load(text);
    } catch (yamlError) {
        try {
            data = JSON.parse(text);
        } catch (jsonError) {
            throw new Error('CSES 文件解析失败：既不是有效的 YAML，也不是有效的 JSON');
        }
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.schedules)) {
        throw new Error('不是有效的 CSES 文件：缺少 schedules 课程表列表');
    }
    return data;
}

ipcMain.handle('import-cses-file', async () => {
    const result = await dialog.showOpenDialog(configEditorWin, {
        title: '从 CSES 导入课表',
        properties: ['openFile'],
        filters: [
            { name: 'CSES 课表文件', extensions: ['yml', 'yaml', 'json'] },
            { name: '所有文件', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const text = fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    return parseCsesText(text);
})

// 从表格（Excel / CSV）或图片（Windows OCR）导入课表。
// 只做解析：主进程返回结构化结果，编辑器负责合并进草稿并由用户确认保存。
ipcMain.handle('import-schedule-table', async () => {
    const result = await dialog.showOpenDialog(configEditorWin, {
        title: '从表格或图片导入课表',
        properties: ['openFile'],
        filters: [
            { name: '表格或图片', extensions: ['xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'] },
            { name: '表格文件', extensions: ['xlsx', 'xls', 'csv'] },
            { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'] },
            { name: '所有文件', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
            return { kind: 'table', parsed: parseTableFile(filePath) };
        }
        return { kind: 'image', parsed: await parseImageFile(filePath) };
    } catch (error) {
        return { error: (error && error.message) || '导入解析失败' };
    }
})

ipcMain.handle('export-cses-file', async (event, cses) => {
    const result = await dialog.showSaveDialog(configEditorWin, {
        title: '导出为 CSES 课表文件',
        defaultPath: 'class-schedule.cses.yml',
        filters: [
            { name: 'CSES YAML 文件', extensions: ['yml'] }
        ]
    });
    if (result.canceled || !result.filePath) return null;
    // noRefs 避免共享引用被序列化成 YAML 锚点；lineWidth:-1 不折行。
    // 07:50:00 这类时间会被 js-yaml 自动加引号，避免 PyYAML 等 YAML 1.1
    // 解析器按六十进制整数误读
    const output = yaml.dump(cses, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(result.filePath, output, 'utf8');
    return result.filePath;
})

ipcMain.handle('save-config-file', async (event, config) => {
    const configPath = path.join(__dirname, 'js', 'scheduleConfig.js');
    const formatted = `const _scheduleConfig = ${JSON.stringify(config, null, 4)}\n\nvar scheduleConfig = JSON.parse(JSON.stringify(_scheduleConfig))\n`;
    fs.writeFileSync(configPath, formatted, 'utf8');
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
        if (sourceWindow && !sourceWindow.isDestroyed()) {
            win.webContents.once('did-finish-load', () => {
                if (!sourceWindow.isDestroyed()) sourceWindow.focus();
            });
        }
        reloadMainWindow();
    }
    if (sourceWindow && !sourceWindow.isDestroyed()) {
        sourceWindow.focus();
    }
    return true;
})

ipcMain.handle('save-settings-file', async (event, settings, options) => {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    // security_protect（逐模块密码保护开关）由 security-modules-set 单独写入磁盘，
    // 渲染层的 settingsRef 可能仍是旧值；这里以磁盘上的最新值为准，
    // 避免用户改完模块开关后再改其它设置时，被旧的 security_protect 覆盖丢失。
    const onDisk = readSettingsObject();
    if (onDisk && onDisk.security_protect && typeof onDisk.security_protect === 'object') {
        if (!settings || typeof settings !== 'object') settings = {};
        settings.security_protect = onDisk.security_protect;
    }
    const formatted = `const _settings = ${JSON.stringify(settings, null, 4)}\n\nvar settings = JSON.parse(JSON.stringify(_settings))\n`;
    fs.writeFileSync(settingsPath, formatted, 'utf8');
    // 主题模式可能随设置一起改变，立即同步主界面与所有 Mica 窗口的深浅色
    if (settings && (settings.theme_mode === 'dark' || settings.theme_mode === 'light' || settings.theme_mode === 'auto')) {
        broadcastThemeMode(settings.theme_mode);
    }
    // 启用的主题包可能改变，热广播到所有窗口
    broadcastActiveTheme();
    // 插件启用状态可能改变：同步启停插件（新增托盘项/窗口，或卸载清理）
    loadActivePlugins();
    // 窗口位置切换已由 window-position-preview 热应用并播放动画，
    // 随后的落盘不需要再整页 reload（否则会打断动画并闪一帧）
    if (win && !win.isDestroyed() && !options?.skipReload) {
        reloadMainWindow();
    }
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow && !sourceWindow.isDestroyed()) {
        sourceWindow.focus();
    }
    return true;
})

ipcMain.handle('save-main-css-file', async (event, css) => {
    const cssPath = path.join(__dirname, 'css', 'style.css');
    fs.writeFileSync(cssPath, String(css ?? ''), 'utf8');
    if (win && !win.isDestroyed()) {
        reloadMainWindow();
    }
    return true;
})

ipcMain.handle('list-theme-packs', async () => readThemePacks())

ipcMain.handle('get-active-theme-pack', async () => getActiveThemePack())

ipcMain.on('open-theme-folder', async () => {
    ensureThemeDir();
    shell.openPath(THEMES_DIR);
})

ipcMain.on('pop', (e, arg) => {
    // 组件角标（星期/日期的小字）点击：按点击位置向下弹出；无参时按托盘图标定位
    trayMenuAnchor = (arg && Number.isFinite(arg.x) && Number.isFinite(arg.bottom))
        ? { x: arg.x, top: Number(arg.top) || arg.bottom, bottom: arg.bottom, preferBelow: true }
        : null;
    openTrayMenu()
})

// 创建桌面快捷方式
ipcMain.handle('create-desktop-shortcut', async () => {
    const desktopPath = app.getPath('desktop');
    const shortcutPath = path.join(desktopPath, 'eSchedule.lnk');
    const iconPath = path.join(__dirname, 'image', 'icon.ico');
    return new Promise((resolve) => {
        createShortcut.create(shortcutPath, buildShortcutOptions(iconPath), (err) => {
            if (err) {
                console.error('创建桌面快捷方式失败:', err);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
});

// 启动设置（开机启动 / 高优先级启动）：高优先级启动依赖开机启动
ipcMain.handle('launch-settings-get', async () => ({
    autoLaunch: store.get('isAutoLaunch', true),
    highPriority: store.get('isHighPriorityLaunch', false)
}))

ipcMain.handle('launch-settings-set', async (event, payload) => {
    if (payload && typeof payload.autoLaunch === 'boolean') {
        store.set('isAutoLaunch', payload.autoLaunch);
        // 关闭开机启动时，高优先级启动一并关闭
        if (!payload.autoLaunch) store.set('isHighPriorityLaunch', false);
    }
    if (payload && typeof payload.highPriority === 'boolean') {
        // 高优先级启动必须在开机启动开启后才能设置
        store.set('isHighPriorityLaunch', payload.highPriority && store.get('isAutoLaunch', true));
    }
    const applied = await applyLaunchSettings();
    return {
        autoLaunch: store.get('isAutoLaunch', true),
        highPriority: store.get('isHighPriorityLaunch', false),
        // 高优先级任务创建失败（如系统策略限制）时为 false，供设置页提示
        applied: applied !== false
    };
})

ipcMain.on('course-fusion-result', (event, fusion) => {
    if (win && !win.isDestroyed()) win.webContents.send('courseFusion', fusion || null);
})

// 时间偏移：由“软件设置 - 基础设置”直接下发，主窗实时生效并写入 localStorage
ipcMain.on('set-time-offset', (event, value) => {
    if (value === null || value === undefined || value === '') return;
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    if (win && !win.isDestroyed()) {
        win.webContents.send('setTimeOffset', Math.trunc(seconds) % 10000000000000);
    }
});