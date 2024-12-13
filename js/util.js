function initPage(window, root, channel){
  const { ipcRenderer } = require('electron');
  let timer = undefined
  window.addEventListener("mousemove", event => {
    if (event.target.className && event.target.className.indexOf('notIgnoreClick') == -1) {
      root.style.opacity = '0.2'
      clearTimeout(timer)
      timer = setTimeout(() => {
        root.style.opacity = '1'
      }, 5000);
    } else {
      clearTimeout(timer)
      root.style.opacity = '1'
    }
    if (event.target.className.indexOf('notIgnoreClick') == -1) {
      ipcRenderer.send(channel, true)
    } else {
      ipcRenderer.send(channel, false)
    }

  });
  ipcRenderer.send(channel, false)
}
