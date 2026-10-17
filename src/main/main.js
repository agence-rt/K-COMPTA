'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Config } = require('./config');
const { Auth } = require('./auth');
const { createApi } = require('./api');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win;
function boot() {
  const userData = app.getPath('userData');
  const config = new Config(path.join(userData, 'config.json'));
  const sessFile = path.join(userData, 'session.json');
  let saved = null; try { saved = JSON.parse(fs.readFileSync(sessFile, 'utf8')); } catch (e) { /* aucune session */ }
  const auth = new Auth({
    getConfig: () => config.get(),
    openExternal: url => shell.openExternal(url),
    session: saved,
    onSession: s => { try { s ? fs.writeFileSync(sessFile, JSON.stringify(s)) : fs.rmSync(sessFile, { force: true }); } catch (e) { /* ignore */ } }
  });
  const dialogs = {
    folder: async title => { const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
    files: async (title, filters, multi) => { const r = await dialog.showOpenDialog(win, { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] }); return r.canceled ? [] : r.filePaths; }
  };
  const api = createApi({ config, auth, dialogs, version: app.getVersion(), openPath: async p => { const e = await shell.openPath(p); if (e) throw new Error(e); } });
  Object.keys(api).forEach(ch => ipcMain.handle(ch, async (ev, ...args) => api[ch](...args)));
  ipcMain.on('period:saveSync', (ev, soc, period, data) => { try { api['period:save'](soc, period, data); ev.returnValue = true; } catch (e) { ev.returnValue = false; } });
}

function createWindow() {
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 1000, minHeight: 640, title: 'AGOA COMPTA', backgroundColor: '#F2F1F0', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  boot(); createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
