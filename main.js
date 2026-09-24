const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell } = require('electron')
const path = require('path');
const fs = require('fs')
const os = require('os')
const createShortcut = require('windows-shortcuts')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const Store = require('electron-store');
const { DisableMinimize } = require('electron-disable-minimize');
const store = new Store();
let tray = undefined;
let form = undefined;
var win = undefined;
let configEditorWin = undefined;
let softwareSettingsWin = undefined;
let courseFusionWin = undefined;
let renameTimetableWindow = undefined;
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
            enableRemoteModule: true
        },
    })
    win.setIgnoreMouseEvents(true, { forward: true });
    // win.webContents.openDevTools()
    win.loadFile('index.html')
    win.webContents.once('did-finish-load', () => {
        win.setIgnoreMouseEvents(true, { forward: true });
        win.webContents.send('ClassCountdown', store.get('isDuringClassCountdown', true))
        win.webContents.send('ClassHidden', store.get('isDuringClassHidden', false))
        win.webContents.send('NextDayAfterSchool', store.get('showNextDayAfterSchool', false))
    })
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
        options.width = Math.min(Math.max(Math.round(Number(saved.width)), options.minWidth || 0), maxW);
        options.height = Math.min(Math.max(Math.round(Number(saved.height)), options.minHeight || 0), maxH);
    }
    return options;
}

function saveWindowSizeOnClose(key, winObj) {
    winObj.on('close', () => {
        if (winObj.isDestroyed() || winObj.isMaximized()) return;
        const [width, height] = winObj.getSize();
        store.set(`windowSizes.${key}`, { width, height });
    });
}

