const { ipcMain, BrowserWindow } = require('electron')
const config = require("./config")

const DEFAULT_SUBJECT = '❎'
exports.DEFAULT_SUBJECT = DEFAULT_SUBJECT
const DEFAULT_SUBJECT_NAME = '错误'

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
    // win.webContents.openDevTools({ mode: 'detach' })
}

exports.openEdit = () => {
  createEditWindow()
}

exports.defaultConfigs = {
  timeOffset: 0,
  // {date: number, timetable: string, classSchedule: string}
  tempBindings: [],
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
    workday: [
      { 'time': '00:00', 'value': '早自习' },
      { 'time': '07:40', 'value': 0, 'divider': false },
      { 'time': '08:20', 'value': '课间' },
      { 'time': '08:30', 'value': 1, 'divider': false },
      { 'time': '09:10', 'value': '课间'},
      { 'time': '09:20', 'value': 2, 'divider': false },
      { 'time': '10:00', 'value': '大课间' },
      { 'time': '10:30', 'value': 3, 'divider': false },
      { 'time': '11:10', 'value': '课间' },
      { 'time': '11:20', 'value': 4, 'divider': true },
      { 'time': '12:00', 'value': '午休' },
      { 'time': '13:00', 'value': 5, 'divider': false },
      { 'time': '13:40', 'value': '课间' },
      { 'time': '13:50', 'value': 6, 'divider': false },
      { 'time': '14:30', 'value': '大课间' },
      { 'time': '15:00', 'value': 7, 'divider': false },
      { 'time': '15:40', 'value': '课间' },
      { 'time': '15:50', 'value': 8, 'divider': false },
      { 'time': '16:20', 'value': '课间' },
      { 'time': '16:30', 'value': 9, 'divider': true },
      { 'time': '17:30', 'value': '晚休' },
      { 'time': '18:30', 'value': 10, 'divider': false },
      { 'time': '19:30', 'value': '课间' },
      { 'time': '19:40', 'value': 11, 'divider': false },
      { 'time': '21:00', 'value': '放学' },
    ],
  },
  // [value, [{condition: [...], value: ''}, ...]]
  classSchedules: Object.fromEntries(Object.entries({
    monday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    tuesday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    wednsday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    thursday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    friday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    saturday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
    sunday: ['物', '英', '数', '语', '数', '自', '自', '化', '走', '语', '语', '自'],
  }).map(([k, v]) => [k, v.map(x => [{condition: ['always'], value: x}])])),
  states: {
    weekIndex: {
      offset: 0,
      type: 'dateAuto',
      begin: 0,
      cycle: 7,
      max: 4,
    },
  },
  // condition: ['type', ...args]
  bindings: [
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'sunday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'monday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'tuesday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'wednsday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'thursday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'friday',
      },
    ],
    [
      {
        condition: ['always'],
        timetable: 'workday',
        classSchedule: 'saturday',
      },
    ],
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
    let configs = lock == 0? applyDefaults(config.fetchConfig().scheduleConfig): cache
    cache = configs
    if (!operator) return configs
    lock += 1
    try{
      let ret = operator(configs)
      lock -= 1
      if (lock == 0) store.set('scheduleConfig', configs)
      ipcMain.emit('scheduleConfig.changed', null, configs)
      for (let k in cachedData) cachedData[k] = {}
      exports.clearErrorList()
      return ret
    }catch(e){
      lock -= 1
    }
  }
  return scheduleConfig
})();

ipcMain.handle('scheduleConfig.get', () => exports.scheduleConfig())

ipcMain.handle('scheduleConfig.set', (_, arg) => {
  exports.scheduleConfig((configs) => {
    Object.assign(configs, arg)
  })
})

ipcMain.handle('scheduleConfig.getStateValue', (event, state) => {
  return getStateValue(state)
})

ipcMain.handle('scheduleConfig.getToday', () => {
  let {timetable, classSchedule} = getTodayBinding()
  return [timetable, classSchedule]
})

exports.load = () => {
  exports.scheduleConfig((a)=>{})
}

let errorList = []
exports.clearErrorList = () => {
  errorList = []
  exports.sendErrorList()
}
exports.sendErrorList = () => {
  if (win && !win.isDestroyed()){
    win.webContents.send('scheduleConfig.binding.errorList', errorList)
  }
}

ipcMain.on('scheduleConfig.binding.getErrorList', exports.sendErrorList)
exports.currentError = (error) => {
  if (!error) return
  errorList.push({
    message: error.message,
    stack: error.stack,
  })
  if (errorList.length > 10) errorList.shift()
  exports.sendErrorList()
}

