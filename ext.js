const { ipcMain, dialog } = require("electron");
const { BrowserWindow } = require("electron/main");
const { promises: fs } = require("fs");

let store = void 0;
let config = exports.config = require("./ext/config")
let scheduleConfig = exports.scheduleConfig = require("./ext/scheduleConfig")
let timer = exports.timer = require("./ext/timer")
let notice = exports.notice = require("./ext/notice")

exports.pass = function(data) {
    store = data.store
    config.pass(data)
    scheduleConfig.pass(data)
    timer.pass(data)
    notice.pass(data)
}

exports.load = function() {
    config.load()
    scheduleConfig.load()
    timer.load()
    notice.load()
}

ipcMain.handle('ext.fileAccess', async (e, {mode, data}) => {
  if (mode == "open") {
    let result = await dialog.showOpenDialog(BrowserWindow.fromId(e.frameId), {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.filePaths[0]) throw new Error("User cancelled")
    return (await fs.readFile(result.filePaths[0])).toString()
  }
  if (mode == "save") {
    let result = await dialog.showSaveDialog(BrowserWindow.fromId(e.frameId), {
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.filePath) throw new Error("User cancelled")
    await fs.writeFile(result.filePath, data)
    return true
  }
})

exports.disableMinimize = function(win){
  if (process.platform === 'linux') return
  const { DisableMinimize } = require('electron-disable-minimize');
  const handle = win.getNativeWindowHandle();
  DisableMinimize(handle);
}
