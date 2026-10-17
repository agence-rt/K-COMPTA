/* Données de comptabilité rangées dans AGOA-COMPTA (dossier Dropbox synchronisé) :
   AGOA-COMPTA/<société>/<année>/<période>/{periode.json, releves/, justificatifs/, exports/}
   Les relevés à traiter sont déposés dans AGOA-COMPTA/A-TRAITER/. */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core/calc');
const { parseStatement } = require('../core/parse/statements');
const { splitByPeriod, mergePart } = require('../core/import');

const mkdir = p => fs.mkdirSync(p, { recursive: true });
function writeAtomic(file, content) { mkdir(path.dirname(file)); const t = file + '.tmp'; fs.writeFileSync(t, content); fs.renameSync(t, file); }
function uniqueName(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext); let n = name, i = 1;
  while (fs.existsSync(path.join(dir, n))) n = base + '-' + (++i) + ext;
  return n;
}

class Store {
  constructor(comptaRoot) { this.base = path.join(comptaRoot, 'AGOA-COMPTA'); }
  inboxDir() { return path.join(this.base, 'A-TRAITER'); }
  periodDir(soc, periodId) {
    const p = C.periodInfo(soc, periodId); if (!p) throw new Error('Période inconnue : ' + periodId);
    return path.join(this.base, C.SOC[soc].folder, String(C.periodYear(periodId)), p.folder);
  }
  ensure() { mkdir(this.inboxDir()); }

  load(soc, periodId) {
    const f = path.join(this.periodDir(soc, periodId), 'periode.json');
    try { return Object.assign(C.blankPeriod(soc, periodId), JSON.parse(fs.readFileSync(f, 'utf8'))); }
    catch (e) { return C.blankPeriod(soc, periodId); }
  }
  save(soc, periodId, data) {
    data.updated = new Date().toISOString();
    writeAtomic(path.join(this.periodDir(soc, periodId), 'periode.json'), JSON.stringify(data, null, 1));
  }
  has(soc, periodId) { return fs.existsSync(path.join(this.periodDir(soc, periodId), 'periode.json')); }

  absPath(soc, periodId, rel) {
    const dir = this.periodDir(soc, periodId), p = path.resolve(dir, rel);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Chemin refusé.');
    return p;
  }

  /** Copie un justificatif PDF dans justificatifs/ sous le nom AAAA-MM-JJ_libellé.pdf */
  attachDoc(soc, periodId, line, srcPath) {
    const dir = path.join(this.periodDir(soc, periodId), 'justificatifs'); mkdir(dir);
    const name = uniqueName(dir, (line.date || 'sans-date') + '_' + C.slug(line.label || 'ligne') + '.pdf');
    fs.copyFileSync(srcPath, path.join(dir, name));
    return { name, original: path.basename(srcPath), rel: path.join('justificatifs', name) };
  }

  /** Lit un relevé PDF, le rattache aux périodes concernées, le range dans releves/. */
  async importStatement(filePath, { fromInbox = false } = {}) {
    const name = path.basename(filePath), rep = { file: name, ok: false, parts: [], issues: [] };
    let parsed;
    try { parsed = await parseStatement(fs.readFileSync(filePath), name); }
    catch (e) { rep.issues.push('PDF illisible : ' + e.message); return rep; }
    rep.bank = parsed.bank; rep.soc = parsed.soc; rep.issues.push(...parsed.issues);
    if (!parsed.soc || !parsed.bank || !parsed.lines.length) return rep;
    if (!C.SOC[parsed.soc].banks.some(b => b.id === parsed.bank)) { rep.issues.push('Cette banque n\'est pas prévue pour cette société.'); return rep; }
    for (const part of splitByPeriod(parsed)) {
      const data = this.load(parsed.soc, part.period);
      const dir = this.periodDir(parsed.soc, part.period), relDir = path.join(dir, 'releves'); mkdir(relDir);
      const dest = fs.existsSync(path.join(relDir, name)) ? null : name;
      if (dest) fs.copyFileSync(filePath, path.join(relDir, dest));
      const added = mergePart(data, parsed, part, { name, rel: path.join('releves', name), src: fromInbox ? 'dropbox' : 'pc' });
      if (added) this.save(parsed.soc, part.period, data);
      rep.parts.push({ period: part.period, lines: part.lines.length, added });
    }
    rep.ok = true;
    rep.checked = parsed.issues.length === 0;
    if (fromInbox && rep.ok) { try { fs.unlinkSync(filePath); rep.moved = true; } catch (e) { rep.issues.push('Le relevé n\'a pas pu être retiré de A-TRAITER : ' + e.message); } }
    return rep;
  }

  listInbox() {
    try { return fs.readdirSync(this.inboxDir()).filter(n => /\.pdf$/i.test(n)).sort(); } catch (e) { return []; }
  }
  async importInbox() {
    this.ensure();
    const out = [];
    for (const n of this.listInbox()) out.push(await this.importStatement(path.join(this.inboxDir(), n), { fromInbox: true }));
    return out;
  }
}
module.exports = { Store, uniqueName };
