/* Rattachement d'un relevé lu aux périodes de comptabilité (mois pour ARCHI PRO, trimestre pour FAURIEL49). */
'use strict';
const C = require('./calc');
const { r2 } = C;

/** Découpe un relevé lu en parties, une par période (un relevé qui couvre deux périodes est traité période par période). */
function splitByPeriod(parsed) {
  const parts = new Map();
  parsed.lines.forEach(l => {
    const pid = C.periodIdOf(parsed.soc, l.date);
    if (!parts.has(pid)) parts.set(pid, []);
    parts.get(pid).push(l);
  });
  const ids = [...parts.keys()].sort();
  let carry = parsed.opening ? parsed.opening.v : null;
  return ids.map((pid, i) => {
    const lines = parts.get(pid);
    const d = r2(lines.reduce((a, l) => a + l.debit, 0)), c = r2(lines.reduce((a, l) => a + l.credit, 0));
    const first = i === 0, last = i === ids.length - 1;
    const open = carry;
    const close = last && parsed.closing ? parsed.closing.v : (open != null ? r2(open + c - d) : null);
    carry = close;
    const single = ids.length === 1;
    return { period: pid, lines, open, close, td: single && parsed.totals.debit != null ? parsed.totals.debit : d, tc: single && parsed.totals.credit != null ? parsed.totals.credit : c, first, last };
  });
}

/** Recalcule les soldes d'un compte d'après les relevés de la période (plusieurs relevés mensuels pour un trimestre). */
function recomputeAccounts(data) {
  const byBank = {};
  data.statements.forEach(s => { if (s.bank && s.open != null) (byBank[s.bank] = byBank[s.bank] || []).push(s); });
  Object.keys(byBank).forEach(b => {
    const list = byBank[b].sort((x, y) => (x.from < y.from ? -1 : 1));
    data.accounts[b] = { open: list[0].open, close: list[list.length - 1].close, td: r2(list.reduce((a, s) => a + s.td, 0)), tc: r2(list.reduce((a, s) => a + s.tc, 0)) };
  });
}

/** Ajoute une partie de relevé à une période. Rend false si ce relevé y figure déjà. */
function mergePart(data, parsed, part, file) {
  if (data.statements.some(s => s.name === file.name || (s.bank === parsed.bank && s.from === part.lines[0].date && s.to === part.lines[part.lines.length - 1].date && s.td === part.td && s.tc === part.tc))) return false;
  const dates = part.lines.map(l => l.date).sort();
  part.lines.forEach(l => {
    const o = C.makeLine({ date: l.date, label: l.label, bank: parsed.bank, debit: l.debit, credit: l.credit, src: file.name });
    if (l.hint) o.hint = l.hint;
    data.lines.push(o);
  });
  data.lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  C.assignCodes(data);
  data.statements.push({ name: file.name, rel: file.rel || null, bank: parsed.bank, account: parsed.account, from: dates[0], to: dates[dates.length - 1],
    open: part.open, close: part.close, td: part.td, tc: part.tc, nlines: part.lines.length, src: file.src || 'pc',
    info: (parsed.bank === 'cm' ? 'Crédit Mutuel' : 'Société Générale') + (parsed.account ? ' · compte ' + parsed.account : '') + ' · ' + C.frFull(dates[0]).slice(0, 5) + ' au ' + C.frFull(dates[dates.length - 1]) + ' · ' + part.lines.length + ' ligne' + (part.lines.length > 1 ? 's' : '') });
  recomputeAccounts(data);
  return true;
}

module.exports = { splitByPeriod, mergePart, recomputeAccounts };
