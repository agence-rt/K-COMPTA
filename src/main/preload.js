'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('agoa', {
  openFile: { pending: () => call('app:pendingOpen'), onOpen: cb => ipcRenderer.on('compta:open', (e, v) => cb(v)) },
  cfg: { get: () => call('cfg:get'), chooseRoot: () => call('cfg:chooseRoot') },
  auth: { session: () => call('auth:session'), login: () => call('auth:login'), logout: () => call('auth:logout') },
  period: { load: (s, p) => call('period:load', s, p), save: (s, p, d) => call('period:save', s, p, d), saveSync: (s, p, d) => ipcRenderer.sendSync('period:saveSync', s, p, d) },
  inbox: { list: () => call('inbox:list'), importAll: () => call('inbox:importAll') },
  statement: { pick: () => call('statement:pick') },
  doc: { pick: (s, p, l) => call('doc:pick', s, p, l), open: (s, p, r) => call('doc:open', s, p, r), read: (s, p, r) => call('doc:read', s, p, r) },
  folder: { open: (s, p, sub) => call('folder:open', s, p, sub) },
  export: { run: (s, p, k) => call('export:run', s, p, k) }
});
