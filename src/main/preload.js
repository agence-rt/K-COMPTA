'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('agoa', {
  cfg: { get: () => call('cfg:get'), setGoogle: g => call('cfg:setGoogle', g), chooseRoot: () => call('cfg:chooseRoot') },
  auth: { session: () => call('auth:session'), login: () => call('auth:login'), local: () => call('auth:local'), logout: () => call('auth:logout') },
  period: { load: (s, p) => call('period:load', s, p), save: (s, p, d) => call('period:save', s, p, d), saveSync: (s, p, d) => ipcRenderer.sendSync('period:saveSync', s, p, d) },
  inbox: { list: () => call('inbox:list'), importAll: () => call('inbox:importAll') },
  statement: { pick: () => call('statement:pick') },
  doc: { pick: (s, p, l) => call('doc:pick', s, p, l), open: (s, p, r) => call('doc:open', s, p, r) },
  folder: { open: (s, p, sub) => call('folder:open', s, p, sub) },
  export: { run: (s, p, k) => call('export:run', s, p, k) }
});
