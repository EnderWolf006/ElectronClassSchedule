// 所有窗口均运行在 nodeIntegration: true、contextIsolation: false 的 Electron 渲染进程中，
// window.require 由 Electron 注入。经 Vite 打包后仍需走 Node 集成获取 ipcRenderer。
const { ipcRenderer } = window.require('electron');

export { ipcRenderer };
