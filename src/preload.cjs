const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pliego', {
  initial: () => ipcRenderer.invoke('reader:initial'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  refreshUpdates: () => ipcRenderer.invoke('updates:refresh'),
  openUpdate: () => ipcRenderer.invoke('updates:open'),
  openReleaseNotes: () => ipcRenderer.invoke('updates:notes'),
  updateTransfer: () => ipcRenderer.invoke('updates:transfer-state'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  cancelUpdate: () => ipcRenderer.invoke('updates:cancel'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateTransfer(callback) {
    ipcRenderer.on('updates:transfer', (_event, status) => callback(status));
  },
  choose: category => ipcRenderer.invoke('reader:choose', category),
  open: (file, category) => ipcRenderer.invoke('reader:open', file, category),
  drop: (file, category) => ipcRenderer.invoke('reader:open', webUtils.getPathForFile(file), category),
  chooseLibrary: category => ipcRenderer.invoke('library:choose', category),
  setLibraryColumns: columns => ipcRenderer.invoke('library:columns', columns),
  importLibrary: (files, category) => ipcRenderer.invoke('library:import', files.map(file => webUtils.getPathForFile(file)), category),
  editLibrary: (command, args) => ipcRenderer.invoke('library:edit', command, args),
  suggestGroups: category => ipcRenderer.invoke('library:suggest', category),
  recent: id => ipcRenderer.invoke('reader:recent', id),
  pageCanAnimate: (id, index) => ipcRenderer.invoke('reader:page-animation', id, index),
  progress: (id, page, rtl, turned) => ipcRenderer.invoke('reader:progress', id, page, rtl, turned),
  settings: settings => ipcRenderer.invoke('reader:settings', settings),
  fullscreen: () => ipcRenderer.invoke('reader:fullscreen'),
  dismissPageTurnTip: () => ipcRenderer.invoke('reader:dismiss-page-turn-tip'),
  torrentInitial: () => ipcRenderer.invoke('torrent:initial'),
  torrentCommand: (command, args) => ipcRenderer.invoke('torrent:command', command, args),
  torrentFolder: chosen => ipcRenderer.invoke('torrent:folder', chosen),
  torrentReveal: () => ipcRenderer.invoke('torrent:reveal'),
  onTorrent(callback) {
    ipcRenderer.on('torrent:changed', (_event, job) => callback(job));
  },
  onLibraryChanged(callback) {
    ipcRenderer.on('library:changed', (_event, library) => callback(library));
  },
  onFullscreen(callback) {
    ipcRenderer.on('reader:fullscreen-changed', (_event, value) => callback(value));
  },
  onExternalOpen(callback) {
    ipcRenderer.on('reader:external-open', (_event, file) => callback(file));
  }
});