function openConfigEditorWindow() {
    if (configEditorWin && !configEditorWin.isDestroyed()) {
        configEditorWin.focus();
        return;
    }

    configEditorWin = new BrowserWindow(applyWindowSizeMemory('configEditor', {
        width: 1200,
        height: 820,
        center: true,
        frame: false,
        minWidth: 980,
        minHeight: 620,
        title: '课表配置编辑器',
        backgroundColor: '#f3f3f3',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }))
    configEditorWin.loadFile('config-editor.html')
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

    softwareSettingsWin = new BrowserWindow(applyWindowSizeMemory('softwareSettings', {
        width: 1200,
        height: 820,
        center: true,
        frame: false,
        resizable: true,
        minWidth: 980,
        minHeight: 620,
        title: '软件设置',
        backgroundColor: '#f3f3f3',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));
    softwareSettingsWin.loadFile('software-settings.html');
    saveWindowSizeOnClose('softwareSettings', softwareSettingsWin);
    softwareSettingsWin.on('closed', () => {
        softwareSettingsWin = undefined;
    });
}

function openCourseFusionWindow() {
    if (courseFusionWin && !courseFusionWin.isDestroyed()) {
        courseFusionWin.focus();
        return;
    }

    courseFusionWin = new BrowserWindow(applyWindowSizeMemory('courseFusion', {
        width: 760,
        height: 680,
        center: true,
        frame: false,
        resizable: true,
        minWidth: 620,
        minHeight: 560,
        title: '课程融合',
        backgroundColor: '#f3f3f3',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));
    courseFusionWin.loadFile('course-fusion.html');
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
            icon: basePath + 'image/clock.png',
            label: '计时矫正',
            click: () => {
                win.webContents.send('getTimeOffset')
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
                const payload = {
                    title: '退出程序？',
                    message: '  ',
                    buttons: ['再想一想', '确定退出']
                };

                const exitConfirm = new BrowserWindow({
                    width: 440,
                    height: 210,
                    center: true,
                    frame: false,
                    resizable: false,
                    minimizable: true,
                    maximizable: false,
                    modal: true,
                    show: false,
                    title: payload.title,
                    backgroundColor: '#f3f3f3',
                    parent: win,
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        enableRemoteModule: true
                    }
                });

                exitConfirm.loadFile(path.join(__dirname, 'exit-confirm.html'), {
                    query: {
                        data: encodeURIComponent(JSON.stringify(payload))
                    }
                });

                exitConfirm.once('ready-to-show', () => {
                    exitConfirm.show();
                });

                ipcMain.once('exit-confirm-result', (event, result) => {
                    if (result && Number(result) === 1) {
                        app.quit();
                    }
                    exitConfirm.close();
                });
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

ipcMain.on('setIgnore', (e, arg) => {
    if (arg)
        win.setIgnoreMouseEvents(true, { forward: true });
    else
        win.setIgnoreMouseEvents(false);
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

    const dialogWindow = new BrowserWindow(applyWindowSizeMemory('scheduleDialog', {
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
        backgroundColor: '#f3f3f3',
        parent: win,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    }));

    scheduleDialog = dialogWindow;
    saveWindowSizeOnClose('scheduleDialog', dialogWindow);

    dialogWindow.loadFile(path.join(__dirname, 'schedule-dialog.html'), {
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

ipcMain.handle('open-rename-timetable-window', async (event, oldName) => {
    if (renameTimetableWindow && !renameTimetableWindow.isDestroyed()) {
        renameTimetableWindow.focus();
        return null;
    }

    const parentWindow = BrowserWindow.fromWebContents(event.sender) || configEditorWin;
    renameTimetableWindow = new BrowserWindow({
        width: 460,
        height: 260,
        center: true,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        modal: true,
        parent: parentWindow,
        show: false,
        title: '重命名时间表',
        backgroundColor: '#101726',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    const currentWindow = renameTimetableWindow;
    return new Promise((resolve) => {
        const resultHandler = (resultEvent, newName) => {
            if (resultEvent.sender !== currentWindow.webContents) return;
            ipcMain.removeListener('rename-timetable-result', resultHandler);
            if (!currentWindow.isDestroyed()) currentWindow.close();
            resolve(newName === null || newName === undefined ? null : String(newName));
        };

        ipcMain.on('rename-timetable-result', resultHandler);
        currentWindow.on('closed', () => {
            ipcMain.removeListener('rename-timetable-result', resultHandler);
            if (renameTimetableWindow === currentWindow) renameTimetableWindow = undefined;
            resolve(null);
        });

        currentWindow.loadFile(path.join(__dirname, 'rename-timetable.html'), {
            query: { name: String(oldName || '') }
        });
        currentWindow.once('ready-to-show', () => currentWindow.show());
    });
});

ipcMain.handle('read-config-file', async () => {
    const configPath = path.join(__dirname, 'js', 'scheduleConfig.js');
    const code = fs.readFileSync(configPath, 'utf8');
    const reader = new Function(`${code}; return { _scheduleConfig, scheduleConfig };`);
    const result = reader();
    return result && result._scheduleConfig ? result._scheduleConfig : result && result.scheduleConfig ? result.scheduleConfig : {};
})

ipcMain.handle('read-settings-file', async () => {
    const settingsPath = path.join(__dirname, 'js', 'settings.js');
    const code = fs.readFileSync(settingsPath, 'utf8');
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

    const code = fs.readFileSync(result.filePaths[0], 'utf8');
    const reader = new Function(`${code}; return { _scheduleConfig, scheduleConfig };`);
    const imported = reader();
    const config = imported && (imported._scheduleConfig || imported.scheduleConfig);
    if (!config || !Array.isArray(config.daily_class)) {
        throw new Error('导入文件缺少有效的 daily_class 配置');
    }
    return config;
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

ipcMain.on('pop', (e, arg) => {
    tray.popUpContextMenu(form)
})

ipcMain.on('course-fusion-result', (event, fusion) => {
    if (win && !win.isDestroyed()) win.webContents.send('courseFusion', fusion || null);
})

let timeOffsetDialog = null;
let timeOffsetResolver = null;

ipcMain.on('getTimeOffset', (e, arg) => {
    if (timeOffsetDialog && !timeOffsetDialog.isDestroyed()) {
        timeOffsetDialog.focus();
        return;
    }

    timeOffsetDialog = new BrowserWindow({
        width: 460,
        height: 280,
        center: true,
        frame: false,
        resizable: false,
        minimizable: true,
        maximizable: false,
        modal: true,
        show: false,
        title: '计时矫正',
        backgroundColor: '#f3f3f3',
        parent: win,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    timeOffsetDialog.loadFile(path.join(__dirname, 'time-offset.html'), {
        query: {
            offset: String(arg ?? 0)
        }
    });

    timeOffsetDialog.once('ready-to-show', () => {
        timeOffsetDialog.show();
    });

    timeOffsetDialog.on('closed', () => {
        timeOffsetDialog = null;
    });
});

ipcMain.on('time-offset-result', (event, value) => {
    if (value === null || value === undefined || value === '') {
        console.log('[getTimeOffset] User cancelled');
        return;
    }
    win.webContents.send('setTimeOffset', Number(value) % 10000000000000)
});