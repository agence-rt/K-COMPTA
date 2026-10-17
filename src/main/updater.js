/* Mise à jour automatique au lancement : cherche la dernière version publiée sur GitHub (agence-rt/K-COMPTA),
   la télécharge et relance l'application dessus. En cas d'échec (hors ligne…), l'application démarre normalement. */
'use strict';
const TIMEOUT_MS = 20000;

/** Rend true si une mise à jour va être installée (l'application redémarre alors). */
const withTimeout = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };

async function checkAndInstall({ app, autoUpdater, onStatus = () => {}, timeoutMs = TIMEOUT_MS }) {
  if (!app.isPackaged && !process.env.AGOA_FORCE_UPDATE) return false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    onStatus('Recherche de mise à jour…');
    const res = await withTimeout(Promise.resolve(autoUpdater.checkForUpdates()), timeoutMs, 'délai dépassé');
    if (!res || !res.updateInfo || !res.isUpdateAvailable) return false;
    onStatus('Téléchargement de la version ' + res.updateInfo.version + '…');
    await withTimeout(Promise.resolve(res.downloadPromise), 10 * 60000, 'téléchargement trop long');
    onStatus('Installation…');
    autoUpdater.quitAndInstall(true, true);   // silencieux, relance après installation
    return true;
  } catch (e) { onStatus(''); return false; }
}
module.exports = { checkAndInstall };
