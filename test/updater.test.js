'use strict';
const test = require('node:test'), assert = require('node:assert');
const { checkAndInstall } = require('../src/main/updater');
const app = { isPackaged: true };
test('mise à jour disponible : téléchargée puis installée', async () => {
  let installed = null;
  const u = { checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.1.9' }, downloadPromise: Promise.resolve() }), quitAndInstall: (...a) => { installed = a; } };
  assert.equal(await checkAndInstall({ app, autoUpdater: u }), true); assert.deepEqual(installed, [true, true]);
});
test('à jour ou erreur réseau : démarrage normal', async () => {
  assert.equal(await checkAndInstall({ app, autoUpdater: { checkForUpdates: async () => ({ isUpdateAvailable: false }) } }), false);
  assert.equal(await checkAndInstall({ app, autoUpdater: { checkForUpdates: async () => { throw new Error('offline'); } } }), false);
  assert.equal(await checkAndInstall({ app, autoUpdater: { checkForUpdates: () => new Promise(() => {}) }, timeoutMs: 30 }), false);
});
test('en développement : pas de recherche', async () => { assert.equal(await checkAndInstall({ app: { isPackaged: false }, autoUpdater: {} }), false); });
