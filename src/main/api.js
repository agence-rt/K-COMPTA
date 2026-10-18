/* Fonctions appelées par l'interface (via le pont du preload). Indépendant d'Electron : les boîtes de dialogue
   et l'ouverture de fichiers sont injectées, ce qui permet de tester l'ensemble sans fenêtre. */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core/calc');
const { Store } = require('./store');
const { buildXlsx } = require('../core/export/xlsx');
const { buildPdf } = require('../core/export/pdf');
const { buildLinesPdf } = require('../core/export/pdf-lines');

function createApi({ config, auth, dialogs, openPath, version, pending }) {
  const store = () => { const r = config.comptaRoot(); if (!r) return null; const s = new Store(r); s.ensure(); return s; };
  const need = () => { const s = store(); if (!s) throw new Error('Dossier Dropbox introuvable : choisissez-le dans Réglages.'); return s; };
  const publicCfg = () => {
    const c = config.get(), g = c.google || {}, root = config.comptaRoot();
    return { root, rootSource: c.root && root === c.root ? 'config' : 'auto', version: version || '', authRequired: auth.required !== false,
      google: { clientId: g.clientId || '', hasSecret: !!g.clientSecret, email: g.allowedEmail, configured: !!g.clientId } };
  };
  const guard = () => { if (!auth.current().ok) throw new Error('Non connecté.'); };

  const api = {
    'cfg:get': () => publicCfg(),
    'cfg:chooseRoot': async () => {
      const p = await dialogs.folder('Choisir le dossier 003-COMPTABILITE de la Dropbox');
      if (!p) return null;
      config.set({ root: p }); return { cfg: publicCfg() };
    },
    'app:pendingOpen': () => { guard(); const p = pending ? pending.take() : null; return p; },
    'auth:session': () => auth.current(),
    'auth:login': () => auth.login(),
    'auth:logout': () => { auth.logout(); return true; },

    'period:load': (soc, period) => { guard(); const s = store(); return s ? s.load(soc, period) : C.blankPeriod(soc, period); },
    'file:saveAs': async (soc, period) => {
      guard(); const s = need(); const info = C.periodInfo(soc, period);
      const name = 'AGOA-COMPTA_' + C.slug(C.SOC[soc].short) + '_' + info.id + '.compta';
      const dest = await dialogs.save('Enregistrer le fichier .compta', name, [{ name: 'Fichier AGOA COMPTA', extensions: ['compta'] }]);
      if (!dest) return null;
      const out = /\.compta$/i.test(dest) ? dest : dest + '.compta';
      s.exportCompta(soc, period, out); return { path: out };
    },
    'file:backups': (soc, period) => { guard(); return need().listBackups(soc, period); },
    'period:save': (soc, period, data) => { guard(); need().save(soc, period, data); return true; },

    'inbox:list': () => { guard(); const s = store(); return { count: s ? s.listInbox().length : 0 }; },
    'inbox:importAll': async () => { guard(); return { reports: await need().importInbox() }; },
    'statement:pick': async () => {
      guard(); const s = need();
      const files = await dialogs.files('Importer des relevés bancaires', [{ name: 'Relevés PDF', extensions: ['pdf'] }], true);
      const reports = []; for (const f of files || []) reports.push(await s.importStatement(f));
      return { reports };
    },
    'doc:pick': async (soc, period, line) => {
      guard(); const s = need();
      const f = await dialogs.files('Ajouter un justificatif', [{ name: 'PDF', extensions: ['pdf'] }], false);
      if (!f || !f[0]) return null;
      return { doc: await s.attachDoc(soc, period, line, f[0], { replace: line && line.oldRel }) };
    },
    'doc:remove': (soc, period, rel) => { guard(); return { trashed: need().trashDoc(soc, period, rel) }; },
    'doc:audit': async () => {
      guard(); const s = need(), reps = [];
      for (const P of s.allPeriods()) reps.push(await s.auditDocs(P.soc, P.period));
      return { reports: reps };
    },
    'doc:read': (soc, period, rel) => { guard(); return fs.readFileSync(need().absPath(soc, period, rel)); },
    'doc:open': async (soc, period, rel) => { guard(); await openPath(need().absPath(soc, period, rel)); return true; },
    'folder:open': async (soc, period, sub) => {
      guard(); const s = need(); const d = sub ? s.absPath(soc, period, sub) : s.periodDir(soc, period);
      fs.mkdirSync(d, { recursive: true }); await openPath(d); return true;
    },

    'export:run': async (soc, period, kind) => {
      guard(); const s = need();
      const data = s.load(soc, period), dir = path.join(s.periodDir(soc, period), 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const base = 'AGOA-COMPTA_' + C.slug(C.SOC[soc].short) + '_' + C.periodInfo(soc, period).id;
      const files = []; let message = '';
      if (kind === 'xlsx' || kind === 'all') {
        const n = base + '_lignes-et-TVA.xlsx'; fs.writeFileSync(path.join(dir, n), buildXlsx(soc, period, data)); files.push({ name: n, rel: path.join('exports', n) });
      }
      if (kind === 'lines' || kind === 'all') {
        const n = base + '_lignes-et-TVA.pdf'; fs.writeFileSync(path.join(dir, n), await buildLinesPdf(soc, period, data)); files.push({ name: n, rel: path.join('exports', n) });
      }
      if (kind === 'pdf' || kind === 'all') {
        const buf = await buildPdf(soc, period, data, async l => { try { return l.doc ? fs.readFileSync(s.absPath(soc, period, l.doc.rel)) : null; } catch (e) { return null; } });
        if (buf) {
          const n = base + '_justificatifs.pdf'; fs.writeFileSync(path.join(dir, n), buf); files.push({ name: n, rel: path.join('exports', n) });
          if (buf.skipped && buf.skipped.length) message = buf.skipped.length + ' justificatif' + (buf.skipped.length > 1 ? 's' : '') + ' non intégré' + (buf.skipped.length > 1 ? 's' : '') + ' au PDF (remplacé' + (buf.skipped.length > 1 ? 's' : '') + ' par une page d\'avertissement) : ' + buf.skipped.map(x => 'n° ' + x.n + ' ' + x.name + ' (' + x.err + ')').join(' ; ') + '.';
        }
        else message = 'Aucun justificatif rattaché : PDF non créé.';
      }
      return { files, message };
    }
  };
  return api;
}
module.exports = { createApi };
