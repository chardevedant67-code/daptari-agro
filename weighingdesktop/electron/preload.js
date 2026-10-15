const { contextBridge, ipcRenderer } = require('electron');

// The renderer (the two screens) gets exactly this and nothing else: no
// Node, no filesystem, no network of its own. Every call is a named method
// that main.js explicitly allows.
contextBridge.exposeInMainWorld('desktop', {
  async call(method, ...args) {
    const result = await ipcRenderer.invoke('desktop:call', method, args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  on(event, listener) {
    const channel = `desktop:event:${event}`;
    const handler = (_e, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
