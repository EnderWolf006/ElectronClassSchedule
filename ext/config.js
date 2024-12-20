const { ipcMain } = require('electron')

let store = void 0;
exports.pass = function(data) {
  store = data.store
}

exports.defaultConfigs = { 
  isWindowAlwaysOnTop: true,
  isDuringClassHidden: true,
  isAutoLaunch: true,
}
exports.defaultConfigsDeep = {
  schedule: {
    weekIndex: 0,
    timeOffset: 0,
    dayOffset: -1,
    setDayOffsetLastDay: -1
  },
  ext: {
    timer: {
      enabled: true,
      isWindowAlwaysOnTop: true
    },
    notice: {
      enabled: true
    }
  }
}

function applyDefaults(configs){
  configs = Object.assign({}, exports.defaultConfigs, configs)
  function iter(obj, target){
    for (let i in obj) {
      if (typeof obj[i] == 'object' && obj[i] != null){
        iter(obj[i], target[i] || (target[i] = {}))
      } else if (typeof target[i] == 'undefined') {
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

ipcMain.handle('configs.set', (arg) => {
  exports.configs(a => Object.assign(a, arg))
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
