const responsiblity = (() => {
  function convertFn(args, func){
    if (typeof args[0] == 'function') {
      if (args[1]) args[1](func)
      setTimeout(() => func(args[0](false)))
      return {
        get: () => args[0](false),
        set: (data) => void (args[0](true, data))
      }
    }
    setTimeout(() => func(args[0][args[1]]))
    return {
      get: () => args[0][args[1]],
      set: (data) => void (args[0][args[1]] = data)
    }
  }
  function attachToInput(node, ...fn){
    fn = convertFn(fn, (value) => {
      if (value === void 0) return
      if (node.type == "checkbox") return node.checked = value
      if (node.type == "date") value = new Date(value).toISOString().slice(0, 10)
      node.value = value
    })
    let l = () => {
      let value = node.value
      if (node.type == "number") value = +value;
      else if (node.type == "checkbox") value = node.checked;
      else if (node.type == "date") value = new Date(node.value).getTime();
      fn.set(value)
    }
    node.addEventListener('change', l)
    node.responsiblity = {
      remove: () => {
        node.removeEventListener('change', l)
        node.responsiblity = void 0
      }
    }
  }
  function attachToSelect(node, options, ...fn){
    node.innerHTML = ''
    for (let i in options) {
      let option = document.createElement('option')
      option.value = i
      option.textContent = options[i]
      node.appendChild(option)
    }
    fn = convertFn(fn, (value) => {
      for (let c of node.children) {
        c.selected = c.value == value
      }
      fn.set(node.value)
    })
    let l = () => {
      let value = node.value
      fn.set(value)
    }
    node.addEventListener('change', l)
    node.responsiblity = {
      remove: () => {
        node.removeEventListener('change', l)
        node.responsiblity = void 0
      }
    }
  }
  return {convertFn, attachToInput, attachToSelect}
})();
