const { ipcMain, BrowserWindow } = require('electron')
const { DisableMinimize } = require('electron-disable-minimize');

let store = void 0;
exports.pass = function(data) {
  store = data.store
}

exports.defaultConfigs = { 
  isWindowAlwaysOnTop: false,
  isDuringClassHidden: true,
  isAutoLaunch: true,
  // 倒计时目标：位于右侧框中的倒计时，输入日期即可，可以是中考高考期末等等，格式YYYY-MM-DD
  // 若想隐藏右侧的倒计时，请在下方冒号后填入'hidden', (包括引号)
  countdownTarget: 'hidden',

  // 星期显示：左侧框是否显示，显示为true，隐藏为false
  // 直接将true或false填入冒号后边，没有引号
  weekDisplay: false,
  weekStrings: ['SUN.日', 'MON.一', 'TUE.二', 'WED.三', 'THU.四', 'FRI.五', 'SAT.六'],
}
exports.defaultConfigsDeep = {
  css: {
    '__no_deep_copy': true,
    '--center-font-size': '50px', // 中间课表中的课程简写单字的字体大小
    '--corner-font-size': '14px', // 左侧的星期中文角标与右侧的"天"字的字体大小
    '--global-border-radius': '16px', // 所有背景框的圆角大小
    '--global-bg-opacity': '0.5', // 所有背景框的不透明度, 范围: [0, 1]
    '--container-bg-padding': '8px 14px', // 上面三个框各自的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
    '--container-space': '16px', // 上面三个框中间的间隔长度
    '--top-space': '16px', // 课表主体最顶端与电脑屏幕上边框的间隔长度
    '--main-horizontal-space': '8px', // 中间课表中的课程简写单字之间的间隔长度
    '--divider-width': '2px', // 分隔线宽度
    '--divider-margin': '6px', // 分隔线外边距
    '--triangle-size': '16px', // 倒计时框上方小三角箭头的大小
    '--sub-font-size': '20px', // 中间课表中的课程下角标(X@X)的字体大小
  },
  schedule: {
    weekIndex: 0,
    timeOffset: 0,
    dayOffset: -1,
    setDayOffsetLastDay: -1
  },
  ext: {
    timer: {
      enabled: true,
      isWindowAlwaysOnTop: true,
      css: {
        '__no_deep_copy': true,
        '--global-border-radius': '16px', // 所有背景框的圆角大小
        '--global-bg-opacity': '0.5', // 所有背景框的不透明度, 范围: [0, 1]
        '--countdown-bg-padding': '5px 12px', // 倒计时框的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
        '--top-space': '16px', // 课表主体最顶端与电脑屏幕上边框的间隔长度
        '--countdown-font-size': '28px', // 课程或课间全称与倒计时的字体大小
        '--timer-close-font-size': '24px', // 倒计时关闭按钮的大小
      }
    },
    notice: {
      enabled: false,
      duration: 30*1000, // 通知持续时间
      maxIndex: 100, // 通知最大索引
      latestDuration: 1*60*60*1000, // 最新通知持续时间
      finishedDuration: 30*60*1000, // 已结束通知持续时间
      css: {
        '__no_deep_copy': true,
        '--font-size': '28px', // 字体大小
        '--global-border-radius': '16px', // 所有背景框的圆角大小
        '--global-bg-opacity': '0.5', // 所有背景框的不透明度, 范围: [0, 1]
        '--container-bg-padding': '8px 14px', // 上面三个框各自的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
        '--notice-top-space': '20%', // 通知表主体最顶端与电脑屏幕上边框的间隔长度
        '--notice-left-space': '55%', // 通知表主体最顶端与电脑屏幕左边框的间隔长度
        '--notice-width': '80%', // 通知表主体宽度
        '--notice-height': '66%', // 通知表主体高度
        '--container-width': '500px', // 通知的宽度
      }
    }
  }
}

function applyDefaults(configs){
  configs = Object.assign({}, exports.defaultConfigs, configs)
  function iter(obj, target){
    for (let i in obj) {
      if (typeof obj[i] == 'object' && obj[i] != null && !obj[i].__no_deep_copy){
        iter(obj[i], target[i] || (target[i] = {}))
      } else if (typeof target[i] == 'undefined') {
        if (typeof obj[i] == 'object' && obj[i] != null)
          target[i] = Object.assign({}, obj[i]), delete target[i].__no_deep_copy
        else
          target[i] = obj[i]
      }
    }
  }
  iter(exports.defaultConfigsDeep, configs)
  return configs
}

exports.load = function() {
  setTimeout(() => exports.configs(()=>{}))
}

ipcMain.handle('configs.get', () => {
  return exports.configs()
})

ipcMain.handle('configs.set', (_, arg, override) => {
  function iter(obj, target){
    for (let i in obj) {
      if (typeof obj[i] == 'object' && obj[i] != null && !Array.isArray(obj[i])){
        iter(obj[i], target[i] || (target[i] = {}))
      } else {
        if (Array.isArray(obj[i])) obj[i] = obj[i].filter(a => a != null)
        target[i] = obj[i]
      }
    }
  }
  exports.configs(a => {
    if (override) for (let i in a)
      delete a[i]
    iter(arg, a)
  })
})

exports.configs = (() => {
  let cache = void 0;
  let lock = 0;
  function configs(operator){
    let configs = lock == 0? applyDefaults(store.get('configs', {})): cache
    cache = configs
    if (!operator) return configs
    lock += 1
    try{
      let ret = operator(configs)
      lock -= 1
      if (lock == 0) store.set('configs', configs)
      ipcMain.emit('configs.configsChanged', null, configs)
      return ret
    }catch(e){
      lock -= 1
    }
  }
  return configs
})();

let win = void 0

function createConfigEditWindow(){
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
    win.loadFile('html/config.html')
    // win.webContents.openDevTools({ mode: 'detach' })
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle)
}

exports.openEdit = () => {
  createConfigEditWindow()
}