const stateTypes = {
  'manual': ({value}) => value,
  'dateAuto': ({begin, cycle, max, offset}) => {
    let t = Date.now() - begin;
    let d = Math.floor(t / (cycle * 24 * 60 * 60 * 1000));
    d += offset + max * 1000
    let r = d % max;
    return r;
  },
  'javascript': ({code}) => {
    let state = getStateValue;
    let sc = exports.scheduleConfig;
    return eval(code)
  }
}
function getStateValue(stateName) {
  let state = cache.states[stateName]
  if (!state) throw new Error('未知状态名: ' + stateName)
  if (state.type in stateTypes) {
    return stateTypes[state.type](state)
  }
  return -1
}

const conditionTypes = {
  'always': () => true,
  'never': () => false,
  'equals': (state, value) => getStateValue(state) == value,
  'notEquals': (state, value) => getStateValue(state) != value,
  'lessThan': (state, value) => getStateValue(state) < value,
  'lessThanEquals': (state, value) => getStateValue(state) <= value,
  'greaterThan': (state, value) => getStateValue(state) > value,
  'greaterThanEquals': (state, value) => getStateValue(state) >= value,
  'between': (state, value) => getStateValue(state) >= value[0] && getStateValue(state) <= value[1],
  'notBetween': (state, value) => getStateValue(state) < value[0] || getStateValue(state) > value[1],
  'javascript': (code) => {
    let state = getStateValue
    let sc = exports.scheduleConfig
    try {
      return eval(code)
    } catch (e) {
      e.message += '\n条件判断javascript错误'
      throw e
    }
  }
}
function evaluateConditions(conditions) {
  let result = conditions.find(a => conditionTypes[a.condition[0]](...a.condition.slice(1)))
  if (!result) throw new Error('无满足任一条件的值')
  return result
}

function getTodayBinding() {
  let today = new Date().toLocaleDateString()
  for (let binding of cache.tempBindings) {
    if (binding.date + 24 * 60 * 60 * 1000 < Date.now()) {
      exports.scheduleConfig((c) => {
        c.tempBindings.splice(c.tempBindings.findIndex(b => b.date == binding.date), 1)
      })
      continue
    }
    console.log(new Date(binding.date).toLocaleDateString(), today)	
    if (new Date(binding.date).toLocaleDateString().substring(0, 10) == today) return binding
  }
  let day = new Date().getDay()
  let binding = cache.bindings[day]
  return evaluateConditions(binding)
}
getTodayBinding = ((fun) => {
  return () => {
    try { return fun() } catch(e) {
      e.message += '\n获取今日数据绑定错误'
      throw e
    }
  }
})(getTodayBinding);

function timeDecreasedOneMinute(time) {
  let [h, m] = time.split(':')
  m = parseInt(m) - 1
  if (m < 0) {
    m = 59
    h = parseInt(h) - 1
  }
  if (h < 0) h = 23
  return h + ':' + m
}

exports.proxy = {}
let cachedData = {
  timetable: {},
  divider: {},
  classSchedule: {},
}

Object.defineProperty(exports.proxy, "timeOffset", {
  get: () => {
    return cache? cache.timeOffset: 0
  }
})
exports.proxy.subject_name = new Proxy({}, {
  get: (target, name) => {
    if (name == DEFAULT_SUBJECT) return DEFAULT_SUBJECT_NAME
    return cache.subjects[name]
  }
})
exports.proxy.timetable = new Proxy({}, {
  get: (target, name) => {
    if (cachedData.timetable[name]) return cachedData.timetable[name]
    let tt = cache.timetables[name]
    let generated = {}
    for (let i in tt) {
      let v = tt[i]
      let next = tt[+i+1] ?? { time: '00:00' }
      generated[v.time + '-' + timeDecreasedOneMinute(next.time)] = tt[i].value
    }
    cachedData.timetable[name] = generated
    return generated
  }
})
exports.proxy.divider = new Proxy({}, {
  get: (target, name) => {
    if (cachedData.divider[name]) return cachedData.divider[name]
    let tt = cache.timetables[name]
    let generated = []
    for (let i of tt) {
      if (i.divider) generated.push(i.value)
    }
    cachedData.divider[name] = generated
    return generated
  }
})
exports.proxy.daily_class = new Proxy({}, {
  get: (target, name) => {
    let {classSchedule: classScheduleName, timetable} = getTodayBinding()
    let classSchedule = cache.classSchedules[classScheduleName]
    classSchedule = cachedData.classSchedule[classSchedule] ??
      (cachedData.classSchedule[classSchedule] = classSchedule.map((a, index) => {
        try { return evaluateConditions(a).value } catch (e) {
          e.message += '\n在课程条件判断时出现问题: '
          e.message += `课程表 ${classScheduleName} 课程 第${index}节 时间表 ${timetable}`
          exports.currentError(e)
          return DEFAULT_SUBJECT
        }
      }))
    return {
      classList: classSchedule,
      timetable
    }
  }
})
