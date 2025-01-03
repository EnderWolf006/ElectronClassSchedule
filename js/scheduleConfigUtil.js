let ipcRendererReady = []

function handleIpcRenderer(fn) {
  if (window.ipcRenderer) return fn(window.ipcRenderer)
  ipcRendererReady.push(fn)
}
