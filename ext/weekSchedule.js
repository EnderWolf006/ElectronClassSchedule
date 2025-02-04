const { ipcMain, screen, BrowserWindow } = require('electron')

const scheduleConfig = require("./scheduleConfig")

let store = void 0;
exports.pass = function(data) {
  store = data.store
}

exports.load = function() {

}

var win = void 0;
function createWindow(){
    if (win && !win.isDestroyed()){
      win.show()
      return
    }
    win = new BrowserWindow({
        x: screen.getPrimaryDisplay().workAreaSize.width - 400,
        y: screen.getPrimaryDisplay().workAreaSize.height - 200,
        width: 400,
        height: 200,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
    })
    win.loadFile('html/weekSchedule.html')
    // win.webContents.openDevTools({ mode: 'detach' })
}
exports.open = () => {
  createWindow()
}
