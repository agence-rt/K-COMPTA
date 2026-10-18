/* Données de comptabilité rangées dans AGOA-COMPTA (dossier Dropbox synchronisé) :
   AGOA-COMPTA/<société>/<année>/<période>/{periode.compta, releves/, justificatifs/, exports/}
   Les relevés à traiter sont déposés dans AGOA-COMPTA/A-TRAITER/. */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core/calc');
const { parseStatement } = require('../core/parse/statements');
const { splitByPeriod, mergePart } = require('../core/import');
const { analyseInvoice, matchInvoice, ventFrom } = require('../core/parse/invoice');

const fmtE = n => C.fmt(n) + ' €';
const mkdir = p => fs.mkdirSync(p, { recursive: true });
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* ignore */ } };
/** Réessaie une opération de fichier : Dropbox, l'antivirus ou l'indexeur verrouillent brièvement les fichiers sous Windows (EPERM, EBUSY, EACCES). */
function retryFs(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES', 'EAGAIN'].includes(e.code)) throw e;
      sleep(60 * (i + 1));
    }
  }
}
/** Écrit un fichier sans jamais le laisser à moitié écrit. Le renommage est réessayé ; s'il reste refusé (fichier tenu par Dropbox), on écrit directement dans le fichier. */
function writeAtomic(file, content) {
  mkdir(path.dirname(file));
  const t = file + '.tmp';
  try {
    retryFs(() => fs.writeFileSync(t, content));
    try { retryFs(() => fs.renameSync(t, file), 5); return; } catch (e) { /* repli ci-dessous */ }
    retryFs(() => fs.writeFileSync(file, content));
  } finally { try { fs.unlinkSync(t); } catch (e) { /* ignore */ } }
}
function uniqueName(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext); let n = name, i = 1;
  while (fs.existsSync(path.join(dir, n))) n = base + '-' + (++i) + ext;
  return n;
}

/** Format du fichier .compta : propre à AGOA COMPTA, il porte la société et la période pour pouvoir être rouvert d'un double-clic. */
const FORMAT = 'AGOA-COMPTA';
const wrap = d => ({ app: FORMAT, format: 1, societe: d.soc, periode: d.period, data: d });
function unwrap(j) { if (j && j.app === FORMAT && j.data) return j.data; if (j && j.app) throw new Error('Fichier .compta d\'une autre application'); return j; }
/** Lit un fichier .compta et rend { soc, period } (ou lève une erreur si ce n'est pas un fichier AGOA COMPTA). */
function readComptaFile(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || j.app !== FORMAT || !C.SOC[j.societe] || !C.periodInfo(j.societe, j.periode)) throw new Error('Ce fichier .compta n\'est pas un fichier AGOA COMPTA valide.');
  return { soc: j.societe, period: j.periode };
}

class Store {
  constructor(comptaRoot) { this.base = path.join(comptaRoot, 'AGOA-COMPTA'); this.keep = Store.keep; this.backupEvery = Store.backupEvery; }
  inboxDir() { return path.join(this.base, 'A-TRAITER'); }
  periodDir(soc, periodId) {
    const p = C.periodInfo(soc, periodId); if (!p) throw new Error('Période inconnue : ' + periodId);
    return path.join(this.base, C.SOC[soc].folder, String(C.periodYear(periodId)), p.folder);
  }
  ensure() { mkdir(this.inboxDir()); }

