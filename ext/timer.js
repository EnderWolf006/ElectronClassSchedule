const { ipcMain, BrowserWindow, screen } = require('electron')
const ext = require("../ext")

let store = void 0;
let win = void 0;
exports.pass = function(data) {
    store = data.store
}

exports.load = function() {
}

function createTimerWindow(){
    win = new BrowserWindow({
        x: screen.getPrimaryDisplay().workAreaSize.width - 400,
        y: 0,
        width: 400,
        height: 150,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
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
    win.loadFile('html/timer.html')
    ext.disableMinimize(win)
}

let __timeout = -1
ipcMain.on('configs.configsChanged', (e, arg) => {
    let enabled = arg.ext.timer.enabled
    if (enabled && !win) createTimerWindow()
    if (!enabled && win){
        win.close()
        win = void 0
    }
    if (!win) return
    win.webContents.send('configs.configsChanged', arg)
    win.setAlwaysOnTop(arg.ext.timer.isWindowAlwaysOnTop, 'screen-saver', 9999999999999)
    if (__timeout != -1) clearTimeout(__timeout)
    __timeout = setTimeout(() => win.setAlwaysOnTop(arg.ext.timer.isWindowAlwaysOnTop, 'screen-saver', 9999999999999), 1000)
})

exports.show = () => {
    if (!win) return
    win.webContents.send('timer.show')
}

ipcMain.on('timer.setIgnore', (e, arg) => {
    if (!win) return
    if (process.platform === 'linux') return
    win.setIgnoreMouseEvents(arg, arg? { forward: true }: void 0);
})

ipcMain.on('schedule.data', (e, arg) => {
    if (!win) return
    win.webContents.send('schedule.data', arg)
})
