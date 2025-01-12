const { app, BrowserWindow, Menu, ipcMain, dialog, screen, Tray, shell } = require('electron')
const https = require('https')
const path = require('path');
const fs = require('fs')
const os = require('os')
const createShortcut = require('windows-shortcuts')
const startupFolderPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const prompt = require('electron-prompt');
const Store = require('electron-store');
const { DisableMinimize } = require('electron-disable-minimize');
const store = new Store();
let tray = undefined;
let form = undefined;
var win = undefined;
var isCloudHidden = true; // 是否隐藏云服务
var cloudInterval = null; // 云服务计时器
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
    // win.webContents.openDevTools()
    win.loadFile('index.html')
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
// 时间相关函数
function formatTime(date) { // 格式化时间（这里只返回到天）
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function beijingTime(stamp) { // 添加时区偏移量
    const time = new Date(stamp * 1000);
    return formatTime(time);
}
// 构造httpGet请求函数（便于复用）
function httpGetRequest(hostname, path, callback) {
    const options = {
        hostname: hostname,
        path: path,
        method: 'GET'
    };
    const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            callback(null, responseData);
        });
    });
    req.on('error', (e) => {
        callback(e, null);
    });
    req.end();
}
// 控制是否执行句子切换的主逻辑
function runCloudService() {
    if (cloudInterval != null) clearInterval(cloudInterval);
    if (!isCloudHidden) {
        getSentence();
    }
    cloudInterval = setInterval(() => {
        if (!isCloudHidden) {
            getSentence();
        }
    }, 20000)
}
// 执行句子切换的函数
function getSentence() {
    let server = 'international.v1.hitokoto.cn'
    httpGetRequest(server, '', (err, data) => {
        if (err) {
            console.error(err);
        } else {
            cloudData = JSON.parse(data);
            let time = beijingTime(cloudData.created_at);
            cloudData.from_who != null ? dataArry = [cloudData.hitokoto, time, cloudData.from, cloudData.from_who] : dataArry = [cloudData.hitokoto, time, cloudData.from];
            win.webContents.send('renderCloudPost', dataArry)
        }
    });
}
app.whenReady().then(() => {
    createWindow()
    Menu.setApplicationMenu(null)
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('getWeekIndex');
        runCloudService();
    })
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle); // Thank to peter's project https://github.com/tbvjaos510/electron-disable-minimize
    setAutoLaunch()
})

ipcMain.on('getWeekIndex', (e, arg) => {
    tray = new Tray(basePath + 'image/icon.png')
    template = [
        {
            label: '第一周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 0)
            }
        },
        {
            label: '第二周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 1)
            }
        },
        {
            label: '第三周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 2)
            }
        },
        {
            label: '第四周',
            type: 'radio',
            click: () => {
                win.webContents.send('setWeekIndex', 3)
            }
        },
        {
            type: 'separator'
        },
        {
            icon: basePath + 'image/setting.png',
            label: '配置课表',
            click: () => {
                win.webContents.send('openSettingDialog')
            }
        },
        {
            icon: basePath + 'image/clock.png',
            label: '矫正计时',
            click: () => {
                win.webContents.send('getTimeOffset')
            }
        },
        {
            icon: basePath + 'image/toggle.png',
            label: '切换日程',
            click: () => {
                win.webContents.send('setDayOffset')
            }
        },
        {
            icon: basePath + 'image/github.png',
            label: '源码仓库',
            click: () => {
                shell.openExternal('https://github.com/EnderWolf006/ElectronClassSchedule');
            }
        },
        {
            type: 'separator'
        },
        {
            label: '句子隐藏',
            type: 'checkbox',
            checked: store.get('isCloudHidden', true),
            click: (e) => {
                store.set('isCloudHidden', e.checked)
                win.webContents.send('cloudHidden', e.checked)
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
            checked: store.get('isDuringClassHidden', true),
            click: (e) => {
                store.set('isDuringClassHidden', e.checked)
                win.webContents.send('ClassHidden', e.checked)
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
    template[arg].checked = true
    form = Menu.buildFromTemplate(template)
    tray.setToolTip('电子课表 - by lsl')
    function trayClicked() {
        tray.popUpContextMenu(form)
    }
    tray.on('click', trayClicked)
    tray.on('right-click', trayClicked)
    tray.setContextMenu(form)
    win.webContents.send('ClassCountdown', store.get('isDuringClassCountdown', true))
    win.webContents.send('ClassHidden', store.get('isDuringClassHidden', true))
    win.webContents.send('cloudHidden', store.get('isCloudHidden', true))
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

ipcMain.on('dialog', (e, arg) => {
    dialog.showMessageBox(win, arg.options).then((data) => {
        e.reply(arg.reply, { 'arg': arg, 'index': data.response })
    })
})

ipcMain.on('pop', (e, arg) => {
    tray.popUpContextMenu(form)
})

ipcMain.on('getTimeOffset', (e, arg) => {
    prompt({
        title: '计时矫正',
        label: '请设置课表计时与系统时间的偏移秒数:',
        value: arg.toString(),
        inputAttrs: {
            type: 'number'
        },
        type: 'input',
        height: 180,
        width: 400,
        icon: basePath + 'image/clock.png',
    }).then((r) => {
        if (r === null) {
            console.log('[getTimeOffset] User cancelled');
        } else {
            win.webContents.send('setTimeOffset', Number(r) % 10000000000000)
        }
    })
})

ipcMain.on('sendIsCloudHidden', (e, arg) => {
    isCloudHidden = arg;
    if (!isCloudHidden) {
        runCloudService();
    }
})
