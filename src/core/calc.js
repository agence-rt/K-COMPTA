/* Calculs comptables et TVA — module partagé (processus principal et interface).
   Fonctionne avec require() et comme script du navigateur (window.AgoaCalc). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgoaCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  /* ---------- référentiel ---------- */
  const SOC = {
    archi: { name: 'THOMAS KOCHANSKI ARCHITECTE', short: 'ARCHI PRO', folder: 'ARCHI PRO', freq: 'monthly', freqLabel: 'Mensuelle', siren: '530 676 766',
      banks: [{ id: 'cm', name: 'Crédit Mutuel' }, { id: 'sg', name: 'Société Générale' }] },
    sci: { name: 'SCI FAURIEL49', short: 'FAURIEL49', folder: 'FAURIEL49', freq: 'quarterly', freqLabel: 'Trimestrielle', siren: null,
      banks: [{ id: 'sg', name: 'Société Générale' }] }
  };
  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const RATES_DEP = [20, 10, 5.5, 2.1];
  const RATES_REC = [20, 10];

  const pad = n => String(n).padStart(2, '0');
  function periodsFor(socId, year) {
    if (SOC[socId].freq === 'monthly') {
      return MOIS.map((m, i) => ({ id: year + '-' + pad(i + 1), label: m + ' ' + year, folder: pad(i + 1), start: year + '-' + pad(i + 1) + '-01' }));
    }
    return [1, 2, 3, 4].map(q => ({ id: 'T' + q + '-' + year, label: (q === 1 ? '1er' : q + 'e') + ' trimestre ' + year, folder: 'T' + q, start: year + '-' + pad((q - 1) * 3 + 1) + '-01' }));
  }
  /** Identifiant de période d'une date ISO (AAAA-MM-JJ) pour une société. */
  function periodIdOf(socId, isoDate) {
    const y = isoDate.slice(0, 4), m = +isoDate.slice(5, 7);
    return SOC[socId].freq === 'monthly' ? y + '-' + pad(m) : 'T' + Math.ceil(m / 3) + '-' + y;
  }
  function periodYear(periodId) { const m = String(periodId).match(/(20\d\d)/); return m ? +m[1] : null; }
  function periodInfo(socId, periodId) {
    const y = periodYear(periodId);
    return periodsFor(socId, y).find(p => p.id === periodId) || null;
  }

  /* ---------- lignes ---------- */
  let seq = 0;
  const newId = () => 'l' + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
  function makeLine(o) {
    return Object.assign({ id: newId(), date: '', label: '', bank: '', debit: 0, credit: 0, type: null, vent: [], immo: false, doc: null }, o || {});
  }
  function blankPeriod(socId, periodId) {
    const accounts = {};
    SOC[socId].banks.forEach(b => { accounts[b.id] = { open: 0, close: 0 }; });
    return { version: 1, soc: socId, period: periodId, lines: [], accounts, statements: [], report: 0 };
  }

  /* ---------- calculs ---------- */
  const lineTTC = l => (l.debit > 0 ? l.debit : l.credit);
  const vTva = v => (v.tva != null ? v.tva : r2(v.ht * v.rate / 100));
  const vTTC = v => r2(v.ht + vTva(v));
  const remain = l => r2(lineTTC(l) - l.vent.reduce((s, v) => s + vTTC(v), 0));
  const needsDoc = l => (l.type === 'dep' || l.type === 'rec') && !l.doc && !l.valid;

  function lineState(l) {
    if (!l.type) return { c: 'todo', t: 'À classer' };
    if (l.type === 'hors') return { c: 'ok', t: 'Hors TVA' };
    if (!(l.type === 'dep' ? l.debit > 0 : l.credit > 0)) return { c: 'bad', t: 'Sens incohérent' };
    const mismatch = l.doc && l.doc.total != null && Math.abs(l.doc.total - lineTTC(l)) > 0.005;
    const why = mismatch ? 'Montant du PDF (' + fmt(l.doc.total) + ' €) différent de la ligne (' + fmt(lineTTC(l)) + ' €).' : !l.doc ? 'Justificatif manquant.' : '';
    if (l.valid && (mismatch || !l.doc)) { if (l.vent.length && remain(l) >= -0.005) return { c: 'ok', t: 'Validée', why: 'Validée manuellement : ' + why + ' Cliquer pour annuler la validation.', act: 'validate' }; }
    if (mismatch) return { c: 'bad', t: 'À vérifier', why: why + ' Cliquer pour valider la ligne.', act: 'validate' };
    if (!l.vent.length) return { c: 'bad', t: 'À ventiler' };
    const r = remain(l);
    if (r < -0.005) return { c: 'bad', t: 'Écart ' + Math.abs(r).toFixed(2).replace('.', ',') + ' €' };
    // rapprochement avec le justificatif : absent ou montant différent => à vérifier (validable à la main)
    if (!l.doc) return { c: 'bad', t: 'À vérifier', why: 'Justificatif manquant. Cliquer pour valider la ligne sans justificatif.', act: 'validate' };
    return l.vent.length > 1 ? { c: 'ok', t: 'Ventilée', why: 'Plusieurs taux de TVA saisis.' } : { c: 'ok', t: 'TVA ok' };
  }

  /* ---------- code unique de ligne : ANNEE-MOIS-BANQUE-N (ex. 2026-09-CM-12) ---------- */
  const bankCode = b => String(b || '').toUpperCase();
  const codePrefix = l => String(l.date || '').slice(0, 7) + '-' + bankCode(l.bank) + '-';
  function nextNumber(data, prefix) {
    let n = 0;
    data.lines.forEach(x => { if (x.code && x.code.startsWith(prefix)) { const k = parseInt(x.code.slice(prefix.length), 10); if (k > n) n = k; } });
    return n + 1;
  }
  /** Donne un code aux lignes qui n'en ont pas, dans l'ordre des dates (le numéro suit la ligne, il ne change plus ensuite). */
  function assignCodes(data) {
    const todo = data.lines.map((l, i) => [l, i]).filter(x => !x[0].code && /^\d{4}-\d{2}/.test(x[0].date || '') && x[0].bank)
      .sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]));
    todo.forEach(([l]) => { const p = codePrefix(l); l.code = p + nextNumber(data, p); });
    return data;
  }
  /** Nouveau code après changement de date ou de compte (seulement tant qu'aucun justificatif n'est rangé sous l'ancien code). */
  function recode(data, l) {
    if (l.doc || !/^\d{4}-\d{2}/.test(l.date || '') || !l.bank) return;
    const p = codePrefix(l);
    if (l.code && l.code.startsWith(p)) return;
    l.code = null; l.code = p + nextNumber(data, p);
  }

  function fillAll(l, rate) {
    const ttc = lineTTC(l), ht = r2(ttc / (1 + rate / 100)), auto = r2(ht * rate / 100), tva = r2(ttc - ht);
    l.vent = [{ rate, ht, tva: Math.abs(tva - auto) < 0.005 ? null : tva }];
  }
  /** Applique l'indication de TVA lue sur le relevé (hint) quand elle existe. */
  function applyHint(l) {
    const h = l.hint; if (!h) return false;
    if (l.type === 'dep' && h.tva != null) { const rate = h.rate || 20; l.vent = [{ rate, ht: h.ht != null ? h.ht : r2(h.tva * 100 / rate), tva: h.tva }]; return true; }
    if (l.type === 'rec' && h.rate) { fillAll(l, h.rate); return true; }
    return false;
  }
  function setType(l, v) {
    l.type = l.type === v ? null : v;
    if (!l.type || l.type === 'hors') { l.vent = []; l.immo = false; }
    else {
      if (l.type === 'rec') { l.vent = l.vent.filter(x => x.rate === 10 || x.rate === 20); l.immo = false; }
      if (!l.vent.length && !applyHint(l)) fillAll(l, 20);
    }
  }

  function acct(data, bank) {
    let d = 0, c = 0, n = 0;
    data.lines.forEach(l => { if (l.bank === bank) { d += l.debit; c += l.credit; n++; } });
    const a = data.accounts[bank] || { open: 0, close: 0 };
    const calc = r2(a.open + c - d);
    return { d: r2(d), c: r2(c), n, calc, ecart: r2(a.close - calc), empty: n === 0 && a.open === 0 && a.close === 0 };
  }
  function stats(data, socId) {
    const o = { todo: 0, bad: 0, miss: 0, bank: 0, n: data.lines.length, banks: 0 };
    data.lines.forEach(l => { const s = lineState(l); if (s.c === 'todo') o.todo++; if (s.c === 'bad') o.bad++; if (needsDoc(l)) o.miss++; });
    SOC[socId].banks.forEach(b => { const a = acct(data, b.id); if (!a.empty) { o.banks++; if (Math.abs(a.ecart) >= 0.005) o.bank++; } });
    o.ready = o.n > 0 && !o.todo && !o.bad && !o.miss && !o.bank;
    return o;
  }
  function totals(data) {
    const t = { b20: 0, t20: 0, b10: 0, t10: 0, d19: 0, d20: 0, dep: {}, rec: {} };
    data.lines.forEach(l => {
      if (l.type === 'rec') l.vent.forEach(v => {
        const x = vTva(v), k = v.rate;
        (t.rec[k] = t.rec[k] || { ht: 0, tva: 0 }); t.rec[k].ht += v.ht; t.rec[k].tva += x;
        if (k === 20) { t.b20 += v.ht; t.t20 += x; } else if (k === 10) { t.b10 += v.ht; t.t10 += x; }
      });
      if (l.type === 'dep') l.vent.forEach(v => {
        const x = vTva(v), k = v.rate;
        (t.dep[k] = t.dep[k] || { ht: 0, tva: 0 }); t.dep[k].ht += v.ht; t.dep[k].tva += x;
        if (l.immo) t.d19 += x; else t.d20 += x;
      });
    });
    const R = Math.round;
    const D = { A1: R(t.b20) + R(t.b10), b08: R(t.b20), t08: R(t.t20), b9B: R(t.b10), t9B: R(t.t10), L16: R(t.t20) + R(t.t10), L19: R(t.d19), L20: R(t.d20), L22: R(data.report || 0) };
    D.L23 = D.L19 + D.L20 + D.L22; D.TD = D.L16 - D.L23;
    return { t, D };
  }

  /* ---------- modèle d'export : classement par compte, puis nature, puis date ---------- */
  const TYPE_LABEL = { dep: 'Dépenses', rec: 'Recettes', hors: 'Hors TVA', '': 'À classer' };
  const TYPE_NOTE = { dep: 'TVA déductible', rec: 'TVA collectée', hors: 'sans TVA', '': 'à classer avant déclaration' };
  const TYPE_SHORT = { dep: 'Dépense', rec: 'Recette', hors: 'Hors TVA', '': 'À classer' };
  function exportModel(data, socId) {
    const flat = [], secs = []; let n = 0;
    SOC[socId].banks.forEach(b => {
      const lines = data.lines.filter(l => l.bank === b.id);
      const groups = [];
      ['dep', 'rec', 'hors', ''].forEach(tp => {
        const g = lines.filter(l => (l.type || '') === tp).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
        if (g.length) { const items = g.map(l => { const it = { n: ++n, l, bank: b, type: tp }; flat.push(it); return it; }); groups.push({ type: tp, title: TYPE_LABEL[tp], items }); }
      });
      secs.push({ bank: b, groups, acct: acct(data, b.id), count: lines.length });
    });
    return { secs, flat };
  }

  const fmtNF = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = n => fmtNF.format(r2(n));
  const fmt0 = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
  const rl = r => String(r).replace('.', ',') + ' %';
  const frFull = d => { const q = String(d || '').split('-'); return q.length === 3 ? q[2] + '/' + q[1] + '/' + q[0] : String(d || ''); };
  const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ligne';

  return { r2, SOC, MOIS, RATES_DEP, RATES_REC, periodsFor, periodIdOf, periodYear, periodInfo, newId, makeLine, blankPeriod,
    lineTTC, vTva, vTTC, remain, needsDoc, lineState, bankCode, assignCodes, recode, fillAll, applyHint, setType, acct, stats, totals,
    TYPE_LABEL, TYPE_NOTE, TYPE_SHORT, exportModel, fmt, fmt0, rl, frFull, slug };
});
