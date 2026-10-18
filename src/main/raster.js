/* Dernier recours pour l'export compilé : un PDF que pdf-lib ne sait pas recopier (fichier abîmé, structure exotique) est dessiné page par page
   (pdf.js, dans une fenêtre cachée) puis inséré sous forme d'images. Le contenu reste lisible, il n'est simplement plus du texte. */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const unpacked = p => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const PAGE = path.join(__dirname, 'raster', 'raster.html');

/** Script exécuté dans la fenêtre cachée : rend chaque page en JPEG (échelle 2) et rend [{ w, h, img }]. */
const SCRIPT = `(async (b64, pdfUrl, workerUrl, maxPages) => {
  const pdfjs = await import(pdfUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const bin = atob(b64), data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, password: '' }).promise;
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 }), v = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    out.push({ w: v1.width, h: v1.height, img: c.toDataURL('image/jpeg', 0.85) });
  }
  return out;
})`;

function assets() {
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return { pdfUrl: pathToFileURL(unpacked(path.join(base, 'build', 'pdf.mjs'))).href, workerUrl: pathToFileURL(unpacked(path.join(base, 'build', 'pdf.worker.mjs'))).href };
}

/** Rend les pages de `buf` (Buffer PDF) en images JPEG : [{ w, h, jpeg: Buffer }] (dimensions en points). `BrowserWindow` vient d'Electron. */
async function rasterizeWithWindow(BrowserWindow, buf, { maxPages = 60, timeout = 60000 } = {}) {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await win.loadFile(PAGE);
    const { pdfUrl, workerUrl } = assets();
    const job = win.webContents.executeJavaScript(SCRIPT + '(' + JSON.stringify(buf.toString('base64')) + ',' + JSON.stringify(pdfUrl) + ',' + JSON.stringify(workerUrl) + ',' + maxPages + ')', true);
    let timer; const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('délai dépassé')), timeout); });
    const pages = await Promise.race([job, guard]).finally(() => clearTimeout(timer));
    return pages.map(p => ({ w: p.w, h: p.h, jpeg: Buffer.from(p.img.slice(p.img.indexOf(',') + 1), 'base64') }));
  } finally { try { win.destroy(); } catch (e) { /* ignore */ } }
}
module.exports = { rasterizeWithWindow, SCRIPT, assets, PAGE };
