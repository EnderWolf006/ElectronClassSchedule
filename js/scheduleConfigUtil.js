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