  composeFile(soc, periodId) { return path.join(this.periodDir(soc, periodId), 'periode.compta'); }
  load(soc, periodId) {
    const dir = this.periodDir(soc, periodId);
    for (const n of ['periode.compta', 'periode.json']) {          // periode.json : ancien format, relu puis réécrit en .compta
      try { return C.assignCodes(Object.assign(C.blankPeriod(soc, periodId), unwrap(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))))); } catch (e) { /* suivant */ }
    }
    return C.blankPeriod(soc, periodId);
  }
  save(soc, periodId, data) {
    data.updated = new Date().toISOString();
    const file = this.composeFile(soc, periodId), json = JSON.stringify(wrap(data), null, 1);
    try { this.backup(file, soc + '/' + periodId); } catch (e) { /* une sauvegarde de secours ratée ne doit jamais bloquer l'enregistrement */ }
    writeAtomic(file, json);
  }
  /** Sauvegardes de secours : avant d'écraser periode.compta, l'état précédent est copié dans backups/ (au plus une copie toutes les
   *  `backupEvery` ms, la première dès le premier enregistrement de la session). On garde les `keep` plus récentes. */
  backup(file, key) {
    if (!fs.existsSync(file)) return;
    const now = Date.now(), last = Store.lastBackup;
    if (last[file] && now - last[file] < this.backupEvery) return;
    const dir = path.join(path.dirname(file), 'backups'); mkdir(dir);
    const st = new Date(now), p2 = n => String(n).padStart(2, '0');
    const stamp = st.getFullYear() + p2(st.getMonth() + 1) + p2(st.getDate()) + '-' + p2(st.getHours()) + p2(st.getMinutes()) + p2(st.getSeconds()) + '-' + String(st.getMilliseconds()).padStart(3, '0');
    let i = 0, bn; do { bn = 'periode_' + stamp + '-' + String(i++).padStart(2, '0') + '.compta'; } while (fs.existsSync(path.join(dir, bn)));
    retryFs(() => fs.copyFileSync(file, path.join(dir, bn)));
    last[file] = now;
    const all = fs.readdirSync(dir).filter(n => /^periode_.*\.compta$/.test(n)).sort();
    all.slice(0, Math.max(0, all.length - this.keep)).forEach(n => { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* ignore */ } });
  }
  listBackups(soc, periodId) {
    const dir = path.join(this.periodDir(soc, periodId), 'backups');
    try { return fs.readdirSync(dir).filter(n => /^periode_.*\.compta$/.test(n)).sort().reverse(); } catch (e) { return []; }
  }
  /** Écrit une copie .compta de la période à l'emplacement choisi par l'utilisateur. */
  exportCompta(soc, periodId, dest) {
    const data = this.load(soc, periodId); data.updated = new Date().toISOString();
    writeAtomic(dest, JSON.stringify(wrap(data), null, 1));
    return dest;
  }
  has(soc, periodId) { return fs.existsSync(this.composeFile(soc, periodId)) || fs.existsSync(path.join(this.periodDir(soc, periodId), 'periode.json')); }

  absPath(soc, periodId, rel) {
    const dir = this.periodDir(soc, periodId), p = path.resolve(dir, rel);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Chemin refusé.');
    return p;
  }

  /** Range un justificatif PDF sous le code de la ligne (ex. 2026-09-CM-12.pdf) et le lit (émetteur, montant). Copie ou déplace selon `move`. */
  async attachDoc(soc, periodId, line, srcPath, { move = false, replace = null } = {}) {
    const dir = path.join(this.periodDir(soc, periodId), 'justificatifs'); mkdir(dir);
    const base = line.code || ((line.date || 'sans-date') + '_' + C.slug(line.label || 'ligne'));
    const buf = fs.readFileSync(srcPath);
    let a = null; try { a = await analyseInvoice(buf); } catch (e) { /* PDF non lisible : rangé quand même */ }
    if (replace) this.trashDoc(soc, periodId, replace);          // l'ancien PDF quitte le dossier : le nouveau reprend le nom du code
    const name = uniqueName(dir, base + '.pdf');
    retryFs(() => fs.writeFileSync(path.join(dir, name), buf));
    if (move) { try { retryFs(() => fs.unlinkSync(srcPath), 4); } catch (e) { /* ignore */ } }
    return { name, original: path.basename(srcPath), rel: path.join('justificatifs', name),
      total: a && a.total != null ? a.total : null, ht: a ? a.ht : null, issuer: a ? a.issuer : null, docDate: a ? a.date : null };
  }

  /** Retire un justificatif du dossier « justificatifs » : il est déplacé dans « corbeille » (à côté de periode.compta), jamais perdu. */
  trashDoc(soc, periodId, rel) {
    if (!rel) return null;
    const src = this.absPath(soc, periodId, rel);
    if (!fs.existsSync(src)) return null;
    const dir = path.join(this.periodDir(soc, periodId), 'corbeille'); mkdir(dir);
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    const name = uniqueName(dir, stamp + '_' + path.basename(src));
    try { retryFs(() => fs.renameSync(src, path.join(dir, name))); } catch (e) { retryFs(() => fs.copyFileSync(src, path.join(dir, name))); retryFs(() => fs.unlinkSync(src)); }
    return name;
  }

  /** Nettoie et vérifie les justificatifs d'une période : un PDF par ligne, nommé d'après le code de la ligne ; les fichiers
   *  qu'aucune ligne n'utilise partent dans « corbeille » ; les PDF sont relus (montant, émetteur). Rend le détail. */
  async auditDocs(soc, periodId) {
    const dir = path.join(this.periodDir(soc, periodId), 'justificatifs');
    const rep = { soc, period: periodId, renamed: [], trashed: [], missing: [], shared: [], refreshed: 0, files: 0, changed: false };
    if (!this.has(soc, periodId)) return rep;
    const data = this.load(soc, periodId);
    const withDoc = data.lines.filter(l => l.doc && l.doc.rel);
    const norm = r => path.normalize(r).toLowerCase();
    const uses = {}; withDoc.forEach(l => { const k = norm(l.doc.rel); (uses[k] = uses[k] || []).push(l); });
    // 1. deux lignes sur le même fichier : on le signale (à la main : un justificatif ne couvre qu'une ligne)
    Object.keys(uses).forEach(k => { if (uses[k].length > 1) rep.shared.push({ name: path.basename(uses[k][0].doc.rel), codes: uses[k].map(l => l.code || l.label) }); });
    // 2. fichier absent, nom différent du code, relecture du PDF
    for (const l of withDoc) {
      const abs = path.resolve(this.periodDir(soc, periodId), l.doc.rel);
      if (!fs.existsSync(abs)) { rep.missing.push({ code: l.code || l.label, name: l.doc.name }); continue; }
      const want = l.code ? l.code + '.pdf' : null;
      if (want && path.basename(abs) !== want && uses[norm(l.doc.rel)].length === 1) {
        const target = path.join(dir, want), clash = fs.existsSync(target) && withDoc.some(x => x !== l && norm(x.doc.rel) === norm(path.join('justificatifs', want)));
        if (!clash) {
          if (fs.existsSync(target)) this.trashDoc(soc, periodId, path.join('justificatifs', want));   // ancien fichier orphelin au même nom
          retryFs(() => fs.renameSync(abs, target));
          rep.renamed.push({ from: path.basename(abs), to: want }); l.doc.name = want; l.doc.rel = path.join('justificatifs', want); rep.changed = true;
        }
      }
      try {
        const a = await analyseInvoice(fs.readFileSync(path.resolve(this.periodDir(soc, periodId), l.doc.rel)));
        const nt = a.total != null ? a.total : null;
        if (l.doc.total !== nt || l.doc.issuer !== (a.issuer || null)) { l.doc.total = nt; l.doc.ht = a.ht; l.doc.issuer = a.issuer || null; l.doc.docDate = a.date; rep.refreshed++; rep.changed = true; }
      } catch (e) { /* PDF illisible : conservé tel quel */ }
    }
    // 3. fichiers que plus aucune ligne n'utilise
    let files = []; try { files = fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n)); } catch (e) { files = []; }
    rep.files = files.length;
    const used = new Set(data.lines.filter(l => l.doc && l.doc.rel).map(l => norm(l.doc.rel)));
    files.forEach(n => { if (!used.has(norm(path.join('justificatifs', n)))) { this.trashDoc(soc, periodId, path.join('justificatifs', n)); rep.trashed.push(n); } });
    if (rep.changed) this.save(soc, periodId, data);
    return rep;
  }

  /** Toutes les périodes déjà enregistrées : [{ soc, period, data }]. */
  allPeriods() {
    const out = [];
    Object.keys(C.SOC).forEach(soc => {
      const base = path.join(this.base, C.SOC[soc].folder);
      let years = []; try { years = fs.readdirSync(base).filter(n => /^20\d\d$/.test(n)); } catch (e) { return; }
      years.forEach(y => C.periodsFor(soc, +y).forEach(p => { if (this.has(soc, p.id)) out.push({ soc, period: p.id, data: this.load(soc, p.id) }); }));
    });
    return out;
  }

  /** Lit un relevé PDF, le rattache aux périodes concernées, le range dans releves/. */
  async importStatement(filePath, { fromInbox = false } = {}) {
    const name = path.basename(filePath), rep = { file: name, ok: false, parts: [], issues: [] };
    let parsed;
    try { parsed = await parseStatement(fs.readFileSync(filePath), name); }
    catch (e) { rep.issues.push('PDF illisible : ' + e.message); return rep; }
    rep.bank = parsed.bank; rep.soc = parsed.soc; rep.issues.push(...parsed.issues);
    if (!parsed.soc || !parsed.bank || !parsed.lines.length) { rep.notStatement = true; return rep; }
    if (!C.SOC[parsed.soc].banks.some(b => b.id === parsed.bank)) { rep.issues.push('Cette banque n\'est pas prévue pour cette société.'); return rep; }
    for (const part of splitByPeriod(parsed)) {
      const data = this.load(parsed.soc, part.period);
      const dir = this.periodDir(parsed.soc, part.period), relDir = path.join(dir, 'releves'); mkdir(relDir);
      const dest = fs.existsSync(path.join(relDir, name)) ? null : name;
      if (dest) retryFs(() => fs.copyFileSync(filePath, path.join(relDir, dest)));
      const added = mergePart(data, parsed, part, { name, rel: path.join('releves', name), src: fromInbox ? 'dropbox' : 'pc' });
      if (added) this.save(parsed.soc, part.period, data);
      rep.parts.push({ period: part.period, lines: part.lines.length, added });
    }
    rep.ok = true;
    rep.checked = parsed.issues.length === 0;
    if (fromInbox && rep.ok) { try { retryFs(() => fs.unlinkSync(filePath), 4); rep.moved = true; } catch (e) { rep.issues.push('Le relevé n\'a pas pu être retiré de A-TRAITER : ' + e.message); } }
    return rep;
  }

  listInbox() {
    try { return fs.readdirSync(this.inboxDir()).filter(n => /\.pdf$/i.test(n)).sort(); } catch (e) { return []; }
  }
  /** Rapproche un justificatif (facture, reçu…) déposé dans A-TRAITER des lignes bancaires sans justificatif. */
  async importJustificatif(filePath, periods) {
    const name = path.basename(filePath), rep = { file: name, ok: false, kind: 'justificatif', parts: [], touched: [], issues: [] };
    let inv;
    try { inv = await analyseInvoice(fs.readFileSync(filePath)); } catch (e) { rep.issues.push('PDF illisible : ' + e.message); return rep; }
    rep.total = inv.total; rep.issuer = inv.issuer;
    if (inv.total == null) { rep.issues.push('Montant non lu sur ce PDF : rapprochement impossible, à ajouter à la main (+PDF).'); return rep; }
    const cand = [];
    periods.forEach(P => P.data.lines.forEach(l => { if (!l.doc && l.code && (l.debit > 0 || l.credit > 0)) cand.push({ soc: P.soc, period: P.period, line: l, P }); }));
    const m = matchInvoice(inv, cand);
    if (m.status === 'ambiguous') { rep.issues.push('Plusieurs lignes possibles pour ' + fmtE(inv.total) + (inv.issuer ? ' (' + inv.issuer + ')' : '') + ' : à rattacher à la main (+PDF).'); return rep; }
    if (m.status === 'none') { rep.issues.push('Aucune ligne bancaire ne correspond à ' + fmtE(inv.total) + (inv.issuer ? ' (' + inv.issuer + ')' : '') + ' : relevé pas encore déposé ?'); return rep; }
    const c = m.best, l = c.line;
    const doc = await this.attachDoc(c.soc, c.period, l, filePath, { move: true });
    doc.auto = true; l.doc = doc;
    if (!l.type) {                                         // nature déduite du sens de la ligne ; TVA lue sur le justificatif si elle est cohérente
      l.type = l.debit > 0 ? 'dep' : 'rec';
      const v = ventFrom(inv, C.lineTTC(l), l.type === 'dep' ? C.RATES_DEP : C.RATES_REC);
      l.vent = v || [];
    }
    this.save(c.soc, c.period, c.P.data);
    rep.ok = true; rep.matched = { soc: c.soc, period: c.period, code: l.code, name: doc.name, mismatch: m.status === 'mismatch' };
    rep.touched.push({ soc: c.soc, period: c.period });
    if (m.status === 'mismatch') rep.issues.push(l.code + ' : montant du PDF ' + fmtE(inv.total) + ' différent de la ligne ' + fmtE(C.lineTTC(l)) + ' (à vérifier).');
    return rep;
  }

  async importInbox() {
    this.ensure();
    const out = [], others = [];
    for (const n of this.listInbox()) {                    // d'abord les relevés, pour que leurs lignes existent
      const r = await this.importStatement(path.join(this.inboxDir(), n), { fromInbox: true });
      if (r.notStatement) others.push(n); else out.push(r);
    }
    if (others.length) {
      const periods = this.allPeriods();
      for (const n of others) out.push(await this.importJustificatif(path.join(this.inboxDir(), n), periods));
    }
    return out;
  }
}
Store.keep = 10;                    // nombre de sauvegardes de secours conservées par période
Store.backupEvery = 5 * 60 * 1000;  // intervalle minimal entre deux sauvegardes de secours
Store.lastBackup = {};              // partagé entre toutes les instances (l'API recrée un Store à chaque appel)

module.exports = { Store, uniqueName, readComptaFile, FORMAT, writeAtomic };
