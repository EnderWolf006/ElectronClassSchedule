const { ipcMain, BrowserWindow } = require('electron')
const { DisableMinimize } = require('electron-disable-minimize');

let store = void 0;
exports.pass = function(data) {
  store = data.store
}

let win = void 0

function createEditWindow(){
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
    win.loadFile('html/scheduleConfig.html')
    win.webContents.openDevTools({ mode: 'detach' })
    const handle = win.getNativeWindowHandle();
    DisableMinimize(handle)
}

exports.openEdit = () => {
  createEditWindow()
}

exports.defaultConfigs = {
  subjects: {
    '自': '自习',
    '物': '物理',
    '英': '英语',
    '化': '化学',
    '语': '语文',
    '走': '走班',
    '体': '体育',
    '数': '数学',
    '生': '生物',
    '地': '地理',
    '史': '历史',
    '政': '政治',
    '班': '班会',
  },
  timetables: {
    workday: {
      meta: {
        dividers: [4, 8]
      },
      data: {
        '00:00-07:39': '早自习',
        '07:40-08:19': 0,
        '08:20-08:29': '课间',
        '08:30-09:09': 1,
        '09:10-09:19': '课间',
        '09:20-09:59': 2,
        '10:00-10:29': '大课间',
        '10:30-11:09': 3,
        '11:10-11:19': '课间',
        '11:20-11:59': 4,
        '12:00-12:59': '午休',
        '13:00-13:39': 5,
        '13:40-13:49': '课间',
        '13:50-14:29': 6,
        '14:30-14:59': '大课间',
        '15:00-15:39': 7,
        '15:40-15:49': '课间',
        '15:50-16:19': 8,
        '16:20-16:29': '课间',
        '16:30-17:29': 9,
        '17:30-18:29': '晚休',
        '18:30-19:29': 10,
        '19:30-19:39': '课间',
        '19:40-20:59': 11,
        '21:00-23:59': '放学',
      }
    },
  },
  classSchedules: {
    monday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    tuesday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    wednsday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    thursday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    friday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    saturday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    sunday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
  },
  states: {
    weekIndex: {
      offset: 0,
      type: 'date-auto',
      begin: 0,
      cycle: 7,
      max: 4,
    },
  },
  // condition: [['cond', 'value'], ['...']]
  bindings: [
    {
      timetable: 'workday',
      classSchedule: 'sunday',
    },
    {
      timetable: 'workday',
      classSchedule: 'monday',
    },
    {
      timetable: 'workday',
      classSchedule: 'tuesday',
    },
    {
      timetable: 'workday',
      classSchedule: 'wednsday',
    },
    {
      timetable: 'workday',
      classSchedule: 'thursday',
    },
    {
      timetable: 'workday',
      classSchedule: 'friday',
    },
    {
      timetable: 'workday',
      classSchedule: 'saturday',
    },
  ]
}

function applyDefaults(configs){
  configs = Object.assign({}, exports.defaultConfigs, configs)
  return configs
}

let cache = void 0;
exports.scheduleConfig = (() => {
  let lock = 0;
  function scheduleConfig(operator){
    let configs = lock == 0? applyDefaults(store.get('scheduleConfig', {})): cache
    cache = configs
    if (!operator) return configs
    lock += 1
    try{
      let ret = operator(configs)
      lock -= 1
      if (lock == 0) store.set('scheduleConfig', configs)
      ipcMain.emit('scheduleConfig.changed', null, configs)
      return ret
    }catch(e){
      lock -= 1
    }
  }
  return scheduleConfig
})();

ipcMain.handle('scheduleConfig.get', () => scheudleConfigs())

ipcMain.handle('scheduleConfig.set', (_, arg) => {
  scheduleConfig((configs) => {
    Object.assign(configs, arg)
  })
})

exports.load = () => {
  exports.scheduleConfig(()=>{})
}

exports.subject_names = new Proxy({}, {
  get: (target, name) => {
    return cache.subjects[name]
  }
})
exports.time_table = new Proxy({}, {
  get: (target, name) => {
    return cache.timetables[name].data
  }
})
exports.divider = new Proxy({}, {
  get: (target, name) => {
    return cache.timetables[name].meta.dividers
  }
})
exports.daily_class = new Proxy({}, {
  get: (target, name) => {
  }
})
