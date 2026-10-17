'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Config } = require('./config');
const { Auth } = require('./auth');
const { createApi } = require('./api');
const { readComptaFile } = require('./store');
const { checkAndInstall } = require('./updater');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win;
let pendingOpen = null;
function fromArgs(argv) { return (argv || []).find(a => /\.compta$/i.test(a) && fs.existsSync(a)); }
function openCompta(file) {
  try { pendingOpen = readComptaFile(file); } catch (e) { dialog.showErrorBox('AGOA COMPTA', e.message); return; }
  if (win && !win.isDestroyed()) { win.webContents.send('compta:open', pendingOpen); if (win.isMinimized()) win.restore(); win.focus(); }
}

function boot() {
  const userData = app.getPath('userData');
  let defaults = {}; try { defaults = require('./google.json'); } catch (e) { /* identifiants Google non embarqués : à saisir au premier lancement */ }
  const config = new Config(path.join(userData, 'config.json'), defaults);
  // La connexion Google est exigée à chaque lancement : aucune session n'est conservée sur le disque.
  const auth = new Auth({ getConfig: () => config.get(), openExternal: url => shell.openExternal(url) });
  const dialogs = {
    folder: async title => { const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
    files: async (title, filters, multi) => { const r = await dialog.showOpenDialog(win, { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] }); return r.canceled ? [] : r.filePaths; }
  };
  const api = createApi({ config, auth, dialogs, pending: { take: () => { const p = pendingOpen; pendingOpen = null; return p; } }, version: app.getVersion(), openPath: async p => { const e = await shell.openPath(p); if (e) throw new Error(e); } });
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

function splash() {
  const w = new BrowserWindow({ width: 380, height: 150, frame: false, resizable: false, alwaysOnTop: true, backgroundColor: '#F2F1F0', webPreferences: { sandbox: true } });
  const set = t => w.isDestroyed() || w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:15px Segoe UI,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#201C1C"><div style="text-align:center"><b style="color:#B3141C">AGOA COMPTA</b><p>' + t + '</p></div>'));
  set('Démarrage…');
  return { set, close: () => { if (!w.isDestroyed()) w.close(); } };
}

app.on('open-file', (e, f) => { e.preventDefault(); openCompta(f); });

app.whenReady().then(async () => {
  { const f = fromArgs(process.argv.slice(1)); if (f) { try { pendingOpen = readComptaFile(f); } catch (e) { dialog.showErrorBox('AGOA COMPTA', e.message); } } }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  if (app.isPackaged || process.env.AGOA_FORCE_UPDATE) {
    const sp = splash();
    const { autoUpdater } = require('electron-updater');
    const updating = await checkAndInstall({ app, autoUpdater, onStatus: t => t && sp.set(t) });
    if (updating) return;                    // l'installateur prend le relais et relance l'application
    sp.close();
  }
  boot(); createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', (e, argv) => { const f = fromArgs(argv); if (f) openCompta(f); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
