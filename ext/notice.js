const { ipcMain, BrowserWindow, screen } = require('electron')
const { DisableMinimize } = require('electron-disable-minimize');

let store = void 0;
let win = void 0;
let editWin = void 0;
exports.pass = function(data) {
    store = data.store
}

exports.load = function() {
  createNoticeWindow()
}

function createNoticeWindow(){
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: screen.getPrimaryDisplay().workAreaSize.width,
        height: screen.getPrimaryDisplay().workAreaSize.height,
        frame: false,
        transparent: true,
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
    win.setIgnoreMouseEvents(true, {forward: true});
    win.loadFile('html/notice.html')
    const handle = win.getNativeWindowHandle();
    setTimeout(() => {
      win.webContents.send('notice.data', store.get('notices', {}), {
        latestIndex: store.get('noticeIndex', 0)
      });
    }, 3000)
    DisableMinimize(handle)
}

function createNoticeEditWindow(){
    if (editWin && !editWin.isDestroyed()){
      editWin.show()
      return
    }
    editWin = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
    })
    editWin.loadFile('html/noticeEdit.html')
    editWin.webContents.openDevTools({ mode: 'detach' })
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle)
}

ipcMain.on("scheduleData.currentHighlight", (e, arg) => {
    let hidden = store.get('isDuringClassHidden', true)
    if (!hidden) return
    if (win.isVisible() && arg.type == "current"){
        win.hide()
    }
    if (!win.isVisible() && arg.type == "incoming") {
        win.showInactive()
    }
})

ipcMain.on('notice.setIgnore', (e, arg) => {
    if (process.platform === 'linux'){
      win.setIgnoreMouseEvents(true)
      return
    }
    win.setIgnoreMouseEvents(arg, arg? { forward: true }: void 0);
})

ipcMain.on('notice.removeFinished', (event, index) => {})

exports.openEdit = () => {
  createNoticeEditWindow()
}
