/* Mise à jour automatique au lancement : cherche la dernière version publiée sur GitHub (agence-rt/K-COMPTA),
   la télécharge et relance l'application dessus. En cas d'échec (hors ligne…), l'application démarre normalement. */
'use strict';
const TIMEOUT_MS = 20000;

/** Rend true si une mise à jour va être installée (l'application redémarre alors). */
async function checkAndInstall({ app, autoUpdater, onStatus = () => {}, timeoutMs = TIMEOUT_MS }) {
  if (!app.isPackaged && !process.env.AGOA_FORCE_UPDATE) return false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    onStatus('Recherche de mise à jour…');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), timeoutMs).unref());
    const res = await Promise.race([autoUpdater.checkForUpdates(), timeout]);
    if (!res || !res.updateInfo || !res.isUpdateAvailable) return false;
    onStatus('Téléchargement de la version ' + res.updateInfo.version + '…');
    await Promise.race([res.downloadPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('téléchargement trop long')), 10 * 60000).unref())]);
    onStatus('Installation…');
    autoUpdater.quitAndInstall(true, true);   // silencieux, relance après installation
    return true;
  } catch (e) { onStatus(''); return false; }
}
module.exports = { checkAndInstall };
