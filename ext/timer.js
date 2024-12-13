const { ipcMain, BrowserWindow, screen } = require('electron')
const { DisableMinimize } = require('electron-disable-minimize');

let store = void 0;
let win = void 0;
exports.pass = function(data) {
    store = data.store
}

exports.load = function() {
    createTimerWindow()
}

function createTimerWindow(){
    win = new BrowserWindow({
        x: screen.getPrimaryDisplay().workAreaSize.width - 300,
        y: 0,
        width: 300,
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
    if (store.get('isWindowAlwaysOnTop', true))
        win.setAlwaysOnTop(true, 'screen-saver', 9999999999999)
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle)
}

exports.sendSettingsChanged = function(){
    ipcMain.emit('timer.settingsChanged', null, {
        isWindowAlwaysOnTop: store.get('isWindowAlwaysOnTop', true),
    })
}

ipcMain.on("scheduleData.currentHighlight", (e, arg) => {
    arg.isDuringClassHidden = store.get('isDuringClassHidden', true)
    win.webContents.send('scheduleData.currentHighlight', arg)
})

ipcMain.on('timer.settingsChanged', (e, arg) => {
    win.setAlwaysOnTop(arg.isWindowAlwaysOnTop, 'screen-saver', 9999999999999)
})

exports.setVisible = (arg) => {
    if (arg) win.showInactive()
    else win.hide()
}

ipcMain.on('timer.setVisible', (e, arg) => {
    exports.setVisible(arg)
})

ipcMain.on('timer.setIgnore', (e, arg) => {
    if (process.platform === 'linux') return
    win.setIgnoreMouseEvents(arg, arg? { forward: true }: void 0);
})
