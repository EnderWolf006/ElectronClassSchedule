const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell } = require('electron')
const path = require('path');
const fs = require('fs')
const os = require('os')
const createShortcut = require('windows-shortcuts')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const prompt = require('electron-prompt');
const Store = require('electron-store');
const store = new Store();
const ext = require("./ext")
const config = require("./ext/config")
const schedule = require("./schedule")
let tray = undefined;
let form = undefined;
var win = undefined;
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
        alwaysOnTop: config.configs().isWindowAlwaysOnTop,
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
    // win.webContents.openDevTools({ mode: 'detach' })
    win.loadFile('index.html')
}
function setAutoLaunch(autoLaunch = true) {
    const shortcutName = '电子课表(请勿重命名).lnk'
    app.setLoginItemSettings({ // backward compatible
        openAtLogin: false,
        openAsHidden: false
    })
    if (autoLaunch) {
        createShortcut.create(startupFolderPath + '/' + shortcutName,
            {
                target: app.getPath('exe'),
                workingDir: app.getPath('exe').split('\\').slice(0, -1).join('\\'),
            }, (e) => { e && console.log(e); })
    } else {
        fs.unlink(startupFolderPath + '/' + shortcutName, () => { })
    }

}
app.whenReady().then(() => {
    ext.pass({"store": store})
    createWindow()
    Menu.setApplicationMenu(null)
    const handle = win.getNativeWindowHandle();
    ext.disableMinimize(handle); // Thank to peter's project https://github.com/tbvjaos510/electron-disable-minimize
    createTray()
    ext.load()
    // win.webContents.openDevTools({mode:'detach'})
})

function createTray(){
    tray = new Tray(basePath + 'image/icon.png')
    template = [
        {
            type: 'separator'
        },
        {
            label: '显示计时',
            click: () => {
              ext.timer.show()
            }
        },
        {
            label: '通知编辑',
            click: () => {
              ext.notice.openEdit()
            }
        },
        {
            label: '配置编辑',
            click: () => {
              ext.config.openEdit()
            }
        },
        {
            label: '课表编辑',
            click: () => {
              ext.scheduleConfig.openEdit()
            }
        },
        {
            type: 'separator'
        },
        {
            label: ext.about.getText(),
            click: () => {
                ext.about.open()
            }
        },
        {
            icon: basePath + 'image/quit.png',
            label: '退出程序',
            click: () => {
                dialog.showMessageBox(win, {
                    title: '请确认',
                    message: '你确定要退出程序吗?',
                    buttons: ['取消', '确定']
                }).then((data) => {
                    if (data.response) app.quit()
                })
            }
        }
    ]
    form = Menu.buildFromTemplate(template)
    tray.setToolTip('电子课表 - by lsl(github.com/EnderWolf006)')
    function trayClicked() {
        tray.popUpContextMenu(form)
    }
    tray.on('click', trayClicked)
    tray.on('right-click', trayClicked)
    tray.setContextMenu(form)
}

ipcMain.on('configs.configsChanged', (e, arg) => {
    win.webContents.send('configs.configsChanged', arg)
    if (arg.isWindowAlwaysOnTop)
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
    else win.setAlwaysOnTop(false)
    setAutoLaunch(arg.isAutoLaunch)
})

ipcMain.on('schedule.data', (e, arg) => {
    if (!win) return
    win.webContents.send('schedule.data', arg, {
        editedDate: schedule.getCurrentEditedDate().valueOf()
    })
})

ipcMain.on('log', (e, arg) => {
    console.log(arg);
})

ipcMain.on('setIgnore', (e, arg) => {
    if (arg)
        win.setIgnoreMouseEvents(true, { forward: true });
    else
        win.setIgnoreMouseEvents(false);
})

