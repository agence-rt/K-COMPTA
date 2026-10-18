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
  constructor(comptaRoot) { this.base = path.join(comptaRoot, 'AGOA-COMPTA'); }
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
    writeAtomic(this.composeFile(soc, periodId), JSON.stringify(wrap(data), null, 1));
  }
  has(soc, periodId) { return fs.existsSync(this.composeFile(soc, periodId)) || fs.existsSync(path.join(this.periodDir(soc, periodId), 'periode.json')); }

  absPath(soc, periodId, rel) {
    const dir = this.periodDir(soc, periodId), p = path.resolve(dir, rel);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Chemin refusé.');
    return p;
  }

  /** Range un justificatif PDF sous le code de la ligne (ex. 2026-09-CM-12.pdf) et le lit (émetteur, montant). Copie ou déplace selon `move`. */
  async attachDoc(soc, periodId, line, srcPath, { move = false } = {}) {
    const dir = path.join(this.periodDir(soc, periodId), 'justificatifs'); mkdir(dir);
    const base = line.code || ((line.date || 'sans-date') + '_' + C.slug(line.label || 'ligne'));
    const name = uniqueName(dir, base + '.pdf');
    const buf = fs.readFileSync(srcPath);
    let a = null; try { a = await analyseInvoice(buf); } catch (e) { /* PDF non lisible : rangé quand même */ }
    retryFs(() => fs.writeFileSync(path.join(dir, name), buf));
    if (move) { try { retryFs(() => fs.unlinkSync(srcPath), 4); } catch (e) { /* ignore */ } }
    return { name, original: path.basename(srcPath), rel: path.join('justificatifs', name),
      total: a && a.total != null ? a.total : null, ht: a ? a.ht : null, issuer: a ? a.issuer : null, docDate: a ? a.date : null };
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
module.exports = { Store, uniqueName, readComptaFile, FORMAT, writeAtomic };
