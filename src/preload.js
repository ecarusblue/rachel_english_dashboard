'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  // 현황판 창
  getBoard: () => ipcRenderer.invoke('board:get'),
  onBoard: (cb) => on('board:update', cb),

  // 홈·로그인·직접 입력 창
  getControl: () => ipcRenderer.invoke('control:get'),
  onControl: (cb) => on('control:update', cb),
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'),
  openBoard: (source) => ipcRenderer.invoke('board:open', source),
  closeBoard: () => ipcRenderer.invoke('board:close'),
  getCustom: () => ipcRenderer.invoke('custom:get'),
  saveCustom: (custom) => ipcRenderer.invoke('custom:save', custom),
  clearCustom: () => ipcRenderer.invoke('custom:clear'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
