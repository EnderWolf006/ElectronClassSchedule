const { ipcMain, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { configs } = require('./config')
const AdmZip = require('adm-zip')

const endpoint = "https://api.github.com/"
const repo = "aawwaaa/ElectronClassSchedule2"
const metaBegin = "[META] "

const releaseURL = endpoint + "repos/" + repo + "/releases/latest"

let store = void 0;
exports.pass = function(data) {
  store = data.store
}

exports.currentVersion = ""
exports.load = function() {
    exports.currentVersion = fs.readFileSync(path.join(__dirname, '..', 'version')).toString().trim()
    exports.checkUpdate()
}

exports.getText = () => {
    let update = store.get("update.hasUpdate", false)? " [*]": ""
    return "关于软件" + update
}

let latestData = {}
let latestMeta = {}
let latestVersion = ""
exports.checkUpdate = async () => {
    let res = await fetch(releaseURL)
    latestData = await res.json()
    latestMeta = JSON.parse(latestData.body.split(metaBegin)[1].trim())
    latestVersion = latestMeta.version
    if (latestVersion != exports.currentVersion){
        store.set("update.hasUpdate", true)
    }
}

let win = void 0

function createUpdateWindow(){
    if (win && !win.isDestroyed()){
      win.show()
      return
    }
    win = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
    })
    win.loadFile('html/about.html')
    win.webContents.openDevTools({ mode: 'detach' })
}

ipcMain.handle('about.getCurrentVersion', () => exports.currentVersion)
ipcMain.handle('about.getUpdateSource', () => releaseURL)
ipcMain.handle('about.hasUpdate', () => store.get("update.hasUpdate", false))
ipcMain.handle('about.getLatestVersion', () => latestVersion)

ipcMain.handle('about.checkUpdate', async () => {
    await exports.checkUpdate()
    return store.get("update.hasUpdate", false)
})

let updateStatus = (msg) => {
    win.webContents.send('updateStatus', msg)
}

let updating = false
ipcMain.handle('about.downloadUpdate', async () => {
    if (updating) return
    updating = true
    try{
        store.set("update.hasUpdate", false)
        updateStatus("检查中...")
        await exports.checkUpdate()
        if (exports.currentVersion == latestVersion)
            throw new Error("已经是最新版本")
        let found = null
        for(let asset of latestData.assets){
            if (asset.name != "update.zip") continue
            found = asset
            break
        }
        if (!found) throw new Error("没有找到更新文件")
        let url = found.browser_download_url

        let {ext: {about: { updateThroughMirror, updateMirror }}} = configs()

        if (updateThroughMirror){
            url = updateMirror.replace("{url}", url)
        }
        
        updateStatus("下载中... ")
        let response = await fetch(url)
        // 获取文件总大小
        const contentLength = response.headers.get('content-length');
        const totalSize = parseInt(contentLength, 10);

        let downloadedSize = 0;
        const reader = response.body.getReader();

        const fileName = path.join(os.tmpdir(), `update-${Date.now()}.zip`);
        const writer = fs.createWriteStream(fileName);

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;
            writer.write(value);
            downloadedSize += value.length;

            const progress = (downloadedSize / totalSize) * 100;
            const progressBar = ("=".repeat(Math.floor(progress / 5)) + ">").padEnd(21, "_")

            updateStatus(`下载中... \n[${progressBar}] ${progress.toFixed(2)}%`);
        }
        writer.close()
        
        updateStatus("解压中... ")
        let zip = new AdmZip(fileName)
        zip.extractAllTo(path.join(__dirname, '..'), true)
        updateStatus("更新完成\n请重启软件")
    }catch(e){
        console.log(e)
        throw e
    }finally{
        updating = false
    }
})

exports.open = () => {
  createUpdateWindow()
}
