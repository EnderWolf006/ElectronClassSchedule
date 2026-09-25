const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell, powerMonitor, nativeTheme } = require('electron')
const path = require('path');
const fs = require('fs')
const os = require('os')
const createShortcut = require('windows-shortcuts')
const yaml = require('js-yaml')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const Store = require('electron-store');
const { DisableMinimize } = require('electron-disable-minimize');
const store = new Store();

// ===== Win11 亚克力材质（仅用于设置类窗口） =====
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
let form = undefined;
var win = undefined;
let configEditorWin = undefined;
let softwareSettingsWin = undefined;
let courseFusionWin = undefined;
let template = []
let basePath = app.isPackaged ? './resources/app/' : './'
if (!app.requestSingleInstanceLock({ key: 'classSchedule' })) {
    app.quit();
}
const createWindow = () => {
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: 200,
        frame: false,
        transparent: true,
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
}
function setAutoLaunch() {
    const shortcutName = '电子课表(请勿重命名).lnk'
    app.setLoginItemSettings({ // backward compatible
        openAtLogin: false,
        openAsHidden: false
    })
    if (store.get('isAutoLaunch', true)) {
        createShortcut.create(startupFolderPath + '/' + shortcutName,
            {
                target: app.getPath('exe'),
                workingDir: app.getPath('exe').split('\\').slice(0, -1).join('\\'),
            }, (e) => { e && console.log(e); })
    } else {
        fs.unlink(startupFolderPath + '/' + shortcutName, () => { })
    }

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
    try {
        const settingsPath = path.join(__dirname, 'js', 'settings.js');
        // 去除 BOM：个别编辑器保存的配置文件带 BOM 时，new Function 会直接抛语法错误
        const code = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
        const reader = new Function(`${code}; return { _settings, settings };`);
        const result = reader();
        const loaded = result && (result._settings || result.settings);
        return loaded && (loaded.theme_mode === 'dark' || loaded.theme_mode === 'light') ? loaded.theme_mode : 'auto';
    } catch (error) {
        return 'auto';
    }
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

// 创建带 Win11 亚克力材质的设置窗口。
// 非 Windows 或 mica-electron 不可用时静默降级为普通 BrowserWindow（渲染层保持不透明外观）。
function createSettingsWindow(options) {
    if (!acrylicAvailable) {
        return new BrowserWindow(options);
    }
    // MicaBrowserWindow 构造函数会强制 transparent=true（Electron 27-40）与透明 backgroundColor
    const winObj = new micaElectron.MicaBrowserWindow(options);
    winObj.__acrylic = true;
    try {
        if (dwmBackdropSupported) {
            // Win11 22H2+：DWM 桌面亚克力（系统原生 Mica/Acrylic）
            winObj.__acrylicBackend = 'dwm';
            winObj.setMicaAcrylicEffect();
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

    return winObj;
}

function openConfigEditorWindow() {
    if (configEditorWin && !configEditorWin.isDestroyed()) {
        configEditorWin.focus();
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
    configEditorWin.on('closed', () => {
        configEditorWin = undefined;
    })
}

function openSoftwareSettingsWindow() {
    if (softwareSettingsWin && !softwareSettingsWin.isDestroyed()) {
        softwareSettingsWin.focus();
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
    softwareSettingsWin.loadFile(path.join(__dirname, 'dist', 'software-settings.html'));
    saveWindowSizeOnClose('softwareSettings', softwareSettingsWin);
    softwareSettingsWin.on('closed', () => {
        softwareSettingsWin = undefined;
    });
}

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

app.whenReady().then(() => {
    createWindow()
    createTrayMenu()
    Menu.setApplicationMenu(null)
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle); // Thank to peter's project https://github.com/tbvjaos510/electron-disable-minimize
    setAutoLaunch()
})

function createTrayMenu() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
    }
    tray = new Tray(basePath + 'image/icon.png')
    template = [
        
        
        {
            icon: basePath + 'image/adjust.png',
            label: '临时调课',
            click: () => {
                win.webContents.send('openSettingDialog')
            }
        },
        {
            icon: basePath + 'image/fusion.png',
            label: '课程融合',
            click: () => {
                openCourseFusionWindow()
            }
        },
        {
            icon: basePath + 'image/toggle.png',
            label: '加载临时课表',
            click: () => {
                win.webContents.send('setDayOffset')
            }
        },
        {
            type: 'separator'
        },
        {
            id: 'countdown',
            label: '课上计时',
            type: 'checkbox',
            checked: store.get('isDuringClassCountdown', true),
            click: (e) => {
                store.set('isDuringClassCountdown', e.checked)
                win.webContents.send('ClassCountdown', e.checked)
            }
        },
        {
            label: '窗口置顶',
            type: 'checkbox',
            checked: store.get('isWindowAlwaysOnTop', true),
            click: (e) => {
                store.set('isWindowAlwaysOnTop', e.checked)
                if (store.get('isWindowAlwaysOnTop', true))
                    win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
                else
                    win.setAlwaysOnTop(false)
            }
        },
        {
            label: '上课隐藏',
            type: 'checkbox',
            checked: store.get('isDuringClassHidden', false),
            click: (e) => {
                store.set('isDuringClassHidden', e.checked)
                win.webContents.send('ClassHidden', e.checked)
            }
        },
        {
            label: '显示次日课程（测试）',
            type: 'checkbox',
            checked: store.get('showNextDayAfterSchool', false),
            click: (e) => {
                store.set('showNextDayAfterSchool', e.checked)
                win.webContents.send('NextDayAfterSchool', e.checked)
            }
        },
        {
            label: '开机启动',
            type: 'checkbox',
            checked: store.get('isAutoLaunch', true),
            click: (e) => {
                store.set('isAutoLaunch', e.checked)
                setAutoLaunch()
            }
        },
        {
            type: 'separator'
        },
        {
            icon: basePath + 'image/editor.png',
            label: '课表配置编辑器',
            click: () => {
                openConfigEditorWindow()
            }
        },
        {
            icon: basePath + 'image/setting.png',
            label: '软件设置',
            click: () => {
                openSoftwareSettingsWindow()
            }
        },
        {
            type: 'separator'
        },
        {
            icon: basePath + 'image/quit.png',
            label: '退出程序',
            click: () => {
                // 右键菜单退出无需二次确认，直接退出
                app.quit();
            }
        }
    ]
    form = Menu.buildFromTemplate(template)
    tray.setToolTip('电子课表 - by lsl and TEG6129BEV15')
    function trayClicked() {
        tray.popUpContextMenu(form)
    }
    tray.on('click', trayClicked)
    tray.on('right-click', trayClicked)
    tray.setContextMenu(form)
}

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

// 主界面高度自适应：渲染进程测量内容（组件行 + 课程下方倒计时框等）
// 实际视口高度后上报，窗口随之调整，避免多行组件被固定高度裁剪。
ipcMain.on('main-window-height', (e, arg) => {
    if (!win || win.isDestroyed()) return;
    const maxHeight = screen.getPrimaryDisplay().workAreaSize.height;
    const height = Math.max(40, Math.min(Math.round(Number(arg) || 0), maxHeight));
    const bounds = win.getBounds();
    if (bounds.height !== height) {
        win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height });
    }
})

