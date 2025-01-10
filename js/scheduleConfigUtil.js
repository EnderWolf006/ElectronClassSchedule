window.ipcRendererReady = []

function handleIpcRenderer(fn) {
  if (window.ipcRenderer) return fn(window.ipcRenderer)
  ipcRendererReady.push(fn)
}

const conditions = {
  'always': ['总是', '@'],
  'never': ['从不', '@'],
  'equals': ['等于', 'ss', '@', 'in'],
  'notEquals': ['不等于', 'ss', '@', 'in'],
  'lessThan': ['小于', 'ss', '@', 'in'],
  'lessThanEquals': ['小于等于', 'ss', '@', 'in'],
  'greaterThan': ['大于', 'ss', '@', 'in'],
  'greaterThanEquals': ['大于等于', 'ss', '@', 'in'],
  'between': ['介于', 'ss', '@', 'in', '@之间', 'in'],
  'notBetween': ['不介于', 'ss', '@', 'in', '@之间', 'in'],
  'javascript': ['JS表达式', '@', 'is']
}

const stateTypes = {
  'manual': ['手动', {
    'value': 'in // 值'
  }],
  'dateAuto': ['日期自动', {
    'offset': 'in // 偏移量',
    'begin': 'id // 开始日期',
    'cycle': 'in // 递增周期(天)',
    'max': 'in // 最大值'
  }],
  'javascript': ['JS表达式', {
    'code': 'a // JS表达式\n-  state(name)获取状态值\n-  sc为scheduleConfig函数\n-  nodejs环境eval执行'
  }],
}

const timetableOptions = {
  'course': ['课程', 'in', data => typeof data == 'number'],
  'rest': ['课间', '=课间', data => data == '课间'],
  'custom': ['自定义', 'is', data => typeof data == 'string'],
}

function _attachElement(div, type, ...fn){
  if (type.startsWith('@')) {
    let a = document.createElement('a')
    a.innerText = type.slice(1)
    div.appendChild(a)
    return false
  }
  if (type[0] == 'i') {
    let input = document.createElement('input')
    input.type = ({
      'n': 'number',
      's': 'text',
      'd': 'date'
    })[type[1]]
    responsiblity.attachToInput(input, ...fn)
    div.appendChild(input)
    return true
  }
  if (type[0] == 'a') {
    let textarea = document.createElement('textarea')
    responsiblity.attachToInput(textarea, ...fn)
    div.appendChild(textarea)
    return true
  }
  if (type[0] == '=') {
    responsiblity.convertFn(fn, ()=>void 0).set(type.slice(1))
    return true
  }
}

function attachElement(div, type, ...fn){
  let comment;
  if (type.includes('// ')) {
    let [a, b] = type.split('// ')
    type = a.trim()
    comment = b
  }
  if (comment) {
    let a = document.createElement('a')
    a.classList = 'comment'
    a.innerText = '// ' + comment
    comment = a
  }
  if (type[0] == 'a' && comment) {
    comment.style.display = 'block'
    div.appendChild(comment)
  }
  let ok = _attachElement(div, type, ...fn)
  if (type[0] != 'a' && comment) div.appendChild(comment)
  return ok
}

function attachCondition(cond, div) {
  div.innerHTML = ''
  let format = conditions[cond[0]].slice(1)
  let current = 1
  for (let i of format) {
    let index = current
    if (i == '@') {
      let select = document.createElement('select')
      responsiblity.attachToSelect(select,
        Object.fromEntries(Object.entries(conditions).map(([k, v]) => [k, v[0]])),
        cond, 0)
      select.addEventListener('change', () => {
        attachCondition(cond, div)
      })
      div.appendChild(select)
      continue
    }
    if (i == 'ss') {
      let select = document.createElement('select')
      responsiblity.attachToSelect(select,
        Object.fromEntries(Object.keys(data.states).map((k) => [k, k])),
        cond, index)
      current += 1
      div.appendChild(select)
      continue
    }
    if (!attachElement(div, i, cond, index)) continue
    current += 1
  }
}

function attachSelectableList(div, listSource, clicked) {
  let selected = void 0
  let selectedLine = void 0
  function refresh() {
    let list = typeof listSource == 'function' ? listSource() : listSource
    div.innerHTML = ''
    for (let i in list) {
      let line = document.createElement('div')
      line.classList = 'line' + (i == selected ? ' selectedLine' : '')
      if (i == selected) selectedLine = line
      line.innerText = list[i]
      line.addEventListener('click', () => {
        if (selectedLine) selectedLine.classList.remove('selectedLine')
        selectedLine = line
        selectedLine.classList.add('selectedLine')
        selected = i
        clicked(selected)
      })
      div.appendChild(line)
    }
    if (!list[selected]) selected = void 0
  }
  refresh()
  return {refresh, getSelected: () => selected,
    setSelected: (i) => {
      selected = i
      refresh()
    }
  }
}

