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

const notices = (() => {
  let cache = void 0;
  let lock = 0;
  function notices(operator){
    let notices = lock == 0? store.get('notices', {}): cache
    cache = notices
    if (!operator) return notices
    lock += 1
    try{
      let ret = operator(notices)
      lock -= 1
      if (lock == 0) store.set('notices', notices)
      ipcMain.emit('notice.getData')
      return ret
    }catch(e){
      lock -= 1
    }
  }
  return notices
})();

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

ipcMain.on('notice.getData', () => {
  let payload = ['notice.data', notices(), {
    latestIndex: store.get('noticeIndex', 0)
  }]
  win.webContents.send(...payload);
  if (editWin) editWin.webContents.send(...payload)
})

ipcMain.on('notice.removeFinished', (event, index) => {
  notices((notices) => {
    if (!notices[index] || !(notices[index].finishTime < Date.now())) return
    delete notices[index]
  })
})

const noticesUpdate = () => notices((notices) => {
  let updated = false
  for (let i in notices) {
    let notice = notices[i]
    if (notice.status != 'doing') continue
    if (notice.finishTime >= Date.now()) continue
    notice.updated += 1
    notice.pinned = false
    if (notice.chain.length == 0){
      notice.status = 'finished'
    } else {
      let newNotice = createNotice()
      let first = notice.chain.shift()
      Object.assign(newNotice, first, {
        chain: notice.chain
      })
      notice.updatedTarget = newNotice.index
      notice.status = 'updated'
    }
    updated = true
  }
  if (!updated) throw 'DO NOT WRITE'
})

setInterval(() => {
  noticesUpdate()
}, 10000)

function createNotice(){
  let index = store.get('noticeIndex', 0)
  index += 1
  store.set('noticeIndex', index)
  return notices(a => a[index] = {
    index: index,
    updated: 0,
    status: 'doing',
    pinned: false,
    createTime: Date.now(),
    finishTime: Date.now() + 24 * 60 * 60 * 1000,
    content: '',
    chain: []
  })
}

ipcMain.handle('noticeEdit.addNotice', (e, arg) => {
  let notice = createNotice()
  return notice.index
})

ipcMain.on('noticeEdit.removeNotice', (event, index) => {
  notices((notices) => {
    delete notices[index]
  })
})

ipcMain.on('noticeEdit.saveNotice', (event, index, object) => {
  notices((notices) => {
    let notice = notices[index]
    Object.assign(notice, object)
    notice.updated += 1
  })
})

exports.openEdit = () => {
  createNoticeEditWindow()
}