ipcMain.on('reminder-trigger', (e, payload) => {
    if (win && !win.isDestroyed()) {
        win.webContents.send('reminder-trigger', payload || {});
    }
})

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
        modal: true,
        show: false,
        title: safePayload.title,
        parent: win,
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

ipcMain.handle('read-main-css-file', async () => {
    const cssPath = path.join(__dirname, 'css', 'style.css');
    return fs.readFileSync(cssPath, 'utf8');
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
        win.reload();
    }
    if (sourceWindow && !sourceWindow.isDestroyed()) {
        sourceWindow.focus();
    }
    return true;
})

ipcMain.handle('save-settings-file', async (event, settings) => {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const formatted = `const _settings = ${JSON.stringify(settings, null, 4)}\n\nvar settings = JSON.parse(JSON.stringify(_settings))\n`;
    fs.writeFileSync(settingsPath, formatted, 'utf8');
    // 主题模式可能随设置一起改变，立即同步主界面与所有亚克力窗口的深浅色
    if (settings && (settings.theme_mode === 'dark' || settings.theme_mode === 'light' || settings.theme_mode === 'auto')) {
        broadcastThemeMode(settings.theme_mode);
    }
    if (win && !win.isDestroyed()) {
        win.reload();
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
        win.reload();
    }
    return true;
})

ipcMain.handle('import-theme-css-file', async () => {
    const result = await dialog.showOpenDialog({
        title: '导入 CSS 主题配置',
        properties: ['openFile'],
        filters: [{ name: 'CSS 文件', extensions: ['css'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const css = fs.readFileSync(result.filePaths[0], 'utf8');
    // 校验完整性：提取 --var: value 对
    const vars = {};
    const regex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;
    let match;
    while ((match = regex.exec(css)) !== null) {
        vars[match[1].trim()] = match[2].trim();
    }
    if (Object.keys(vars).length === 0) {
        throw new Error('CSS 文件中未找到任何 CSS 变量定义（--xxx: value）');
    }
    return vars;
})

ipcMain.on('pop', (e, arg) => {
    tray.popUpContextMenu(form)
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