const { ipcMain, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yauzl = require('yauzl');

const { configs } = require('./config')

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
    // win.webContents.openDevTools({ mode: 'detach' })
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

        await unzipFile(fileName, path.join(__dirname, ".."))
        updateStatus("更新完成\n请重启软件")

        fs.unlinkSync(fileName)
    }catch(e){
        console.log(e)
        throw e
    }finally{
        updating = false
    }
})

/**
 * 解压 ZIP 文件到指定目录
 * @param {string} zipFile - ZIP 文件路径
 * @param {string} outputDir - 解压目标目录
 * @author DeepSeek v3
 */
function unzipFile(zipFile, outputDir) {
  let resolve, reject;
  let promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  // 打开 ZIP 文件
  yauzl.open(zipFile, { lazyEntries: true }, (err, zipfile) => {
    if (err) {
      console.error('打开 ZIP 文件时发生错误:', err);
      reject(err);
      return;
    }

    // 监听 ZIP 文件的每一个条目（文件或目录）
    zipfile.readEntry();
    zipfile.on('entry', (entry) => {
      if (/\/$/.test(entry.fileName)) {
        // 如果是目录，创建目录
        const dirPath = path.join(outputDir, entry.fileName);
        fs.mkdirSync(dirPath, { recursive: true });
        zipfile.readEntry(); // 继续读取下一个条目
      } else {
        // 如果是文件，解压文件
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) {
            console.error('解压文件时发生错误:', err);
            return;
          }

          // 创建目标文件路径
          const filePath = path.join(outputDir, entry.fileName);
          updateStatus(`解压文件: ${entry.fileName}`);

          // 确保目标文件的目录存在
          fs.mkdirSync(path.dirname(filePath), { recursive: true });

          // 将文件内容写入目标文件
          readStream.pipe(fs.createWriteStream(filePath));

          // 监听写入完成事件
          readStream.on('end', () => {
            zipfile.readEntry(); // 继续读取下一个条目
          });
        });
      }
    });

    // 监听 ZIP 文件读取完成事件
    zipfile.on('end', () => {
      resolve();
    });

    // 监听错误事件
    zipfile.on('error', (err) => {
      console.error('解压过程中发生错误:', err);
      reject(err)
    });
  });

  return promise;
}

exports.open = () => {
  createUpdateWindow()
}