function timeGreaterThan(a, b) {
  let [h1, m1] = a.split(':')
  let [h2, m2] = b.split(':')
  if (h1 != h2) return h1 > h2
  return m1 > m2
}

function validTime(a) {
  let [h, m] = a.split(':')
  return h >= 0 && h < 24 && m >= 0 && m < 60
}

function timetableRange(timetable, i) {
  let {time} = timetable[i]
  let {time: nextTime} = timetable[+i+1] ?? {time: '23:59'}
  return `${time} ~ ${nextTime}`
}

function checkConditions(conds, config, current, warn, error){
  let hasAlways = false
  for (let index in conds) {
    let { condition } = conds[index]
    current('条件 # ' + index)
    error(conditions[condition[0]][1] == 'ss' && !config.states[condition[1]], '无效的状态名: ' + condition[1])
    warn(hasAlways, '条件被always覆盖: 条件上方存在always条件')
    if (condition[0] == 'always') hasAlways = true
  }
  current('')
  warn(!hasAlways, '不存在always条件: 可能无符合条件的值')
}

function checkBindings(bindings, config, current, warn, error){
  for (let index in bindings){
    let binding = bindings[index]
    current('条件 # ' + index)
    checkBinding(binding, config, current, warn, error)
  }
}

function checkBinding(binding, config, current, warn, error){
  let timetable = config.timetables[binding.timetable]
  let classSchedule = config.classSchedules[binding.classSchedule]
  error(!timetable, '无效的时间表: ' + binding.timetable)
  error(!classSchedule, '无效的课程表: ' + binding.classSchedule)
  if (timetable && classSchedule) {
    let max = timetable.reduce((a, b) => typeof b.value == 'number'? b.value > a ? b.value : a : a, 0)
    warn(classSchedule.length < max, '课程表课程数量不足(' + classSchedule.length + '), 少于时间表课程数量(' + max + ')')
  }
}

const checks = {
  bindings: [
    checkConditions,
    checkBindings
  ],
  tempBindings: [
    checkBinding
  ],
  timetables: [
    (timetable, config, current, warn, error) => {
      let lastTime = '00:00'
      for (let i in timetable) {
        let {time, value} = timetable[i]
        current(timetableRange(timetable, i))
        error(typeof value == 'number' && value < 0, `无效的课程索引(<0)`)
        error(!validTime(time), '无效的时间')
        error(i != 0 && validTime(time) && !timeGreaterThan(time, lastTime), '无效的时间(时间倒流)')
        lastTime = time
      }
    }
  ],
  classSchedules: [
    (classSchedule, config, current, warn, error) => {
      for (let index in classSchedule) {
        let conditions = classSchedule[index]
        let curr = '第' + index + '节'
        current(curr)
        checkConditions(conditions, config, (a) => current(curr + a), warn, error)
        for (let i in conditions) {
          let { value } = conditions[i]
          error(!config.subjects[value], '无效的课程: ' + value)
        }
      }
    }
  ]
}

function runCheckFor(type, name, object, config, output) {
  let cs = checks[type]
  if (!cs) return
  let cn = ''
  let warn = (a, b) => {
    if (!a) return
    output.lines.push('[⚠警告] ' + name + (cn? '[' + cn + ']': '') + ': ' + b)
    output.warns += 1
  }
  let error = (a, b) => {
    if (!a) return
    output.lines.push('[✖错误] ' + name + (cn? '[' + cn + ']': '') + ': ' + b)
    output.errors += 1
  }
  for (let check of cs) {
    check(object, config, (a) => cn = a, warn, error)
  }
}

function checkConfig(config) {
  let output = {
    lines: [],
    warns: 0,
    errors: 0
  }
  function runCheck(type, array, name, value = (a) => a) {
    array.forEach((a, index) => {
      runCheckFor(type, name(a, index), value(a, index), config, output)
    })
  }
  let weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  runCheck('bindings', config.bindings, (_, i) => '数据绑定[' + weekdays[i] + ']')
  runCheck('tempBindings', config.tempBindings, (d) => '临时数据绑定[' + new Date(d.date).toLocaleDateString() + ']')
  runCheck('timetables', Object.entries(config.timetables), ([v, _]) => '时间表[' + v + ']', ([_, v]) => v)
  runCheck('classSchedules', Object.entries(config.classSchedules), ([v, _]) => '课程表[' + v + ']', ([_, v]) => v)
  return output
}
