(function (root) {
  'use strict';

  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const ym = (d) => d.slice(0, 7);
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
  const addMonths = (p, n) => { let [y, m] = p.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
  const monthsBetween = (a, b) => { const out = []; for (let p = a; p <= b; p = addMonths(p, 1)) out.push(p); return out; };
  const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const monthLabel = (p) => { const [y, m] = p.split('-').map(Number); return `${MONTHS_FR[m - 1]} ${y}`; };

  /* ---------- validation ---------- */
  function validateEntry(e, data) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errs.push('Date invalide');
    if (!e.lines || e.lines.length < 2) errs.push('Il faut au moins deux lignes');
    const acc = new Set(data.accounts.map((a) => a.id));
    const loans = new Set(data.loans.map((l) => l.id));
    let sum = 0;
    (e.lines || []).forEach((l, i) => {
      if (!acc.has(l.acct)) errs.push(`Ligne ${i + 1} : compte inconnu`);
      const a = data.accounts.find((x) => x.id === l.acct);
      if (a && a.perLoan && !loans.has(l.loan)) errs.push(`Ligne ${i + 1} : choisir un prêt`);
      if (!isFinite(l.amt)) errs.push(`Ligne ${i + 1} : montant invalide`);
      sum += Number(l.amt) || 0;
    });
    if (Math.abs(r2(sum)) >= 0.01) errs.push(`La ventilation ne balance pas : écart de ${Math.abs(r2(sum)).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
    return errs;
  }

  /* ---------- soldes ---------- */
  const key = (l) => (l.loan ? `${l.acct}|${l.loan}` : l.acct);
  function balances(data, asOf, from) {
    const b = {};
    for (const e of data.entries) {
      if (asOf && e.date > asOf) continue;
      if (from && e.date < from) continue;
      for (const l of e.lines) { b[key(l)] = (b[key(l)] || 0) + l.amt; if (l.loan) b[l.acct] = (b[l.acct] || 0) + l.amt; }
    }
    for (const k in b) b[k] = r2(b[k]);
    return b;
  }

  /* ---------- P&L ---------- */
  const GROUP_SIGN = { revenue: -1, direct: 1, overhead: 1 };
  // basis : 'cash' (encaissement : date de dépôt) ou 'accrual' (reconnaissance : les intérêts comptent
  // dans leur mois couvert; les autres lignes restent à leur date).
  // En reconnaissance, les lignes d'intérêts rattachées à un mois sont remplacées par les intérêts gagnés (calendrier).
  const lineDate = (e, l) => e.date;
  // Intérêts reconnus par prêt et par mois :
  //  - mois terminés : max(attendu, reçu pour ce mois), payé ou non (intérêts gagnés);
  //  - mois en cours et mois futurs : seulement ce qui est déjà reçu pour ce mois (payé d'avance).
  //  - prêts avec capitalisation : la portion capitalisée d'un mois terminé s'ajoute au revenu reconnu (elle augmente
  //    chaque mois puisque l'intérêt est calculé sur le solde augmenté et que le paiement reste fixe).
  //    Les intérêts se paient à terme échu : le mois en cours n'est pas encore dû.
  function earnedByLoan(data, from, to, today) {
    const out = [];
    for (const loan of data.loans) {
      const s = schedule(data, loan.id, today, 0);
      for (const r of s.rows) {
        if (r.period < ym(from) || r.period > ym(to)) continue;
        const future = r.period >= ym(today);
        // intérêts capitalisés : gagnés une fois le mois terminé (ajoutés au capital, non encaissés)
        const cap = future ? 0 : r2(r.capitalized || 0);
        const paid = r2(future ? r.received : Math.max(r.expected, r.received));
        const v = r2(paid + cap);
        if (v) out.push({ loan: loan.id, period: r.period, earned: v, paid, capitalized: cap, received: r.received, expected: future ? r.received : r.expected, future });
      }
    }
    return out;
  }
  function pnl(data, from, to, basis, today) {
    today = today || new Date().toISOString().slice(0, 10);
    const months = monthsBetween(ym(from), ym(to));
    const acc = Object.fromEntries(data.accounts.map((a) => [a.id, a]));
    const rows = {}; // id -> {acct, loan, label, group, byMonth, total}
    for (const e of data.entries) {
      for (const l of e.lines) {
        if (basis === 'accrual' && l.acct === 'rev:interest' && l.period) continue;
        const ag = (acc[l.acct] || {}).group;
        // en reconnaissance, une dépense ou un revenu de frais avec un mois couvert compte dans ce mois (charge payée d'avance ou à terme échu)
        const dt = basis === 'accrual' && l.period && (ag === 'direct' || ag === 'overhead' || ag === 'revenue') ? `${l.period}-15` : lineDate(e, l);
        if (dt < from || dt > to) continue;
        const a = acc[l.acct];
        if (!a || !(a.group in GROUP_SIGN)) continue;
        const id = a.perLoan && l.loan ? `${a.id}|${l.loan}` : a.id;
        if (!rows[id]) {
          const loan = l.loan && data.loans.find((x) => x.id === l.loan);
          rows[id] = { id, acct: a.id, loan: l.loan || null, group: a.group, label: loan ? loan.name : a.name, byMonth: {}, total: 0 };
        }
        const v = GROUP_SIGN[a.group] * l.amt, p = ym(dt);
        rows[id].byMonth[p] = (rows[id].byMonth[p] || 0) + v;
        rows[id].total += v;
      }
    }
    if (basis === 'accrual') for (const x of earnedByLoan(data, from, to, today)) {
      const loan = data.loans.find((l) => l.id === x.loan);
      const add = (id, label, v, cap) => {
        if (!v) return;
        if (!rows[id]) rows[id] = { id, acct: 'rev:interest', loan: x.loan, group: 'revenue', label, capitalized: cap, byMonth: {}, total: 0 };
        rows[id].byMonth[x.period] = (rows[id].byMonth[x.period] || 0) + v; rows[id].total += v;
      };
      add(`rev:interest|${x.loan}`, loan.name, x.paid, false);
      add(`rev:interest|${x.loan}|cap`, `${loan.name} — intérêts capitalisés`, x.capitalized, true);
    }
    const list = Object.values(rows);
    const sumGroup = (g, p) => r2(list.filter((r) => r.group === g).reduce((s, r) => s + (p ? r.byMonth[p] || 0 : r.total), 0));
    const totals = (p) => {
      const revenue = sumGroup('revenue', p), direct = sumGroup('direct', p), overhead = sumGroup('overhead', p);
      const interest = r2(list.filter((r) => r.acct === 'rev:interest').reduce((s, r) => s + (p ? r.byMonth[p] || 0 : r.total), 0));
      const margin = r2(revenue - direct), profit = r2(margin - overhead);
      return { revenue, interest, direct, overhead, margin, profit, marginPct: revenue ? margin / revenue : 0, profitPct: interest ? profit / interest : 0 };
    };
    list.forEach((r) => { r.total = r2(r.total); for (const p in r.byMonth) r.byMonth[p] = r2(r.byMonth[p]); });
    const order = (g) => list.filter((r) => r.group === g).sort((a, b) => (a.acct === b.acct ? a.label.localeCompare(b.label, 'fr') : data.accounts.findIndex((x) => x.id === a.acct) - data.accounts.findIndex((x) => x.id === b.acct)));
    return { from, to, months, groups: { revenue: order('revenue'), direct: order('direct'), overhead: order('overhead') },
             total: totals(null), byMonth: Object.fromEntries(months.map((p) => [p, totals(p)])) };
  }

  /* ---------- Encaissement vs reconnaissance des intérêts ---------- */
  // Pour chaque mois : intérêts encaissés (date de dépôt), reconnus (mois couvert), et le détail de l'écart :
  // reçus d'avance (pour un mois futur), rattrapages (pour un mois antérieur), et intérêts attendus non reçus.
  function interestTiming(data, from, to, today) {
    const months = monthsBetween(ym(from), ym(to)), z = () => Object.fromEntries(months.map((p) => [p, 0]));
    const cash = z(), earned = z(), receivable = z(), aheadIn = z(), capitalized = z();
    for (const e of data.entries) for (const l of e.lines) {
      if (l.acct !== 'rev:interest') continue;
      const v = -l.amt, pc = ym(e.date);
      if (pc in cash) { cash[pc] += v; if (l.period && l.period > pc) aheadIn[pc] += v; }
    }
    for (const x of earnedByLoan(data, from, to, today)) { earned[x.period] += x.earned; capitalized[x.period] += x.capitalized; receivable[x.period] += Math.max(0, x.expected - x.received); }
    // au jour du rapport : intérêts payés d'avance pas encore gagnés, et intérêts gagnés pas encore reçus (tous mois confondus)
    let prepaidOpen = 0, receivableOpen = 0;
    const cut = to < today ? to : today;
    for (const loan of data.loans) for (const r of schedule(data, loan.id, today, 24).rows) {
      const paidByCut = r.payments.filter((p) => p.date <= cut).reduce((a, p) => a + p.amt, 0);
      if (r.period >= ym(cut)) prepaidOpen += paidByCut;
      else receivableOpen += Math.max(0, r.expected - paidByCut);
    }
    const fix = (o) => { for (const k in o) o[k] = r2(o[k]); return o; };
    const sum = (o) => r2(Object.values(o).reduce((a, b) => a + b, 0));
    [cash, earned, receivable, aheadIn, capitalized].forEach(fix);
    return { months, cash, earned, receivable, aheadIn, capitalized, cut,
             totals: { cash: sum(cash), earned: sum(earned), receivable: sum(receivable), aheadIn: sum(aheadIn), capitalized: sum(capitalized), prepaidOpen: r2(prepaidOpen), receivableOpen: r2(receivableOpen) } };
  }

  /* ---------- Bilan ---------- */
  function balanceSheet(data, asOf) {
    const b = balances(data, asOf);
    const assets = [], liabilities = [];
    for (const a of data.accounts) {
      if (a.group === 'asset') {
        if (a.perLoan) for (const l of data.loans) { const v = b[`${a.id}|${l.id}`] || 0; if (Math.abs(v) >= 0.01) assets.push({ id: l.id, label: l.name, value: v, kind: 'loan' }); }
        else { const v = b[a.id] || 0; const hidden = (data.bankAccounts || []).some((x) => x.id === a.id && x.hidden); if (Math.abs(v) >= 0.01 || (a.bank && !hidden)) assets.push({ id: a.id, label: a.name, value: v, kind: a.other ? 'other' : 'bank' }); }
      } else if (a.group === 'liability') {
        const v = -(b[a.id] || 0); if (Math.abs(v) >= 0.01) liabilities.push({ id: a.id, label: a.name, value: r2(v) });
      }
    }
    const sum = (arr) => r2(arr.reduce((s, x) => s + x.value, 0));
    const coreAssets = sum(assets.filter((x) => x.kind !== 'other'));
    const totalAssets = sum(assets), totalLiab = sum(liabilities);
    return { asOf, assets, liabilities, totalAssets, coreAssets, totalLiab,
             equityCore: r2(coreAssets - totalLiab), equity: r2(totalAssets - totalLiab),
             loansTotal: sum(assets.filter((x) => x.kind === 'loan')) };
  }

  /* ---------- Calendrier des intérêts par prêt ---------- */
  function versionAt(loan, day) {
    let v = null;
    for (const x of loan.versions) if (x.from <= day) v = x;
    return v;
  }
  function expectedFor(loan, period, capBefore) {
    const [y, m] = period.split('-').map(Number), dim = daysIn(y, m);
    let exp = 0, cap = 0; const segs = [];
    let cur = null, n = 0;
    // capitalisation : la partie de l'intérêt non payée (intérêt sur le solde augmenté − paiement fixe) s'ajoute au solde
    const flush = () => { if (cur && n) { const base = cur.monthly != null ? cur.monthly : cur.principal * cur.rate / 12;
      const capM = cur.capitalize ? Math.max(0, (cur.principal + (capBefore || 0)) * cur.rate / 12 - (cur.monthly || 0)) : 0;
      exp += base * n / dim; cap += capM * n / dim; segs.push({ v: cur, days: n }); } };
    for (let d = 1; d <= dim; d++) {
      const day = `${period}-${String(d).padStart(2, '0')}`;
      const v = (loan.closedOn && day > loan.closedOn) ? null : versionAt(loan, day);
      if (v !== cur) { flush(); cur = v; n = 0; }
      if (v) n++;
    }
    flush();
    return { expected: r2(exp), capitalized: r2(cap), segs };
  }
  // horizon : nombre de mois à venir affichés après le mois courant, pour tous les prêts non remboursés
  // (un prêt arrivé à échéance mais pas remboursé continue de porter intérêt).
  function schedule(data, loanId, today, horizon) {
    const loan = data.loans.find((l) => l.id === loanId);
    const first = ym(loan.versions[0].from);
    const h = horizon == null ? 3 : horizon;
    let end = loan.closedOn ? ym(loan.closedOn) : addMonths(ym(today), h);
    const recv = {}; const unassigned = []; const payments = {};
    for (const e of data.entries) for (const l of e.lines) {
      if (l.acct !== 'rev:interest' || l.loan !== loanId) continue;
      const amt = -l.amt;
      if (l.period) { recv[l.period] = (recv[l.period] || 0) + amt; (payments[l.period] = payments[l.period] || []).push({ date: e.date, amt, entry: e.id }); }
      else unassigned.push({ date: e.date, amt, entry: e.id });
    }
    for (const p of Object.keys(recv)) if (p > end) end = p;   // intérêts payés d'avance au-delà de l'horizon
    const maturity = loan.maturity ? ym(loan.maturity) : null;
    let capTotal = 0;
    const rows = monthsBetween(first, end < first ? first : end).map((p) => {
      const calc = expectedFor(loan, p, capTotal), { capitalized, segs } = calc;
      capTotal += capitalized;
      const received = r2(recv[p] || 0);
      // ajustement manuel du mois : « réglé » (l'attendu devient le reçu) ou montant attendu fixé
      const adj = (loan.adjustments || {})[p] || null;
      const expected = adj ? r2(adj.mode === 'settled' ? received : Number(adj.amount) || 0) : calc.expected;
      const due = addMonths(p, 1) + '-10'; // payé à terme échu, 10 jours de grâce
      let status;
      if (expected === 0 && received === 0) status = adj ? 'adjusted' : 'none';
      else if (received >= expected - 0.5) status = received > expected + 0.5 ? 'over' : adj ? 'adjusted' : 'paid';
      else if (today > due) status = received > 0 ? 'partial' : 'late';
      else status = 'upcoming';
      const v = segs.length ? segs[segs.length - 1].v : null;
      return { period: p, label: monthLabel(p), principal: v ? v.principal + r2(capTotal - capitalized) : 0, rate: v ? v.rate : null,
               prepaid: (payments[p] || []).some((x) => x.date < `${p}-01`), version: v ? v.label : '', isMaturity: p === maturity, afterMaturity: !!maturity && p > maturity, isFuture: p > ym(today), expected, expectedCalc: calc.expected, adjustment: adj, capitalized, received, diff: r2(received - expected), status, payments: payments[p] || [] };
    });
    const ledger = balances(data, today)[`loans|${loanId}`] || 0;
    const sum = (k, f) => r2(rows.filter(f || (() => true)).reduce((s, r) => s + r[k], 0));
    const pastDue = (r) => r.status !== 'upcoming';
    return { loan, rows, unassigned, ledgerBalance: ledger, capitalizedTotal: r2(capTotal),
             totals: { expected: sum('expected', pastDue), received: r2(Object.values(recv).reduce((a, b) => a + b, 0) + unassigned.reduce((a, b) => a + b.amt, 0)),
                       arrears: r2(rows.filter((r) => r.status === 'late' || r.status === 'partial').reduce((s, r) => s + (r.expected - r.received), 0)) } };
  }

  function loanStatus(loan, today) {
    if (loan.closedOn && loan.closedOn <= today) return 'closed';
    if (loan.versions[0].from > today) return 'future';
    return 'active';
  }

  /* ---------- Suggestion de ventilation d'un virement ---------- */
  // Cherche une combinaison de mensualités attendues et impayées (période la plus ancienne d'abord) qui donne le montant reçu.
  function suggestSplit(data, amount, date, draftEntries) {
    const pool = [];
    const temp = draftEntries ? { ...data, entries: data.entries.concat(draftEntries) } : data;
    for (const loan of data.loans) {
      if (loanStatus(loan, date) === 'future') continue;
      const s = schedule(temp, loan.id, date);
      s.rows.filter((r) => r.expected > 0 && r.received < r.expected - 0.5 && r.period <= ym(date))
        .slice(0, 3).forEach((r, i) => pool.push({ loan: loan.id, loanName: loan.name, period: r.period, amt: r2(r.expected - r.received), rank: i }));
    }
    pool.sort((a, b) => a.period.localeCompare(b.period));
    const target = Math.round(amount * 100), best = [];
    const items = pool.slice(0, 22);
    const rec = (i, sum, chosen, usedLoanPeriods) => {
      if (best.length >= 5) return;
      if (sum === target) { best.push(chosen.slice()); return; }
      if (sum > target || i >= items.length) return;
      const it = items[i]; const c = Math.round(it.amt * 100);
      // un prêt ne peut sauter un mois : on prend les périodes dans l'ordre
      const prevNeeded = items.slice(0, i).some((x) => x.loan === it.loan && !chosen.includes(x));
      if (!prevNeeded) { chosen.push(it); rec(i + 1, sum + c, chosen); chosen.pop(); }
      rec(i + 1, sum, chosen);
    };
    rec(0, 0, []);
    best.sort((a, b) => a.length - b.length);
    return { pool, options: best };
  }

  /* ---------- Paiements d'avance ---------- */
  // Répartit un montant sur N mois consécutifs d'un prêt (le dernier mois absorbe l'arrondi).
  function advanceSplits(loanId, fromPeriod, months, perMonth, total) {
    const out = []; let left = r2(total != null ? total : perMonth * months);
    for (let i = 0; i < months; i++) {
      const amt = i === months - 1 ? left : r2(perMonth);
      out.push({ acct: 'rev:interest', loan: loanId, period: addMonths(fromPeriod, i), amt }); left = r2(left - amt);
    }
    return out;
  }
  // Cherche les prêts pour lesquels le montant reçu équivaut à N mois d'intérêt (2 à 12),
  // à partir du premier mois pas entièrement payé : soit l'intérêt mensuel complet, soit le solde impayé de ce mois.
  function suggestAdvance(data, amount, date, draftEntries) {
    const temp = draftEntries ? { ...data, entries: data.entries.concat(draftEntries) } : data;
    const out = [];
    for (const loan of data.loans) {
      if (loanStatus(loan, date) !== 'active') continue;
      const s = schedule(temp, loan.id, date, 14);
      const starts = s.rows.filter((r) => r.expected > 0 && r.received < r.expected - 0.5 && r.period >= addMonths(ym(date), -2)).slice(0, 4);
      const seen = new Set();
      for (const r0 of starts) {
        const cands = Array.from(new Set([r2(r0.expected - r0.received), r2(r0.expected)])).filter((v) => v > 0);
        for (const v of cands) for (let n = 2; n <= 12; n++) {
          const k = `${v}|${n}`;
          if (!seen.has(k) && Math.abs(amount - n * v) < 0.01) { seen.add(k); out.push({ loan: loan.id, loanName: loan.name, from: r0.period, months: n, perMonth: v, partial: v !== r2(r0.expected), fits: v === r2(r0.expected - r0.received) }); }
        }
      }
    }
    // d'abord les options qui comblent exactement le solde impayé du premier mois (sans le dépasser)
    return out.sort((a, b) => (b.fits - a.fits) || a.from.localeCompare(b.from) || a.months - b.months);
  }

  /* ---------- Résumé actionnaire ---------- */
  function shareholder(data, asOf) {
    const b = balances(data, asOf);
    const ids = data.accounts.filter((a) => a.id.startsWith('liab:sh-'));
    const list = ids.map((a) => ({ id: a.id, label: a.name, value: r2(-(b[a.id] || 0)) }));
    return { list, total: r2(list.reduce((s, x) => s + x.value, 0)) };
  }

  /* ---------- Revenus par prêt ---------- */
  // Intérêts par prêt sur la période (encaissement ou reconnaissance) et capital moyen prêté (capital × jours).
  function loanRevenue(data, from, to, basis, today) {
    today = today || new Date().toISOString().slice(0, 10);
    const cash = {}, earned = {};
    for (const e of data.entries) for (const l of e.lines) {
      if (l.acct !== 'rev:interest' || !l.loan) continue;
      if (e.date >= from && e.date <= to) cash[l.loan] = (cash[l.loan] || 0) - l.amt;
    }
    for (const x of earnedByLoan(data, from, to, today)) earned[x.loan] = (earned[x.loan] || 0) + x.earned;
    const rev = basis === 'accrual' ? earned : cash;
    const upto = to < today ? to : today, DAY = 86400000;
    const t0 = parse(from).getTime(), t1 = parse(upto).getTime();
    const days = Math.max(1, (t1 - t0) / DAY + 1);
    const rows = data.loans.map((loan) => {
      const ev = [];
      for (const e of data.entries) for (const l of e.lines) if (l.acct === 'loans' && l.loan === loan.id) ev.push([parse(e.date).getTime(), l.amt]);
      ev.sort((x, y) => x[0] - y[0]);
      let bal = 0, cd = 0, t = t0;
      for (const [te, amt] of ev) { if (te > t1) break; if (te > t) { cd += bal * (te - t) / DAY; t = te; } bal += amt; }
      if (t1 >= t) cd += bal * ((t1 - t) / DAY + 1);
      cd = Math.max(0, cd);
      const revenue = r2(rev[loan.id] || 0);
      return { loan: loan.id, revenue, capDays: cd, avgCapital: r2(cd / days), yieldAnn: cd ? revenue / cd * 365 : null };
    });
    return { rows, days };
  }

  const api = { loanRevenue, interestTiming, r2, ym, iso, parse, addMonths, monthsBetween, monthLabel, validateEntry, balances, pnl, balanceSheet, schedule, expectedFor, loanStatus, suggestSplit, suggestAdvance, advanceSplits, shareholder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* Graphiques interactifs (SVG) : lignes, aires, barres empilées ou groupées.
   Survol : ligne-repère et infobulle; légende cliquable pour masquer une série; vue tableau.
   FinCharts.render(spec) renvoie le HTML; l'état (séries masquées, vue tableau) survit au re-rendu. */
(function (root) {
  const REG = {}, STATE = {};
  let W = 720; const PL = 64, PR = 16, PT = 14, PB = 28;
  const fmt0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const axisLbl = (v) => { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 2 })} M` : a >= 1000 ? `${Math.round(v / 1000)} k` : `${Math.round(v)}`; };
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  // barre arrondie (4 px) à l'extrémité de la donnée, ancrée sur la ligne de base
  function barPath(x, y0, y1, w) {
    const h = Math.abs(y1 - y0); if (h < 0.5) return '';
    const r = Math.min(4, w / 2, h), up = y1 < y0, t = Math.min(y0, y1), b = Math.max(y0, y1);
    return up ? `M${x},${b}V${t + r}Q${x},${t} ${x + r},${t}H${x + w - r}Q${x + w},${t} ${x + w},${t + r}V${b}Z`
      : `M${x},${t}H${x + w}V${b - r}Q${x + w},${b} ${x + w - r},${b}H${x + r}Q${x},${b} ${x},${b - r}Z`;
  }

  function render(spec) {
    REG[spec.id] = spec;
    const st = STATE[spec.id] = STATE[spec.id] || { hidden: {}, table: false };
    const vis = spec.series.filter((s) => !st.hidden[s.key]);
    const legend = spec.series.length > 1 ? `<div class="fc-legend" role="group" aria-label="Séries">${spec.series.map((s) => `<button type="button" class="fc-key ${st.hidden[s.key] ? 'off' : ''}" data-fc-toggle="${spec.id}" data-key="${s.key}" aria-pressed="${!st.hidden[s.key]}"><i class="${s.signColor ? 'sign' : `s${s.slot}`}${s.kind === 'line' && spec.type === 'bar' ? ' ln' : ''}"></i>${esc(s.label)}</button>`).join('')}</div>` : '';
    const tools = spec.noTable ? "" : `<button type="button" class="fc-tab" data-fc-table="${spec.id}">${st.table ? 'Graphique' : 'Tableau'}</button>`;
    const body = st.table ? table(spec) : svg(spec, vis);
    return `<div class="fc" id="fc-${spec.id}"><div class="fc-top">${legend}${tools}</div><div class="fc-body">${body}</div></div>`;
  }

  function table(spec) {
    return `<div class="table-wrap fc-table"><table><thead><tr><th>${esc(spec.xTitle || 'Mois')}</th>${spec.series.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>
      ${spec.x.map((_, i) => `<tr><td>${esc(spec.xFull[i])}</td>${spec.series.map((s) => `<td class="num">${fmt0.format(s.values[i] || 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function svg(spec, vis) {
    W = spec.w || 720;
    const H = spec.height || 260, n = spec.x.length, bw = (W - PL - PR) / Math.max(1, n);
    const bars = vis.filter((s) => spec.type === 'bar' && s.kind !== 'line'), lines = vis.filter((s) => !(spec.type === 'bar' && s.kind !== 'line'));
    let lo = 0, hi = 0;
    const stackPos = Array(n).fill(0), stackNeg = Array(n).fill(0);
    if (spec.stacked) bars.forEach((s) => s.values.forEach((v, i) => { if (v >= 0) stackPos[i] += v; else stackNeg[i] += v; }));
    const all = [].concat(spec.stacked ? stackPos.concat(stackNeg) : bars.flatMap((s) => s.values), lines.flatMap((s) => s.values));
    all.forEach((v) => { if (v > hi) hi = v; if (v < lo) lo = v; });
    if (!(spec.zero && (lines.length > 1 || lines.some((x) => x.area))) && !bars.length && lines.length) { const vals = lines.flatMap((s) => s.values); lo = Math.min(...vals); hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1000; lo -= pad; hi += pad; if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0; }
    if (hi === lo) hi = lo + 1000;
    const step = niceStep((hi - lo) / 4), top = Math.ceil(hi / step) * step, bottom = Math.floor(lo / step) * step;
    const y = (v) => PT + (H - PT - PB) * (top - v) / (top - bottom || 1);
    const xc = (i) => PL + i * bw + bw / 2;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title || '')}" data-fc="${spec.id}" data-n="${n}">`;
    for (let v = bottom; v <= top + step * 0.01; v += step) s += `<line class="fc-grid${Math.abs(v) < step / 100 ? ' zero' : ''}" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/><text class="fc-ax" x="${PL - 8}" y="${y(v) + 4}" text-anchor="end">${axisLbl(v)}</text>`;
    const every = Math.ceil(n / 12);
    spec.x.forEach((lb, i) => { if (i % every === 0 || (i === n - 1 && (n - 1) % every >= every * 0.7)) s += `<text class="fc-ax" x="${xc(i)}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>`; });
    // barres
    if (bars.length) {
      const gw = bw * 0.68, gap = 2;
      if (spec.stacked) {
        const p = Array(n).fill(0), q = Array(n).fill(0);
        bars.forEach((se) => se.values.forEach((v, i) => {
          if (!v) return; const x = xc(i) - gw / 2;
          const base = v >= 0 ? p[i] : q[i], end = base + v;
          const y0 = y(base) + (base !== 0 ? (v > 0 ? -gap / 2 : gap / 2) : 0), y1 = y(end);
          if (v >= 0) p[i] = end; else q[i] = end;
          s += `<path class="fc-bar ${se.signColor ? (v >= 0 ? 's3' : 's2') : `s${se.slot}`}" d="${barPath(x, y0, y1, gw)}"/>`;
        }));
      } else {
        const w = (gw - gap * (bars.length - 1)) / bars.length;
        bars.forEach((se, k) => se.values.forEach((v, i) => { if (v) s += `<path class="fc-bar ${se.signColor ? (v >= 0 ? 's3' : 's2') : `s${se.slot}`}" d="${barPath(xc(i) - gw / 2 + k * (w + gap), y(0), y(v), w)}"/>`; }));
      }
    }
    // lignes et aires
    lines.forEach((se) => {
      const pts = se.values.map((v, i) => [xc(i), y(v)]);
      if (se.area) s += `<path class="fc-area s${se.slot}" d="M${pts[0][0]},${y(Math.max(bottom, 0))}L${pts.map((p) => p.join(',')).join('L')}L${pts[pts.length - 1][0]},${y(Math.max(bottom, 0))}Z"/>`;
      s += `<polyline class="fc-line s${se.slot}${se.bold ? ' bold' : ''}${se.dash ? ' dash' : ''}" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    });
    // étiquettes directes en fin de ligne (repérage sans dépendre de la couleur)
    if (spec.endLabels && lines.length) {
      const ends = lines.map((se) => ({ se, v: se.values[n - 1], yy: y(se.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
      for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 13) ends[k].yy = ends[k - 1].yy + 13;
      ends.forEach((e) => { s += `<circle class="fc-end s${e.se.slot}" cx="${xc(n - 1)}" cy="${y(e.v)}" r="4"/>`; });
    }
    s += `<line class="fc-cross" x1="0" x2="0" y1="${PT}" y2="${H - PB}" visibility="hidden"/><g class="fc-dots"></g>`;
    s += `<rect class="fc-hit" x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}"/></svg>`;
    spec._geo = { y, xc, H, bw, bars, lines };
    return `<div class="fc-plot">${s}<div class="fc-tip" hidden></div></div>`;
  }

  function hover(svgEl, clientX) {
    const spec = REG[svgEl.dataset.fc]; if (!spec || !spec._geo) return;
    W = spec.w || 720;
    const r = svgEl.getBoundingClientRect(), sx = (clientX - r.left) * W / r.width;
    const n = spec.x.length, g = spec._geo;
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - PL) / g.bw)));
    const cross = svgEl.querySelector('.fc-cross'), dots = svgEl.querySelector('.fc-dots'), tip = svgEl.parentNode.querySelector('.fc-tip');
    cross.setAttribute('x1', g.xc(i)); cross.setAttribute('x2', g.xc(i)); cross.setAttribute('visibility', 'visible');
    dots.innerHTML = g.lines.map((se) => `<circle class="fc-dot s${se.slot}" cx="${g.xc(i)}" cy="${g.y(se.values[i])}" r="4.5"/>`).join('');
    const vis = g.bars.concat(g.lines);
    const total = spec.total ? spec.total(i, vis) : null;
    tip.innerHTML = `<div class="fc-tip-h">${esc(spec.xFull[i])}</div>${vis.map((se) => `<div class="fc-tip-r"><i class="${se.signColor ? ((se.values[i] || 0) >= 0 ? 's3' : 's2') : `s${se.slot}`}${se.kind === 'line' && spec.type === 'bar' ? ' ln' : ''}"></i><span>${esc(se.label)}</span><b>${fmt0.format(se.values[i] || 0)}</b></div>`).join('')}${total ? `<div class="fc-tip-r tot"><span>${esc(total[0])}</span><b>${fmt0.format(total[1])}</b></div>` : ''}${spec.extra ? spec.extra(i) : ''}`;
    tip.hidden = false;
    const px = g.xc(i) / W * r.width, tw = tip.offsetWidth;
    tip.style.left = `${px + 14 + tw > r.width ? Math.max(0, px - tw - 14) : px + 14}px`;
    tip.style.top = '8px';
  }
  function leave(svgEl) {
    const tip = svgEl.parentNode.querySelector('.fc-tip'); if (tip) tip.hidden = true;
    const c = svgEl.querySelector('.fc-cross'); if (c) c.setAttribute('visibility', 'hidden');
    const d = svgEl.querySelector('.fc-dots'); if (d) d.innerHTML = '';
  }
  function rerender(id) { const el = document.getElementById(`fc-${id}`); if (el && REG[id]) el.outerHTML = render(REG[id]); }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointermove', (ev) => { const s = ev.target.closest && ev.target.closest('svg[data-fc]'); if (s) hover(s, ev.clientX); });
    document.addEventListener('pointerout', (ev) => { const s = ev.target.closest && ev.target.closest('svg[data-fc]'); if (s && !s.contains(ev.relatedTarget)) leave(s); });
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-fc-toggle],[data-fc-table]'); if (!t) return;
      if (t.dataset.fcToggle) { const id = t.dataset.fcToggle, st = STATE[id]; const visible = REG[id].series.filter((x) => !st.hidden[x.key]).length; if (!st.hidden[t.dataset.key] && visible <= 1) return; st.hidden[t.dataset.key] = !st.hidden[t.dataset.key]; rerender(id); }
      else { const id = t.dataset.fcTable; STATE[id].table = !STATE[id].table; rerender(id); }
    });
  }
  root.FinCharts = { render };
})(typeof window !== 'undefined' ? window : globalThis);

/* Import d'un relevé bancaire (CSV) : lecture, rapprochement avec les écritures existantes,
   propositions de catégorisation tirées de l'historique. Fonctions pures (navigateur + Node). */
(function (root) {
  'use strict';
  const E = root.FinEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const r2 = E.r2;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /* ---------- lecture du CSV ---------- */
  function splitCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }
  const money = (s) => { const t = String(s || '').replace(/[\s$]/g, '').replace(/,(?=\d{2}$)/, '.').replace(/,/g, ''); return t === '' ? null : Number(t); };
  function toIso(s) {
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());           // TD : MM/JJ/AAAA
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());                        // AAAA-MM-JJ
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  /* Formats reconnus :
     - TD (EasyWeb, « accountactivity.csv ») : date, description, retrait, dépôt, solde — sans en-tête;
     - RBC (Banque en direct, « csv*.csv ») : en-tête « Account Type, Account Number, Transaction Date, Cheque Number,
       Description 1, Description 2, CAD$, USD$ ». */
  function parseBankCsv(text) {
    const rows = [], skipped = [];
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const head = splitCsvLine(lines[0] || '').map((h) => h.trim().toLowerCase());
    const iDate = head.indexOf('transaction date');
    if (iDate >= 0) {
      const iD1 = head.indexOf('description 1'), iD2 = head.indexOf('description 2'), iAmt = head.findIndex((h) => h.startsWith('cad'));
      lines.slice(1).forEach((line, i) => {
        if (!line.trim()) return;
        const f = splitCsvLine(line), date = toIso(f[iDate] || ''), amt = money(f[iAmt]);
        if (!date || amt == null) { skipped.push(i + 2); return; }
        rows.push({ n: rows.length, line: i + 2, date, description: norm(`${f[iD1] || ''} ${f[iD2] || ''}`), amount: r2(amt), balance: null });
      });
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n).forEach((r, i) => (r.n = i));
      return { rows, skipped, format: 'RBC' };
    }
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const f = splitCsvLine(line);
      const date = toIso(f[0] || '');
      if (!date || f.length < 4) { skipped.push(i + 1); return; }
      const out = money(f[2]), inn = money(f[3]), bal = f.length > 4 ? money(f[4]) : null;
      if (out == null && inn == null) { skipped.push(i + 1); return; }
      rows.push({ n: rows.length, line: i + 1, date, description: norm(f[1]), amount: r2((inn || 0) - (out || 0)), balance: bal });
    });
    return { rows, skipped, format: 'TD' };
  }

  /* ---------- rapprochement ---------- */
  const pivotAmt = (e, account) => { const l = e.lines.find((x) => x.acct === account) || (e.counter && e.lines.find((x) => x.acct === e.counter)); return l ? l.amt : 0; };
  function reconcile(data, account, rows) {
    const used = new Set();
    const byDate = {};
    data.entries.filter((e) => e.account === account).forEach((e) => (byDate[e.date] = byDate[e.date] || []).push(e));
    // 1) même date, même montant
    for (const r of rows) {
      const c = (byDate[r.date] || []).find((e) => !used.has(e.id) && Math.abs(pivotAmt(e, account) - r.amount) < 0.005);
      if (c) { used.add(c.id); r.status = 'exists'; r.matches = [c.id]; }
    }
    // 2) même date, une ligne du relevé répartie sur plusieurs écritures (ex. câble + frais)
    for (const r of rows.filter((x) => !x.status)) {
      const group = (byDate[r.date] || []).filter((e) => !used.has(e.id) && norm(e.description).startsWith(r.description));
      if (group.length > 1 && Math.abs(group.reduce((s, e) => s + pivotAmt(e, account), 0) - r.amount) < 0.005) {
        group.forEach((e) => used.add(e.id)); r.status = 'exists'; r.matches = group.map((e) => e.id);
      }
    }
    rows.filter((x) => !x.status).forEach((r) => (r.status = 'new'));
    // 3) contrôle des soldes de fin de journée quand le relevé les fournit
    const bal = E.balances;
    const days = Array.from(new Set(rows.map((r) => r.date)));
    const dayCheck = {};
    for (const dte of days) {
      const last = rows.filter((r) => r.date === dte).pop();
      if (last.balance == null) continue;
      const ledger = (bal(data, dte)[account] || 0);
      const pending = rows.filter((r) => r.date <= dte && r.status === 'new').reduce((s, r) => s + r.amount, 0);
      dayCheck[dte] = { statement: last.balance, ledger: r2(ledger), ledgerAfter: r2(ledger + pending), ok: Math.abs(ledger + pending - last.balance) < 0.005 };
    }
    // écritures existantes de la période qui ne figurent pas au relevé
    const from = rows.length ? rows[0].date : null, to = rows.length ? rows[rows.length - 1].date : null;
    const missing = from ? data.entries.filter((e) => e.account === account && e.date >= from && e.date <= to && !used.has(e.id)).map((e) => e.id) : [];
    return { rows, dayCheck, missing };
  }

  /* ---------- propositions ---------- */
  function history(data, account) {
    const h = {};
    for (const e of data.entries) if (e.account === account) (h[norm(e.description)] = h[norm(e.description)] || []).push(e);
    return h;
  }
  // Règles de catégorisation créées par l'utilisateur (Banque → Créer une règle)
  function matchRule(data, account, row) {
    const desc = String(row.description || '').toLowerCase(), abs = Math.abs(row.amount);
    return (data.rules || []).find((r) => r.active !== false && r.contains && desc.includes(String(r.contains).toLowerCase())
      && (!r.account || r.account === account) && (!r.dir || r.dir === 'any' || (r.dir === 'in' ? row.amount > 0 : row.amount < 0))
      && (r.amin == null || r.amin === '' || abs >= Number(r.amin) - 0.005) && (r.amax == null || r.amax === '' || abs <= Number(r.amax) + 0.005)) || null;
  }
  function ruleSplits(rule, row) {
    const per = rule.periodMode === 'prev' ? E.addMonths(row.date.slice(0, 7), -1) : rule.periodMode === 'same' ? row.date.slice(0, 7) : '';
    const o = { acct: rule.acct, amt: Math.abs(row.amount) };
    if (rule.loan) o.loan = rule.loan; if (per) o.period = per; if (rule.memo) o.memo = rule.memo;
    return [o];
  }
  function propose(data, account, row, hist) {
    const rule = matchRule(data, account, row);
    if (rule) return { splits: ruleSplits(rule, row), confidence: 'high', rule: rule.id, reason: `Règle « ${rule.name || rule.contains} »` };
    hist = hist || history(data, account);
    const sign = row.amount >= 0 ? 1 : -1, abs = Math.abs(row.amount);
    const past = (hist[row.description] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const others = (e) => e.lines.filter((l) => l.acct !== account);
    const bank = (data.bankAccounts || []).find((b) => b.id === account) || {};
    const interestOpts = () => (row.amount > 0 && !bank.personal ? E.suggestSplit(data, abs, row.date).options : []);
    const asSplits = (opt) => opt.map((x) => ({ acct: 'rev:interest', loan: x.loan, period: x.period, amt: x.amt }));

    if (past.length) {
      const last = past[0], ls = others(last);
      if (ls.every((l) => l.acct === 'rev:interest')) {
        const loansHist = new Set(past.slice(0, 3).flatMap((e) => others(e).map((l) => l.loan)));
        const opts = interestOpts();
        const same = opts.find((o) => o.every((x) => loansHist.has(x.loan)) && new Set(o.map((x) => x.loan)).size === new Set(ls.map((l) => l.loan)).size);
        if (same) return { splits: asSplits(same), confidence: 'high', reason: `Même payeur que le ${fmt(last.date)}` };
        const adv = E.suggestAdvance(data, abs, row.date).filter((a) => loansHist.has(a.loan));
        if (adv.length) { const a = adv[0]; return { splits: E.advanceSplits(a.loan, a.from, a.months, a.perMonth, abs), confidence: 'medium', advance: a,
          reason: `Même payeur — paiement d'avance ? ${a.months} mois × ${fmtMoney(a.perMonth)} à partir de ${fmtMonth(a.from)}` }; }
        if (opts.length) return { splits: asSplits(opts[0]), confidence: 'medium', reason: `Payeur connu (${[...loansHist].join(', ')}), mais montant inhabituel` };
        return { splits: [], confidence: 'low', reason: `Payeur connu (intérêts) — aucune mensualité impayée ne donne ce montant` };
      }
      const accts = new Set(past.map((e) => others(e).map((l) => l.acct + (l.loan || '')).join('+')));
      if (abs >= 10000) {   // mouvement de capital : toujours à confirmer
        const uses = Array.from(new Set(past.slice(0, 4).map((e) => others(e).map((l) => label(data, l)).join(' + ')))).join(' · ');
        return { splits: [], confidence: 'low',
                 reason: `Montant important — à confirmer. Cette description a déjà servi pour : ${uses}` };
      }
      const prop = ls.length === 1 ? [{ acct: ls[0].acct, loan: ls[0].loan, memo: ls[0].memo, amt: abs, ...(/^exp:int-/.test(ls[0].acct) ? { period: E.addMonths(row.date.slice(0, 7), -1) } : {}) }] : [];
      if (prop.length) {
        const sameSign = Math.sign(pivotAmt(last, account)) === sign;
        const conf = accts.size === 1 && past.length >= 2 && sameSign && ls[0].acct.startsWith('exp:') ? 'high' : 'medium';
        return { splits: prop, confidence: conf, reason: past.length > 1 ? `${past.length} transactions précédentes avec cette description` : `Comme le ${fmt(last.date)}` };
      }
    }
    if (bank.personal) {   // déjà mise de côté comme personnelle ?
      const prev = (data.bankFeed || []).filter((x) => x.account === account && x.status === 'excluded' && norm(x.description) === row.description).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev && !past.length) return { splits: [], confidence: 'low', personal: true, reason: `Déjà classée « Personnel » le ${fmt(prev.date)}` };
    }
    if (bank.personal && !past.length) {
      if (row.amount > 0) return { splits: [], confidence: 'low', reason: bank.card ? 'Paiement de la carte ou crédit : probablement personnel (bouton « Personnel »)' : 'Entrée sur un compte personnel : remboursement ou transaction personnelle ?' };
      return { splits: [], confidence: 'low', reason: "Dépense d'entreprise ? Choisissez la catégorie, sinon « Personnel »" };
    }
    if (row.amount > 0) {
      const opts = interestOpts();
      if (opts.length) return { splits: asSplits(opts[0]), confidence: 'medium', reason: opts.length > 1 ? `Intérêts attendus — ${opts.length} combinaisons possibles` : 'Intérêts attendus' };
      const adv = E.suggestAdvance(data, abs, row.date);
      if (adv.length) { const a = adv[0], to = E.addMonths(a.from, a.months - 1);
        return { splits: E.advanceSplits(a.loan, a.from, a.months, a.perMonth, abs), confidence: 'medium', advance: a,
          reason: `Paiement d'avance ? ${a.months} mois × ${fmtMoney(a.perMonth)} (${fmtMonth(a.from)} → ${fmtMonth(to)})${a.partial ? ' — complète les mois déjà payés en partie' : ''}${adv.length > 1 ? ` · ${adv.length} possibilités` : ''}` }; }
      return { splits: [], confidence: 'low', reason: 'Aucune mensualité impayée ne correspond' };
    }
    // sortie inconnue : même montant dans les 6 derniers mois
    const since = E.addMonths(row.date.slice(0, 7), -6);
    const same = data.entries.filter((e) => e.account === account && e.date.slice(0, 7) >= since && Math.abs(pivotAmt(e, account) - row.amount) < 0.005 && others(e).length === 1)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (same.length) { const l = others(same[0])[0]; return { splits: [{ acct: l.acct, loan: l.loan, memo: l.memo, amt: abs, ...(/^exp:int-/.test(l.acct) ? { period: E.addMonths(row.date.slice(0, 7), -1) } : {}) }], confidence: 'low', reason: `Même montant que « ${same[0].description} » le ${fmt(same[0].date)}` }; }
    return { splits: [], confidence: 'low', reason: 'Nouvelle description — à catégoriser' };
  }
  function label(data, l) {
    const a = data.accounts.find((x) => x.id === l.acct) || { name: l.acct };
    const loan = l.loan && data.loans.find((x) => x.id === l.loan);
    return loan ? `${a.id === 'loans' ? 'Capital' : a.name} ${loan.name.split(' — ')[0]}` : a.name;
  }
  const fmtMoney = (x) => `${Number(x).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const fmtMonth = (p) => { const [y, m] = p.split('-'); return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m - 1]} ${y}`; };
  const fmt = (s) => { const [y, m, d] = s.split('-'); return `${Number(d)} ${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m - 1]} ${y}`; };

  function entryFromRow(account, row, splits) {
    const sign = row.amount >= 0 ? 1 : -1;
    return { date: row.date, account, description: row.description, source: 'import',
      lines: [{ acct: account, amt: row.amount }].concat(splits.map((s) => { const o = { acct: s.acct, amt: r2(-sign * s.amt) }; if (s.loan) o.loan = s.loan; if (s.period) o.period = s.period; if (s.memo) o.memo = s.memo; return o; })) };
  }

  const api = { parseBankCsv, reconcile, propose, history, entryFromRow, norm, matchRule, ruleSplits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinImport = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* Barèmes des droits de mutation (« taxe de bienvenue ») 2026 — repris du classeur Template_Analyse_Financement.
   Modifiables dans Outils → Taxes de bienvenue (les modifications sont enregistrées avec vos données). */
window.TF_WELCOME_TAX = [{"name": "Standard Québec", "status": "Barème provincial 2026", "source": "", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Baie-D'Urfé", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Beaconsfield", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Beloeil", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Blainville", "status": "Confirmé officiel partiel 2026", "source": "Ville de Blainville", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, 750000, 0.015], [750000, null, 0.03]]}, {"name": "Bois-des-Filion", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Boisbriand", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Boucherville", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Brossard", "status": "Confirmé officiel 2026", "source": "Ville de Brossard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, 500000, 0.015], [500000, null, 0.03]]}, {"name": "Candiac", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Chambly", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Charlemagne", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Châteauguay", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Côte-Saint-Luc", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Delson", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Deux-Montagnes", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Dollard-des-Ormeaux", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Dorval", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Hampstead", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Kirkland", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "L'Assomption", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "La Prairie", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Laval", "status": "Confirmé officiel 2026", "source": "Ville de Laval", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, 500000, 0.015], [500000, null, 0.03]]}, {"name": "Longueuil", "status": "À valider - calculette officielle disponible", "source": "Ville de Longueuil", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Lorraine", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Mascouche", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Mercier", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Mirabel", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Mont-Royal", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Mont-Saint-Hilaire", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Montréal", "status": "Confirmé officiel 2026", "source": "Ville de Montréal", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, 552300, 0.015], [552300, 1104700, 0.02], [1104700, 2136500, 0.025], [2136500, 3113000, 0.035], [3113000, null, 0.04]]}, {"name": "Montréal-Est", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Montréal-Ouest", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Pointe-Claire", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Repentigny", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Richelieu", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Rosemère", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Bruno-de-Montarville", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Colomban", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Constant", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Eustache", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Jean-sur-Richelieu", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Jérôme", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Saint-Lambert", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Sainte-Anne-de-Bellevue", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Sainte-Anne-des-Plaines", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Sainte-Catherine", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Sainte-Julie", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Sainte-Thérèse", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Senneville", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Terrebonne", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Varennes", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Vaudreuil-Dorion", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}, {"name": "Westmount", "status": "À valider municipalement", "source": "Québec standard", "brackets": [[0, 62900, 0.005], [62900, 315000, 0.01], [315000, null, 0.015]]}];

/* Calculs des outils clients (fonctions pures, navigateur + Node).
   Repris du classeur « Template_Analyse_Financement » : Équité restante, tables d'amortissement,
   intérêts capitalisés et cédule de paiement. */
(function (root) {
  'use strict';
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const n = (x) => { const v = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : 0; };

  /* ---------- taxe de bienvenue (droits de mutation) ---------- */
  function welcomeTax(price, brackets) {
    const p = n(price); let total = 0;
    const rows = (brackets || []).map(([from, to, rate]) => {
      const top = to == null ? Infinity : to;
      const base = Math.max(0, Math.min(p, top) - from);
      const tax = base * rate; total += tax;
      return { from, to, rate, base: r2(base), tax: r2(tax) };
    });
    return { total: r2(total), rows };
  }

  /* ---------- commission du courtier ---------- */
  function brokerCost(price, pct, tps = 0.05, tvq = 0.09975) {
    const gross = n(price) * n(pct);
    return { gross: r2(gross), tps: r2(gross * tps), tvq: r2(gross * tvq), total: r2(gross * (1 + tps + tvq)) };
  }

  /* ---------- pénalité de remboursement anticipé ---------- */
  // Variable : 3 mois d'intérêt. Fixe : le plus élevé de 3 mois d'intérêt et du différentiel de taux (IRD).
  function penalty({ balance, rate, type, marketRate, monthsLeft, manual }) {
    const bal = n(balance), three = bal * n(rate) / 12 * 3;
    const ird = bal * (n(rate) - n(marketRate)) * (n(monthsLeft) / 12);
    let final, method;
    if (type === 'Manuelle') { final = n(manual); method = 'Montant fourni par la banque'; }
    else if (type === 'Aucune') { final = 0; method = 'Aucune pénalité'; }
    else if (type === 'Variable') { final = three; method = "3 mois d'intérêt (taux variable)"; }
    else { final = Math.max(three, ird); method = ird > three ? 'Différentiel de taux (IRD)' : "3 mois d'intérêt (plus élevé que l'IRD)"; }
    return { three: r2(three), ird: r2(ird), final: r2(Math.max(0, final)), method };
  }

  /* ---------- prêt relais (bridge) ---------- */
  function bridgeCost({ amount, rate, feePct, minMonths, months }) {
    const monthly = n(amount) * n(rate) / 12;
    const charged = Math.max(n(months), n(minMonths));
    const interest = monthly * charged, fees = n(amount) * n(feePct);
    return { monthly: r2(monthly), monthsCharged: charged, interest: r2(interest), fees: r2(fees), total: r2(interest + fees) };
  }

  /* ---------- équité restante : deux scénarios ---------- */
  function equity(i, brackets) {
    const wt = welcomeTax(i.purchasePrice, brackets);
    const br = brokerCost(i.salePrice, i.brokerPct, i.tps, i.tvq);
    const pen = penalty({ balance: i.mortgageBalance, rate: i.mortgageRate, type: i.rateType, marketRate: i.marketRate, monthsLeft: i.monthsLeft, manual: i.penaltyManual });
    const bridge = bridgeCost({ amount: i.bridgeAmount, rate: i.bridgeRate, feePct: i.bridgeFeePct, minMonths: i.bridgeMinMonths, months: i.bridgeMonths });
    const value = n(i.salePrice), debt = n(i.mortgageBalance) + n(i.heloc);
    const theoretical = value - debt;
    const common = [
      { k: 'welcome', label: 'Taxe de bienvenue (nouvelle propriété)', v: wt.total },
      { k: 'broker', label: 'Commission du courtier (taxes incluses)', v: br.total },
      { k: 'penalty', label: 'Pénalité de remboursement hypothécaire', v: pen.final },
      { k: 'notary', label: 'Notaire', v: n(i.notary) },
      ...(n(i.otherCosts) ? [{ k: 'other', label: i.otherLabel || 'Autres frais', v: n(i.otherCosts) }] : []),
    ];
    const s1 = common, s2 = common.concat([{ k: 'bridge', label: 'Coût du financement relais', v: bridge.total }, ...(n(i.bridgeNotary) ? [{ k: 'bnotary', label: 'Notaire — financement relais', v: n(i.bridgeNotary) }] : [])]);
    const sum = (a) => r2(a.reduce((s, x) => s + x.v, 0));
    const mk = (costs) => { const c = sum(costs); return { costs, totalCosts: c, real: r2(theoretical - c), pctOfValue: value ? (theoretical - c) / value : 0 }; };
    return { value, debt: r2(debt), theoretical: r2(theoretical), welcome: wt, broker: br, penalty: pen, bridge, s1: mk(s1), s2: mk(s2) };
  }

  /* ---------- structures de prêt ---------- */
  function addMonthsIso(iso, k) { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + k, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; }
  function endOfMonth(iso) { const [y, m] = iso.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; }
  function pmt(rate, nper, pv) { return rate === 0 ? pv / nper : (pv * rate) / (1 - Math.pow(1 + rate, -nper)); }
  // type : 'conv' (capital + intérêts), 'io' (intérêts seulement), 'cap' (intérêts partiels, reste capitalisé)
  function amortize({ type, principal, rate, months, amortYears, payment, capMode, capRatio, startDate, fees }) {
    const P = n(principal), r = n(rate) / 12, N = Math.max(1, Math.round(n(months)));
    const start = startDate || new Date().toISOString().slice(0, 7) + '-01';
    let pay;
    if (type === 'conv') pay = pmt(r, Math.max(1, Math.round(n(amortYears) * 12)), P);
    else if (type === 'io') pay = P * r;
    else pay = n(payment);
    let bal = P; const rows = []; const acc = { paid: 0, interest: 0, capitalized: 0, principalPaid: 0 };
    for (let k = 0; k < N; k++) {
      const open = bal, interest = open * r;
      let paid, princ = 0, cap = 0;
      if (type === 'conv') { paid = Math.min(pay, open + interest); princ = paid - interest; bal = open - princ; }
      else if (type === 'io') { paid = interest; bal = open; }
      else {
        if (capMode === 'ratio') { cap = interest * Math.max(0, Math.min(1, n(capRatio))); paid = interest - cap; }
        else { paid = Math.min(pay, interest); cap = interest - paid; }
        bal = open + cap;
      }
      acc.paid += paid; acc.interest += interest; acc.capitalized += cap; acc.principalPaid += princ;
      const from = addMonthsIso(start, k);
      rows.push({ n: k + 1, from, to: endOfMonth(from), due: addMonthsIso(endOfMonth(from).slice(0, 8) + '01', 1), open: r2(open), interest: r2(interest), paid: r2(paid), principalPaid: r2(princ), capitalized: r2(cap), close: r2(bal), capRatio: interest ? cap / interest : 0 });
    }
    const t = { paid: r2(acc.paid), interest: r2(acc.interest), capitalized: r2(acc.capitalized), principalPaid: r2(acc.principalPaid), endBalance: r2(Math.abs(bal) < 0.005 ? 0 : bal), fees: r2(n(fees)) };
    t.totalCost = r2(t.interest + t.fees);                 // coût du prêt : intérêts + frais
    t.cashOut = r2(t.paid + t.fees);                        // décaissements pendant le terme
    t.payoff = r2(t.cashOut + t.endBalance);               // tout payé, solde remboursé à la fin
    return { type, payment: r2(type === 'cap' ? (rows[0] ? rows[0].paid : 0) : pay), rows, totals: t };
  }
  // Compare intérêts partiels capitalisés vs intérêts seulement, même montant, taux et durée
  function compareCapVsIO(base) {
    const io = amortize({ ...base, type: 'io' }), cap = amortize({ ...base, type: 'cap' });
    return { io, cap,
      monthlySaving: r2(io.rows[0].paid - cap.rows[0].paid),
      cashSaved: r2(io.totals.paid - cap.totals.paid),
      balanceIncrease: r2(cap.totals.endBalance - n(base.principal)),
      extraCost: r2(cap.totals.interest - io.totals.interest),      // coût de la capitalisation (intérêts sur intérêts)
      payoffDiff: r2(cap.totals.payoff - io.totals.payoff) };
  }
  // Paiement mensuel requis selon la durée d'amortissement (tableau du classeur)
  function paymentByYears(principal, rate, years) { return years.map((y) => ({ years: y, payment: r2(pmt(n(rate) / 12, y * 12, n(principal))) })); }

  const api = { r2, n, welcomeTax, brokerCost, penalty, bridgeCost, equity, amortize, compareCapVsIO, paymentByYears, addMonthsIso, endOfMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TFCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* Outils clients : équité restante, structures de prêt, cédule de paiement, taxes de bienvenue.
   Les paramètres en cours sont gardés dans ce navigateur; les scénarios enregistrés vont dans finances.json. */
(function () {
  'use strict';
  const C = () => window.TFCalc;
  const T = () => window.TF;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const n = (x) => C().n(x);
  const KEY = 'terreno-outils.v1';
  const firstOfNextMonth = () => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth() + 1, 1)).toISOString().slice(0, 10); };

  const DEFAULTS = {
    tool: 'equity',
    equity: { client: '', salePrice: 675000, brokerPct: 4, tps: 5, tvq: 9.975, mortgageBalance: 170000, heloc: 40000, mortgageRate: 2.95, monthsLeft: 12,
      rateType: 'Fixe', marketRate: 4.2, penaltyManual: 0, purchasePrice: 525000, city: 'Standard Québec', notaryChoice: 'Achat + financement', notary: 3700,
      otherLabel: '', otherCosts: 0, bridgeAmount: 440000, bridgeRate: 10, bridgeFeePct: 0, bridgeMinMonths: 6, bridgeMonths: 0, bridgeNotary: 0, notes: '' },
    struct: { client: '', principal: 270000, months: 24, startDate: firstOfNextMonth(), convRate: 6, amortYears: 25, ioRate: 12, capRate: 15, capMode: 'fixed', payment: 2000, capRatio: 50, feePct: 0,
      show: { conv: true, io: true, cap: true }, detail: 'cap', period: 'month' },
    sched: { client: '', property: '', loanId: '', principal: 270000, rate: 15, type: 'cap', capMode: 'fixed', payment: 2000, capRatio: 50, months: 24, startDate: '2026-09-01', amortYears: 25, feePct: 0, notes: '' },
    tax: { city: 'Standard Québec', price: 525000 },
    brand: { name: '', contact: '' },
    letter: null, amort: null,
  };
  let S = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), v); } catch (e) { /* rien */ } return JSON.parse(JSON.stringify(DEFAULTS)); })();
  function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
  const saveState = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* rien */ } };

  /* ---------- taxes de bienvenue (données modifiables) ---------- */
  const taxTable = () => T().data.welcomeTax || window.TF_WELCOME_TAX;
  const cityOf = (name) => taxTable().find((c) => c.name === name) || taxTable()[0];

  /* ---------- formats ---------- */
  const pct = (x, d = 2) => `${(n(x)).toLocaleString('fr-CA', { maximumFractionDigits: d })} %`;
  const field = (id, label, value, opts = {}) => `<label class="field ${opts.cls || ''} ${opts.num === false ? 'span-all' : ''}"><span>${label}</span>
    <div class="inp ${opts.suffix ? 'has-suffix' : ''}"><input type="text" ${opts.num === false ? '' : 'inputmode="decimal" class="num"'} id="tl-${id}" data-tl="${id}" value="${T().esc(value ?? '')}" ${opts.ph ? `placeholder="${T().esc(opts.ph)}"` : ''}>${opts.suffix ? `<em>${opts.suffix}</em>` : ''}</div>${opts.hint ? `<small class="hint">${opts.hint}</small>` : ''}</label>`;
  const select = (id, label, value, options, opts = {}) => `<label class="field ${opts.cls || ''}"><span>${label}</span><select id="tl-${id}" data-tl="${id}" data-full="1">${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${T().esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${T().esc(l)}</option>`; }).join('')}</select>${opts.hint ? `<small class="hint">${opts.hint}</small>` : ''}</label>`;
  const dateField = (id, label, value) => `<label class="field"><span>${label}</span><input type="date" id="tl-${id}" data-tl="${id}" data-full="1" value="${value || ''}"></label>`;
  const group = (title, body, sub) => `<fieldset class="tl-group"><legend>${title}</legend>${sub ? `<p class="hint">${sub}</p>` : ''}<div class="tl-fields">${body}</div></fieldset>`;

  /* ---------- en-tête commun ---------- */
  const TOOLS = [['equity', 'Équité restante'], ['struct', 'Structures de prêt'], ['sched', 'Cédule de paiement'], ['amort', "Table d'amortissement"], ['letter', "Lettre d'approbation"], ['tax', 'Taxes de bienvenue']];
  const amortState = () => { if (!S.amort) S.amort = JSON.parse(JSON.stringify(window.TFAmort.DEFAULTS)); return S.amort; };
  const letterState = () => { if (!S.letter) S.letter = JSON.parse(JSON.stringify(window.TFLetter.DEFAULTS)); return S.letter; };
  window.TFToolsKit = { field, select, dateField, group };
  function header() {
    const t = S.tool, all = (T().data.toolScenarios || []).filter((x) => x.tool === t), scen = all.filter((x) => !x.archived);
    return `<div class="section-head"><div><h1>Outils clients</h1><div class="sub">Calculateurs pour préparer des documents informatifs. Modifiez les paramètres à gauche; les résultats se mettent à jour.</div></div>
      ${t !== 'tax' ? `<div class="toolbar">
        <select id="tl-scen" aria-label="Scénarios enregistrés"><option value="">Scénarios enregistrés (${scen.length})</option>${scen.map((x) => `<option value="${x.id}">${T().esc(x.name)} · ${T().d(x.savedAt.slice(0, 10))}</option>`).join('')}</select>
        ${all.length ? `<button class="btn" data-tlact="manage">Gérer${all.length > scen.length ? ` <span class="small muted">(${all.length - scen.length} archivé${all.length - scen.length > 1 ? 's' : ''})</span>` : ''}</button>` : ''}
        <button class="btn" data-tlact="save">Enregistrer le scénario</button>
        <button class="btn" data-tlact="reset">Valeurs par défaut</button>
        <button class="btn primary" data-tlact="doc">Aperçu client</button></div>` : ''}</div>
      <div class="seg big tl-tabs" role="tablist">${TOOLS.map(([k, l]) => `<button role="tab" data-tlact="tool" data-k="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  /* ================================================================ ÉQUITÉ RESTANTE */
  function eqInputs() {
    const e = S.equity;
    return { ...e, brokerPct: n(e.brokerPct) / 100, tps: n(e.tps) / 100, tvq: n(e.tvq) / 100, mortgageRate: n(e.mortgageRate) / 100, marketRate: n(e.marketRate) / 100,
      bridgeRate: n(e.bridgeRate) / 100, bridgeFeePct: n(e.bridgeFeePct) / 100, notary: e.notaryChoice === 'Achat' ? 1700 : e.notaryChoice === 'Achat + financement' ? 3700 : n(e.notary) };
  }
  function eqCalc() { return C().equity(eqInputs(), cityOf(S.equity.city).brackets); }
  function viewEquity() {
    const e = S.equity, cities = taxTable().map((c) => c.name);
    const form = group('Client', field('client', 'Nom du client', e.client, { num: false, ph: 'Ex. : Valérie Beauregard' }))
      + group('Vente de la propriété actuelle', field('salePrice', 'Prix de vente visé', e.salePrice, { suffix: '$' }) + field('brokerPct', 'Commission du courtier', e.brokerPct, { suffix: '%' })
        + field('tps', 'TPS', e.tps, { suffix: '%' }) + field('tvq', 'TVQ', e.tvq, { suffix: '%' }))
      + group('Hypothèque actuelle', field('mortgageBalance', 'Solde hypothécaire', e.mortgageBalance, { suffix: '$' }) + field('heloc', 'Marge hypothécaire utilisée', e.heloc, { suffix: '$' })
        + field('mortgageRate', "Taux de l'hypothèque", e.mortgageRate, { suffix: '%' }) + field('monthsLeft', 'Mois restants au terme', e.monthsLeft, { suffix: 'mois' })
        + select('rateType', 'Type de taux / pénalité', e.rateType, [['Fixe', 'Fixe (3 mois ou IRD)'], ['Variable', "Variable (3 mois d'intérêt)"], ['Manuelle', 'Montant fourni par la banque'], ['Aucune', 'Aucune pénalité']])
        + (e.rateType === 'Fixe' ? field('marketRate', 'Taux actuel au marché (même terme)', e.marketRate, { suffix: '%' }) : '')
        + (e.rateType === 'Manuelle' ? field('penaltyManual', 'Pénalité confirmée par la banque', e.penaltyManual, { suffix: '$' }) : ''))
      + group('Achat de la nouvelle propriété', field('purchasePrice', "Prix d'achat", e.purchasePrice, { suffix: '$' }) + select('city', 'Ville (taxe de bienvenue)', e.city, cities)
        + select('notaryChoice', 'Frais de notaire', e.notaryChoice, [['Achat', 'Achat seulement (1 700 $)'], ['Achat + financement', 'Achat + financement (3 700 $)'], ['Autre', 'Autre montant']])
        + (e.notaryChoice === 'Autre' ? field('notary', 'Montant du notaire', e.notary, { suffix: '$' }) : '')
        + field('otherLabel', 'Autres frais — description', e.otherLabel, { num: false, ph: 'Ex. : inspection, déménagement' }) + field('otherCosts', 'Autres frais — montant', e.otherCosts, { suffix: '$' }))
      + group('Financement relais (scénario 2)', field('bridgeAmount', 'Montant du prêt', e.bridgeAmount, { suffix: '$' }) + field('bridgeRate', "Taux d'intérêt annuel", e.bridgeRate, { suffix: '%' })
        + field('bridgeFeePct', 'Frais de dossier', e.bridgeFeePct, { suffix: '%' }) + field('bridgeMinMonths', 'Minimum de mois facturés', e.bridgeMinMonths, { suffix: 'mois' })
        + field('bridgeMonths', 'Durée prévue', e.bridgeMonths, { suffix: 'mois', hint: 'Le coût utilise le plus élevé de la durée prévue et du minimum.' }) + field('bridgeNotary', 'Notaire — prêt relais (facultatif)', e.bridgeNotary, { suffix: '$' }),
        "Permet d'acheter sans condition de vente : le prêt relais finance l'achat en attendant la vente.")
      + group('Notes pour le client', `<label class="field span-all"><textarea id="tl-notes" data-tl="notes" rows="3" placeholder="Hypothèses, dates prévues, etc.">${T().esc(e.notes)}</textarea></label>`);
    return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">${form}</form><div id="tl-results">${eqResults()}</div></div>`;
  }
  function eqResults() {
    const r = eqCalc(), e = S.equity, { m, m0, esc } = T();
    const card = (title, s, accent, sub) => `<section class="panel scen ${accent ? 'accent' : ''}"><div class="panel-head"><div><h2>${title}</h2><div class="small muted">${sub}</div></div></div>
      <div class="panel-body"><table class="wf"><tbody>
        <tr><td>Prix de vente</td><td class="num">${m(r.value)}</td></tr>
        <tr><td>− Solde hypothécaire</td><td class="num">${m(-n(e.mortgageBalance))}</td></tr>
        <tr><td>− Marge hypothécaire utilisée</td><td class="num">${m(-n(e.heloc))}</td></tr>
        <tr class="sub"><td>Équité théorique</td><td class="num">${m(r.theoretical)}</td></tr>
        ${s.costs.map((c) => `<tr><td>− ${esc(c.label)}</td><td class="num">${m(-c.v)}</td></tr>`).join('')}
        <tr class="sub"><td>Total des coûts</td><td class="num">${m(-s.totalCosts)}</td></tr>
      </tbody></table>
      <div class="big-result"><span class="label">Équité réelle restante</span><span class="v">${m0(s.real)}</span><span class="small muted">${(s.pctOfValue * 100).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} % du prix de vente</span></div></div></section>`;
    const diff = r.s2.real - r.s1.real;
    const wt = r.welcome, city = cityOf(e.city);
    return `
      <div class="scen-grid">${card('Scénario 1 — Vendre, puis acheter', r.s1, false, 'Achat conditionnel à la vente de la propriété actuelle')}${card('Scénario 2 — Acheter sans condition', r.s2, true, 'Avec un financement relais en attendant la vente')}</div>
      <div class="callout info">Le financement relais coûte <b>${m(r.bridge.total)}</b> (${r.bridge.monthsCharged} mois × ${m(r.bridge.monthly)}${r.bridge.fees ? ` + ${m(r.bridge.fees)} de frais de dossier` : ''}). L'équité réelle passe de ${m0(r.s1.real)} à ${m0(r.s2.real)} (${m0(diff)}), en échange d'un achat sans condition de vente.</div>
      <div class="detail-grid">
        <section class="panel"><div class="panel-head"><h3>Taxe de bienvenue — ${esc(city.name)}</h3><span class="small muted">${esc(city.status || '')}</span></div><div class="table-wrap"><table><thead><tr><th>Tranche</th><th class="num">Taux</th><th class="num">Montant imposé</th><th class="num">Taxe</th></tr></thead><tbody>
          ${wt.rows.map((x) => `<tr><td>${m0(x.from)} à ${x.to == null ? 'et plus' : m0(x.to)}</td><td class="num">${pct(x.rate * 100, 2)}</td><td class="num">${m(x.base)}</td><td class="num">${m(x.tax)}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">Total sur ${m0(e.purchasePrice)}</td><td class="num">${m(wt.total)}</td></tr></tbody></table></div></section>
        <section class="panel"><div class="panel-head"><h3>Commission du courtier</h3></div><div class="panel-body"><dl class="kv">
          <dt>Commission (${pct(e.brokerPct)})</dt><dd class="num">${m(r.broker.gross)}</dd><dt>TPS (${pct(e.tps, 3)})</dt><dd class="num">${m(r.broker.tps)}</dd><dt>TVQ (${pct(e.tvq, 3)})</dt><dd class="num">${m(r.broker.tvq)}</dd><dt><b>Total</b></dt><dd class="num"><b>${m(r.broker.total)}</b></dd></dl></div></section>
        <section class="panel"><div class="panel-head"><h3>Pénalité hypothécaire</h3></div><div class="panel-body"><dl class="kv">
          <dt>3 mois d'intérêt</dt><dd class="num">${m(r.penalty.three)}</dd>${e.rateType === 'Fixe' ? `<dt>Différentiel de taux (IRD)</dt><dd class="num">${m(Math.max(0, r.penalty.ird))}</dd>` : ''}
          <dt><b>Pénalité retenue</b></dt><dd class="num"><b>${m(r.penalty.final)}</b></dd></dl><p class="hint">${esc(r.penalty.method)}. Estimation : la banque fournit le montant exact.</p></div></section>
        <section class="panel"><div class="panel-head"><h3>Financement relais</h3></div><div class="panel-body"><dl class="kv">
          <dt>Intérêt mensuel</dt><dd class="num">${m(r.bridge.monthly)}</dd><dt>Mois facturés</dt><dd class="num">${r.bridge.monthsCharged}</dd><dt>Intérêts</dt><dd class="num">${m(r.bridge.interest)}</dd><dt>Frais de dossier</dt><dd class="num">${m(r.bridge.fees)}</dd><dt><b>Coût total</b></dt><dd class="num"><b>${m(r.bridge.total)}</b></dd></dl></div></section>
      </div>`;
  }
  function eqDoc() {
    const r = eqCalc(), e = S.equity, { m, m0, esc } = T();
    const col = (s) => `<td class="num">${m0(s.real)}</td>`;
    const costRow = (k, label) => { const a = r.s1.costs.find((c) => c.k === k), b = r.s2.costs.find((c) => c.k === k); if (!a && !b) return ''; return `<tr><td>${label}</td><td class="num">${a ? m(-a.v) : '—'}</td><td class="num">${b ? m(-b.v) : '—'}</td></tr>`; };
    return docShell('Analyse de l’équité restante', e.client, `
      <p>Cette analyse estime l'équité qui vous restera réellement après la vente de votre propriété et l'achat de la nouvelle, une fois les frais de transaction payés. Elle compare deux façons de procéder.</p>
      <div class="doc-kpis"><div><span>Scénario 1 — Vendre, puis acheter</span><b>${m0(r.s1.real)}</b></div><div><span>Scénario 2 — Acheter sans condition (financement relais)</span><b>${m0(r.s2.real)}</b></div></div>
      <h3>Hypothèses</h3>
      <table class="doc-table"><tbody>
        <tr><td>Prix de vente visé</td><td class="num">${m(e.salePrice)}</td></tr><tr><td>Solde hypothécaire / marge utilisée</td><td class="num">${m(e.mortgageBalance)} / ${m(e.heloc)}</td></tr>
        <tr><td>Prix d'achat de la nouvelle propriété (${esc(e.city)})</td><td class="num">${m(e.purchasePrice)}</td></tr>
        <tr><td>Financement relais</td><td class="num">${m(e.bridgeAmount)} à ${pct(e.bridgeRate)} · minimum ${e.bridgeMinMonths} mois${n(e.bridgeFeePct) ? ` · frais ${pct(e.bridgeFeePct)}` : ''}</td></tr>
      </tbody></table>
      <h3>Calcul</h3>
      <table class="doc-table"><thead><tr><th></th><th class="num">Scénario 1</th><th class="num">Scénario 2</th></tr></thead><tbody>
        <tr><td>Prix de vente</td><td class="num">${m(r.value)}</td><td class="num">${m(r.value)}</td></tr>
        <tr><td>− Dettes sur la propriété (hypothèque + marge)</td><td class="num">${m(-r.debt)}</td><td class="num">${m(-r.debt)}</td></tr>
        <tr class="sub"><td>Équité théorique</td><td class="num">${m(r.theoretical)}</td><td class="num">${m(r.theoretical)}</td></tr>
        ${costRow('welcome', 'Taxe de bienvenue')}${costRow('broker', 'Commission du courtier (taxes incluses)')}${costRow('penalty', 'Pénalité hypothécaire (estimée)')}${costRow('notary', 'Notaire')}${costRow('other', esc(e.otherLabel || 'Autres frais'))}${costRow('bridge', 'Coût du financement relais')}${costRow('bnotary', 'Notaire — financement relais')}
        <tr class="sub"><td>Total des coûts</td><td class="num">${m(-r.s1.totalCosts)}</td><td class="num">${m(-r.s2.totalCosts)}</td></tr>
        <tr class="grand"><td>Équité réelle restante</td>${col(r.s1)}${col(r.s2)}</tr>
      </tbody></table>
      ${e.notes ? `<h3>Notes</h3><p>${esc(e.notes).replace(/\n/g, '<br>')}</p>` : ''}`);
  }

  /* ================================================================ STRUCTURES DE PRÊT */
  function stBase() {
    const s = S.struct;
    return { principal: n(s.principal), months: n(s.months), startDate: s.startDate, amortYears: n(s.amortYears), payment: n(s.payment), capMode: s.capMode, capRatio: n(s.capRatio) / 100, fees: n(s.principal) * n(s.feePct) / 100 };
  }
  function stCalc() {
    const b = stBase(), s = S.struct;
    return { conv: C().amortize({ ...b, type: 'conv', rate: n(s.convRate) / 100 }), io: C().amortize({ ...b, type: 'io', rate: n(s.ioRate) / 100 }), cap: C().amortize({ ...b, type: 'cap', rate: n(s.capRate) / 100 }),
      cmp: C().compareCapVsIO({ ...b, rate: n(s.capRate) / 100 }) };
  }
  const ST_LABEL = { conv: 'Conventionnel', io: 'Intérêts seulement', cap: 'Intérêts partiels + capitalisés' };
  const ST_COLOR = { conv: 'var(--info)', io: 'var(--ink-2)', cap: 'var(--accent)' };
  function viewStruct() {
    const s = S.struct;
    const form = group('Client', field('client', 'Nom du client', s.client, { num: false }))
      + group('Prêt', field('principal', 'Montant du prêt', s.principal, { suffix: '$' }) + field('months', 'Durée analysée', s.months, { suffix: 'mois' }) + dateField('startDate', 'Premier mois', s.startDate)
        + field('feePct', 'Frais de dossier', s.feePct, { suffix: '%', hint: 'Ajoutés au coût total de chaque structure.' }))
      + group('Conventionnel', field('convRate', "Taux d'intérêt", s.convRate, { suffix: '%' }) + field('amortYears', 'Amortissement', s.amortYears, { suffix: 'ans' }), 'Paiement fixe qui comprend intérêts et capital.')
      + group('Intérêts seulement', field('ioRate', "Taux d'intérêt", s.ioRate, { suffix: '%' }), "Le capital reste le même; il est remboursé à la fin.")
      + group('Intérêts partiels + capitalisés', field('capRate', "Taux d'intérêt", s.capRate, { suffix: '%' })
        + select('capMode', 'Mode', s.capMode, [['fixed', 'Paiement mensuel fixe'], ['ratio', 'Pourcentage capitalisé']])
        + (s.capMode === 'fixed' ? field('payment', 'Paiement mensuel', s.payment, { suffix: '$', hint: "Le reste de l'intérêt s'ajoute au solde." }) : field('capRatio', "Part de l'intérêt capitalisée", s.capRatio, { suffix: '%' })),
        "La partie non payée de l'intérêt s'ajoute au solde; l'intérêt du mois suivant est calculé sur le solde augmenté.")
      + group('Afficher', ['conv', 'io', 'cap'].map((k) => `<label class="check"><input type="checkbox" data-tlshow="${k}" ${s.show[k] ? 'checked' : ''}> ${ST_LABEL[k]}</label>`).join(''));
    return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">${form}</form><div id="tl-results">${stResults()}</div></div>`;
  }
  function stResults() {
    const s = S.struct, R = stCalc(), { m, m0 } = T(), keys = ['conv', 'io', 'cap'].filter((k) => s.show[k]);
    const rate = { conv: s.convRate, io: s.ioRate, cap: s.capRate };
    const cards = keys.map((k) => { const a = R[k], t = a.totals; return `<section class="panel st-card" style="--c:${ST_COLOR[k]}"><div class="panel-head"><h3>${ST_LABEL[k]}</h3><span class="small muted">${pct(rate[k])}</span></div>
      <div class="panel-body"><dl class="kv">
        <dt>Paiement mensuel</dt><dd class="num"><b>${m(k === 'cap' ? a.rows[0]?.paid : a.payment)}</b>${k === 'cap' && s.capMode === 'ratio' ? ' <span class="small muted">au début</span>' : ''}</dd>
        <dt>Total payé sur ${s.months} mois</dt><dd class="num">${m(t.paid)}</dd>
        <dt>Intérêts</dt><dd class="num">${m(t.interest)}</dd>
        ${k === 'conv' ? `<dt>Capital remboursé</dt><dd class="num">${m(t.principalPaid)}</dd>` : ''}${k === 'cap' ? `<dt>Intérêts capitalisés</dt><dd class="num">${m(t.capitalized)}</dd>` : ''}
        ${t.fees ? `<dt>Frais de dossier</dt><dd class="num">${m(t.fees)}</dd>` : ''}
        <dt>Solde à la fin</dt><dd class="num"><b>${m(t.endBalance)}</b></dd>
        <dt>Coût total (intérêts + frais)</dt><dd class="num"><b>${m(t.totalCost)}</b></dd>
      </dl></div></section>`; }).join('');
    const c = R.cmp;
    const cmp = `<section class="panel accent-border"><div class="panel-head"><h2>Capitalisé ou intérêts seulement ? <span class="small muted">même taux (${pct(s.capRate)}), ${s.months} mois</span></h2></div><div class="panel-body">
      <div class="kpis inner">
        <div class="kpi"><span class="label">Paiement mensuel</span><span class="v">${m0(c.cap.rows[0].paid)} <span class="small muted">vs ${m0(c.io.rows[0].paid)}</span></span><span class="d">${m(c.monthlySaving)} de moins par mois au départ</span></div>
        <div class="kpi"><span class="label">Liquidités épargnées</span><span class="v">${m0(c.cashSaved)}</span><span class="d">Moins de paiements pendant ${s.months} mois</span></div>
        <div class="kpi"><span class="label">Augmentation du solde</span><span class="v">${m0(c.balanceIncrease)}</span><span class="d">Solde final ${m0(c.cap.totals.endBalance)}</span></div>
        <div class="kpi"><span class="label">Coût de la capitalisation</span><span class="v neg">${m0(c.extraCost)}</span><span class="d">Intérêts sur les intérêts capitalisés</span></div>
      </div>
      <p class="hint" style="margin:10px 0 0">Avec les intérêts seulement, le client paie ${m(c.io.totals.paid)} et doit encore ${m0(n(s.principal))} à la fin, soit ${m0(c.io.totals.payoff)} au total. Avec la capitalisation, il paie ${m(c.cap.totals.paid)} et doit ${m0(c.cap.totals.endBalance)} à la fin, soit ${m0(c.cap.totals.payoff)} : <b>${m0(c.payoffDiff)} de plus</b>, en échange de ${m0(c.cashSaved)} de liquidités disponibles pendant le prêt.</p>
    </div></section>`;
    const chart = stChart(R, keys);
    const det = s.show[s.detail] ? s.detail : keys[0];
    return `<div class="st-cards">${cards}</div>${s.show.cap || s.show.io ? cmp : ''}
      <section class="panel"><div class="panel-head"><h2>Solde du prêt dans le temps</h2><div class="legend">${keys.map((k) => `<span><i style="background:${ST_COLOR[k]}"></i>${ST_LABEL[k]}</span>`).join('')}</div></div><div class="panel-body chart">${chart}</div></section>
      ${det ? `<section class="panel"><div class="panel-head"><div class="seg" role="tablist">${keys.map((k) => `<button data-tlact="detail" data-k="${k}" class="${det === k ? 'on' : ''}">${ST_LABEL[k]}</button>`).join('')}</div>
        <div class="seg">${[['month', 'Par mois'], ['year', 'Par année']].map(([k, l]) => `<button data-tlact="period" data-k="${k}" class="${s.period === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="table-wrap">${amortTable(R[det], s.period, det)}</div></section>` : ''}`;
  }
  function amortTable(a, period, kind) {
    const { m, d } = T();
    let rows = a.rows;
    if (period === 'year') {
      const by = {}; rows.forEach((r) => { const y = r.from.slice(0, 4); const o = by[y] = by[y] || { label: y, open: r.open, interest: 0, paid: 0, principalPaid: 0, capitalized: 0, close: 0, n: 0 }; o.interest += r.interest; o.paid += r.paid; o.principalPaid += r.principalPaid; o.capitalized += r.capitalized; o.close = r.close; o.n++; });
      rows = Object.values(by);
    }
    return `<table><thead><tr><th>${period === 'year' ? 'Année' : 'Mois'}</th>${period === 'year' ? '' : '<th>Période couverte</th>'}<th class="num">Solde au début</th><th class="num">Intérêt</th><th class="num">Paiement</th>${kind === 'conv' ? '<th class="num">Capital remboursé</th>' : ''}${kind === 'cap' ? '<th class="num">Capitalisé</th>' : ''}<th class="num">Solde à la fin</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${period === 'year' ? `${r.label} <span class="small muted">(${r.n} mois)</span>` : r.n}</td>${period === 'year' ? '' : `<td class="small">${d(r.from)} au ${d(r.to)}</td>`}<td class="num">${m(r.open)}</td><td class="num">${m(r.interest)}</td><td class="num">${m(r.paid)}</td>${kind === 'conv' ? `<td class="num">${m(r.principalPaid)}</td>` : ''}${kind === 'cap' ? `<td class="num">${m(r.capitalized)}</td>` : ''}<td class="num">${m(r.close)}</td></tr>`).join('')}
      <tr class="total"><td colspan="${period === 'year' ? 2 : 3}">Total</td><td class="num">${m(a.totals.interest)}</td><td class="num">${m(a.totals.paid)}</td>${kind === 'conv' ? `<td class="num">${m(a.totals.principalPaid)}</td>` : ''}${kind === 'cap' ? `<td class="num">${m(a.totals.capitalized)}</td>` : ''}<td class="num">${m(a.totals.endBalance)}</td></tr>
    </tbody></table>`;
  }
  function stChart(R, keys) {
    const W = 640, H = 220, pl = 64, pr = 12, pt = 10, pb = 26;
    const N = R[keys[0]] ? R[keys[0]].rows.length : 0; if (!N) return '';
    const vals = keys.flatMap((k) => R[k].rows.map((r) => r.close)).concat(keys.map((k) => R[k].rows[0].open));
    const hi = Math.max(...vals), lo = Math.min(...vals), pad = Math.max((hi - lo) * 0.15, hi * 0.02);
    const max = hi + pad, min = Math.max(0, lo - pad);
    const x = (i) => pl + (W - pl - pr) * (i / N), y = (v) => pt + (H - pt - pb) * (max - v) / (max - min || 1);
    const step = (() => { const raw = (max - min) / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; })();
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solde du prêt dans le temps">`;
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v / 1000)} k</text>`;
    const ticks = Math.min(N, 6); for (let i = 0; i <= ticks; i++) { const k = Math.round(i * N / ticks); s += `<text x="${x(k)}" y="${H - 8}" text-anchor="middle">${k} m</text>`; }
    keys.forEach((k) => { const pts = [[0, R[k].rows[0].open]].concat(R[k].rows.map((r, i) => [i + 1, r.close])); s += `<polyline fill="none" stroke="${ST_COLOR[k]}" stroke-width="2.2" points="${pts.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')}"/>`; const [li, lv] = pts[pts.length - 1]; s += `<circle cx="${x(li)}" cy="${y(lv)}" r="3.5" fill="${ST_COLOR[k]}"><title>${ST_LABEL[k]} : ${T().m(lv)}</title></circle>`; });
    return s + '</svg>';
  }
  function stDoc() {
    const s = S.struct, R = stCalc(), { m, m0 } = T(), keys = ['conv', 'io', 'cap'].filter((k) => s.show[k]);
    const rate = { conv: s.convRate, io: s.ioRate, cap: s.capRate };
    const c = R.cmp;
    return docShell('Comparaison de structures de prêt', s.client, `
      <p>Montant du prêt : <b>${m(s.principal)}</b> · période analysée : <b>${s.months} mois</b> à partir de ${T().d(s.startDate)}.</p>
      <table class="doc-table"><thead><tr><th></th>${keys.map((k) => `<th class="num">${ST_LABEL[k]}<br><span class="small">${pct(rate[k])}</span></th>`).join('')}</tr></thead><tbody>
        <tr><td>Paiement mensuel</td>${keys.map((k) => `<td class="num">${m(k === 'cap' ? R[k].rows[0].paid : R[k].payment)}</td>`).join('')}</tr>
        <tr><td>Total payé pendant la période</td>${keys.map((k) => `<td class="num">${m(R[k].totals.paid)}</td>`).join('')}</tr>
        <tr><td>Intérêts</td>${keys.map((k) => `<td class="num">${m(R[k].totals.interest)}</td>`).join('')}</tr>
        ${keys.some((k) => R[k].totals.fees) ? `<tr><td>Frais de dossier</td>${keys.map((k) => `<td class="num">${m(R[k].totals.fees)}</td>`).join('')}</tr>` : ''}
        <tr class="sub"><td>Solde à la fin</td>${keys.map((k) => `<td class="num">${m(R[k].totals.endBalance)}</td>`).join('')}</tr>
        <tr class="grand"><td>Coût total (intérêts + frais)</td>${keys.map((k) => `<td class="num">${m(R[k].totals.totalCost)}</td>`).join('')}</tr>
      </tbody></table>
      ${s.show.cap ? `<h3>Intérêts partiels capitalisés comparés aux intérêts seulement (${pct(s.capRate)})</h3>
      <ul class="doc-list"><li>Paiement mensuel de ${m(c.cap.rows[0].paid)} au lieu de ${m(c.io.rows[0].paid)} : <b>${m0(c.cashSaved)}</b> de liquidités conservées sur ${s.months} mois.</li>
        <li>La partie non payée de l'intérêt s'ajoute au solde, qui passe à <b>${m0(c.cap.totals.endBalance)}</b> (+${m0(c.balanceIncrease)}).</li>
        <li>Coût additionnel de la capitalisation (intérêts sur les intérêts) : <b>${m0(c.extraCost)}</b>.</li></ul>` : ''}
      <div class="doc-chart">${stChart(R, keys)}</div>`);
  }

  /* ================================================================ CÉDULE DE PAIEMENT */
  function scCalc() {
    const s = S.sched;
    return C().amortize({ type: s.type, principal: n(s.principal), rate: n(s.rate) / 100, months: n(s.months), amortYears: n(s.amortYears), payment: n(s.payment), capMode: s.capMode, capRatio: n(s.capRatio) / 100, startDate: s.startDate, fees: n(s.principal) * n(s.feePct) / 100 });
  }
  function viewSched() {
    const s = S.sched, loans = T().data.loans;
    const form = group('Remplir à partir d\'un prêt', select('loanId', 'Prêt existant', s.loanId, [['', '— Choisir un prêt —']].concat(loans.map((l) => [l.id, l.name]))), 'Reprend le capital, le taux, le paiement et la date de début de la version actuelle du prêt.')
      + group('Client', field('client', 'Nom du client', s.client, { num: false }) + field('property', 'Propriété', s.property, { num: false, ph: 'Adresse' }))
      + group('Prêt', field('principal', 'Solde initial', s.principal, { suffix: '$' }) + field('rate', 'Taux annuel', s.rate, { suffix: '%' }) + dateField('startDate', 'Premier mois couvert', s.startDate)
        + field('months', 'Nombre de mois', s.months, { suffix: 'mois' })
        + select('type', 'Structure', s.type, [['cap', 'Intérêts partiels + capitalisés'], ['io', 'Intérêts seulement'], ['conv', 'Conventionnel (capital + intérêts)']])
        + (s.type === 'cap' ? select('capMode', 'Mode', s.capMode, [['fixed', 'Paiement mensuel fixe'], ['ratio', 'Pourcentage capitalisé']]) + (s.capMode === 'fixed' ? field('payment', 'Paiement mensuel', s.payment, { suffix: '$' }) : field('capRatio', "Part de l'intérêt capitalisée", s.capRatio, { suffix: '%' })) : '')
        + (s.type === 'conv' ? field('amortYears', 'Amortissement', s.amortYears, { suffix: 'ans' }) : '')
        + field('feePct', 'Frais de dossier', s.feePct, { suffix: '%' }))
      + group('Notes pour le client', `<label class="field span-all"><textarea id="tl-notes" data-tl="notes" rows="3" placeholder="Ex. : paiements par virement Interac le 1er de chaque mois.">${T().esc(s.notes)}</textarea></label>`);
    return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">${form}</form><div id="tl-results">${scResults()}</div></div>`;
  }
  function scTable(a, s) {
    const { m, d } = T();
    return `<table class="${'sched'}"><thead><tr><th>Mois</th><th>Période couverte</th><th>Payable le</th><th class="num">Solde au début</th><th class="num">Intérêt du mois</th><th class="num">Paiement</th>${s.type === 'cap' ? '<th class="num">Capitalisé</th>' : ''}${s.type === 'conv' ? '<th class="num">Capital</th>' : ''}<th class="num">Solde à la fin</th></tr></thead><tbody>
      ${a.rows.map((r) => `<tr><td>${r.n}</td><td class="small">${d(r.from)} au ${d(r.to)}</td><td class="small">${d(r.due)}</td><td class="num">${m(r.open)}</td><td class="num">${m(r.interest)}</td><td class="num"><b>${m(r.paid)}</b></td>${s.type === 'cap' ? `<td class="num">${m(r.capitalized)}</td>` : ''}${s.type === 'conv' ? `<td class="num">${m(r.principalPaid)}</td>` : ''}<td class="num">${m(r.close)}</td></tr>`).join('')}
      <tr class="total"><td colspan="4">Total</td><td class="num">${m(a.totals.interest)}</td><td class="num">${m(a.totals.paid)}</td>${s.type === 'cap' ? `<td class="num">${m(a.totals.capitalized)}</td>` : ''}${s.type === 'conv' ? `<td class="num">${m(a.totals.principalPaid)}</td>` : ''}<td class="num">${m(a.totals.endBalance)}</td></tr></tbody></table>`;
  }
  function scResults() {
    const s = S.sched, a = scCalc(), { m, m0, kpi } = T();
    return `<div class="kpis">${kpi('Paiement mensuel', m(a.rows[0]?.paid || 0), s.type === 'cap' ? `+ ${m(a.rows[0]?.capitalized || 0)} capitalisés le 1er mois` : '')}${kpi(`Total payé sur ${s.months} mois`, m0(a.totals.paid), `Intérêts ${m0(a.totals.interest)}`)}
      ${s.type === 'cap' ? kpi('Intérêts capitalisés', m0(a.totals.capitalized), 'Ajoutés au solde') : ''}${kpi('Solde à la fin', m0(a.totals.endBalance), `Au ${T().d(a.rows[a.rows.length - 1]?.to)}`)}</div>
      <section class="panel"><div class="panel-head"><h2>Cédule de paiement</h2><span class="small muted">Payable à terme échu : l'intérêt d'un mois se paie le 1er du mois suivant</span></div><div class="table-wrap">${scTable(a, s)}</div></section>`;
  }
  function scDoc() {
    const s = S.sched, a = scCalc(), { m, m0, esc } = T();
    const type = { cap: 'intérêts partiels avec capitalisation du solde des intérêts', io: 'intérêts seulement', conv: 'paiements de capital et intérêts' }[s.type];
    return docShell('Cédule de paiement', s.client, `
      ${s.property ? `<p><b>Propriété :</b> ${esc(s.property)}</p>` : ''}
      <div class="doc-kpis"><div><span>Solde initial</span><b>${m0(s.principal)}</b></div><div><span>Taux annuel</span><b>${pct(s.rate)}</b></div><div><span>Paiement mensuel</span><b>${m(a.rows[0]?.paid || 0)}</b></div><div><span>Solde après ${s.months} mois</span><b>${m0(a.totals.endBalance)}</b></div></div>
      <p>Structure : ${type}.${s.type === 'cap' ? " Chaque mois, la partie de l'intérêt qui n'est pas payée s'ajoute au solde du prêt; l'intérêt du mois suivant est calculé sur ce solde augmenté." : ''} Chaque paiement couvre l'intérêt du mois précédent et est payable le 1er du mois.</p>
      ${scTable(a, s).replace('<table class="sched">', '<table class="doc-table sched">')}
      ${s.notes ? `<h3>Notes</h3><p>${esc(s.notes).replace(/\n/g, '<br>')}</p>` : ''}`);
  }
  function fillFromLoan(id) {
    const l = T().loanById(id); if (!l) return;
    const v = l.versions[l.versions.length - 1], s = S.sched;
    Object.assign(s, { loanId: id, client: l.borrower || '', property: l.name.split(' — ')[1] ? `${l.name.split(' — ')[1]}${l.city ? `, ${l.city}` : ''}` : (l.city || ''), principal: v.principal, rate: E2(v.rate * 100), startDate: v.from.slice(0, 8) + '01' });
    if (v.capitalize && v.monthly != null) Object.assign(s, { type: 'cap', capMode: 'fixed', payment: v.monthly });
    else Object.assign(s, { type: 'io' });
    if (l.maturity) { const [y1, m1] = v.from.split('-').map(Number), [y2, m2] = l.maturity.split('-').map(Number); s.months = Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1); }
  }
  const E2 = (x) => Math.round(x * 1000) / 1000;

  /* ================================================================ TAXES DE BIENVENUE */
  function viewTax() {
    const t = S.tax, c = cityOf(t.city), wt = C().welcomeTax(t.price, c.brackets), { m, m0, esc } = T();
    const edited = !!T().data.welcomeTax;
    return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">
      ${group('Calculer', select('city', 'Ville', t.city, taxTable().map((x) => x.name)) + field('price', "Prix d'achat", t.price, { suffix: '$' }))}
      ${group('Gérer le barème', `<p class="hint">Les barèmes viennent de votre classeur (2026). Modifiez une tranche directement dans le tableau, ajoutez une ville, ou revenez aux valeurs d'origine.</p>
        <div class="toolbar"><input type="text" id="tl-newcity" placeholder="Nouvelle ville" style="width:180px"><button class="btn small" data-tlact="addcity">Ajouter (barème provincial)</button></div>
        ${edited ? '<button class="btn small danger" data-tlact="taxreset">Revenir au barème d\'origine</button>' : ''}`)}
    </form><div id="tl-results">
      <div class="kpis">${kpi2('Taxe de bienvenue', m(wt.total), `${esc(c.name)} · ${m0(t.price)}`)}${kpi2('Taux effectif', t.price ? `${(wt.total / n(t.price) * 100).toLocaleString('fr-CA', { maximumFractionDigits: 2 })} %` : '—', esc(c.status || ''))}</div>
      <section class="panel"><div class="panel-head"><h2>Barème — ${esc(c.name)}</h2><span class="small muted">${esc([c.status, c.source].filter(Boolean).join(' · '))}</span></div><div class="table-wrap"><table><thead><tr><th>De ($)</th><th>À ($)</th><th class="num">Taux (%)</th><th class="num">Montant imposé</th><th class="num">Taxe</th><th></th></tr></thead><tbody>
        ${c.brackets.map((b, i) => `<tr><td><input type="text" class="num" data-br="${i}" data-bk="0" value="${b[0]}" aria-label="De"></td><td><input type="text" class="num" data-br="${i}" data-bk="1" value="${b[1] == null ? '' : b[1]}" placeholder="et plus" aria-label="À"></td><td><input type="text" class="num" data-br="${i}" data-bk="2" value="${E2(b[2] * 100)}" aria-label="Taux"></td><td class="num">${m(wt.rows[i].base)}</td><td class="num">${m(wt.rows[i].tax)}</td><td><button class="icon-btn" data-tlact="delbr" data-i="${i}" aria-label="Retirer la tranche" ${c.brackets.length < 2 ? 'disabled' : ''}>×</button></td></tr>`).join('')}
        <tr class="total"><td colspan="4">Total</td><td class="num">${m(wt.total)}</td><td></td></tr></tbody></table></div>
        <div class="panel-body"><button class="btn small" data-tlact="addbr">+ Ajouter une tranche</button></div></section>
      <section class="panel"><div class="panel-head"><h2>Comparer les villes pour ${m0(t.price)}</h2></div><div class="table-wrap"><table><thead><tr><th>Ville</th><th class="num">Taxe</th><th>Statut</th></tr></thead><tbody>
        ${taxTable().map((x) => ({ x, v: C().welcomeTax(t.price, x.brackets).total })).sort((a, b) => b.v - a.v || a.x.name.localeCompare(b.x.name, 'fr')).map(({ x, v }) => `<tr class="clickable" data-tlact="pickcity" data-k="${esc(x.name)}"><td>${esc(x.name)}</td><td class="num">${m(v)}</td><td class="small muted">${esc(x.status || '')}</td></tr>`).join('')}
      </tbody></table></div></section></div></div>`;
  }
  const kpi2 = (l, v, s) => T().kpi(l, v, s);
  function editableTax() { if (!T().data.welcomeTax) T().data.welcomeTax = JSON.parse(JSON.stringify(window.TF_WELCOME_TAX)); return T().data.welcomeTax; }

  /* ================================================================ DOCUMENT CLIENT */
  function docShell(title, client, body, foot, dateIso) {
    const b = S.brand, ent = b.name || T().data.entity || '';
    return `<article class="doc-page">
      <header class="doc-head"><div><div class="doc-brand">${T().esc(ent)}</div>${b.contact ? `<div class="doc-contact">${T().esc(b.contact)}</div>` : ''}</div><div class="doc-meta">${T().d(dateIso || T().todayISO)}</div></header>
      <h1>${title}</h1>${client ? `<p class="doc-client">Préparé pour <b>${T().esc(client)}</b></p>` : ''}
      ${body}
      <footer class="doc-foot">${foot || "Document informatif préparé à titre d'estimation. Les montants réels (pénalité, taxes, frais) doivent être confirmés par les professionnels concernés (institution financière, municipalité, notaire, courtier)."}</footer>
    </article>`;
  }
  function openDoc() {
    const t = S.tool, html = t === 'equity' ? eqDoc() : t === 'struct' ? stDoc() : t === 'letter' ? window.TFLetter.letter(letterState()) : t === 'amort' ? window.TFAmort.doc(amortState()) : scDoc();
    const el = $('#doc');
    const land = S.docLandscape && S.docLandscape[t];
    let ps = document.getElementById('doc-page-size'); if (!ps) { ps = document.createElement('style'); ps.id = 'doc-page-size'; document.head.appendChild(ps); }
    ps.textContent = `@page { size: letter ${land ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    document.body.classList.toggle('doc-landscape', !!land);
    el.innerHTML = `<div class="doc-toolbar"><div class="toolbar">
        ${t === 'amort' || t === 'sched' ? `<div class="seg" role="group"><button type="button" data-docact="portrait" class="${land ? '' : 'on'}">Portrait</button><button type="button" data-docact="landscape" class="${land ? 'on' : ''}">Paysage</button></div>` : ''}
        <label class="small">Nom affiché <input type="text" id="tl-brand-name" value="${T().esc(S.brand.name || T().data.entity || '')}" style="width:220px"></label>
        <label class="small">Coordonnées <input type="text" id="tl-brand-contact" value="${T().esc(S.brand.contact || '')}" placeholder="Téléphone · courriel" style="width:240px"></label></div>
        <div class="toolbar">${window.FIN_ARTIFACT ? '<span class="small muted">Impression non disponible dans la version publiée : utilisez la version du dossier pour imprimer ou enregistrer en PDF.</span>' : '<button class="btn primary" data-docact="print">Imprimer / PDF</button>'}<button class="btn" data-docact="close">Fermer</button></div></div>
      <div class="doc-scroll">${html}</div>`;
    el.hidden = false; document.body.classList.add('doc-open');
  }
  function closeDoc() { $('#doc').hidden = true; document.body.classList.remove('doc-open'); }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-docact]'); if (!a) return;
    if (a.dataset.docact === 'print') window.print();
    else if (a.dataset.docact === 'portrait' || a.dataset.docact === 'landscape') { S.docLandscape = Object.assign({}, S.docLandscape, { [S.tool]: a.dataset.docact === 'landscape' }); saveState(); openDoc(); }
    else closeDoc();
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'tl-brand-name' || ev.target.id === 'tl-brand-contact') { S.brand[ev.target.id === 'tl-brand-name' ? 'name' : 'contact'] = ev.target.value; saveState(); openDoc(); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#doc').hidden) closeDoc(); });

  /* ================================================================ GESTION DES SCÉNARIOS */
  const TOOL_NAME = Object.fromEntries(TOOLS);
  let showArchived = false;
  function openManage() {
    const { esc, d } = T();
    const list = (T().data.toolScenarios || []).filter((x) => x.tool === S.tool).sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || b.savedAt.localeCompare(a.savedAt));
    const shown = list.filter((x) => showArchived || !x.archived), nArch = list.filter((x) => x.archived).length;
    T().modalState = { kind: 'scen' };
    T().openModal(`Scénarios — ${TOOL_NAME[S.tool]}`, `
      <div class="toolbar" style="justify-content:space-between"><span class="hint">Renommez un scénario directement dans la case. Un scénario archivé n'apparaît plus dans la liste, mais reste dans vos données.</span>
        ${nArch ? `<label class="check small"><input type="checkbox" data-scact="toggle-arch" ${showArchived ? 'checked' : ''}> Afficher les archivés (${nArch})</label>` : ''}</div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Enregistré</th><th>État</th><th></th></tr></thead><tbody>
        ${shown.map((x) => `<tr class="${x.archived ? 'muted' : ''}">
          <td style="min-width:220px"><input type="text" id="scn-${x.id}" data-screname="${x.id}" value="${esc(x.name)}" aria-label="Nom du scénario"></td>
          <td class="small" style="white-space:nowrap">${d(x.savedAt.slice(0, 10))}</td>
          <td>${x.archived ? '<span class="pill none">Archivé</span>' : '<span class="pill active">Actif</span>'}</td>
          <td style="white-space:nowrap;text-align:right"><button class="btn small" data-scact="load" data-id="${x.id}">Charger</button>
            <button class="btn small" data-scact="${x.archived ? 'unarchive' : 'archive'}" data-id="${x.id}">${x.archived ? 'Désarchiver' : 'Archiver'}</button>
            <button class="btn small danger" data-scact="delete" data-id="${x.id}">Supprimer</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${list.length ? 'Tous les scénarios sont archivés. Cochez « Afficher les archivés » pour les voir.' : 'Aucun scénario enregistré pour cet outil.'}</div>`}`,
      '<div></div><div class="toolbar"><button class="btn" data-close>Fermer</button></div>');
  }
  const scenById = (id) => (T().data.toolScenarios || []).find((x) => x.id === id);
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-scact]'); if (!a) return;
    const act = a.dataset.scact, sc = scenById(a.dataset.id);
    if (act === 'toggle-arch') { showArchived = a.checked; return openManage(); }
    if (!sc) return;
    if (act === 'load') { S[sc.tool] = JSON.parse(JSON.stringify(sc.inputs)); saveState(); T().closeModal(); T().toast(`Scénario « ${sc.name} » chargé`); return rerender(); }
    if (act === 'archive' || act === 'unarchive') { if (act === 'archive') sc.archived = true; else delete sc.archived; T().persist(act === 'archive' ? `« ${sc.name} » archivé` : `« ${sc.name} » désarchivé`); T().render(); return openManage(); }
    if (act === 'delete') {
      if (!a.classList.contains('armed')) { a.classList.add('armed'); a.textContent = 'Confirmer'; setTimeout(() => { if (a.isConnected) { a.classList.remove('armed'); a.textContent = 'Supprimer'; } }, 3500); return; }
      T().data.toolScenarios = T().data.toolScenarios.filter((x) => x.id !== sc.id); T().persist(`« ${sc.name} » supprimé`); T().render(); return openManage();
    }
  });
  document.addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.screname; if (!id) return;
    const sc = scenById(id), name = ev.target.value.trim();
    if (!sc) return;
    if (!name) { ev.target.value = sc.name; return T().toast('Le nom ne peut pas être vide'); }
    sc.name = name; T().persist('Scénario renommé'); T().render();
  });

  /* ================================================================ ÉTAT DE COMPTE D'UN PRÊT */
  // Pour le client ou le notaire : mois couverts, paiements reçus, intérêts impayés, intérêt journalier
  // et montant requis pour rembourser le prêt à une date donnée.
  let STMT = null;
  const dim = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  function statementCalc() {
    const { E, data } = T(), loan = T().loanById(STMT.loanId);
    if (loan.closedOn && STMT.payoff > loan.closedOn) STMT.payoff = loan.closedOn;
    const st = STMT, payM = st.payoff.slice(0, 7), start = loan.versions[0].from;
    const sch = E.schedule(data, loan.id, st.asOf, 36);
    const payRow = sch.rows.find((r) => r.period === payM);
    const ledger = E.balances(data, st.payoff)[`loans|${loan.id}`] || 0;
    const principal = payRow ? payRow.principal : ledger;
    const rate = payRow && payRow.rate != null ? payRow.rate : (loan.versions[loan.versions.length - 1] || {}).rate || 0;
    const monthlyInt = payRow ? (payRow.adjustment ? payRow.expected : payRow.expectedCalc) : principal * rate / 12;
    const perDiem = st.basis === 'month' ? monthlyInt / dim(st.payoff) : principal * rate / Number(st.basis);
    const days = Number(st.payoff.slice(8, 10)) - (start.slice(0, 7) === payM ? Number(start.slice(8, 10)) - 1 : 0);
    const accrued = perDiem * days;
    const lines = sch.rows.filter((r) => r.period <= payM || r.received > 0).map((r) => {
      const past = r.period < payM, cur = r.period === payM;
      const due = past ? r.expected : cur ? accrued : 0;
      let status;
      if (cur) status = r.received >= due - 0.5 ? (r.received > due + 0.5 ? 'credit' : 'paid') : 'accruing';
      else if (!past) status = 'prepaid';
      else status = r.received >= r.expected - 0.5 ? (r.adjustment ? 'adjusted' : 'paid') : r.received > 0 ? 'partial' : 'unpaid';
      const from = r.period === start.slice(0, 7) ? start : `${r.period}-01`;
      const to = cur ? st.payoff : loan.closedOn && loan.closedOn.slice(0, 7) === r.period ? loan.closedOn : `${r.period}-${String(dim(r.period + '-01')).padStart(2, '0')}`;
      return { ...r, due: C().r2(due), balance: C().r2(due - r.received), status, cur, past, days: cur ? days : null, from, to };
    });
    const arrears = C().r2(lines.filter((l) => l.past).reduce((a, l) => a + Math.max(0, l.balance), 0));
    const overpaidPast = C().r2(lines.filter((l) => l.past).reduce((a, l) => a + Math.max(0, -l.balance), 0));
    const curLine = lines.find((l) => l.cur);
    const accruedOwing = C().r2(curLine ? curLine.balance : accrued);
    const prepaidCredit = C().r2(lines.filter((l) => !l.past && !l.cur).reduce((a, l) => a + l.received, 0));
    const feeLines = (st.feeItems || []).map((f) => ({ ...f, amt: C().r2(f.unit === '%' ? principal * n(f.value) / 100 : n(f.value)) })).filter((f) => f.amt);
    const fees = C().r2(feeLines.reduce((a, f) => a + f.amt, 0));
    const total = C().r2(principal + arrears + accruedOwing - prepaidCredit + fees);
    const missed = lines.filter((l) => l.past && (l.status === 'unpaid' || l.status === 'partial'));
    return { loan, principal: C().r2(principal), rate, perDiem: C().r2(perDiem), perDiemRaw: perDiem, days, accrued: C().r2(accrued), lines, arrears, overpaidPast, accruedOwing, prepaidCredit, fees, feeLines, total, missed, sch };
  }
  const ST_LBL = { paid: ['paid', 'Payé'], partial: ['partial', 'Partiel'], unpaid: ['late', 'Non payé'], accruing: ['upcoming', 'Intérêts courus'], credit: ['over', 'Payé (crédit)'], prepaid: ['over', "Payé d'avance"], adjusted: ['paid', 'Payé (montant ajusté)'] };
  function statementDoc() {
    const r = statementCalc(), st = STMT, { m, m0, d, esc } = T(), l = r.loan;
    const v0 = l.versions[0];
    const recipient = st.recipient ? `<p class="doc-client">À l'attention de <b>${esc(st.recipient)}</b></p>` : '';
    const perDayRows = []; for (let k = Number(st.payoff.slice(8, 10)); k <= dim(st.payoff); k++) { const dt = `${st.payoff.slice(0, 8)}${String(k).padStart(2, '0')}`; const kk = k - (Number(st.payoff.slice(8, 10)) - r.days), acc = r.perDiemRaw * kk; perDayRows.push({ dt, k: kk, acc, total: r.principal + r.arrears + (acc - (r.lines.find((x) => x.cur) || { received: 0 }).received) - r.prepaidCredit + r.fees }); }
    return docShell(`État de compte — ${esc(l.name)}`, l.borrower, `
      ${recipient}
      <table class="doc-table"><tbody>
        <tr><td>Emprunteur</td><td>${esc(l.borrower || '')}</td><td>Dossier</td><td>${l.dossier ? `n° ${l.dossier}` : '—'}</td></tr>
        <tr><td>Propriété</td><td>${esc(l.name.split(' — ').find((p) => p !== l.borrower) || l.name)}${l.city ? `, ${esc(l.city)}` : ''}</td><td>Date de début</td><td>${d(v0.from)}</td></tr>
        <tr><td>Capital au ${d(st.payoff)}</td><td class="num" style="text-align:left">${m(r.principal)}</td><td>Taux annuel</td><td>${(r.rate * 100).toLocaleString('fr-CA', { maximumFractionDigits: 3 })} %</td></tr>
        <tr><td>Intérêt journalier (per diem)</td><td class="num" style="text-align:left"><b>${m(r.perDiemRaw)}</b></td><td>Échéance</td><td>${l.maturity ? d(l.maturity) : '—'}</td></tr>
      </tbody></table>
      <div class="doc-kpis"><div><span>Intérêts impayés (mois échus)</span><b>${m(r.arrears)}</b></div><div><span>Intérêts du mois en cours, nets des paiements reçus (${r.days} j)</span><b>${m(r.accruedOwing)}</b></div><div><span>Montant requis pour rembourser au ${d(st.payoff)}</span><b>${m(r.total)}</b></div></div>
      ${r.missed.length ? `<p class="doc-alert">Paiement${r.missed.length > 1 ? 's' : ''} manquant${r.missed.length > 1 ? 's' : ''} : ${r.missed.map((x) => `${x.label} (${m(x.balance)})`).join(', ')}.</p>` : ''}
      <h3>Intérêts par période couverte</h3>
      <table class="doc-table stmt"><thead><tr><th>Période couverte</th><th class="num">Capital</th><th class="num">Intérêt dû</th><th>Payé le</th><th class="num">Montant reçu</th><th class="num">Solde</th><th>Statut</th></tr></thead><tbody>
        ${r.lines.map((x) => `<tr><td>${d(x.from)} au ${d(x.to)}${x.cur ? ` <span class="small">(${x.days} j)</span>` : ''}</td>
          <td class="num">${m0(x.principal)}</td><td class="num">${x.past || x.cur ? m(x.due) : '—'}</td><td class="small">${x.payments.map((p) => d(p.date)).join('<br>') || '—'}</td>
          <td class="num">${x.payments.length ? x.payments.map((p) => m(p.amt)).join('<br>') : m(0)}</td><td class="num">${x.past || x.cur ? m(x.balance) : m(-x.received)}</td><td>${ST_LBL[x.status][1]}</td></tr>`).join('')}
      </tbody></table>
      <h3>Montant requis pour rembourser le prêt au ${d(st.payoff)}</h3>
      <table class="doc-table"><tbody>
        <tr><td>Capital${r.sch.capitalizedTotal ? ' (incluant les intérêts capitalisés)' : ''}</td><td class="num">${m(r.principal)}</td></tr>
        <tr><td>+ Intérêts impayés des mois échus</td><td class="num">${m(r.arrears)}</td></tr>
        <tr><td>+ Intérêts courus du ${d((r.lines.find((x) => x.cur) || {}).from || st.payoff.slice(0, 8) + '01')} au ${d(st.payoff)} (${r.days} jours × ${m(r.perDiemRaw)})${(r.lines.find((x) => x.cur) || {}).received ? ', moins le montant déjà reçu pour ce mois' : ''}</td><td class="num">${m(r.accruedOwing)}</td></tr>
        ${r.prepaidCredit ? `<tr><td>− Intérêts payés d'avance pour des mois suivants</td><td class="num">${m(-r.prepaidCredit)}</td></tr>` : ''}
        ${r.feeLines.map((f) => `<tr><td>+ ${esc(f.label || 'Frais')}${f.unit === '%' ? ` (${n(f.value).toLocaleString('fr-CA', { maximumFractionDigits: 3 })} % du capital de ${m(r.principal)})` : ''}</td><td class="num">${m(f.amt)}</td></tr>`).join('')}
        <tr class="grand"><td>Total requis au ${d(st.payoff)}</td><td class="num">${m(r.total)}</td></tr>
      </tbody></table>
      <p>Pour un remboursement à une autre date du mois, ajoutez <b>${m(r.perDiemRaw)}</b> par jour d'intérêt (${st.basis === 'month' ? 'intérêt du mois ÷ nombre de jours du mois' : `capital × taux ÷ ${st.basis} jours`}).</p>
      <h3>Montant requis selon la date de remboursement</h3>
      <div class="table-wrap"><table class="doc-table perdiem"><thead><tr><th>Date</th><th class="num">Jours courus</th><th class="num">Intérêts courus</th><th class="num">Total requis</th></tr></thead><tbody>
        ${perDayRows.map((x) => `<tr><td>${d(x.dt)}</td><td class="num">${x.k}</td><td class="num">${m(x.acc)}</td><td class="num">${m(x.total)}</td></tr>`).join('')}
      </tbody></table></div>`,
      `État de compte au ${d(st.asOf)}, préparé à partir des paiements reçus et des modalités du prêt. Le montant requis pour rembourser est valide pour la date indiquée; un intérêt de ${m(r.perDiemRaw)} s'ajoute par jour additionnel. Sous réserve de tout paiement reçu après la date de l'état.`, st.asOf);
  }
  function openStatement(loanId) {
    const t = T().todayISO;
    const cl = T().loanById(loanId).closedOn;
    if (!STMT || STMT.loanId !== loanId) STMT = { loanId, asOf: t, payoff: cl && cl < t ? cl : t, basis: '365', feeItems: [{ label: 'Frais de quittance', value: 0, unit: '$' }, { label: 'Frais de dossier', value: 0, unit: '%' }], recipient: '' };
    renderStatement();
  }
  function renderStatement() {
    const st = STMT, el = $('#doc'), { esc } = T();
    el.innerHTML = `<div class="doc-toolbar"><div class="toolbar">
        <label class="small">État au <input type="date" data-stmt="asOf" value="${st.asOf}"></label>
        <label class="small">Remboursement prévu le <input type="date" data-stmt="payoff" value="${st.payoff}"></label>
        <label class="small">Intérêt journalier <select data-stmt="basis"><option value="365" ${st.basis === '365' ? 'selected' : ''}>capital × taux ÷ 365</option><option value="360" ${st.basis === '360' ? 'selected' : ''}>capital × taux ÷ 360</option><option value="month" ${st.basis === 'month' ? 'selected' : ''}>intérêt du mois ÷ jours du mois</option></select></label>
        <label class="small">Destinataire <input type="text" data-stmt="recipient" value="${esc(st.recipient)}" placeholder="Ex. : Me Tremblay, notaire" style="width:190px"></label>
        ${st.feeItems.map((f, i) => `<label class="small"><input type="text" data-stmt="fee.${i}.label" value="${esc(f.label)}" style="width:130px" aria-label="Libellé du frais"> <input type="text" class="num" data-stmt="fee.${i}.value" value="${f.value}" style="width:70px" aria-label="Montant ou pourcentage"> <select data-stmt="fee.${i}.unit" aria-label="Unité" style="width:auto"><option value="$" ${f.unit === '$' ? 'selected' : ''}>$</option><option value="%" ${f.unit === '%' ? 'selected' : ''}>% du capital</option></select></label>`).join('')}</div>
        <div class="toolbar">${window.FIN_ARTIFACT ? '<span class="small muted">Impression : utilisez la version du dossier.</span>' : '<button class="btn primary" data-docact="print">Imprimer / PDF</button>'}<button class="btn" data-docact="close">Fermer</button></div></div>
      <div class="doc-scroll">${statementDoc()}</div>`;
    el.hidden = false; document.body.classList.add('doc-open');
  }
  document.addEventListener('change', (ev) => {
    const k = ev.target.dataset && ev.target.dataset.stmt; if (!k || !STMT) return;
    if (k.startsWith('fee.')) { const [, i, f] = k.split('.'); STMT.feeItems[i][f] = ev.target.value; renderStatement(); return; }
    STMT[k] = ev.target.value; if (k === 'asOf' && STMT.payoff < STMT.asOf) STMT.payoff = STMT.asOf; renderStatement();
  });

  /* ================================================================ RENDU ET ÉVÉNEMENTS */
  function view() {
    const t = S.tool;
    const body = t === 'equity' ? viewEquity() : t === 'struct' ? viewStruct() : t === 'sched' ? viewSched() : t === 'letter' ? viewLetter() : t === 'amort' ? viewAmort() : viewTax();
    return `<div class="tools">${header()}${body}</div>`;
  }
  const stateFor = () => (S.tool === 'equity' ? S.equity : S.tool === 'struct' ? S.struct : S.tool === 'sched' ? S.sched : S.tool === 'letter' ? letterState() : S.tool === 'amort' ? amortState() : S.tax);
  function viewAmort() { const s = amortState(); return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">${window.TFAmort.form(s)}</form><div id="tl-results">${window.TFAmort.results(s)}</div></div>`; }
  function viewLetter() { const s = letterState(); return `<div class="tl-grid"><form class="tl-form" onsubmit="return false">${window.TFLetter.form(s)}</form><div id="tl-results">${window.TFLetter.results(s)}</div></div>`; }
  function refreshResults() {
    const el = $('#tl-results'); if (!el) return;
    el.innerHTML = S.tool === 'equity' ? eqResults() : S.tool === 'struct' ? stResults() : S.tool === 'sched' ? scResults() : S.tool === 'letter' ? window.TFLetter.results(letterState()) : S.tool === 'amort' ? window.TFAmort.results(amortState()) : '';
    if (S.tool === 'letter' || S.tool === 'amort') saveState();
    if (S.tool === 'tax') T().render();
  }
  function rerender(keepFocusId) { T().render(); if (keepFocusId) { const el = document.getElementById(keepFocusId); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } } }
  let tmr;
  const view$ = () => $('#view');
  document.addEventListener('input', (ev) => {
    const t = ev.target; if (!t.closest || !t.closest('.tools')) return;
    if (t.dataset.tl && !t.dataset.full) { stateFor()[t.dataset.tl] = t.value; saveState(); clearTimeout(tmr); tmr = setTimeout(S.tool === 'tax' ? () => rerender(t.id) : refreshResults, 250); }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target; if (!t.closest || !t.closest('.tools')) return;
    if (t.dataset.tl && t.dataset.full) {
      stateFor()[t.dataset.tl] = t.value;
      if (S.tool === 'sched' && t.dataset.tl === 'loanId' && t.value) fillFromLoan(t.value);
      if (S.tool === 'equity' && t.dataset.tl === 'notaryChoice') S.equity.notary = t.value === 'Achat' ? 1700 : t.value === 'Achat + financement' ? 3700 : S.equity.notary;
      saveState(); return rerender();
    }
    if (t.dataset.tlshow) { S.struct.show[t.dataset.tlshow] = t.checked; if (!Object.values(S.struct.show).some(Boolean)) S.struct.show.cap = true; saveState(); return rerender(); }
    if (t.id === 'tl-scen' && t.value) { const sc = (T().data.toolScenarios || []).find((x) => x.id === t.value); if (sc) { S[sc.tool] = JSON.parse(JSON.stringify(sc.inputs)); saveState(); T().toast(`Scénario « ${sc.name} » chargé`); rerender(); } return; }
    if (t.dataset.br != null) {
      const c = editableTax().find((x) => x.name === S.tax.city), b = c.brackets[+t.dataset.br], k = +t.dataset.bk;
      b[k] = k === 2 ? n(t.value) / 100 : (t.value.trim() === '' && k === 1 ? null : n(t.value));
      c.status = 'Modifié manuellement'; T().persist('Barème modifié'); return rerender();
    }
  });
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-tlact]'); if (!a || !a.closest('.tools')) return;
    const act = a.dataset.tlact;
    if (act === 'tool') { S.tool = a.dataset.k; saveState(); return rerender(); }
    if (act === 'detail' || act === 'period') { S.struct[act] = a.dataset.k; saveState(); return refreshResults(); }
    if (act === 'doc') return openDoc();
    if (act === 'reset') {
      if (!a.classList.contains('armed')) { a.classList.add('armed', 'danger'); a.textContent = 'Confirmer'; setTimeout(() => { a.classList.remove('armed', 'danger'); a.textContent = 'Valeurs par défaut'; }, 3500); return; }
      S[S.tool] = JSON.parse(JSON.stringify(S.tool === 'letter' ? window.TFLetter.DEFAULTS : S.tool === 'amort' ? window.TFAmort.DEFAULTS : DEFAULTS[S.tool])); saveState(); return rerender();
    }
    if (act === 'save') {
      const st = stateFor(), name = (st.client || '').trim() || `Scénario du ${T().d(T().todayISO)}`;
      const list = T().data.toolScenarios = T().data.toolScenarios || [];
      const ex = list.find((x) => x.tool === S.tool && x.name === name && !x.archived);
      const rec = { id: ex ? ex.id : `sc${Date.now().toString(36)}`, tool: S.tool, name, ...(ex && ex.createdAt ? { createdAt: ex.createdAt } : { createdAt: new Date().toISOString() }), inputs: JSON.parse(JSON.stringify(st)), savedAt: new Date().toISOString() };
      if (ex) Object.assign(ex, rec); else list.push(rec);
      T().persist(`Scénario « ${name} » enregistré`); return rerender();
    }
    if (act === 'manage') return openManage();
    if (act === 'pickcity') { S.tax.city = a.dataset.k; saveState(); return rerender(); }
    if (act === 'addbr') { const c = editableTax().find((x) => x.name === S.tax.city); const last = c.brackets[c.brackets.length - 1]; const from = last[1] == null ? last[0] + 100000 : last[1]; if (last[1] == null) last[1] = from; c.brackets.push([from, null, last[2]]); T().persist('Tranche ajoutée'); return rerender(); }
    if (act === 'delbr') { const c = editableTax().find((x) => x.name === S.tax.city); c.brackets.splice(+a.dataset.i, 1); c.brackets[c.brackets.length - 1][1] = null; T().persist('Tranche retirée'); return rerender(); }
    if (act === 'addcity') { const nm = ($('#tl-newcity').value || '').trim(); if (!nm) return T().toast('Indiquez le nom de la ville'); const tb = editableTax(); if (tb.some((x) => x.name.toLowerCase() === nm.toLowerCase())) return T().toast('Cette ville existe déjà'); tb.push({ name: nm, status: 'Ajoutée manuellement', source: '', brackets: JSON.parse(JSON.stringify(tb.find((x) => x.name === 'Standard Québec').brackets)) }); S.tax.city = nm; saveState(); T().persist('Ville ajoutée'); return rerender(); }
    if (act === 'taxreset') { if (!a.classList.contains('armed')) { a.classList.add('armed'); a.textContent = 'Confirmer'; return; } delete T().data.welcomeTax; T().persist("Barème d'origine rétabli"); return rerender(); }
  });

  window.TFTools = { view, state: () => S, rerender: () => rerender(), refresh: refreshResults, docShell, openStatement, statementCalc: (st) => { STMT = st; return statementCalc(); } };
})();

/* Signatures par défaut pour la lettre d'approbation (PNG encodés). */
window.TF_SIGNATURES = { jonathan: 'data:image/png;base64,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', marc: 'data:image/png;base64,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' };

/* Outil « Lettre d'approbation » : formulaire + lettre d'une page (aperçu, impression / PDF).
   Branché dans tools.js (onglet Outils). État : S.letter; scénarios enregistrables comme les autres outils. */
(function () {
  'use strict';
  const T = () => window.TF, K = () => window.TFToolsKit, $ = (s, r = document) => r.querySelector(s);
  const n = (x) => { const v = parseFloat(String(x ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
  const esc = (s) => T().esc(s);
  const money = (v, dec = 0) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: dec, minimumFractionDigits: dec }).format(v);
  const longDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d === 1 ? '1er' : d} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][m - 1]} ${y}`; };
  const RANK_TXT = { '1er rang': 'premier rang', '2e rang': 'deuxième rang', '3e rang': 'troisième rang', 'Sans garantie': '' };

  const DEFAULTS = {
    client: '', date: '', place: 'Terrebonne', borrower1: '', borrower2: '', company: '', dossierId: '',
    subject: 'Financement Privé - Approbation Hypothécaire', txType: 'Financement', rank: '2e rang',
    propAddress: '', propCity: '', propPostal: '', propValue: '', purchasePrice: '', downPayment: '',
    lender: '', amount: '', amountNote: '', rate: '', payMode: 'io', payment: '', feePct: 1, feeFixed: '',
    termText: '6 mois (renouvelable au même taux d\'intérêt)', repayText: 'En tout temps, sous réserve d\'un minimum de 6 mois d\'intérêts perçus par le prêteur',
    partialText: '', footnote: '',
    g: [{ rank: '2e rang', address: '', lot: '' }, { rank: '', address: '', lot: '' }, { rank: '', address: '', lot: '' }],
    insurance: 'au nom des propriétaires avec {lender} à titre de créancier hypothécaire',
    notary: 'Les frais de notaire ainsi que les frais de dossier seront payables par l\'emprunteur chez le notaire à partir du déboursé du prêteur.',
    funds: '', other: '', approval: true, validUntil: '',
    s1: { name: 'Jonathan Mireault', company: '9397-8187 Québec inc.', address: '694 rue de la Mistassini, Terrebonne, QC J6W 5H2', phone: '514-433-1021', email: 'jonathan.mireault@outlook.com', show: true, sig: 'jonathan' },
    s2: { name: 'Marc Beaudoin', company: '', address: '474 Montée du Val-de-Loire, Saint-Adolphe-d\'Howard, QC J0T 2B0', phone: '514-953-4606', email: 'marc.beaudoin@hotmail.com', show: true, sig: 'marc' },
  };

  function calc(s) {
    const amount = n(s.amount), rate = n(s.rate) / 100, monthlyInt = amount * rate / 12;
    const fee = s.feeFixed !== '' && s.feeFixed != null ? n(s.feeFixed) : amount * n(s.feePct) / 100;
    let payText;
    if (s.payMode === 'cap') { const paid = n(s.payment) || monthlyInt, cap = Math.max(0, monthlyInt - paid); payText = `${money(monthlyInt)}, soit ${money(paid)} d'intérêts payables mensuellement et ${money(cap)} d'intérêts capitalisés`; }
    else if (s.payMode === 'pi') payText = `${money(n(s.payment) || monthlyInt)} (capital et intérêts)`;
    else payText = `${money(monthlyInt)} (intérêts seulement)`;
    const ltv = n(s.propValue) ? amount / n(s.propValue) : null;
    return { amount, monthlyInt, fee, payText, ltv };
  }
  const lenderName = (s) => s.lender || T().data.entity || '';
  const fullAddress = (s) => [s.propAddress, s.propCity, s.propPostal ? `QC ${s.propPostal}` : ''].filter(Boolean).join(', ');

  /* ---------- préremplissage depuis un dossier Terreno ---------- */
  function fillFromDossier(s, id) {
    const D = T().data, ds = (D.dossiers || []).find((x) => x.id === id); if (!ds) return;
    const props = (ds.properties || []).map((pid) => (D.properties || []).find((p) => p.id === pid)).filter(Boolean), p = props[0];
    const names = String(ds.contact || '').split(/\s*(?:&|,| et )\s*/).filter(Boolean);
    Object.assign(s, { dossierId: id, client: ds.contact || '', borrower1: names[0] || ds.contact || '', borrower2: names[1] || '', lender: s.lender || T().data.entity || '',
      rank: ds.rank && RANK_TXT[ds.rank] !== undefined ? ds.rank : s.rank, amount: n(ds.amount) || s.amount, rate: ds.rate ?? s.rate,
      propAddress: p ? p.address : s.propAddress, propCity: p ? p.city : s.propCity, propPostal: p ? p.postal || '' : s.propPostal, propValue: p && p.value ? p.value : s.propValue,
      termText: ds.termMonths ? `${ds.termMonths} mois (renouvelable au même taux d'intérêt)` : s.termText,
      repayText: ds.minMonths ? `En tout temps, sous réserve d'un minimum de ${ds.minMonths} mois d'intérêts perçus par le prêteur` : s.repayText });
    s.g = [0, 1, 2].map((i) => props[i] ? { rank: i === 0 ? (ds.rank || '') : '', address: [props[i].address, props[i].city, props[i].postal ? `QC ${props[i].postal}` : ''].filter(Boolean).join(', '), lot: props[i].lot || '' } : { rank: '', address: '', lot: '' });
    const loan = window.TFDossiers && window.TFDossiers.loanOf(ds);
    if (loan) { const v = loan.versions[loan.versions.length - 1]; if (v.capitalize && v.monthly != null) { s.payMode = 'cap'; s.payment = v.monthly; } }
  }

  /* ---------- formulaire ---------- */
  function form(s) {
    const { field, select, dateField, group } = K(), D = T().data; if (window.TFDossiers) window.TFDossiers.ensure();
    const dossiers = (D.dossiers || []).slice().sort((a, b) => (b.no || 0) - (a.no || 0));
    const sig = (k, lb) => group(lb, `<label class="check"><input type="checkbox" data-tlsig="${k}" ${s[k].show ? 'checked' : ''}> Afficher ce signataire</label>`
      + `<label class="field span-all"><span>Signature</span><select data-tlsig="${k}" data-f="sig">${[['jonathan', 'Jonathan Mireault (image)'], ['marc', 'Marc Beaudoin (image)'], ['', 'Ligne vide (signature manuscrite)']].map(([v, l]) => `<option value="${v}" ${(s[k].sig || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
      + ['name', 'company', 'address', 'phone', 'email'].map((f) => `<label class="field span-all"><span>${{ name: 'Nom', company: 'Entreprise', address: 'Adresse', phone: 'Téléphone', email: 'Courriel' }[f]}</span><input type="text" data-tlsig="${k}" data-f="${f}" value="${esc(s[k][f] || '')}"></label>`).join(''));
    const gar = (i) => `<div class="tl-gar"><b>Garantie ${i + 1}</b>${select(`g${i}rank`, 'Rang', s.g[i].rank, [['', '—'], '1er rang', '2e rang', '3e rang', 'Sans garantie'])}${field(`g${i}address`, 'Immeuble', s.g[i].address, { num: false, ph: 'Adresse complète' })}${field(`g${i}lot`, 'Lot cadastral', s.g[i].lot, { num: false })}</div>`;
    return group('Remplir à partir d\'un dossier', select('dossierId', 'Dossier Terreno', s.dossierId, [['', '— Choisir un dossier —']].concat(dossiers.map((x) => [x.id, `${x.no != null ? String(x.no).padStart(3, '0') + ' · ' : ''}${x.name}`]))), 'Reprend le contact, le prêteur, le montant, le taux, le rang, l\'immeuble et les garanties.')
      + group('En-tête', field('place', 'Lieu', s.place, { num: false }) + dateField('date', 'Date de la lettre', s.date || T().todayISO) + field('borrower1', 'Emprunteur', s.borrower1, { num: false }) + field('borrower2', '2e emprunteur (facultatif)', s.borrower2, { num: false }) + field('company', 'Entreprise de l\'emprunteur (facultatif)', s.company, { num: false }) + field('subject', 'Objet', s.subject, { num: false }))
      + group('Immeuble et transaction', select('txType', 'Type de transaction', s.txType, ['Financement', 'Refinancement', 'Acquisition & Financement', 'Prêt relais']) + select('rank', 'Rang du prêt', s.rank, ['1er rang', '2e rang', '3e rang', 'Sans garantie'])
        + field('propAddress', 'Adresse', s.propAddress, { num: false }) + field('propCity', 'Ville', s.propCity, { num: false }) + field('propPostal', 'Code postal', s.propPostal, { num: false })
        + field('propValue', 'Valeur estimée', s.propValue, { suffix: '$' }) + (s.txType.startsWith('Acquisition') ? field('purchasePrice', 'Prix d\'acquisition', s.purchasePrice, { suffix: '$' }) + field('downPayment', 'Mise de fonds', s.downPayment, { suffix: '$' }) : ''))
      + group('Conditions de financement', field('lender', 'Prêteur', s.lender, { num: false, ph: T().data.entity || '' }) + field('amount', 'Financement proposé', s.amount, { suffix: '$' }) + field('footnote', 'Note sur le montant (astérisque)', s.footnote, { num: false, ph: 'Ex. : Le total des prêts combinés ne devra pas dépasser…' })
        + field('rate', 'Taux d\'intérêt annuel', s.rate, { suffix: '%' }) + select('payMode', 'Type de paiement', s.payMode, [['io', 'Intérêts seulement'], ['cap', 'Intérêts partiels + capitalisés'], ['pi', 'Capital et intérêts']])
        + (s.payMode !== 'io' ? field('payment', s.payMode === 'cap' ? 'Intérêts payés par mois' : 'Paiement mensuel', s.payment, { suffix: '$', hint: s.payMode === 'cap' ? 'Le reste de l\'intérêt mensuel est capitalisé.' : '' }) : '')
        + field('feePct', 'Frais de dossier', s.feePct, { suffix: '%' }) + field('feeFixed', 'ou montant fixe', s.feeFixed, { suffix: '$', ph: 'Laisser vide pour le %' })
        + field('termText', 'Échéance', s.termText, { num: false }) + field('repayText', 'Remboursement', s.repayText, { num: false }) + field('partialText', 'Remboursement partiel (facultatif)', s.partialText, { num: false, ph: 'Ex. : Possible par tranches de 50 000 $ après 6 mois' }) + dateField('validUntil', 'Offre valide jusqu\'au (facultatif)', s.validUntil))
      + group('Garanties', gar(0) + gar(1) + gar(2))
      + group('Clauses', `<label class="field span-all"><span>Assurances</span><input type="text" id="tl-insurance" data-tl="insurance" value="${esc(s.insurance)}"><small class="hint">{lender} = nom du prêteur</small></label>`
        + `<label class="field span-all"><span>Notaire</span><textarea id="tl-notary" data-tl="notary" rows="3">${esc(s.notary)}</textarea></label>`
        + `<label class="field span-all"><span>Utilisation des fonds (facultatif)</span><textarea id="tl-funds" data-tl="funds" rows="3" placeholder="Ex. : Les fonds serviront à rembourser l'hypothèque de 2e rang de … Le solde sera versé à …">${esc(s.funds)}</textarea></label>`
        + `<label class="field span-all"><span>Autres conditions (facultatif, une par ligne)</span><textarea id="tl-other" data-tl="other" rows="3">${esc(s.other)}</textarea></label>`
        + `<label class="check"><input type="checkbox" data-tlapproval ${s.approval ? 'checked' : ''}> Inclure la section « Approbation de l'emprunteur » (signatures)</label>`)
      + sig('s1', 'Signataire 1') + sig('s2', 'Signataire 2');
  }

  /* ---------- lettre ---------- */
  function letter(s) {
    const c = calc(s), lender = lenderName(s), rank = RANK_TXT[s.rank] || '';
    const borrowers = [s.borrower1, s.borrower2].filter(Boolean).join(' & ') || s.client || '…';
    const addr = fullAddress(s) || '…';
    const intro = s.txType.startsWith('Acquisition')
      ? `Par la présente, je vous confirme que nous sommes disposés à vous faire un prêt hypothécaire${rank ? ` de ${rank}` : ''} pour l'acquisition de l'immeuble suivant : ${esc(addr)}.`
      : s.txType === 'Prêt relais' ? `Par la présente, je vous confirme que nous sommes disposés à vous faire un prêt relais garanti par une hypothèque${rank ? ` de ${rank}` : ''} sur l'immeuble suivant : ${esc(addr)}.`
      : `Par la présente, je vous confirme que nous sommes disposés à vous faire un prêt hypothécaire${rank ? ` de ${rank}` : ''} sur l'immeuble suivant : ${esc(addr)}.`;
    const cell = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    const left = [cell('Valeur estimée de la propriété :', n(s.propValue) ? money(n(s.propValue)) : '—')]
      .concat(s.txType.startsWith('Acquisition') && n(s.purchasePrice) ? [cell("Prix d'acquisition :", money(n(s.purchasePrice))), cell('Mise de fonds :', n(s.downPayment) ? money(n(s.downPayment)) : '—')] : [])
      .concat([cell('Prêteur :', esc(lender)), cell('Financement proposé :', `${money(c.amount)}${s.footnote ? ' *' : ''}`), cell("Taux d'intérêt :", `${n(s.rate).toLocaleString('fr-CA')} %`)]);
    const right = [cell('Échéance :', esc(s.termText)), cell('Remboursement :', esc(s.repayText)), cell('Paiement mensuel :', esc(c.payText)), cell('Frais de dossier :', s.feeFixed !== '' && s.feeFixed != null ? money(c.fee) : `${n(s.feePct).toLocaleString('fr-CA')} % (${money(c.fee)})`)]
      .concat(s.partialText ? [cell('Remboursement partiel :', esc(s.partialText))] : []);
    const gars = s.g.filter((g) => g.address || g.lot).map((g) => `${g.rank ? `${esc(g.rank === '1er rang' ? '1re' : g.rank.replace(' rang', ''))} hypothèque : ` : ''}${esc(g.address)}${g.lot ? ` (Lot : ${esc(g.lot)})` : ''}`);
    const others = String(s.other || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const sigs = ['s1', 's2'].filter((k) => s[k].show && s[k].name);
    return `<article class="doc-page letter">
      <p class="lt-date">${esc(s.place ? `${s.place}, le ` : '')}${longDate(s.date || T().todayISO)}</p>
      <p class="lt-to">${esc(borrowers)}${s.company ? `<br>${esc(s.company)}` : ''}</p>
      <p class="lt-subject"><b>OBJET : ${esc(s.subject)}</b></p>
      <p>${intro}</p>
      <p><b>Les conditions de financement sont les suivantes :</b></p>
      <div class="lt-cond"><table>${left.join('')}</table><table>${right.join('')}</table></div>
      ${s.footnote ? `<p class="lt-note">* ${esc(s.footnote)}</p>` : ''}
      ${gars.length ? `<p><b>Garantie${gars.length > 1 ? 's' : ''} :</b> ${gars.join('<br>')}</p>` : ''}
      <p><b>Assurances :</b> ${esc(String(s.insurance || '').replace('{lender}', lender))}</p>
      <p><b>Notaire :</b> ${esc(s.notary)}</p>
      ${s.funds ? `<p><b>Utilisation des fonds :</b> ${esc(s.funds)}</p>` : ''}
      ${others.length ? `<p><b>Autres conditions :</b></p><ul class="lt-list">${others.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${s.validUntil ? `<p>La présente offre est valide jusqu'au ${longDate(s.validUntil)}.</p>` : ''}
      ${s.approval ? `<p class="lt-h"><b>Approbation de l'emprunteur</b></p><p>J'accepte les conditions du prêt hypothécaire et certifie que les informations fournies sont exactes.</p>
        <table class="lt-sign"><tr>${[s.borrower1 || s.client || 'Emprunteur'].concat(s.borrower2 ? [s.borrower2] : []).map((x) => `<td>${esc(x)}</td>`).join('')}<td>Date</td></tr><tr>${[s.borrower1 || 1].concat(s.borrower2 ? [1] : []).map(() => '<td class="lt-blank"></td>').join('')}<td class="lt-blank"></td></tr></table>` : ''}
      <p class="lt-closing">Cordialement,</p>
      <div class="lt-sigs">${sigs.map((k) => { const x = s[k]; const img = x.sig && window.TF_SIGNATURES && window.TF_SIGNATURES[x.sig]; return `<div>${img ? `<img class="lt-sigimg" src="${img}" alt="Signature de ${esc(x.name)}">` : '<div class="lt-sigline"></div>'}<b>${esc(x.name)}</b>${x.company ? `<br>${esc(x.company)}` : ''}<div class="small">${x.address ? `${esc(x.address)}<br>` : ''}${x.phone ? `T : ${esc(x.phone)}<br>` : ''}${x.email ? `E : ${esc(x.email)}` : ''}</div></div>`; }).join('')}</div>
    </article>`;
  }

  function results(s) {
    const c = calc(s);
    return `<div class="lt-preview-head"><div class="mini-kpis"><div><span>Financement</span><b>${money(c.amount)}</b></div><div><span>Intérêt mensuel</span><b>${money(c.monthlyInt)}</b></div><div><span>Frais de dossier</span><b>${money(c.fee)}</b></div>${c.ltv != null ? `<div><span>LTV</span><b>${T().PCT.format(c.ltv)}</b></div>` : ''}</div>
      <p class="small muted">Aperçu de la lettre. Utilisez « Aperçu client » pour l'ouvrir en plein écran et l'imprimer ou l'enregistrer en PDF (une page lettre).</p></div>
      <div class="lt-preview">${letter(s)}</div>`;
  }

  /* ---------- événements propres à la lettre ---------- */
  document.addEventListener('change', (ev) => {
    const t = ev.target, S = window.TFTools && window.TFTools.state(); if (!S || S.tool !== 'letter' || !t.closest('.tools')) return;
    const s = S.letter;
    if (t.dataset.tl === 'dossierId') { if (t.value) fillFromDossier(s, t.value); else s.dossierId = ''; return window.TFTools.rerender(); }
    if (t.dataset.tl && /^g\d(rank|address|lot)$/.test(t.dataset.tl)) { const i = +t.dataset.tl[1], f = t.dataset.tl.slice(2); s.g[i][f] = t.value; return window.TFTools.refresh(); }
    if (t.dataset.tlsig) { const k = t.dataset.tlsig; if (t.type === 'checkbox') s[k].show = t.checked; else s[k][t.dataset.f] = t.value; return window.TFTools.refresh(); }
    if (t.hasAttribute('data-tlapproval')) { s.approval = t.checked; return window.TFTools.refresh(); }
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target, S = window.TFTools && window.TFTools.state(); if (!S || S.tool !== 'letter' || !t.closest('.tools')) return;
    const s = S.letter;
    if (t.dataset.tl && /^g\d(rank|address|lot)$/.test(t.dataset.tl)) { s.g[+t.dataset.tl[1]][t.dataset.tl.slice(2)] = t.value; }
    else if (t.dataset.tlsig && t.type !== 'checkbox') { s[t.dataset.tlsig][t.dataset.f] = t.value; }
    else return;
    clearTimeout(window.__ltTmr); window.__ltTmr = setTimeout(() => window.TFTools.refresh(), 250);
  });
  window.TFLetter = { DEFAULTS, form, results, letter, fillFromDossier };
})();

/* Outil « Table d'amortissement » : table complète selon une structure précise, vue mensuelle ou annuelle,
   remboursements anticipés, impression / PDF. Branché dans tools.js (état : S.amort). */
(function () {
  'use strict';
  const T = () => window.TF, K = () => window.TFToolsKit, C = () => window.TFCalc;
  const n = (x) => { const v = parseFloat(String(x ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const pmt = (r, N, P) => (r ? P * r / (1 - Math.pow(1 + r, -N)) : P / N);
  const firstOfNextMonth = () => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth() + 1, 1)).toISOString().slice(0, 10); };
  const STRUCT = [['conv', 'Conventionnel (capital + intérêts, paiement fixe)'], ['fixedp', 'Capital fixe + intérêts (paiement dégressif)'], ['io', 'Intérêts seulement'], ['cap', 'Intérêts partiels + capitalisés']];
  const DEFAULTS = { client: '', property: '', loanId: '', principal: 300000, rate: 6, type: 'conv', amortYears: 25, termMonths: 60, startDate: firstOfNextMonth(), payment: '', capMode: 'fixed', capRatio: 50, fixedPrincipal: '',
    feePct: 0, view: 'year', showFull: true, extras: [], notes: '' };

  /* ---------- calcul ---------- */
  function calc(s) {
    const P = n(s.principal), r = n(s.rate) / 100 / 12, start = s.startDate || firstOfNextMonth();
    const term = Math.max(1, Math.round(n(s.termMonths) || 12)), amortN = Math.max(1, Math.round(n(s.amortYears) * 12) || term);
    const N = s.type === 'conv' || s.type === 'fixedp' ? (s.showFull ? amortN : Math.min(term, amortN)) : term;
    let pay = 0;
    if (s.type === 'conv') pay = pmt(r, amortN, P);
    else if (s.type === 'fixedp') pay = n(s.fixedPrincipal) || P / amortN;
    else if (s.type === 'io') pay = P * r;
    else pay = n(s.payment);
    const extras = (s.extras || []).map((e) => ({ month: Math.max(1, Math.round(n(e.month))), amount: n(e.amount), every: e.every ? Math.max(1, Math.round(n(e.every))) : 0 })).filter((e) => e.amount > 0);
    const extraAt = (k) => extras.reduce((a, e) => a + (k === e.month || (e.every && k > e.month && (k - e.month) % e.every === 0) ? e.amount : 0), 0);
    let bal = P; const rows = []; const acc = { paid: 0, interest: 0, principal: 0, cap: 0, extra: 0 };
    for (let k = 1; k <= N && bal > 0.005; k++) {
      const open = bal, interest = open * r; let paid, princ = 0, cap = 0;
      if (s.type === 'conv') { paid = Math.min(pay, open + interest); princ = paid - interest; }
      else if (s.type === 'fixedp') { princ = Math.min(pay, open); paid = princ + interest; }
      else if (s.type === 'io') { paid = interest; }
      else { if (s.capMode === 'ratio') { cap = interest * Math.max(0, Math.min(1, n(s.capRatio) / 100)); paid = interest - cap; } else { paid = Math.min(pay, interest); cap = interest - paid; } }
      bal = open - princ + cap;
      const extra = Math.min(extraAt(k), bal); bal -= extra;
      acc.paid += paid + extra; acc.interest += interest; acc.principal += princ + extra; acc.cap += cap; acc.extra += extra;
      const from = C().addMonthsIso(start, k - 1);
      rows.push({ n: k, from, to: C().endOfMonth(from), due: C().addMonthsIso(C().endOfMonth(from).slice(0, 8) + '01', 1), open: r2(open), interest: r2(interest), paid: r2(paid), principal: r2(princ), cap: r2(cap), extra: r2(extra), close: r2(Math.max(0, bal)), termEnd: k === term });
    }
    const atTerm = rows.find((x) => x.n === term) || rows[rows.length - 1];
    const years = []; rows.forEach((x) => { const y = Math.ceil(x.n / 12); let Y = years[y - 1]; if (!Y) Y = years[y - 1] = { year: y, from: x.from, to: x.to, open: x.open, interest: 0, paid: 0, principal: 0, cap: 0, extra: 0, close: x.close, months: 0 }; Y.interest += x.interest; Y.paid += x.paid + x.extra; Y.principal += x.principal + x.extra; Y.cap += x.cap; Y.extra += x.extra; Y.close = x.close; Y.to = x.to; Y.months++; });
    years.forEach((Y) => ['interest', 'paid', 'principal', 'cap', 'extra'].forEach((k) => { Y[k] = r2(Y[k]); }));
    const fees = r2(P * n(s.feePct) / 100);
    return { rows, years, payment: r2(s.type === 'fixedp' ? (rows[0] ? rows[0].paid : 0) : s.type === 'cap' ? (rows[0] ? rows[0].paid : 0) : pay), term, amortN, N, atTerm, fees,
      totals: { paid: r2(acc.paid), interest: r2(acc.interest), principal: r2(acc.principal), cap: r2(acc.cap), extra: r2(acc.extra), end: r2(bal > 0.005 ? bal : 0), months: rows.length },
      payoffMonth: bal <= 0.005 ? rows.length : null };
  }

  /* ---------- formulaire ---------- */
  function form(s) {
    const { field, select, dateField, group } = K(), loans = T().data.loans, St = window.TFTools.state().struct;
    const isConv = s.type === 'conv' || s.type === 'fixedp';
    const extras = (s.extras || []).map((e, i) => `<div class="tl-extra"><input type="number" data-tlx="${i}" data-f="month" value="${e.month ?? ''}" placeholder="Mois n°" min="1"><input type="text" inputmode="decimal" class="num" data-tlx="${i}" data-f="amount" value="${e.amount ?? ''}" placeholder="Montant $"><input type="number" data-tlx="${i}" data-f="every" value="${e.every ?? ''}" placeholder="Répéter tous les … mois" min="0"><button type="button" class="btn ghost small" data-tlx-del="${i}" aria-label="Retirer">✕</button></div>`).join('');
    return group('Remplir à partir de', select('loanId', 'Prêt existant', s.loanId, [['', '— Choisir un prêt —']].concat(loans.map((l) => [l.id, l.name]))) + `<button type="button" class="btn small span-all" data-tlamort="from-struct">Reprendre les paramètres de « Structures de prêt » (${T().m0(n(St.principal))}, ${St.months} mois)</button>`)
      + group('Client', field('client', 'Nom du client', s.client, { num: false }) + field('property', 'Propriété', s.property, { num: false, ph: 'Adresse' }))
      + group('Prêt', field('principal', 'Montant du prêt', s.principal, { suffix: '$' }) + field('rate', 'Taux annuel', s.rate, { suffix: '%' }) + dateField('startDate', 'Premier mois', s.startDate)
        + select('type', 'Structure', s.type, STRUCT)
        + (isConv ? field('amortYears', 'Amortissement', s.amortYears, { suffix: 'ans' }) : '')
        + field('termMonths', 'Terme', s.termMonths, { suffix: 'mois', hint: isConv ? 'Le solde au terme est mis en évidence (renouvellement).' : 'Durée de la table.' })
        + (s.type === 'fixedp' ? field('fixedPrincipal', 'Capital remboursé par mois', s.fixedPrincipal, { suffix: '$', ph: 'Vide = montant ÷ mois d\'amortissement' }) : '')
        + (s.type === 'cap' ? select('capMode', 'Mode', s.capMode, [['fixed', 'Paiement mensuel fixe'], ['ratio', 'Pourcentage capitalisé']]) + (s.capMode === 'fixed' ? field('payment', 'Paiement mensuel', s.payment, { suffix: '$' }) : field('capRatio', "Part de l'intérêt capitalisée", s.capRatio, { suffix: '%' })) : '')
        + field('feePct', 'Frais de dossier', s.feePct, { suffix: '%' })
        + (isConv ? `<label class="check span-all"><input type="checkbox" data-tlamort="showFull" ${s.showFull ? 'checked' : ''}> Table complète jusqu'au remboursement (sinon : le terme seulement)</label>` : ''))
      + group('Remboursements anticipés', `${extras}<button type="button" class="btn small span-all" data-tlamort="add-extra">+ Remboursement anticipé</button>`, 'Montant appliqué au capital à la fin du mois indiqué; « répéter » pour un versement récurrent (ex. : tous les 12 mois).')
      + group('Présentation', select('view', 'Détail', s.view, [['year', 'Par année (sommaire)'], ['month', 'Par mois (détaillé)']]) + `<label class="field span-all"><span>Notes pour le client</span><textarea id="tl-notes" data-tl="notes" rows="3">${T().esc(s.notes || '')}</textarea></label>`);
  }

  /* ---------- tableaux ---------- */
  function table(a, s, docMode) {
    const { m, m0, d } = T(), cap = s.type === 'cap', ex = a.totals.extra > 0, cls = docMode ? 'doc-table amort-doc' : 'amort';
    const per = (x) => docMode ? `${T().E.monthLabel(x.from.slice(0, 7))}` : `${d(x.from)} au ${d(x.to)}`;
    const perY = (Y) => docMode ? `${T().E.monthLabel(Y.from.slice(0, 7))} – ${T().E.monthLabel(Y.to.slice(0, 7))}` : `${d(Y.from)} au ${d(Y.to)}`;
    if (s.view === 'year') {
      return `<table class="${cls}"><thead><tr><th>Année</th><th>Période</th><th class="num">Solde au début</th><th class="num">Paiements</th><th class="num">Intérêts</th><th class="num">${cap ? 'Capitalisés' : 'Capital remboursé'}</th>${ex ? '<th class="num">dont anticipés</th>' : ''}<th class="num">Solde à la fin</th></tr></thead><tbody>
        ${a.years.map((Y) => { const term = a.term > (Y.year - 1) * 12 && a.term <= Y.year * 12; return `<tr class="${term ? 'term' : ''}"><td>${Y.year}${Y.months < 12 ? ` <span class="small muted">(${Y.months} mois)</span>` : ''}</td><td class="small">${perY(Y)}</td><td class="num">${m0(Y.open)}</td><td class="num">${m0(Y.paid)}</td><td class="num">${m0(Y.interest)}</td><td class="num">${m0(cap ? Y.cap : Y.principal)}</td>${ex ? `<td class="num">${Y.extra ? m0(Y.extra) : '—'}</td>` : ''}<td class="num"><b>${m0(Y.close)}</b>${term ? '<div class="small chip-line">fin du terme</div>' : ''}</td></tr>`; }).join('')}
        <tr class="total"><td colspan="3">Total</td><td class="num">${m0(a.totals.paid)}</td><td class="num">${m0(a.totals.interest)}</td><td class="num">${m0(cap ? a.totals.cap : a.totals.principal)}</td>${ex ? `<td class="num">${m0(a.totals.extra)}</td>` : ''}<td class="num">${m0(a.totals.end)}</td></tr></tbody></table>`;
    }
    return `<table class="${cls}"><thead><tr><th>Mois</th><th>Période</th><th>Payable le</th><th class="num">Solde au début</th><th class="num">Paiement</th><th class="num">Intérêt</th><th class="num">${cap ? 'Capitalisé' : 'Capital'}</th>${ex ? '<th class="num">Anticipé</th>' : ''}<th class="num">Solde à la fin</th></tr></thead><tbody>
      ${a.rows.map((x) => `<tr class="${x.termEnd ? 'term' : ''} ${x.n % 12 === 0 ? 'yr' : ''}"><td>${x.n}</td><td class="small">${per(x)}</td><td class="small">${docMode ? d(x.due).replace(/^1 /, '1er ') : d(x.due)}</td><td class="num">${m(x.open)}</td><td class="num"><b>${m(x.paid)}</b></td><td class="num">${m(x.interest)}</td><td class="num">${m(cap ? x.cap : x.principal)}</td>${ex ? `<td class="num">${x.extra ? m(x.extra) : '—'}</td>` : ''}<td class="num">${m(x.close)}${x.termEnd ? '<div class="small chip-line">fin du terme</div>' : ''}</td></tr>`).join('')}
      <tr class="total"><td colspan="4">Total</td><td class="num">${m(a.totals.paid)}</td><td class="num">${m(a.totals.interest)}</td><td class="num">${m(cap ? a.totals.cap : a.totals.principal)}</td>${ex ? `<td class="num">${m(a.totals.extra)}</td>` : ''}<td class="num">${m(a.totals.end)}</td></tr></tbody></table>`;
  }
  const structLabel = (s) => Object.fromEntries(STRUCT)[s.type];
  function kpis(a, s) {
    const { m, m0, kpi, d } = T();
    return `<div class="kpis">
      ${kpi(s.type === 'fixedp' ? 'Premier paiement' : 'Paiement mensuel', m(a.payment), s.type === 'fixedp' ? `${m(a.rows[a.rows.length - 1]?.paid || 0)} le dernier mois` : s.type === 'cap' ? `+ ${m(a.rows[0]?.cap || 0)} capitalisés le 1er mois` : s.type === 'conv' ? `Amortissement ${s.amortYears} ans` : '')}
      ${kpi(`Solde à la fin du terme (${a.term} mois)`, m0(a.atTerm ? a.atTerm.close : 0), a.atTerm ? `Au ${d(a.atTerm.to)}` : '')}
      ${kpi(`Intérêts sur ${a.totals.months} mois`, m0(a.totals.interest), a.fees ? `+ frais de dossier ${m0(a.fees)}` : '')}
      ${kpi(a.payoffMonth ? 'Prêt remboursé après' : 'Solde à la fin de la table', a.payoffMonth ? `${a.payoffMonth} mois` : m0(a.totals.end), a.payoffMonth ? `${(a.payoffMonth / 12).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} ans${a.totals.extra ? ` · ${m0(a.totals.extra)} anticipés` : ''}` : `Après ${a.totals.months} mois`)}
    </div>`;
  }
  function results(s) {
    const a = calc(s);
    return `${kpis(a, s)}<section class="panel"><div class="panel-head"><h2>Table d'amortissement — ${structLabel(s).split(' (')[0]}</h2><span class="small muted">${a.totals.months} mois · ${s.view === 'year' ? 'sommaire par année' : 'détail mensuel'}</span></div><div class="table-wrap">${table(a, s, false)}</div></section>`;
  }
  function doc(s) {
    const a = calc(s), { m, m0, esc, d, PCT } = T(), docShell = window.TFTools.docShell;
    const desc = { conv: `Paiement mensuel fixe de ${m(a.payment)} (capital et intérêts), amorti sur ${s.amortYears} ans; le solde restant au terme de ${a.term} mois est renouvelé ou remboursé.`,
      fixedp: `Capital fixe de ${m(a.rows[0] ? a.rows[0].principal : 0)} par mois plus l'intérêt du mois : le paiement diminue au fil du temps.`,
      io: `Intérêts seulement : le paiement mensuel couvre l'intérêt; le capital de ${m0(n(s.principal))} est remboursé à la fin.`,
      cap: `Intérêts partiels : ${m(a.payment)} payés par mois, le reste de l'intérêt s'ajoute au solde; l'intérêt du mois suivant est calculé sur le solde augmenté.` }[s.type];
    return docShell("Table d'amortissement", s.client, `
      ${s.property ? `<p><b>Propriété :</b> ${esc(s.property)}</p>` : ''}
      <div class="doc-kpis"><div><span>Montant du prêt</span><b>${m0(n(s.principal))}</b></div><div><span>Taux annuel</span><b>${(n(s.rate)).toLocaleString('fr-CA', { maximumFractionDigits: 3 })} %</b></div><div><span>${s.type === 'fixedp' ? 'Premier paiement' : 'Paiement mensuel'}</span><b>${m(a.payment)}</b></div><div><span>Solde au terme (${a.term} mois)</span><b>${m0(a.atTerm ? a.atTerm.close : 0)}</b></div></div>
      <p><b>Structure :</b> ${desc}${a.fees ? ` Frais de dossier : ${m0(a.fees)}.` : ''} Chaque paiement couvre l'intérêt du mois précédent et est payable le 1er du mois.${a.totals.extra ? ` Remboursements anticipés inclus : ${m0(a.totals.extra)}.` : ''}</p>
      ${table(a, s, true)}
      ${s.view === 'month' && a.years.length > 1 ? `<h3>Sommaire par année</h3>${table(a, { ...s, view: 'year' }, true)}` : ''}
      ${s.notes ? `<h3>Notes</h3><p>${esc(s.notes).replace(/\n/g, '<br>')}</p>` : ''}`,
      "Table informative préparée à partir des paramètres indiqués; les montants réels dépendent des dates de versement et des modalités du contrat de prêt.");
  }

  function fromStruct(s) {
    const St = window.TFTools.state().struct;
    Object.assign(s, { client: St.client || s.client, principal: St.principal, termMonths: St.months, startDate: St.startDate, feePct: St.feePct,
      rate: St.detail === 'conv' ? St.convRate : St.detail === 'io' ? St.ioRate : St.capRate, type: St.detail === 'cap' ? 'cap' : St.detail === 'io' ? 'io' : 'conv', amortYears: St.amortYears, capMode: St.capMode, payment: St.payment, capRatio: St.capRatio });
  }
  function fromLoan(s, id) {
    const l = T().loanById(id); if (!l) return;
    const v = l.versions[l.versions.length - 1];
    Object.assign(s, { loanId: id, client: l.borrower || '', property: l.name.split(' — ')[1] ? `${l.name.split(' — ')[1]}${l.city ? `, ${l.city}` : ''}` : (l.city || ''), principal: v.principal, rate: Math.round(v.rate * 100000) / 1000, startDate: v.from.slice(0, 8) + '01' });
    if (v.capitalize && v.monthly != null) Object.assign(s, { type: 'cap', capMode: 'fixed', payment: v.monthly }); else s.type = 'io';
    if (l.maturity) { const [y1, m1] = v.from.split('-').map(Number), [y2, m2] = l.maturity.split('-').map(Number); s.termMonths = Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1); }
  }

  /* ---------- événements ---------- */
  const st = () => window.TFTools && window.TFTools.state();
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-tlamort],[data-tlx-del]'); const S = st(); if (!b || !S || S.tool !== 'amort') return;
    const s = S.amort;
    if (b.dataset.tlxDel != null) { s.extras.splice(+b.dataset.tlxDel, 1); return window.TFTools.rerender(); }
    if (b.dataset.tlamort === 'add-extra') { s.extras = s.extras || []; s.extras.push({ month: 12, amount: '', every: '' }); return window.TFTools.rerender(); }
    if (b.dataset.tlamort === 'from-struct') { fromStruct(s); return window.TFTools.rerender(); }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target, S = st(); if (!S || S.tool !== 'amort' || !t.closest('.tools')) return;
    const s = S.amort;
    if (t.dataset.tlamort === 'showFull') { s.showFull = t.checked; return window.TFTools.rerender(); }
    if (t.dataset.tl === 'loanId') { if (t.value) fromLoan(s, t.value); else s.loanId = ''; return window.TFTools.rerender(); }
    if (t.dataset.tlx != null) { s.extras[+t.dataset.tlx][t.dataset.f] = t.value; return window.TFTools.refresh(); }
  });
  window.TFAmort = { DEFAULTS, form, results, doc, calc };
})();

/* Prévisions : trésorerie projetée (prêts actifs, dépenses récurrentes, nouveaux prêts prévus)
   et équité future à intérêt composé avec pouvoir d'achat. Calculs purs (navigateur + Node). */
(function (root) {
  'use strict';
  const E = root.FinEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const ym = (s) => s.slice(0, 7);
  const dim = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
  const eom = (k) => `${k}-${String(dim(k)).padStart(2, '0')}`;
  const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };

  const DEFAULTS = { horizon: 24, reserve: 25000, arrears: false, exp: {}, loans: {}, newLoans: [], others: [],
    compound: { start: null, rate: 10, years: 35, inflation: 3, monthly: 0, detail: false } };
  function settings(data) {
    const f = data.forecast = data.forecast || {};
    for (const k in DEFAULTS) if (f[k] === undefined) f[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    for (const k in DEFAULTS.compound) if (f.compound[k] === undefined) f.compound[k] = DEFAULTS.compound[k];
    return f;
  }

  // Comptes bancaires de l'entreprise (actif) : la trésorerie disponible
  const cashAccounts = (data) => (data.bankAccounts || []).filter((b) => !b.personal && b.kind !== 'liability').map((b) => b.id);

  // Dépenses récurrentes par défaut : moyenne mensuelle des 6 derniers mois complets (reconnaissance)
  const EXP_KEYS = [['doris', "Intérêts versés à Doris Lacasse", ['exp:int-doris']], ['guy', 'Intérêts versés à Guy Mireault', ['exp:int-guy']],
    ['marge', "Intérêts de la marge (remboursés à l'actionnaire)", ['exp:int-marge']], ['overhead', 'Frais généraux (banque, comptable, autres)', null]];
  function expenseAverages(data, today) {
    const end = E.addMonths(ym(today), -1), start = E.addMonths(end, -5);
    const p = E.pnl(data, `${start}-01`, eom(end), 'accrual', today);
    const byAcct = (ids) => r2(p.groups.direct.filter((r) => ids.includes(r.acct)).reduce((a, r) => a + r.total, 0) / 6);
    const out = {};
    for (const [k, , ids] of EXP_KEYS) out[k] = ids ? byAcct(ids) : r2(p.total.overhead / 6);
    out.from = start; out.to = end;
    return out;
  }

  /* ---------- trésorerie projetée ---------- */
  function cashForecast(data, today, S) {
    S = S || settings(data);
    const cur = ym(today), H = Math.max(1, Math.min(120, num(S.horizon) || 24));
    const months = []; for (let i = 1; i <= H; i++) months.push(E.addMonths(cur, i));
    const last = months[months.length - 1];
    const bal = E.balances(data, today), accts = cashAccounts(data);
    const opening = r2(accts.reduce((a, id) => a + (bal[id] || 0), 0));
    const avg = expenseAverages(data, today);
    const exp = {}; for (const [k] of EXP_KEYS) exp[k] = S.exp[k] === undefined || S.exp[k] === '' || S.exp[k] === null ? avg[k] : num(S.exp[k]);
    const row = () => ({ interest: 0, capital: 0, newLoans: 0, newInterest: 0, other: 0, arrears: 0, events: [] });
    const M = Object.fromEntries(months.map((k) => [k, row()]));
    const add = (k, f, v, ev) => { if (!M[k]) return; M[k][f] += v; if (ev) M[k].events.push(ev); };
    const loansInfo = [];
    for (const loan of data.loans) {
      if (E.loanStatus(loan, today) === 'closed') continue;
      const ls = (S.loans || {})[loan.id] || {};
      const s = E.schedule(data, loan.id, today, H + 2);
      const bal0 = bal[`loans|${loan.id}`] || 0;
      const v = loan.versions[loan.versions.length - 1];
      // date de remboursement supposée
      let payoff = null;
      if (ls.mode === 'date' && ls.date) payoff = ls.date;
      else if (ls.mode !== 'renew' && loan.maturity) payoff = loan.maturity;
      const payM = payoff ? ym(payoff) : null;
      let arrears = 0;
      for (const r of s.rows) {
        if (r.period < cur) { if (r.expected > r.received + 0.5) arrears += r.expected - r.received; continue; }
        if (payM && r.period > payM) break;
        const due = Math.max(0, r.expected - r.received);   // déjà reçu d'avance : rien à encaisser
        if (!due) continue;
        // intérêts à terme échu : le mois p est encaissé au début du mois p+1 (ou avec le remboursement)
        const k = payM && r.period === payM ? payM : E.addMonths(r.period, 1);
        let amt = due;
        if (payM && r.period === payM) amt = due * Math.min(1, Number(payoff.slice(8, 10)) / dim(r.period));
        add(k, 'interest', amt);
      }
      if (S.arrears && arrears > 0.5) add(months[0], 'arrears', arrears, `Arriérés ${loan.name.split(' — ')[0]}`);
      let capital = null;
      if (payM && payM > cur && payM <= last) {
        const pr = s.rows.find((r) => r.period === payM);
        capital = r2((pr ? pr.principal + (pr.capitalized || 0) : bal0));
        add(payM, 'capital', capital, `Remboursement ${loan.name.split(' — ')[0]} (${fmt(capital)})`);
      }
      const curRow = s.rows.find((r) => r.period === cur);
      loansInfo.push({ id: loan.id, name: loan.name, balance: r2(curRow ? curRow.principal : bal0), rate: v.rate, monthly: v.monthly != null ? v.monthly : r2(v.principal * v.rate / 12),
        maturity: loan.maturity || '', mode: ls.mode || (loan.maturity ? 'repay' : 'renew'), date: ls.date || '', payoff, capital, arrears: r2(arrears) });
    }
    // nouveaux prêts prévus
    for (const nl of S.newLoans || []) {
      const amt = num(nl.amount), rate = num(nl.rate) / 100, n = Math.max(0, Math.round(num(nl.months))); if (!amt || !nl.date) continue;
      const k0 = ym(nl.date); add(k0, 'newLoans', amt, `Nouveau prêt ${nl.name || ''} (${fmt(amt)})`);
      const endK = n ? E.addMonths(k0, n) : null;
      for (let i = 0; i <= (n || H + 1); i++) {
        const p = E.addMonths(k0, i); if (p > last || (endK && p >= endK)) break;
        let it = amt * rate / 12; if (i === 0) it *= (dim(p) - Number(nl.date.slice(8, 10)) + 1) / dim(p);
        add(E.addMonths(p, 1), 'newInterest', it);
      }
      if (endK) add(endK, 'capital', amt, `Fin du prêt ${nl.name || ''} (${fmt(amt)})`);
    }
    for (const o of S.others || []) { if (!o.date || !num(o.amount)) continue; add(ym(o.date), 'other', num(o.amount), `${o.label || 'Autre'} (${fmt(num(o.amount))})`); }
    let run = opening; const reserve = num(S.reserve);
    const rows = months.map((k) => {
      const x = M[k], expTot = r2(exp.doris + exp.guy + exp.marge + exp.overhead);
      const open = r2(run), inflow = r2(x.interest + x.newInterest + x.capital + x.arrears + Math.max(0, x.other)), outflow = r2(expTot + x.newLoans + Math.max(0, -x.other));
      run = open + inflow - outflow;
      return { k, open, interest: r2(x.interest + x.newInterest + x.arrears), capital: r2(x.capital), expenses: expTot, newLoans: r2(x.newLoans), other: r2(x.other), inflow, outflow,
        net: r2(inflow - outflow), close: r2(run), available: r2(run - reserve), events: x.events };
    });
    const low = rows.reduce((a, r) => (r.close < a.close ? r : a), rows[0]);
    // capacité de prêt : montant qu'on peut prêter maintenant sans passer sous la réserve à aucun mois de l'horizon
    const capacityNow = r2(Math.min(opening - reserve, ...rows.map((r) => r.close - reserve)));
    return { opening, reserve, rows, exp, avg, loans: loansInfo, low, capacityNow, horizon: H };
  }

  /* ---------- équité future : intérêt composé (capitalisation mensuelle) ---------- */
  function compound(c) {
    const P = num(c.start), rate = num(c.rate) / 100, years = Math.max(1, Math.min(60, Math.round(num(c.years)))), inf = num(c.inflation) / 100, pm = num(c.monthly);
    const i = rate / 12, startK = c.startMonth;
    let b = P, cumInt = 0, cumDep = 0;
    const months = [], yearsOut = [];
    for (let y = 1; y <= years; y++) {
      const open = b; let yi = 0, yd = 0;
      for (let mth = 1; mth <= 12; mth++) {
        const it = b * i; b += it + pm; yi += it; yd += pm;
        const t = ((y - 1) * 12 + mth) / 12;
        months.push({ n: (y - 1) * 12 + mth, k: startK ? E.addMonths(startK, (y - 1) * 12 + mth - 1) : null, year: y, open: r2(b - it - pm), interest: r2(it), deposit: pm, close: r2(b), real: r2(b / Math.pow(1 + inf, t)) });
      }
      cumInt += yi; cumDep += yd;
      yearsOut.push({ year: y, open: r2(open), interest: r2(yi), deposit: r2(yd), close: r2(b), real: r2(b / Math.pow(1 + inf, y)), cumInterest: r2(cumInt), cumDeposit: r2(cumDep),
        monthlyIncome: r2(b * i), monthlyIncomeReal: r2(b * i / Math.pow(1 + inf, y)) });
    }
    // retrait mensuel possible pour épuiser l'équité de départ en N années (même rendement)
    const withdraw = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35].filter((n) => n <= Math.max(35, years)).map((n) => {
      const N = n * 12, pmt = i ? P * i / (1 - Math.pow(1 + i, -N)) : P / N;
      return { years: n, payment: r2(pmt), total: r2(pmt * N) };
    });
    const perpetual = r2(P * i);
    return { years: yearsOut, months, withdraw, perpetual, final: yearsOut[yearsOut.length - 1] };
  }

  // rendement réel des 12 derniers mois complets : profit ÷ équité nette moyenne
  function actualReturn(data, today, netEquityAt) {
    const end = E.addMonths(ym(today), -1), start = E.addMonths(end, -11);
    const p = E.pnl(data, `${start}-01`, eom(end), 'accrual', today);
    let s = 0, n = 0; for (let k = E.addMonths(start, -1); k <= end; k = E.addMonths(k, 1)) { s += netEquityAt(eom(k)); n++; }
    const avgEq = s / n;
    return { profit: p.total.profit, avgEquity: r2(avgEq), rate: avgEq ? p.total.profit / avgEq : 0, from: start, to: end };
  }

  function fmt(v) { return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v); }
  const api = { settings, cashForecast, compound, expenseAverages, actualReturn, EXP_KEYS, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinForecast = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* Onglet Prévisions : trésorerie projetée et capacité de prêt, équité future à intérêt composé et pouvoir d'achat.
   Les hypothèses sont gardées dans finances.json (data.forecast). */
(function () {
  'use strict';
  const T = () => window.TF, F = () => window.FinForecast, $ = (s, r = document) => r.querySelector(s);
  const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };
  let TAB = (() => { try { return sessionStorage.getItem('tf.pv') || 'cash'; } catch (e) { return 'cash'; } })();
  const fmtIn = (v) => (v === '' || v == null ? '' : String(v));
  const nextMonth1 = () => `${T().E.addMonths(T().todayISO.slice(0, 7), 1)}-01`;

  function view() {
    const t = T(), S = F().settings(t.data);
    const seg = `<div class="seg big" role="tablist">${[['cash', 'Trésorerie et capacité de prêt'], ['equity', "Équité future et pouvoir d'achat"]].map(([k, l]) => `<button role="tab" data-pv-tab="${k}" class="${TAB === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="section-head"><div><h1>Prévisions</h1><div class="sub">${TAB === 'cash' ? "Argent disponible dans le futur pour faire de nouveaux prêts, selon les prêts actifs, leurs échéances et vos dépenses récurrentes" : "Croissance de l'équité à intérêt composé et sa valeur en dollars d'aujourd'hui"}</div></div>${seg}</div>
      ${TAB === 'cash' ? cashView(S) : equityView(S)}`;
  }

  /* ================================================================ TRÉSORERIE */
  function cashView(S) {
    const t = T(), { m, m0, d, esc, E, kpi, PCT } = t, R = F().cashForecast(t.data, t.todayISO, S);
    const rows = R.rows, H = rows.length, at12 = rows[Math.min(11, H - 1)];
    const capTot = rows.reduce((a, r) => a + r.capital, 0), hasNL = rows.some((r) => r.newLoans), hasOT = rows.some((r) => r.other);
    const x = rows.map((r) => E.monthLabel(r.k).split(' ')[0].slice(0, 4) + (H > 13 ? ` ${r.k.slice(2, 4)}` : ''));
    const xFull = rows.map((r) => E.monthLabel(r.k));
    const evTip = (i) => { const r = rows[i]; return `<div class="fc-tip-r small"><span>+ Entrées</span><b>${m0(r.inflow)}</b></div><div class="fc-tip-r small"><span>− Sorties</span><b>${m0(r.outflow)}</b></div>${r.events.map((e) => `<div class="fc-tip-sub">${esc(e)}</div>`).join('')}`; };
    const expRows = F().EXP_KEYS.map(([k, label]) => `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" data-pv="exp.${k}" value="${fmtIn(S.exp[k])}" placeholder="${R.avg[k].toFixed(2)}"><small class="muted">Moyenne des 6 derniers mois : ${m(R.avg[k])}</small></label>`).join('');
    const modeSel = (l) => `<select data-pv-loan="${l.id}" data-f="mode">${[['repay', "Remboursé à l'échéance"], ['renew', 'Renouvelé (pas de remboursement)'], ['date', 'Remboursé à une autre date']].filter(([k]) => k !== 'repay' || l.maturity).map(([k, lb]) => `<option value="${k}" ${l.mode === k ? 'selected' : ''}>${lb}</option>`).join('')}</select>${l.mode === 'date' ? `<input type="date" data-pv-loan="${l.id}" data-f="date" value="${l.date}">` : ''}`;
    return `
    <div class="kpis">
      ${kpi('Trésorerie aujourd\'hui', m0(R.opening), `Comptes de l'entreprise au ${d(t.todayISO)}`)}
      ${kpi('Disponible pour prêter maintenant', `<span class="${R.capacityNow < 0 ? 'neg' : ''}">${m0(R.capacityNow)}</span>`, `Sans passer sous la réserve de ${m0(R.reserve)} d'ici ${H} mois`)}
      ${kpi(`Trésorerie dans ${Math.min(12, H)} mois`, m0(at12.close), `${E.monthLabel(at12.k)} · disponible ${m0(at12.available)}`)}
      ${kpi('Capital remboursé prévu', m0(capTot), `Sur ${H} mois, selon les hypothèses ci-dessous`)}
      ${kpi('Point le plus bas', `<span class="${R.low.close < R.reserve ? 'neg' : ''}">${m0(R.low.close)}</span>`, E.monthLabel(R.low.k))}
    </div>
    <section class="panel"><div class="panel-head"><h2>Trésorerie projetée</h2><span class="muted small">Solde à la fin de chaque mois · ${H} mois</span></div>
      <div class="panel-body">${FinCharts.render({ id: 'pv-cash', w: 1000, height: 300, type: 'line', zero: true, endLabels: true, title: 'Trésorerie projetée', x, xFull,
        series: [{ key: 'close', label: 'Trésorerie projetée', slot: 1, bold: true, values: rows.map((r) => r.close) }, { key: 'res', label: 'Réserve minimale', slot: 2, dash: true, values: rows.map(() => R.reserve) }],
        extra: evTip })}</div></section>
    ${flowsPanel(rows, x, xFull, esc)}
    <section class="panel"><div class="panel-head"><h2>Hypothèses</h2><button class="btn ghost small" data-pv-act="reset-exp">Dépenses : reprendre les moyennes</button></div>
        <div class="panel-body pv-form pv-4">
          <label class="field"><span>Horizon</span><select data-pv="horizon">${[12, 18, 24, 36, 48, 60].map((n) => `<option value="${n}" ${Number(S.horizon) === n ? 'selected' : ''}>${n} mois</option>`).join('')}</select></label>
          <label class="field"><span>Réserve minimale à garder</span><input type="text" inputmode="decimal" data-pv="reserve" value="${fmtIn(S.reserve)}"><small class="muted">Coussin jamais prêté</small></label>
          <label class="field check span-2 pv-arr"><input type="checkbox" data-pv="arrears" ${S.arrears ? 'checked' : ''}> Compter les arriérés comme encaissés le mois prochain (${m(R.loans.reduce((a, l) => a + l.arrears, 0))})</label>
          <h4 class="span-all">Sorties mensuelles prévues</h4>
          ${expRows}
          <p class="small muted span-all">Total : ${m(R.exp.doris + R.exp.guy + R.exp.marge + R.exp.overhead)} par mois. Laissez vide pour utiliser la moyenne; ajustez si une dette est remboursée.</p>
        </div></section>
    <section class="panel"><div class="panel-head"><h2>Prêts actifs</h2><span class="muted small">Hypothèse de remboursement par prêt</span></div>
        <div class="table-wrap"><table class="pv-loans"><thead><tr><th>Prêt</th><th class="num">Solde</th><th class="num">Intérêt / mois</th><th>Échéance</th><th>Hypothèse</th></tr></thead><tbody>
          ${R.loans.map((l) => `<tr><td>${esc(l.name)}${l.arrears > 0.5 ? `<div class="small neg">Arriérés ${m(l.arrears)}</div>` : ''}</td><td class="num">${m0(l.balance)}</td><td class="num">${m(l.monthly)}<div class="small muted">${PCT.format(l.rate)}</div></td><td>${l.maturity ? d(l.maturity) : '<span class="muted">—</span>'}</td><td class="pv-mode">${modeSel(l)}${l.capital ? `<div class="small muted">${m0(l.capital)} en ${E.monthLabel(l.payoff.slice(0, 7))}</div>` : ''}</td></tr>`).join('')}
        </tbody></table></div></section>

    <div class="grid-2 even">
      <section class="panel"><div class="panel-head"><h2>Nouveaux prêts prévus</h2><button class="btn small" data-pv-act="add-loan">+ Prêt prévu</button></div>
        ${S.newLoans.length ? `<div class="table-wrap"><table class="pv-edit"><thead><tr><th>Nom</th><th>Déboursé le</th><th class="num">Montant</th><th class="num">Taux %</th><th class="num">Durée (mois)</th><th></th></tr></thead><tbody>
          ${S.newLoans.map((nl, i) => `<tr><td><input type="text" data-pv-nl="${i}" data-f="name" value="${esc(nl.name || '')}" placeholder="Ex. : prêt Laval"></td><td><input type="date" data-pv-nl="${i}" data-f="date" value="${nl.date || ''}"></td>
            <td><input type="text" class="num" inputmode="decimal" data-pv-nl="${i}" data-f="amount" value="${fmtIn(nl.amount)}"></td><td><input type="text" class="num" inputmode="decimal" data-pv-nl="${i}" data-f="rate" value="${fmtIn(nl.rate)}"></td>
            <td><input type="text" class="num" inputmode="numeric" data-pv-nl="${i}" data-f="months" value="${fmtIn(nl.months)}" placeholder="0 = sans fin"></td><td><button class="btn ghost small" data-pv-act="del-loan" data-i="${i}" aria-label="Retirer">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="panel-body"><p class="muted">Ajoutez un prêt que vous prévoyez faire : le montant sort de la trésorerie à la date du déboursé, les intérêts entrent chaque mois et le capital revient à la fin de la durée.</p></div>`}
      </section>
      <section class="panel"><div class="panel-head"><h2>Autres mouvements prévus</h2><button class="btn small" data-pv-act="add-other">+ Mouvement</button></div>
        ${S.others.length ? `<div class="table-wrap"><table class="pv-edit"><thead><tr><th>Date</th><th>Description</th><th class="num">Montant (+ entrée, − sortie)</th><th></th></tr></thead><tbody>
          ${S.others.map((o, i) => `<tr><td><input type="date" data-pv-ot="${i}" data-f="date" value="${o.date || ''}"></td><td><input type="text" data-pv-ot="${i}" data-f="label" value="${esc(o.label || '')}" placeholder="Ex. : remboursement à Doris"></td>
            <td><input type="text" class="num" inputmode="decimal" data-pv-ot="${i}" data-f="amount" value="${fmtIn(o.amount)}"></td><td><button class="btn ghost small" data-pv-act="del-other" data-i="${i}" aria-label="Retirer">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="panel-body"><p class="muted">Ex. : remboursement d'une partie de la dette à Doris ou à Guy, retrait de l'actionnaire, frais de dossier attendus.</p></div>`}
      </section>
    </div>

    <section class="panel"><div class="panel-head"><h2>Tableau de trésorerie</h2><span class="muted small">Départ : ${m(R.opening)} au ${d(t.todayISO)}</span></div>
      <div class="table-wrap"><table class="pv-table"><thead><tr><th>Mois</th><th class="num">Solde au début</th><th class="num">Intérêts reçus</th><th class="num">Capital remboursé</th><th class="num">Sorties récurrentes</th>${hasNL ? '<th class="num">Nouveaux prêts</th>' : ''}${hasOT ? '<th class="num">Autres</th>' : ''}<th class="num">Solde à la fin</th><th class="num">Disponible pour prêter</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.events.length ? 'has-ev' : ''}"><td>${E.monthLabel(r.k)}${r.events.length ? `<div class="small muted">${r.events.map(esc).join('<br>')}</div>` : ''}</td><td class="num">${m0(r.open)}</td><td class="num">${m0(r.interest)}</td><td class="num">${r.capital ? m0(r.capital) : '<span class="muted">—</span>'}</td>
          <td class="num">${m0(-r.expenses)}</td>${hasNL ? `<td class="num">${r.newLoans ? m0(-r.newLoans) : '<span class="muted">—</span>'}</td>` : ''}${hasOT ? `<td class="num">${r.other ? m0(r.other) : '<span class="muted">—</span>'}</td>` : ''}<td class="num"><b>${m0(r.close)}</b></td><td class="num ${r.available < 0 ? 'neg' : ''}">${m0(r.available)}</td></tr>`).join('')}
      </tbody></table></div></section>
    <p class="hint">Les intérêts attendus viennent du calendrier de chaque prêt (payés à terme échu, encaissés le mois suivant; ce qui est déjà payé d'avance n'est pas compté deux fois). Le prêt remboursé rapporte ses intérêts jusqu'à la date de remboursement. Les intérêts capitalisés sont encaissés avec le capital au remboursement.</p>`;
  }


  /* ---------- Entrées et sorties : trois vues ---------- */
  function flowsPanel(rows, x, xFull, esc) {
    const t = T(), mode = t.ui.pvFlow || 'stack', m0 = t.m0, withCap = !!t.ui.pvFlowCap;
    const ev = (i) => rows[i].events.map((e) => `<div class="fc-tip-sub">${esc(e)}</div>`).join('');
    // vue opérationnelle par défaut : intérêts et dépenses récurrentes, sans les mouvements de capital (remboursements, nouveaux prêts, autres)
    const R = rows.map((r) => withCap ? { ...r } : { ...r, inflow: r.interest, outflow: r.expenses, net: Math.round((r.interest - r.expenses) * 100) / 100, capital: 0, other: 0 });
    const seg = `<div class="seg" role="group">${[['stack', 'Entrées / sorties'], ['net', 'Net mensuel'], ['line', 'Courbes']].map(([k, l]) => `<button type="button" data-pv-act="flow" data-v="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const netTot = R.reduce((a, r) => a + r.net, 0), pos = R.filter((r) => r.net >= 0).length;
    const sub = `<div class="mini-kpis"><div><span>Net cumulé sur ${R.length} mois</span><b class="${netTot < 0 ? 'neg' : ''}">${netTot >= 0 ? '+' : ''}${m0(netTot)}</b></div><div><span>Mois positifs</span><b>${pos} / ${R.length}</b></div><div><span>Net mensuel moyen</span><b class="${netTot < 0 ? 'neg' : ''}">${m0(netTot / R.length)}</b></div><label class="check small muted" style="align-self:end"><input type="checkbox" data-pv="flowCap" ${withCap ? 'checked' : ''}> Inclure le capital (remboursements, nouveaux prêts, autres mouvements)</label></div>`;
    let chart;
    if (mode === 'net') chart = FinCharts.render({ id: 'pv-flows-net', w: 1000, height: 280, type: 'bar', title: 'Variation nette de trésorerie par mois', x, xFull,
      series: [{ key: 'net', label: 'Net du mois (entrées − sorties)', slot: 3, signColor: true, values: R.map((r) => r.net) }, { key: 'cum', label: 'Net cumulé', slot: 1, kind: 'line', values: (() => { let a = 0; return R.map((r) => (a = Math.round((a + r.net) * 100) / 100)); })() }],
      extra: (i) => `<div class="fc-tip-r small"><span>+ Entrées</span><b>${m0(R[i].inflow)}</b></div><div class="fc-tip-r small"><span>− Sorties</span><b>${m0(R[i].outflow)}</b></div>${ev(i)}` });
    else if (mode === 'line') chart = FinCharts.render({ id: 'pv-flows-line', w: 1000, height: 280, type: 'line', zero: true, endLabels: true, title: 'Entrées, sorties et net par mois', x, xFull,
      series: [{ key: 'in', label: 'Entrées', slot: 3, values: R.map((r) => r.inflow) }, { key: 'out', label: 'Sorties', slot: 2, values: R.map((r) => r.outflow) }, { key: 'net', label: 'Net', slot: 1, bold: true, values: R.map((r) => r.net) }],
      extra: ev });
    else chart = FinCharts.render({ id: 'pv-flows', w: 1000, height: 280, type: 'bar', stacked: true, title: 'Entrées et sorties prévues', x, xFull,
      series: [{ key: 'int', label: 'Intérêts reçus', slot: 1, values: R.map((r) => r.interest) }, { key: 'cap', label: 'Capital remboursé', slot: 3, values: R.map((r) => r.capital + Math.max(0, r.other)) },
        { key: 'out', label: 'Sorties (dépenses, nouveaux prêts)', slot: 2, values: R.map((r) => -r.outflow) }, { key: 'net', label: 'Net du mois', slot: 1, kind: 'line', bold: true, values: R.map((r) => r.net) }],
      total: (i) => ['Variation nette', R[i].net], extra: ev });
    return `<section class="panel"><div class="panel-head"><h2>Entrées et sorties prévues</h2><div class="toolbar">${seg}</div></div>
      <div class="panel-body">${sub}${chart}</div></section>`;
  }

  /* ================================================================ ÉQUITÉ FUTURE */
  function equityView(S) {
    const t = T(), { m, m0, d, esc, E, kpi, PCT } = t, c = S.compound;
    const eqNow = t.netEquity(t.todayISO).equity;
    const act = F().actualReturn(t.data, t.todayISO, (dt) => t.netEquity(dt).equity);
    const startMonth = c.startMonth || t.E.addMonths(t.todayISO.slice(0, 7), 1);
    const start = c.start === null || c.start === '' || c.start === undefined ? eqNow : num(c.start);
    const R = F().compound({ ...c, start, startMonth });
    const Y = R.years, fin = R.final, y0 = +startMonth.slice(0, 4);
    const yearLbl = (y) => E.addMonths(startMonth, y * 12 - 1).slice(0, 4);
    const labelYear = (y) => `Année ${y} (${E.monthLabel(E.addMonths(startMonth, (y - 1) * 12))} – ${E.monthLabel(E.addMonths(startMonth, y * 12 - 1))})`;
    return `
    <div class="kpis">
      ${kpi(`Équité dans ${c.years} ans`, m0(fin.close), `${E.monthLabel(E.addMonths(startMonth, c.years * 12 - 1))}, à ${num(c.rate).toLocaleString('fr-CA')} % composé mensuellement`)}
      ${kpi("Pouvoir d'achat (dollars d'aujourd'hui)", m0(fin.real), `Avec une inflation de ${num(c.inflation).toLocaleString('fr-CA')} % par an`)}
      ${kpi('Intérêts composés cumulés', m0(fin.cumInterest), num(c.monthly) ? `Apports nets ${m0(fin.cumDeposit)}` : `Départ ${m0(start)}`)}
      ${kpi('Revenu mensuel à la fin', m0(fin.monthlyIncome), `${m0(fin.monthlyIncomeReal)} en dollars d'aujourd'hui`)}
    </div>
    <div class="grid-2 pv-eq">
      <section class="panel"><div class="panel-head"><h2>Hypothèses</h2></div>
        <div class="panel-body pv-form">
          <label class="field span-2"><span>Équité de départ</span><input type="text" inputmode="decimal" data-pv="compound.start" value="${c.start === null || c.start === undefined ? '' : c.start}" placeholder="${eqNow.toFixed(2)}">
            <small class="muted">Vide = équité nette actuelle (${m0(eqNow)} : TD + prêts − marge, Doris et Guy)</small></label>
          <label class="field"><span>Rendement annuel net (%)</span><input type="text" inputmode="decimal" data-pv="compound.rate" value="${fmtIn(c.rate)}"></label>
          <label class="field"><span>Inflation annuelle (%)</span><input type="text" inputmode="decimal" data-pv="compound.inflation" value="${fmtIn(c.inflation)}"></label>
          <label class="field"><span>Durée (années)</span><input type="text" inputmode="numeric" data-pv="compound.years" value="${fmtIn(c.years)}"></label>
          <label class="field"><span>Mois de départ</span><input type="month" data-pv="compound.startMonth" value="${startMonth}"></label>
          <label class="field span-2"><span>Apport mensuel (+) ou retrait (−)</span><input type="text" inputmode="decimal" data-pv="compound.monthly" value="${fmtIn(c.monthly)}"><small class="muted">Ajouté à la fin de chaque mois, après les intérêts</small></label>
          <div class="callout span-2 small">Votre rendement réel des 12 derniers mois : <b>${PCT.format(act.rate)}</b> (profit de ${m0(act.profit)} en reconnaissance ÷ équité nette moyenne de ${m0(act.avgEquity)}, ${E.monthLabel(act.from)} à ${E.monthLabel(act.to)}).
            <button class="btn small" data-pv-act="use-actual" data-v="${(act.rate * 100).toFixed(2)}">Utiliser ce rendement</button></div>
        </div></section>
      <section class="panel"><div class="panel-head"><h2>Évolution de l'équité</h2><span class="muted small">Fin de chaque année</span></div>
        <div class="panel-body">${FinCharts.render({ id: 'pv-eq', w: 640, height: 300, type: 'line', zero: true, endLabels: true, title: "Équité future et pouvoir d'achat", x: Y.map((r) => yearLbl(r.year)), xFull: Y.map((r) => labelYear(r.year)),
          series: [{ key: 'nom', label: 'Équité (dollars courants)', slot: 1, bold: true, values: Y.map((r) => r.close) }, { key: 'real', label: "Pouvoir d'achat (dollars d'aujourd'hui)", slot: 3, values: Y.map((r) => r.real) }]
            .concat(num(c.monthly) ? [{ key: 'dep', label: 'Départ + apports', slot: 2, dash: true, values: Y.map((r) => start + r.cumDeposit) }] : []),
          extra: (i) => `<div class="fc-tip-r small"><span>Intérêts de l'année</span><b>${m0(Y[i].interest)}</b></div><div class="fc-tip-r small"><span>Revenu mensuel</span><b>${m0(Y[i].monthlyIncome)}</b></div>` })}</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Tableau de l'équité par année</h2><label class="small muted check"><input type="checkbox" data-pv="compound.detail" ${c.detail ? 'checked' : ''}> Détail mensuel</label></div>
      <div class="table-wrap pv-scroll">${c.detail ? `<table class="pv-table"><thead><tr><th>#</th><th>Mois</th><th class="num">Solde au début</th><th class="num">Intérêts</th><th class="num">Apport / retrait</th><th class="num">Solde à la fin</th><th class="num">Pouvoir d'achat</th></tr></thead><tbody>
          ${R.months.map((r) => `<tr class="${r.n % 12 === 0 ? 'yr-end' : ''}"><td class="num">${r.n}</td><td>${E.monthLabel(r.k)}</td><td class="num">${m0(r.open)}</td><td class="num">${m(r.interest)}</td><td class="num">${r.deposit ? m0(r.deposit) : '<span class="muted">—</span>'}</td><td class="num"><b>${m0(r.close)}</b></td><td class="num">${m0(r.real)}</td></tr>`).join('')}</tbody></table>`
        : `<table class="pv-table"><thead><tr><th>Année</th><th class="num">Équité au début</th><th class="num">Intérêts composés</th>${num(c.monthly) ? '<th class="num">Apports / retraits</th>' : ''}<th class="num">Équité à la fin</th><th class="num">Pouvoir d'achat</th><th class="num">Intérêts cumulés</th><th class="num">Revenu mensuel possible</th></tr></thead><tbody>
          ${Y.map((r) => `<tr><td>${r.year} <span class="muted small">· ${E.monthLabel(E.addMonths(startMonth, r.year * 12 - 1))}</span></td><td class="num">${m0(r.open)}</td><td class="num">${m0(r.interest)}</td>${num(c.monthly) ? `<td class="num">${m0(r.deposit)}</td>` : ''}<td class="num"><b>${m0(r.close)}</b></td><td class="num">${m0(r.real)}</td><td class="num">${m0(r.cumInterest)}</td><td class="num">${m0(r.monthlyIncome)}<div class="small muted">${m0(r.monthlyIncomeReal)} d'aujourd'hui</div></td></tr>`).join('')}</tbody></table>`}
      </div></section>
    <section class="panel"><div class="panel-head"><h2>Retrait mensuel possible à partir de l'équité de départ</h2><span class="muted small">${m0(start)} à ${num(c.rate).toLocaleString('fr-CA')} %</span></div>
      <div class="panel-body"><p class="small muted" style="margin-top:0">Montant que vous pourriez retirer chaque mois pendant la durée indiquée en vidant l'équité, si elle continue de rapporter ce rendement. Sans toucher au capital : <b>${m0(R.perpetual)}</b> par mois.</p>
        <div class="table-wrap"><table class="pv-table pv-w"><thead><tr><th>Durée</th><th class="num">Retrait mensuel</th><th class="num">Total retiré</th><th class="num">Retrait mensuel en dollars d'aujourd'hui (fin de période)</th></tr></thead><tbody>
          ${R.withdraw.map((w) => `<tr><td>${w.years} an${w.years > 1 ? 's' : ''}</td><td class="num"><b>${m(w.payment)}</b></td><td class="num">${m0(w.total)}</td><td class="num">${m0(w.payment / Math.pow(1 + num(c.inflation) / 100, w.years))}</td></tr>`).join('')}
        </tbody></table></div></div></section>
    <p class="hint">Pouvoir d'achat = équité ÷ (1 + inflation)<sup>années écoulées</sup> : ce que l'équité de cette année-là permettrait d'acheter en dollars d'aujourd'hui.</p>`;
  }

  /* ================================================================ ÉVÉNEMENTS */
  function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; }); o[ks[ks.length - 1]] = v; }
  const inView = (el) => el && el.closest && el.closest('#view') && T() && T().ui.view === 'forecast';
  document.addEventListener('change', (ev) => {
    const el = ev.target; if (!inView(el)) return;
    const S = F().settings(T().data);
    if (el.dataset.pv === 'flowCap') { T().ui.pvFlowCap = el.checked; T().saveUi(); return T().render(); }
    if (el.dataset.pv) {
      const k = el.dataset.pv;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'compound.start' && v === '') v = null;
      setPath(S, k, v);
    } else if (el.dataset.pvLoan) { const id = el.dataset.pvLoan; S.loans[id] = S.loans[id] || {}; S.loans[id][el.dataset.f] = el.value; if (el.dataset.f === 'mode' && el.value === 'date' && !S.loans[id].date) S.loans[id].date = (T().loanById(id) || {}).maturity || nextMonth1(); }
    else if (el.dataset.pvNl != null) S.newLoans[+el.dataset.pvNl][el.dataset.f] = el.value;
    else if (el.dataset.pvOt != null) S.others[+el.dataset.pvOt][el.dataset.f] = el.value;
    else return;
    T().persist(); T().render();
  });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-pv-tab],[data-pv-act]'); if (!b || !inView(b)) return;
    const S = F().settings(T().data);
    if (b.dataset.pvTab) { TAB = b.dataset.pvTab; try { sessionStorage.setItem('tf.pv', TAB); } catch (e) { /* rien */ } return T().render(); }
    const a = b.dataset.pvAct;
    if (a === 'flow') { T().ui.pvFlow = b.dataset.v; T().saveUi(); return T().render(); }
    if (a === 'add-loan') { const R = F().cashForecast(T().data, T().todayISO, S); S.newLoans.push({ name: '', date: nextMonth1(), amount: Math.max(0, Math.floor(R.capacityNow / 5000) * 5000), rate: 12, months: 12 }); }
    else if (a === 'del-loan') S.newLoans.splice(+b.dataset.i, 1);
    else if (a === 'add-other') S.others.push({ date: nextMonth1(), label: '', amount: '' });
    else if (a === 'del-other') S.others.splice(+b.dataset.i, 1);
    else if (a === 'reset-exp') S.exp = {};
    else if (a === 'use-actual') S.compound.rate = b.dataset.v;
    else return;
    T().persist(); T().render();
  });
  window.TFForecast = { view };
})();

/* Prêts : vue Échéancier (Gantt) et vue Calendrier.
   Événements : début du prêt, modifications, échéance, remboursement prévu (onglet Prévisions), remboursement réel,
   et, au besoin, les intérêts attendus chaque mois. */
(function () {
  'use strict';
  const T = () => window.TF;
  const STATE = (() => { try { return Object.assign({ range: 'auto', filter: 'all', month: null, calView: 'month', showInt: false, showPaid: true }, JSON.parse(sessionStorage.getItem('tf.tl') || '{}')); } catch (e) { return { range: 'auto', filter: 'all', month: null, calView: 'month', showInt: false }; } })();
  const save = () => { try { sessionStorage.setItem('tf.tl', JSON.stringify(STATE)); } catch (e) { /* rien */ } };
  const DAY = 864e5, t0 = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const dim = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
  const short = (name) => name.split(' — ')[0];
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MONTHS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // Remboursement prévu : hypothèse de l'onglet Prévisions (autre date, renouvelé) ou, par défaut, l'échéance
  function plannedPayoff(loan) {
    const f = ((T().data.forecast || {}).loans || {})[loan.id] || {};
    if (loan.closedOn) return null;
    if (f.mode === 'date' && f.date) return { date: f.date, custom: true };
    if (f.mode === 'renew') return { renew: true };
    return loan.maturity ? { date: loan.maturity, custom: false } : null;
  }
  function loanInfo(loan) {
    const { E, todayISO, data } = T();
    const st = E.loanStatus(loan, todayISO), start = loan.versions[0].from, plan = plannedPayoff(loan);
    const bal = E.balances(data, todayISO)[`loans|${loan.id}`] || 0;
    const v = loan.versions[loan.versions.length - 1];
    const end = loan.closedOn || (plan && plan.date) || loan.maturity || null;
    const overdue = !loan.closedOn && loan.maturity && loan.maturity < todayISO;
    return { loan, st, start, end, plan, overdue, principal: st === 'closed' ? v.principal : bal || v.principal, rate: v.rate, versions: loan.versions };
  }
  function events(from, to) {
    const { data, E, todayISO } = T(), out = [];
    const push = (date, type, loan, label, extra) => { if (date && date >= from && date <= to) out.push({ date, type, loan, label, ...(extra || {}) }); };
    for (const loan of data.loans) {
      const L = loanInfo(loan);
      push(L.start, 'start', loan, `Début · ${T().m0(loan.versions[0].principal)}`);
      loan.versions.slice(1).forEach((v) => push(v.from, 'mod', loan, `${v.label || 'Modification'} · ${T().m0(v.principal)} à ${T().PCT.format(v.rate)}`));
      if (loan.maturity) push(loan.maturity, 'maturity', loan, `Capital ${T().m0(L.principal)}${loan.closedOn ? ` · remboursé le ${T().d(loan.closedOn)}` : L.overdue ? ' · échéance dépassée' : L.plan && L.plan.renew ? ' · renouvellement prévu' : L.plan && L.plan.custom ? ` · remboursement prévu le ${T().d(L.plan.date)}` : ''}`);
      if (L.plan && L.plan.custom) push(L.plan.date, 'planned', loan, `Capital ${T().m0(L.principal)}`);
      if (loan.closedOn) push(loan.closedOn, 'closed', loan, `Capital ${T().m0(L.principal)}`);
      if (STATE.showPaid) {
        const byEntry = {};
        for (const e of data.entries) for (const ln of e.lines) {
          if (ln.acct !== 'rev:interest' || ln.loan !== loan.id || e.date < from || e.date > to) continue;
          const g = byEntry[e.id] = byEntry[e.id] || { date: e.date, amt: 0, periods: [] };
          g.amt -= ln.amt; if (ln.period && !g.periods.includes(ln.period)) g.periods.push(ln.period);
        }
        Object.values(byEntry).forEach((g) => { if (Math.abs(g.amt) < 0.005) return; g.periods.sort();
          const cov = g.periods.length ? ` · ${g.periods.length > 2 ? `${E.monthLabel(g.periods[0])} à ${E.monthLabel(g.periods[g.periods.length - 1])}` : g.periods.map((p) => E.monthLabel(p)).join(', ')}` : '';
          push(g.date, 'received', loan, `${T().m(g.amt)} reçus${cov}`, { amt: g.amt }); });
      }
      if (STATE.showInt && L.st !== 'future') {
        const s = E.schedule(data, loan.id, todayISO, 14);
        for (const r of s.rows) {
          if (!r.expected || r.afterMaturity) continue;
          const due = `${E.addMonths(r.period, 1)}-01`;
          if (loan.closedOn && due > E.addMonths(loan.closedOn.slice(0, 7), 1) + '-01') continue;
          push(due, 'interest', loan, `Intérêts ${E.monthLabel(r.period)} · ${T().m(r.expected)}${r.received >= r.expected - 0.5 ? ' (reçus)' : r.received ? ` (reçu ${T().m(r.received)})` : ''}`, { paid: r.received >= r.expected - 0.5 });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  }
  const TYPES = { start: ['Début du prêt', '▶'], mod: ['Modification', '✎'], maturity: ['Échéance', '◆'], planned: ['Remboursement prévu', '◎'], closed: ['Remboursé', '✓'], interest: ['Intérêts attendus', '$'], received: ['Intérêts encaissés', '$'] };
  const legend = (types) => `<div class="lt-legend">${types.map((k) => `<span class="lt-ev ${k}"><i>${TYPES[k][1]}</i>${TYPES[k][0]}</span>`).join('')}</div>`;

  /* ================================================================ ÉCHÉANCIER (GANTT) */
  function gantt() {
    const { data, todayISO, esc, m0, d, PCT } = T();
    const list = data.loans.map(loanInfo).filter((x) => STATE.filter === 'all' || (STATE.filter === 'active' ? x.st !== 'closed' : x.st === 'closed'))
      .sort((a, b) => a.start.localeCompare(b.start));
    // période affichée
    const allDates = list.flatMap((x) => [x.start, x.end, x.loan.maturity].filter(Boolean)).concat([todayISO]);
    let from, to;
    if (STATE.range === 'auto') { from = allDates.reduce((a, b) => (b < a ? b : a)); to = allDates.reduce((a, b) => (b > a ? b : a)); from = `${from.slice(0, 7)}-01`; const k = T().E.addMonths(to.slice(0, 7), 2); to = `${k}-${dim(k)}`; }
    else if (STATE.range === '12') { const k = T().E.addMonths(todayISO.slice(0, 7), -4); from = `${k}-01`; const e = T().E.addMonths(k, 15); to = `${e}-${dim(e)}`; }
    else { from = `${STATE.range}-01-01`; to = `${STATE.range}-12-31`; }
    const A = t0(from), B = t0(to) + DAY, span = B - A, pct = (date) => Math.max(0, Math.min(100, (t0(date) - A) / span * 100));
    const months = []; for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = T().E.addMonths(k, 1)) months.push(k);
    const yearsSet = [...new Set(data.loans.flatMap((l) => [l.versions[0].from, l.maturity, l.closedOn]).filter(Boolean).map((x) => x.slice(0, 4)))].sort();
    const dense = months.length > 18, showLbl = (k) => !dense || ['01', '04', '07', '10'].includes(k.slice(5));
    const head = months.map((k) => { const l = pct(`${k}-01`), w = dim(k) * DAY / span * 100; return `<div class="lt-m ${k.endsWith('-01') ? 'jan' : ''}" style="left:${l}%;width:${w * (dense ? 3 : 1)}%">${showLbl(k) ? `<span>${MONTHS[+k.slice(5) - 1]}${k.endsWith('-01') || k === months[0] ? ` ${k.slice(0, 4)}` : ''}</span>` : ''}</div>`; }).join('');
    const showToday = todayISO >= from && todayISO <= to;
    const today = showToday ? `<div class="lt-today" style="left:${pct(todayISO)}%"><span>Aujourd'hui</span></div>` : '';
    const todayLine = showToday ? `<div class="lt-todayline" style="left:${pct(todayISO)}%"></div>` : '';
    const rows = list.map((x) => {
      const l = x.loan, s = x.start < from ? from : x.start;
      const openEnd = !x.end || (x.plan && x.plan.renew);
      const e = openEnd ? to : (x.end > to ? to : x.end);
      const visible = x.start <= to && (openEnd || x.end >= from);
      const tip = `${l.name}\nDébut : ${d(x.start)}\nCapital : ${m0(x.principal)} à ${PCT.format(x.rate)}${l.maturity ? `\nÉchéance : ${d(l.maturity)}` : '\nSans échéance'}${l.closedOn ? `\nRemboursé le ${d(l.closedOn)}` : x.plan && x.plan.custom ? `\nRemboursement prévu : ${d(x.plan.date)}` : x.plan && x.plan.renew ? '\nRenouvellement prévu' : ''}`;
      const bar = visible ? `<div class="lt-bar ${x.st}${x.overdue ? ' overdue' : ''}${openEnd ? ' open' : ''}" style="left:${pct(s)}%;width:${Math.max(0.6, pct(e) - pct(s))}%" title="${esc(tip)}" data-action="open-loan" data-id="${l.id}"><span>${esc(m0(x.principal))}</span></div>` : '';
      const marks = [];
      l.versions.slice(1).forEach((v) => { if (v.from >= from && v.from <= to) marks.push(`<i class="lt-mk mod" style="left:${pct(v.from)}%" title="${esc(`${v.label || 'Modification'} le ${d(v.from)} : ${m0(v.principal)} à ${PCT.format(v.rate)}`)}">✎</i>`); });
      if (l.maturity && l.maturity >= from && l.maturity <= to) marks.push(`<i class="lt-mk maturity${x.overdue ? ' late' : ''}" style="left:${pct(l.maturity)}%" title="${esc(`Échéance le ${d(l.maturity)}${x.overdue ? ' — dépassée, prêt non remboursé' : ''}`)}">◆</i>`);
      if (x.plan && x.plan.custom && x.plan.date >= from && x.plan.date <= to) marks.push(`<i class="lt-mk planned" style="left:${pct(x.plan.date)}%" title="${esc(`Remboursement prévu le ${d(x.plan.date)}`)}">◎</i>`);
      if (l.closedOn && l.closedOn >= from && l.closedOn <= to) marks.push(`<i class="lt-mk closed" style="left:${pct(l.closedOn)}%" title="${esc(`Remboursé le ${d(l.closedOn)}`)}">✓</i>`);
      const endTxt = l.closedOn ? `Remboursé le ${d(l.closedOn)}` : x.plan && x.plan.custom ? `Prévu le ${d(x.plan.date)}` : x.plan && x.plan.renew ? 'Renouvellement prévu' : l.maturity ? `Échéance ${d(l.maturity)}` : 'Sans échéance';
      const left = (l.maturity && !l.closedOn) ? Math.round((t0(l.maturity) - t0(todayISO)) / DAY) : null;
      return `<div class="lt-row ${x.st}">
        <div class="lt-label"><button class="linklike" data-action="open-loan" data-id="${l.id}">${esc(short(l.name))}</button><div class="small muted">${m0(x.principal)} · ${PCT.format(x.rate)}</div><div class="small ${x.overdue ? 'neg' : 'muted'}">${endTxt}${left != null ? ` · ${left >= 0 ? `dans ${left} j` : `dépassée de ${-left} j`}` : ''}</div></div>
        <div class="lt-track">${months.map((k) => `<div class="lt-grid ${k.endsWith('-01') ? 'jan' : ''}" style="left:${pct(`${k}-01`)}%"></div>`).join('')}${todayLine}${bar}${marks.join('')}</div></div>`;
    }).join('');
    const opt = (v, lb, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${lb}</option>`;
    const upcoming = events(todayISO, `${T().E.addMonths(todayISO.slice(0, 7), 6)}-31`).filter((e) => ['maturity', 'planned'].includes(e.type));
    return `
    <div class="lt-filters">
      <label class="small muted">Prêts <select data-tl="filter">${opt('all', 'Tous', STATE.filter)}${opt('active', 'En cours', STATE.filter)}${opt('closed', 'Remboursés', STATE.filter)}</select></label>
      <label class="small muted">Période <select data-tl="range">${opt('auto', 'Toute la durée des prêts', STATE.range)}${opt('12', '16 mois autour d\'aujourd\'hui', STATE.range)}${yearsSet.map((y) => opt(y, y, STATE.range)).join('')}</select></label>
      ${legend(['start', 'mod', 'maturity', 'planned', 'closed'])}
    </div>
    ${upcoming.length ? `<div class="callout small">Dans les 6 prochains mois : ${upcoming.map((e) => `<b>${esc(short(e.loan.name))}</b> ${e.type === 'planned' ? 'remboursement prévu' : 'échéance'} le ${d(e.date)}`).join(' · ')}</div>` : ''}
    <section class="panel lt-panel"><div class="lt-wrap">
      <div class="lt-row lt-headrow"><div class="lt-label small muted">${list.length} prêt${list.length > 1 ? 's' : ''}</div><div class="lt-track lt-head">${head}${today}</div></div>
      ${rows || '<div class="empty">Aucun prêt.</div>'}
    </div></section>
    <p class="hint">Barre pleine : prêt en cours; grise : remboursé; hachurée au bout : sans échéance ou renouvellement prévu. ◆ échéance (rouge si dépassée), ◎ remboursement prévu (hypothèse de l'onglet Prévisions), ✓ remboursement réel, ✎ modification. Cliquez sur un prêt pour ouvrir sa fiche.</p>`;
  }

  /* ================================================================ CALENDRIER */
  function calendar() {
    const { todayISO, esc, d, E } = T();
    const k = STATE.month || todayISO.slice(0, 7);
    const seg = `<div class="seg" role="group">${[['month', 'Mois'], ['agenda', 'Liste']].map(([v, l]) => `<button type="button" data-tl-act="calview" data-v="${v}" class="${STATE.calView === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const nav = `<div class="toolbar"><button class="btn small" data-tl-act="prev" aria-label="Mois précédent">‹</button><b class="lt-mtitle">${MONTHS_L[+k.slice(5) - 1]} ${k.slice(0, 4)}</b><button class="btn small" data-tl-act="next" aria-label="Mois suivant">›</button><button class="btn ghost small" data-tl-act="today">Aujourd'hui</button></div>`;
    const top = `<div class="lt-filters">${STATE.calView === 'month' ? nav : ''}${seg}<label class="small muted check"><input type="checkbox" data-tl="showPaid" ${STATE.showPaid ? 'checked' : ''}> Intérêts encaissés (date du dépôt)</label><label class="small muted check"><input type="checkbox" data-tl="showInt" ${STATE.showInt ? 'checked' : ''}> Intérêts attendus (le 1er du mois)</label>${legend(['start', 'mod', 'maturity', 'planned', 'closed'].concat(STATE.showPaid ? ['received'] : [], STATE.showInt ? ['interest'] : []))}</div>`;
    if (STATE.calView === 'agenda') {
      const from = `${E.addMonths(todayISO.slice(0, 7), -2)}-01`, to = `${E.addMonths(todayISO.slice(0, 7), 18)}-28`;
      const ev = events(from, to); const byMonth = {};
      ev.forEach((e) => { (byMonth[e.date.slice(0, 7)] = byMonth[e.date.slice(0, 7)] || []).push(e); });
      return `${top}<section class="panel"><div class="panel-body lt-agenda">${Object.keys(byMonth).sort().map((mk) => `<h3 class="${mk === todayISO.slice(0, 7) ? 'cur' : ''}">${MONTHS_L[+mk.slice(5) - 1]} ${mk.slice(0, 4)}</h3><ul>${byMonth[mk].map((e) => `<li class="${e.date < todayISO ? 'past' : ''}"><span class="lt-date">${d(e.date)}</span><span class="lt-ev ${e.type}${e.paid ? ' paid' : ''}"><i>${TYPES[e.type][1]}</i>${TYPES[e.type][0]}</span><button class="linklike" data-action="open-loan" data-id="${e.loan.id}">${esc(short(e.loan.name))}</button><span class="small muted">${esc(e.label)}</span></li>`).join('')}</ul>`).join('') || '<p class="muted">Aucun événement.</p>'}</div></section>`;
    }
    // grille du mois (semaine du dimanche au samedi)
    const first = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)), startDow = first.getUTCDay();
    const gridStart = t0(`${k}-01`) - startDow * DAY, weeks = Math.ceil((startDow + dim(k)) / 7);
    const ev = events(iso(gridStart), iso(gridStart + (weeks * 7 - 1) * DAY)), byDay = {};
    ev.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const day = iso(gridStart + i * DAY), inMonth = day.slice(0, 7) === k, list = byDay[day] || [];
      const max = 5, more = list.length - max;
      cells += `<div class="lt-cell ${inMonth ? '' : 'out'} ${day === todayISO ? 'today' : ''}"><span class="lt-dn">${+day.slice(8)}</span>
        ${list.slice(0, max).map((e) => `<button class="lt-ev ${e.type}${e.paid ? ' paid' : ''}" data-action="open-loan" data-id="${e.loan.id}" title="${esc(`${short(e.loan.name)} — ${e.label}`)}"><i>${TYPES[e.type][1]}</i>${e.type === 'received' ? `${esc(T().m0(e.amt))} · ` : ''}${esc(short(e.loan.name))}</button>`).join('')}
        ${more > 0 ? `<span class="small muted">+ ${more} autre${more > 1 ? 's' : ''}</span>` : ''}</div>`;
    }
    const monthEv = ev.filter((e) => e.date.slice(0, 7) === k);
    return `${top}<section class="panel"><div class="lt-cal"><div class="lt-dow">${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'].map((x) => `<span>${x}</span>`).join('')}</div><div class="lt-grid7">${cells}</div></div></section>
      ${monthEv.length ? `<section class="panel"><div class="panel-head"><h2>Ce mois-ci</h2><span class="muted small">${monthEv.length} événement${monthEv.length > 1 ? 's' : ''}${monthEv.some((e) => e.type === 'received') ? ` · intérêts encaissés ${T().m(monthEv.filter((e) => e.type === 'received').reduce((a, e) => a + e.amt, 0))}` : ''}</span></div><div class="panel-body lt-agenda"><ul>${monthEv.map((e) => `<li class="${e.date < todayISO ? 'past' : ''}"><span class="lt-date">${d(e.date)}</span><span class="lt-ev ${e.type}${e.paid ? ' paid' : ''}"><i>${TYPES[e.type][1]}</i>${TYPES[e.type][0]}</span><button class="linklike" data-action="open-loan" data-id="${e.loan.id}">${esc(short(e.loan.name))}</button><span class="small muted">${esc(e.label)}</span></li>`).join('')}</ul></div></section>` : ''}`;
  }

  const inLoans = (el) => el && el.closest && el.closest('#view') && T().ui.view === 'loans';
  document.addEventListener('change', (ev) => { const el = ev.target; if (!inLoans(el) || !el.dataset.tl) return; STATE[el.dataset.tl] = el.type === 'checkbox' ? el.checked : el.value; save(); T().render(); });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-tl-act]'); if (!b || !inLoans(b)) return;
    const k = STATE.month || T().todayISO.slice(0, 7), a = b.dataset.tlAct;
    if (a === 'prev') STATE.month = T().E.addMonths(k, -1); else if (a === 'next') STATE.month = T().E.addMonths(k, 1); else if (a === 'today') STATE.month = null; else if (a === 'calview') STATE.calView = b.dataset.v;
    save(); T().render();
  });
  window.TFTimeline = { gantt, calendar, events };
})();

/* Dossiers et immeubles : fournis par js/bridge.js (window.TFDossiers) à partir des données de Terreno (carte). */


/* Stockage : navigateur (localStorage) + enregistrement/ouverture d'un fichier finances.json.
   Pour l'intégration à Terreno, il suffira de remplacer cet objet par un adaptateur serveur
   qui expose les mêmes méthodes (load, save, exportFile, importFile). */
(function (root) {
  'use strict';
  const KEY = 'terreno.v1';
  const META = 'terreno.meta.v1';
  let fileHandle = null;

  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

  function load() {
    const raw = read(KEY);
    if (raw) { try { return { data: JSON.parse(raw), from: 'browser' }; } catch (e) { /* données corrompues : on repart des données initiales */ } }
    return { data: JSON.parse(JSON.stringify(root.FIN_SEED)), from: 'seed' };
  }
  function meta() { try { return JSON.parse(read(META) || '{}'); } catch (e) { return {}; } }
  function setMeta(m) { write(META, JSON.stringify({ ...meta(), ...m })); }

  function save(data) {
    data.updatedAt = new Date().toISOString();
    const ok = write(KEY, JSON.stringify(data));
    setMeta({ dirty: true, savedAt: data.updatedAt });
    return ok;
  }

  async function exportFile(data) {
    const text = JSON.stringify(data, null, 1);
    // Version publiée (page hébergée) : les téléchargements sont bloqués, on copie le JSON dans le presse-papiers
    if (root.FIN_ARTIFACT) {
      try { await navigator.clipboard.writeText(text); setMeta({ dirty: false, exportedAt: new Date().toISOString() }); return { ok: true, how: 'clipboard' }; }
      catch (e) { return { ok: false, error: 'Copie impossible dans cette fenêtre.' }; }
    }
    // Chrome/Edge : écrit directement dans le fichier choisi (et réutilise le même fichier ensuite)
    if (root.showSaveFilePicker) {
      try {
        if (!fileHandle) fileHandle = await root.showSaveFilePicker({ suggestedName: 'terreno.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        const w = await fileHandle.createWritable(); await w.write(text); await w.close();
        setMeta({ dirty: false, exportedAt: new Date().toISOString() });
        return { ok: true, how: 'file', name: fileHandle.name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
        fileHandle = null;
      }
    }
    // Autres navigateurs : téléchargement classique
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'terreno.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMeta({ dirty: false, exportedAt: new Date().toISOString() });
    return { ok: true, how: 'download' };
  }

  function importFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(fr.result);
          if (!d || !Array.isArray(d.entries) || !Array.isArray(d.loans) || !Array.isArray(d.accounts)) throw new Error('Ce fichier ne contient pas de données Terreno Finances.');
          resolve(d);
        } catch (e) { reject(e); }
      };
      fr.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      fr.readAsText(file);
    });
  }

  function reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(META); } catch (e) { /* rien */ } }

  root.FinStore = { load, save, meta, exportFile, importFile, reset };
})(window);

/* Terreno Finances — interface. Rendu par gabarits HTML, délégation d'événements sur #view et #modal. */
(function () {
  'use strict';
  const E = window.FinEngine, S = window.FinStore;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONEY = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const MONEY0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const PCT = new Intl.NumberFormat('fr-CA', { style: 'percent', maximumFractionDigits: 1 });
  const DATE = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const m = (x) => MONEY.format(x || 0);
  const m0 = (x) => MONEY0.format(x || 0);
  const d = (s) => (s ? DATE.format(E.parse(s)) : '');
  const signCls = (x) => (x < -0.004 ? 'neg' : '');
  const todayISO = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();

  const STATUS = { paid: 'Payé', adjusted: 'Réglé (ajusté)', over: 'Payé (+)', partial: 'Partiel', late: 'En retard', upcoming: 'À venir', none: '—', active: 'Actif', closed: 'Remboursé', future: 'À venir' };
  const GROUPS = { asset: 'Actif', liability: 'Passif', equity: 'Équité', revenue: 'Revenus', direct: "Dépenses d'intérêts", overhead: 'Autres dépenses' };
  const SHORT = {
    'rev:interest': 'Intérêts', 'rev:fees': 'Frais de dossier', 'loans': 'Capital du prêt', 'bank:td': 'TD', 'bank:cash': 'Comptant',
    'exp:int-marge': 'Int. marge', 'exp:int-doris': 'Int. Doris', 'exp:int-guy': 'Int. Guy', 'exp:bank-td': 'Frais TD', 'exp:bank-transfer': 'Frais virement',
    'exp:accounting': 'Comptable', 'exp:gov': 'Gouvernement', 'exp:other': 'Autres dép.', 'liab:doris': 'Doris', 'liab:guy': 'Guy',
    'liab:sh-marge': 'Actionnaire · marge', 'liab:sh-perso': 'Actionnaire · perso', 'liab:sh-int': 'Actionnaire · int. marge',
    'liab:sh-frais': 'Actionnaire · frais', 'liab:sh-autres': 'Actionnaire · autres', 'liab:marc': 'Marc (In & Out)', 'eq:opening': 'Équité', 'asset:invest': 'Placements',
  };

  /* ---------------------------------------------------------------- état */
  let loaded = S.load();
  let data = loaded.data;
  const ui = { horizon: 3, view: 'dashboard', loanId: null, tx: { year: String(todayISO.slice(0, 4)), account: '', acct: '', q: '', limit: 200 }, pnlYear: todayISO.slice(0, 4), bsDate: todayISO };
  try { const v = sessionStorage.getItem('tf.view'); if (v) Object.assign(ui, JSON.parse(v)); } catch (e) { /* rien */ }

  const acc = (id) => data.accounts.find((a) => a.id === id);
  // Mises à niveau des données enregistrées (une seule fois par fichier)
  function upgradeData(d) {
    d.migrations = d.migrations || {};
    let changed = false;
    if (!d.migrations.expensePeriods) {
      const prev = (date) => { const [y, m2] = date.slice(0, 7).split('-').map(Number); const t2 = new Date(Date.UTC(y, m2 - 2, 1)); return t2.toISOString().slice(0, 7); };
      const add1 = (p0, n) => { const [y, m2] = p0.split('-').map(Number); return new Date(Date.UTC(y, m2 - 1 + n, 1)).toISOString().slice(0, 7); };
      for (const e of d.entries) {
        const out = [];
        for (const l of e.lines) {
          const prepaid = (l.acct === 'exp:int-doris' && e.date === '2026-07-24' && l.amt === 9000) || (l.acct === 'exp:int-guy' && e.date === '2026-07-27' && l.amt === 9000);
          if (prepaid && !l.period) { for (let i = 0; i < 6; i++) out.push({ acct: l.acct, amt: 1500, period: add1('2026-07', i) }); changed = true; continue; }
          if ((l.acct === 'exp:int-doris' || l.acct === 'exp:int-guy') && !l.period) { out.push({ ...l, period: prev(e.date) }); changed = true; continue; }
          out.push(l);
        }
        e.lines = out;
      }
      d.migrations.expensePeriods = true;
    }
    return changed;
  }
  if (upgradeData(data)) { try { S.save(data); } catch (e) { /* rien */ } }
  const loanById = (id) => data.loans.find((l) => l.id === id);
  const loanShort = (id) => { const l = loanById(id); return l ? l.name.split(' — ')[0] : id; };
  const bankById = (id) => data.bankAccounts.find((b) => b.id === id);
  // Catégories qui portent un « mois couvert » : revenus d'intérêts et toutes les dépenses
  const hasPeriod = (acctId) => { const a = acc(acctId) || {}; return a.group === 'revenue' || a.group === 'direct' || a.group === 'overhead'; };
  // Mois couvert par défaut : le mois précédent pour les intérêts (payés à terme échu), aucun pour les autres dépenses
  const defaultPeriod = (acctId, date) => (acctId === 'rev:interest' || /^exp:int-/.test(acctId) ? E.addMonths(date.slice(0, 7), -1) : '');
  const visibleBanks = (keep) => data.bankAccounts.filter((b) => !b.hidden || b.id === keep);
  const bankUsage = (id) => ({ entries: data.entries.filter((e) => e.account === id || e.lines.some((l) => l.acct === id)).length, feed: (data.bankFeed || []).filter((x) => x.account === id).length });
  // années disponibles dans les rapports : années des écritures, des mois couverts (paiements d'avance) et l'année suivante
  const years = () => {
    const set = new Set(data.entries.map((e) => e.date.slice(0, 4)));
    data.entries.forEach((e) => e.lines.forEach((l) => { if (l.period) set.add(l.period.slice(0, 4)); }));
    set.add(String(Number(todayISO.slice(0, 4)) + 1));
    return Array.from(set).filter((y) => y >= (data.reportStart || '').slice(0, 4)).sort();
  };

  function persist(msg) {
    S.save(data);
    renderSaveState();
    if (msg) toast(msg);
  }
  function renderSaveState() {
    const meta = S.meta(); const el = $('#save-state');
    if (meta.dirty) { el.textContent = 'Modifié — pensez à enregistrer le fichier'; el.className = 'save-state dirty'; }
    else if (meta.exportedAt) { el.textContent = 'Fichier enregistré'; el.className = 'save-state'; }
    else { el.textContent = loaded.from === 'seed' ? 'Données du classeur' : 'Enregistré dans ce navigateur'; el.className = 'save-state'; }
  }
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); }

  /* ---------------------------------------------------------------- navigation */
  function go(view, extra) {
    Object.assign(ui, { view }, extra || {});
    try { sessionStorage.setItem('tf.view', JSON.stringify(ui)); } catch (e) { /* rien */ }
    render();
    const col = document.getElementById('fin-col'); if (col) col.scrollTo(0, 0); else window.scrollTo(0, 0);
  }
  // Thème : automatique (selon l'appareil), clair ou sombre
  const THEMES = [['auto', '◐', 'Auto', "Thème automatique (suit l'appareil)"], ['light', '☀', 'Clair', 'Thème clair'], ['dark', '☾', 'Sombre', 'Thème sombre']];
  function applyTheme(mode) {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', mode);
    const t = THEMES.find((x) => x[0] === mode) || THEMES[0], b = $('#btn-theme');
    if (b) { b.querySelector('.theme-ico').textContent = t[1]; b.querySelector('.theme-lbl').textContent = t[2]; b.title = `${t[3]} — cliquer pour changer`; b.setAttribute('aria-label', b.title); }
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#ffffff';
  }
  const themeMode = () => { try { const v = localStorage.getItem('tf.theme'); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } };
  applyTheme(themeMode());
  $('#btn-theme').addEventListener('click', () => { const i = THEMES.findIndex((x) => x[0] === themeMode()), next = THEMES[(i + 1) % THEMES.length][0]; try { if (next === 'auto') localStorage.removeItem('tf.theme'); else localStorage.setItem('tf.theme', next); } catch (e) { /* rien */ } applyTheme(next); render(); });
  // Écran large : utilise toute la largeur de la fenêtre (pratique pour le P&L de 12 mois)
  function applyWide(on) {
    document.body.classList.toggle('wide', on);
    const b = $('#btn-wide'); if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.querySelector('.wide-lbl').textContent = on ? 'Largeur normale' : 'Écran large'; b.title = on ? 'Revenir à la largeur normale' : "Utiliser toute la largeur de l'écran"; }
  }
  applyWide((() => { try { return localStorage.getItem('tf.wide') === '1'; } catch (e) { return false; } })());
  $('#btn-wide').addEventListener('click', () => { const on = !document.body.classList.contains('wide'); applyWide(on); try { localStorage.setItem('tf.wide', on ? '1' : '0'); } catch (e) { /* rien */ } render(); });
  // Groupes de pages : un onglet du menu regroupe plusieurs pages (sous-onglets en haut de la page)
  const VIEW_GROUPS = { ops: { label: 'Opérations', views: [['bank', 'Banque'], ['transactions', 'Transactions']] }, fin: { label: 'États financiers', views: [['pnl', 'P&L'], ['pnlp', 'P&L période'], ['balance', 'Bilan']] } };
  const groupOf = (view) => Object.keys(VIEW_GROUPS).find((g) => VIEW_GROUPS[g].views.some(([v]) => v === view || (v === 'transactions' && view === 'import')));
  function subNav() {
    const g = groupOf(ui.view); if (!g) return '';
    const cur = ui.view === 'import' ? 'transactions' : ui.view;
    return `<div class="subnav seg big" role="tablist" aria-label="${VIEW_GROUPS[g].label}">${VIEW_GROUPS[g].views.map(([v, l]) => `<button role="tab" data-action="go" data-view="${v}" class="${cur === v ? 'on' : ''}" aria-selected="${cur === v}">${l}${v === 'bank' ? '<span class="tab-badge sub" data-badge hidden></span>' : ''}</button>`).join('')}</div>`;
  }
  $('#tabs').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-view]'); if (!b) return; const g = b.dataset.group; go(g && (ui.lastSub || {})[g] ? ui.lastSub[g] : b.dataset.view, { loanId: null }); });
  $('#btn-new').addEventListener('click', () => openTxForm(null));

  function render() {
    const g = groupOf(ui.view); if (g) { ui.lastSub = Object.assign({}, ui.lastSub, { [g]: ui.view === 'import' ? 'transactions' : ui.view }); }
    $$('#tabs button').forEach((b) => b.classList.toggle('active', g ? b.dataset.group === g : b.dataset.view === (ui.view === 'property' ? 'dossiers' : ui.view)));
    const v = $('#view');
    const fn = { dashboard: viewDashboard, transactions: viewTransactions, loans: ui.loanId ? viewLoan : viewLoans, pnl: viewPnl, pnlp: viewPnlPeriod, balance: viewBalance, settings: viewSettings, import: viewImport, bank: viewBank, tools: () => window.TFTools.view(), forecast: () => window.TFForecast.view(), dossiers: () => window.TFDossiers.view(), property: () => window.TMap.viewProperty() }[ui.view] || viewDashboard;
    v.innerHTML = subNav() + fn();
    if (window.TMap) { if (ui.view === 'dashboard') v.insertAdjacentHTML('beforeend', window.TMap.dashboardPanel()); window.TMap.onFinanceRender(); }
    const pend = (data.bankFeed || []).filter((x) => x.status === 'pending').length;
    $$('#tab-badge, [data-badge]').forEach((tb) => { tb.textContent = pend; tb.hidden = !pend; });
    renderSaveState();
  }

  /* ---------------------------------------------------------------- utilitaires d'affichage */
  function pivotOf(e) {
    if (!e.account) return null;
    const b = bankById(e.account);
    const acct = b && b.personal ? e.counter : e.account;
    return e.lines.find((l) => l.acct === acct) || null;
  }
  function entryAmount(e) {
    const p = pivotOf(e);
    if (p) return p.amt;
    return E.r2(e.lines.filter((l) => l.amt > 0).reduce((s, l) => s + l.amt, 0));
  }
  // Regroupe les lignes d'intérêts consécutives d'un même prêt et d'un même montant : « oct. 2026 → mars 2027 · 6 × 250 $ »
  function groupSplits(list) {
    const out = [];
    for (const l of list) {
      const prev = out[out.length - 1];
      if (prev && l.acct === prev.acct && prev.loan === l.loan && l.period && prev.to
          && E.addMonths(prev.to, 1) === l.period && Math.abs(Math.abs(prev.each) - Math.abs(l.amt)) < 0.005) { prev.to = l.period; prev.n++; prev.total += l.amt; continue; }
      out.push({ ...l, from: l.period, to: l.period, n: 1, each: l.amt, total: l.amt });
    }
    return out;
  }
  function splitChip(g, showAmt) {
    const label = SHORT[g.acct] || (acc(g.acct) || {}).name || g.acct;
    const per = g.n > 1 ? ` · ${E.monthLabel(g.from)} → ${E.monthLabel(g.to)}` : g.period ? ` · ${E.monthLabel(g.period)}` : '';
    const amt = !showAmt ? '' : g.n > 1 ? ` ${g.n} × ${m(Math.abs(g.each))}` : ` ${m(Math.abs(g.total))}`;
    return `<span class="chip ${g.acct === 'rev:interest' ? 'acc' : ''}">${esc(label + (g.loan ? ` · ${loanShort(g.loan)}` : '') + per + (g.memo ? ` · ${g.memo}` : ''))}${esc(amt)}</span>`;
  }
  function chipsFor(e) {
    const p = pivotOf(e);
    const lines = e.lines.filter((l) => l !== p);
    if (!p) return lines.map((l) => `<span class="chip ${l.acct === 'rev:interest' ? 'acc' : ''}">${esc((SHORT[l.acct] || (acc(l.acct) || {}).name || l.acct) + (l.loan ? ` · ${loanShort(l.loan)}` : '') + (l.period ? ` · ${E.monthLabel(l.period)}` : ''))} ${l.amt > 0 ? 'Dt' : 'Ct'} ${esc(m(Math.abs(l.amt)))}</span>`).join('');
    return groupSplits(lines).map((g) => splitChip(g, lines.length > 1)).join('');
  }
  const accountLabel = (e) => (e.account ? (bankById(e.account) || {}).name || e.account : 'Écriture de journal');
  const pill = (s) => `<span class="pill ${s}">${STATUS[s] || s}</span>`;

  /* ---------------------------------------------------------------- tableau de bord */
  function viewDashboard() {
    const y = todayISO.slice(0, 4);
    const p = E.pnl(data, `${y}-01-01`, `${y}-12-31`);
    const bs = E.balanceSheet(data, todayISO);
    const sh = E.shareholder(data, todayISO);
    const td = (bs.assets.find((a) => a.id === 'bank:td') || {}).value || 0;
    const active = data.loans.filter((l) => E.loanStatus(l, todayISO) === 'active');
    const watch = [], expected = [];
    const lastMonth = E.addMonths(todayISO.slice(0, 7), -1), thisMonth = todayISO.slice(0, 7);
    for (const l of data.loans) {
      const s = E.schedule(data, l.id, todayISO);
      if (E.loanStatus(l, todayISO) === 'closed') continue; // prêt remboursé : les écarts restent visibles dans sa fiche
      s.rows.filter((r) => (r.status === 'late' || r.status === 'partial') && r.period >= E.addMonths(thisMonth, -6))
        .forEach((r) => watch.push({ loan: l, r, missing: E.r2(r.expected - r.received) }));
      s.rows.filter((r) => (r.period === lastMonth || r.period === thisMonth) && r.expected > 0)
        .forEach((r) => expected.push({ loan: l, r }));
    }
    watch.sort((a, b) => a.r.period.localeCompare(b.r.period));
    const recent = data.entries.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 8);
    const lastTd = data.entries.filter((e) => e.account === 'bank:td').map((e) => e.date).sort().pop();
    const eqNow = netEquity(todayISO);
    const DS = dashSeries();

    return `
    <div class="section-head"><div><h1>Tableau de bord ${y}</h1><div class="sub">Du 1<sup>er</sup> janvier à aujourd'hui · dernière transaction TD saisie le ${d(lastTd)}</div></div></div>
    <div class="kpis k8">
      ${kpi('Revenus totaux', m0(p.total.revenue), `Intérêts ${m0(p.total.interest)} + frais de dossier ${m0(p.total.revenue - p.total.interest)}`)}
      ${kpi("Revenus d'intérêts", m0(p.total.interest), `${y}, encaissement`)}
      ${kpi("Dépenses d'intérêts", m0(p.total.direct), `Marge ${PCT.format(p.total.marginPct)}`)}
      ${kpi('Profit avant impôts', m0(p.total.profit), `${PCT.format(p.total.profitPct)} des revenus d'intérêts`)}
      ${kpi('Équité nette', m0(eqNow.equity), 'TD + prêts − marge, Doris et Guy')}
      ${kpi('Solde TD', m(td), `Au ${d(todayISO)}`)}
      ${kpi('Prêts actifs', m0(active.reduce((s, l) => s + (E.balances(data, todayISO)[`loans|${l.id}`] || 0), 0)), `${active.length} prêts en cours`)}
      ${kpi("Dû à l'actionnaire", m0(sh.total), 'Avances de Jonathan')}
    </div>
    ${dashCharts(DS)}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Revenus, dépenses et profit par mois</h2><span class="muted small">${esc(DS.rangeLabel)} · ${DS.basis === 'accrual' ? 'reconnaissance' : 'encaissement'}</span></div>
        <div class="panel-body">${FinCharts.render({ id: 'pl', w: 600, type: 'bar', title: 'Revenus, dépenses et profit par mois', x: DS.x, xFull: DS.xFull,
          series: [{ key: 'rev', label: 'Revenus', slot: 1, values: DS.revTotal }, { key: 'exp', label: 'Dépenses', slot: 2, values: DS.expTotal }, { key: 'pr', label: 'Profit', slot: 3, kind: 'line', values: DS.profit }] })}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Paiements à surveiller</h2><span class="muted small">6 derniers mois</span></div>
        ${watch.length ? `<ul class="alert-list">${watch.map((w) => `
          <li><div><button class="btn ghost small" data-action="open-loan" data-id="${w.loan.id}">${esc(w.loan.name)}</button><div class="small muted">${E.monthLabel(w.r.period)} · reçu ${m(w.r.received)} sur ${m(w.r.expected)}</div></div>
          <div style="text-align:right">${pill(w.r.status)}<div class="num small">${m(w.missing)}</div></div></li>`).join('')}</ul>`
        : '<div class="empty">Aucun paiement en retard.</div>'}
      </section>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Dernières transactions</h2><button class="btn ghost small" data-action="go" data-view="transactions">Tout voir</button></div>
        <div class="table-wrap">${txTable(recent, true)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Intérêts attendus</h2><span class="muted small">${E.monthLabel(lastMonth)} et ${E.monthLabel(thisMonth)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Prêt</th><th>Mois</th><th class="num">Attendu</th><th class="num">Reçu</th><th>Statut</th></tr></thead><tbody>
        ${expected.sort((a, b) => a.r.period.localeCompare(b.r.period) || a.loan.name.localeCompare(b.loan.name)).map((x) => `
          <tr class="clickable" data-action="open-loan" data-id="${x.loan.id}"><td>${esc(loanShort(x.loan.id))}</td><td style="white-space:nowrap">${x.r.label}</td><td class="num">${m(x.r.expected)}</td><td class="num">${m(x.r.received)}</td><td>${pill(x.r.status)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
    </div>`;
  }

  /* ---------- Tableau de bord : équité nette et séries mensuelles ---------- */
  // Équité nette = comptes bancaires de l'entreprise + prêts − marge de crédit (avances via la marge) − Doris − Guy.
  // Exclut les autres placements (ex. Contxtful) et les autres avances de l'actionnaire.
  const EQ_DEBTS = [['liab:sh-marge', 'Marge de crédit'], ['liab:doris', 'Doris Lacasse'], ['liab:guy', 'Guy Mireault']];
  function netEquity(date, b) {
    b = b || E.balances(data, date);
    const banks = (data.bankAccounts || []).filter((x) => !x.personal && x.kind !== 'liability');
    const bank = E.r2(banks.reduce((a, x) => a + (b[x.id] || 0), 0));
    const loanBal = {}; let loans = 0;
    for (const l of data.loans) { const v = b[`loans|${l.id}`] || 0; if (Math.abs(v) >= 0.01) { loanBal[l.id] = v; loans += v; } }
    const bizLiab = (data.bankAccounts || []).filter((x) => !x.personal && x.kind === 'liability').reduce((a, x) => a - (b[x.id] || 0), 0);
    const debts = EQ_DEBTS.map(([id, label]) => ({ id, label, value: E.r2(-(b[id] || 0)) }));
    if (Math.abs(bizLiab) >= 0.01) debts.push({ id: 'biz', label: "Marge ou carte de l'entreprise", value: E.r2(bizLiab) });
    const debt = E.r2(debts.reduce((a, x) => a + x.value, 0));
    loans = E.r2(loans);
    return { bank, loans, assets: E.r2(bank + loans), debts, debt, equity: E.r2(bank + loans - debt), loanBal };
  }
  // Périodes du tableau de bord : 12 derniers mois, une année précise (y2025, y2026…) ou depuis le début
  const dashYears = () => { const first = +data.entries.reduce((a, e) => (e.date < a ? e.date : a), todayISO).slice(0, 4), last = +todayISO.slice(0, 4); const out = []; for (let y = last; y >= first; y--) out.push(String(y)); return out; };
  function dashRange() {
    const f = ui.dash = Object.assign({ range: '12m', basis: 'cash', cumul: false }, ui.dash || {});
    const cur = todayISO.slice(0, 7);
    const first = data.entries.reduce((a, e) => (e.date < a ? e.date : a), todayISO).slice(0, 7);
    if (f.range === 'year') f.range = `y${cur.slice(0, 4)}`;
    if (/^y\d{4}$/.test(f.range) && !dashYears().includes(f.range.slice(1))) f.range = '12m';
    let start, end = cur, label;
    if (f.range === 'all') { start = first; label = 'Depuis le début'; }
    else if (/^y\d{4}$/.test(f.range)) { const y = f.range.slice(1); start = `${y}-01`; end = `${y}-12` < cur ? `${y}-12` : cur; label = `Année ${y}`; }
    else { start = E.addMonths(cur, -11); label = '12 derniers mois'; }
    return { f, start: start < first ? first : start, end, cur, label };
  }
  function dashSeries() {
    const { f, start, end, cur, label } = dashRange();
    const months = E.monthsBetween(start, end);
    const short = (k) => { const [yy, mm] = k.split('-'); const mo = E.monthLabel(k).split(' ')[0]; return months.length > 13 ? `${mo.slice(0, 4)} ${yy.slice(2)}` : mo; };
    const out = { months, rangeLabel: label, basis: f.basis, x: months.map(short), xFull: months.map((k) => E.monthLabel(k) + (k === cur ? ' (en cours)' : '')) };
    out.bank = bankFlows(f.bank || 'bank:td', months);
    { const pe = new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, 0)).toISOString().slice(0, 10); out.eqOpen = netEquity(pe); out.openDate = pe; }
    out.eq = months.map((k) => { const [yy, mm] = k.split('-').map(Number); const end = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10); return netEquity(end < todayISO ? end : todayISO); });
    const endCur = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7), 0)).toISOString().slice(0, 10);
    out.endDate = endCur < todayISO ? endCur : todayISO;
    const p = E.pnl(data, `${start}-01`, endCur, f.basis, todayISO);
    const sumRows = (rows, k) => E.r2(rows.reduce((a, r) => a + (r.byMonth[k] || 0), 0));
    const R = p.groups.revenue, intR = R.filter((r) => r.acct === 'rev:interest' && !r.capitalized), capR = R.filter((r) => r.capitalized), feeR = R.filter((r) => r.acct !== 'rev:interest');
    out.int = months.map((k) => sumRows(intR, k)); out.cap = months.map((k) => sumRows(capR, k)); out.fees = months.map((k) => sumRows(feeR, k));
    out.revTotal = months.map((k) => (p.byMonth[k] || {}).revenue || 0);
    out.expTotal = months.map((k) => E.r2(((p.byMonth[k] || {}).direct || 0) + ((p.byMonth[k] || {}).overhead || 0)));
    out.profit = months.map((k) => (p.byMonth[k] || {}).profit || 0);
    out.totals = { rev: E.r2(out.revTotal.reduce((a, b) => a + b, 0)), int: E.r2(out.int.reduce((a, b) => a + b, 0)), cap: E.r2(out.cap.reduce((a, b) => a + b, 0)), fees: E.r2(out.fees.reduce((a, b) => a + b, 0)) };
    return out;
  }

  // Évolution d'un compte bancaire : solde d'ouverture, entrées, sorties et solde de fin pour chaque mois
  function bankFlows(id, months) {
    const first = `${months[0]}-01`, last = months[months.length - 1];
    let bal = 0; const flows = {};
    for (const e of data.entries) for (const l of e.lines) {
      if (l.acct !== id) continue;
      if (e.date < first) bal += l.amt;
      else if (e.date.slice(0, 7) <= last) { const k = e.date.slice(0, 7), f0 = flows[k] = flows[k] || { in: 0, out: 0, n: 0 }; if (l.amt >= 0) f0.in += l.amt; else f0.out -= l.amt; f0.n++; }
    }
    return months.map((k) => { const f0 = flows[k] || { in: 0, out: 0, n: 0 }; const open = E.r2(bal); bal += f0.in - f0.out;
      return { k, open, in: E.r2(f0.in), out: E.r2(f0.out), net: E.r2(f0.in - f0.out), close: E.r2(bal), n: f0.n }; });
  }
  function dashBank(DS) {
    const f = ui.dash, id = f.bank || 'bank:td', rows = DS.bank, banks = (data.bankAccounts || []).filter((b) => !b.personal && !b.hidden);
    const lastR = rows[rows.length - 1], firstR = rows[0];
    const tIn = E.r2(rows.reduce((a, r) => a + r.in, 0)), tOut = E.r2(rows.reduce((a, r) => a + r.out, 0));
    const low = rows.reduce((a, r) => (r.close < a.close ? r : a), rows[0]);
    return `
    <section class="panel">
      <div class="panel-head"><h2>Évolution du compte bancaire</h2>
        <div class="toolbar">${banks.length > 1 ? `<select id="dash-bank" aria-label="Compte">${banks.map((b) => `<option value="${b.id}" ${b.id === id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
          <div class="seg" role="group">${[['chart', 'Solde'], ['flows', 'Entrées et sorties'], ['table', 'Tableau']].map(([k, l]) => `<button type="button" data-action="dash-set" data-k="bankView" data-v="${k}" class="${(f.bankView || 'chart') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      <div class="panel-body">
        <div class="mini-kpis"><div><span>Solde au ${d(DS.endDate)}</span><b>${m0(lastR.close)}</b></div><div><span>Solde au début</span><b>${m0(firstR.open)}</b></div><div><span>Entrées</span><b>${m0(tIn)}</b></div><div><span>Sorties</span><b>${m0(tOut)}</b></div><div><span>Variation</span><b class="${lastR.close - firstR.open < 0 ? 'neg' : ''}">${lastR.close - firstR.open >= 0 ? '+' : ''}${m0(lastR.close - firstR.open)}</b></div><div><span>Plus bas (fin de mois)</span><b>${m0(low.close)}</b></div></div>
        ${f.bankView === 'flows' ? FinCharts.render({ id: 'bankflows', w: 1000, height: 300, noTable: true, type: 'bar', title: 'Entrées et sorties du compte par mois', x: DS.x, xFull: DS.xFull,
            series: [{ key: 'in', label: 'Entrées (money in)', slot: 3, values: rows.map((r) => r.in) }, { key: 'out', label: 'Sorties (money out)', slot: 2, values: rows.map((r) => r.out) }, { key: 'bal', label: 'Solde en fin de mois', slot: 1, kind: 'line', values: rows.map((r) => r.close) }],
            total: (i) => ['Variation nette', rows[i].net], extra: (i) => `<div class="fc-tip-sub">${rows[i].n} transaction${rows[i].n > 1 ? 's' : ''} · solde au début ${m0(rows[i].open)}</div>` })
          : (f.bankView || 'chart') === 'chart' ? FinCharts.render({ id: 'bank', w: 1000, height: 300, noTable: true, type: 'line', title: 'Solde du compte bancaire à la fin de chaque mois', x: DS.x, xFull: DS.xFull, zero: true,
            series: [{ key: 'bal', label: 'Solde en fin de mois', slot: 1, area: true, values: rows.map((r) => r.close) }],
            extra: (i) => { const r = rows[i]; return `<div class="fc-tip-r small"><span>Solde au début</span><b>${m0(r.open)}</b></div><div class="fc-tip-r small"><span>+ Entrées</span><b>${m0(r.in)}</b></div><div class="fc-tip-r small"><span>− Sorties</span><b>${m0(r.out)}</b></div><div class="fc-tip-sub">${r.n} transaction${r.n > 1 ? 's' : ''}</div>`; } })
          : `<div class="table-wrap"><table class="bank-evo"><thead><tr><th>Mois</th><th class="num">Solde au début</th><th class="num">Entrées</th><th class="num">Sorties</th><th class="num">Variation</th><th class="num">Solde à la fin</th><th class="num">Transactions</th></tr></thead><tbody>
            ${rows.slice().reverse().map((r, i) => `<tr class="clickable" data-action="dash-bank-month" data-k="${r.k}" title="Voir les transactions du mois dans Banque"><td>${esc(DS.xFull[rows.length - 1 - i])}</td><td class="num">${m(r.open)}</td><td class="num">${r.in ? m(r.in) : '<span class="muted">—</span>'}</td><td class="num">${r.out ? m(r.out) : '<span class="muted">—</span>'}</td><td class="num ${r.net < 0 ? 'neg' : ''}">${r.net >= 0 ? '+' : ''}${m(r.net)}</td><td class="num"><b>${m(r.close)}</b></td><td class="num">${r.n}</td></tr>`).join('')}
            </tbody><tfoot><tr class="grand"><td>Total de la période</td><td class="num">${m(firstR.open)}</td><td class="num">${m(tIn)}</td><td class="num">${m(tOut)}</td><td class="num">${m(E.r2(tIn - tOut))}</td><td class="num">${m(lastR.close)}</td><td class="num">${rows.reduce((a, r) => a + r.n, 0)}</td></tr></tfoot></table></div>`}
      </div>
    </section>`;
  }
  function dashCharts(DS) {
    const f = ui.dash, eq = DS.eq, last = eq[eq.length - 1], firstEq = DS.eqOpen;
    const cum = (arr) => { let a = 0; return arr.map((v) => (a = E.r2(a + v))); };
    const rv = f.cumul ? { int: cum(DS.int), cap: cum(DS.cap), fees: cum(DS.fees) } : DS;
    const revSeries = [{ key: 'int', label: f.basis === 'accrual' ? 'Intérêts (payés ou à recevoir)' : "Intérêts encaissés", slot: 1, values: rv.int }];
    if (DS.totals.cap) revSeries.push({ key: 'cap', label: 'Intérêts capitalisés', slot: 3, values: rv.cap });
    revSeries.push({ key: 'fees', label: 'Frais de dossier', slot: 2, values: rv.fees });
    const delta = E.r2(last.equity - firstEq.equity);
    const seg = (name, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-action="dash-set" data-k="${name}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const loanName = (id) => loanShort(id);
    return `
    <div class="dash-filters">
      <label class="small muted">Période ${seg('range', f.range, [['12m', '12 derniers mois']].concat(dashYears().map((y) => [`y${y}`, y]), [['all', 'Depuis le début']]))}</label>
      <label class="small muted">Revenus selon ${seg('basis', f.basis, [['cash', 'Encaissement'], ['accrual', 'Reconnaissance']])}</label>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Évolution de l'équité nette</h2><span class="muted small">${esc(DS.rangeLabel)} · fin de chaque mois · cliquez une série pour la masquer</span></div>
      <div class="panel-body eq-wrap">
        <div>${FinCharts.render({ id: 'eq', type: 'line', title: "Évolution de l'équité nette, de l'actif et des dettes", x: DS.x, xFull: DS.xFull, endLabels: true, zero: true,
          series: [{ key: 'assets', label: 'Actif (TD + prêts)', slot: 1, values: eq.map((e) => e.assets) }, { key: 'debt', label: 'Dettes (marge, Doris, Guy)', slot: 2, values: eq.map((e) => e.debt) }, { key: 'eq', label: 'Équité nette', slot: 3, bold: true, values: eq.map((e) => e.equity) }] })}</div>
        <dl class="eq-comp">
          <dt class="muted small">Au ${d(DS.endDate)}</dt><dd></dd>
          <dt>Banque TD</dt><dd>${m0(last.bank)}</dd>
          <dt>Prêts en cours</dt><dd>${m0(last.loans)}</dd>
          <dt class="sub">Actif</dt><dd class="sub">${m0(last.assets)}</dd>
          ${last.debts.map((x) => `<dt>− ${esc(x.label)}</dt><dd>${m0(x.value)}</dd>`).join('')}
          <dt class="tot">Équité nette</dt><dd class="tot">${m0(last.equity)}</dd>
          <dt class="muted">Variation depuis le ${d(DS.openDate)}</dt><dd class="${delta < 0 ? 'neg' : ''}">${delta >= 0 ? '+' : ''}${m0(delta)}</dd>
        </dl>
      </div>
    </section>
    ${dashBank(DS)}
    <div class="grid-2 even">
      <section class="panel">
        <div class="panel-head"><h2>Revenus par mois</h2>${seg('cumul', f.cumul ? 1 : 0, [[0, 'Mensuel'], [1, 'Cumulatif']])}</div>
        <div class="panel-body">
          <div class="mini-kpis"><div><span>Total</span><b>${m0(DS.totals.rev)}</b></div><div><span>Intérêts</span><b>${m0(E.r2(DS.totals.int + DS.totals.cap))}</b></div><div><span>Frais de dossier</span><b>${m0(DS.totals.fees)}</b></div></div>
          ${FinCharts.render({ id: 'rev', w: 520, height: 280, type: 'bar', stacked: true, title: 'Revenus par mois', x: DS.x, xFull: DS.xFull, series: revSeries,
            total: (i, vis) => ['Total', vis.reduce((a, s) => a + (s.values[i] || 0), 0)] })}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Prêts en cours</h2><span class="muted small">Capital prêté à la fin du mois</span></div>
        <div class="panel-body">
          <div class="mini-kpis"><div><span>${DS.endDate === todayISO ? "Aujourd'hui" : `Au ${d(DS.endDate)}`}</span><b>${m0(last.loans)}</b></div><div><span>Prêts actifs</span><b>${Object.keys(last.loanBal).length}</b></div><div><span>Variation depuis le ${d(DS.openDate)}</span><b class="${last.loans - firstEq.loans < 0 ? 'neg' : ''}">${last.loans - firstEq.loans >= 0 ? '+' : ''}${m0(last.loans - firstEq.loans)}</b></div></div>
          ${FinCharts.render({ id: 'loans', w: 520, height: 280, type: 'line', title: 'Total des prêts en cours', x: DS.x, xFull: DS.xFull, zero: true,
            series: [{ key: 'loans', label: 'Total des prêts', slot: 1, area: true, values: eq.map((e) => e.loans) }],
            extra: (i) => { const lb = Object.entries(eq[i].loanBal).sort((a, b) => b[1] - a[1]); return `<div class="fc-tip-sub">${lb.length} prêt${lb.length > 1 ? 's' : ''}</div>${lb.slice(0, 8).map(([id, v]) => `<div class="fc-tip-r small"><span>${esc(loanName(id))}</span><b>${m0(v)}</b></div>`).join('')}${lb.length > 8 ? `<div class="fc-tip-sub">+ ${lb.length - 8} autres</div>` : ''}`; } })}</div>
      </section>
    </div>`;
  }
  const kpi = (label, v, sub) => `<div class="kpi"><span class="label">${esc(label)}</span><span class="v">${v}</span><span class="d">${sub}</span></div>`;

  function monthlyChart(p) {
    const months = p.months, W = 640, H = 230, pl = 56, pr = 10, pt = 12, pb = 26;
    const rows = months.map((k) => ({ k, rev: p.byMonth[k].revenue, exp: E.r2(p.byMonth[k].direct + p.byMonth[k].overhead), pr: p.byMonth[k].profit }));
    const max = Math.max(1000, ...rows.map((r) => Math.max(r.rev, r.exp)));
    const min = Math.min(0, ...rows.map((r) => r.pr));
    const step = niceStep((max - min) / 4);
    const top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
    const y = (v) => pt + (H - pt - pb) * (top - v) / (top - bottom);
    const bw = (W - pl - pr) / months.length;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus, dépenses et profit par mois">`;
    for (let v = bottom; v <= top + 0.1; v += step) s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v / 1000)} k</text>`;
    rows.forEach((r, i) => {
      const x = pl + i * bw;
      s += `<rect class="bar-rev" x="${x + bw * 0.14}" y="${y(Math.max(0, r.rev))}" width="${bw * 0.34}" height="${Math.abs(y(0) - y(r.rev))}" rx="1.5"><title>${E.monthLabel(r.k)} · revenus ${m(r.rev)}</title></rect>`;
      s += `<rect class="bar-exp" x="${x + bw * 0.5}" y="${y(Math.max(0, r.exp))}" width="${bw * 0.34}" height="${Math.abs(y(0) - y(r.exp))}" rx="1.5"><title>${E.monthLabel(r.k)} · dépenses ${m(r.exp)}</title></rect>`;
      s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${E.monthLabel(r.k).split(' ')[0]}</text>`;
    });
    const pts = rows.map((r, i) => `${pl + i * bw + bw / 2},${y(r.pr)}`);
    s += `<polyline class="line-profit" points="${pts.join(' ')}"/>`;
    rows.forEach((r, i) => { if (r.rev || r.exp) s += `<circle class="dot" cx="${pl + i * bw + bw / 2}" cy="${y(r.pr)}" r="3"><title>${E.monthLabel(r.k)} · profit ${m(r.pr)}</title></circle>`; });
    return s + '</svg>';
  }
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  /* ---------------------------------------------------------------- transactions */
  function txTable(list, compact) {
    if (!list.length) return '<div class="empty">Aucune transaction ne correspond à ces filtres.</div>';
    return `<table><thead><tr><th>Date</th><th>Description</th>${compact ? '' : '<th>Compte</th>'}<th>Ventilation</th><th class="num">Montant</th>${compact ? '' : '<th></th>'}</tr></thead><tbody>
      ${list.map((e) => { const a = entryAmount(e); return `<tr class="clickable" data-action="edit-tx" data-id="${e.id}">
        <td class="num" style="text-align:left">${d(e.date)}</td>
        <td class="desc">${esc(e.description)}${e.notes ? `<div class="sub">${esc(e.notes)}</div>` : ''}${compact ? `<div class="sub">${esc(accountLabel(e))}</div>` : ''}</td>
        ${compact ? '' : `<td class="small">${esc(accountLabel(e))}</td>`}
        <td>${chipsFor(e)}</td>
        <td class="num ${signCls(a)}">${e.account ? m(a) : `<span class="muted">${m(a)}</span>`}</td>
        ${compact ? '' : `<td><button class="btn ghost small" data-action="dup-tx" data-id="${e.id}" title="Créer une nouvelle transaction à partir de celle-ci, un mois plus tard">Dupliquer</button></td>`}</tr>`; }).join('')}
      </tbody></table>`;
  }
  function filteredTx() {
    const f = ui.tx, q = f.q.trim().toLowerCase();
    return data.entries.filter((e) => {
      if (f.year && !e.date.startsWith(f.year)) return false;
      if (f.account === '__journal' ? e.account : f.account && e.account !== f.account) return false;
      if (f.acct) { const [a, l] = f.acct.split('|'); if (!e.lines.some((x) => x.acct === a && (!l || x.loan === l))) return false; }
      if (q) { const hay = `${e.description} ${e.notes || ''} ${e.lines.map((l) => `${(acc(l.acct) || {}).name} ${l.loan ? loanById(l.loan)?.name : ''} ${l.memo || ''}`).join(' ')} ${Math.abs(entryAmount(e)).toFixed(2)}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  function viewTransactions() {
    const f = ui.tx, list = filteredTx();
    const shown = list.slice(0, f.limit);
    const tdIn = E.r2(list.filter((e) => e.account === 'bank:td').reduce((s, e) => s + Math.max(0, entryAmount(e)), 0));
    const tdOut = E.r2(list.filter((e) => e.account === 'bank:td').reduce((s, e) => s + Math.min(0, entryAmount(e)), 0));
    return `
    <div class="section-head"><div><h1>Transactions</h1><div class="sub">${list.length} transactions · entrées TD ${m(tdIn)} · sorties TD ${m(tdOut)}</div></div>
      <div class="toolbar"><button class="btn" data-action="go" data-view="bank">Classer les relevés bancaires</button><button class="btn primary" data-action="new-tx">+ Transaction</button></div></div>
    <div class="toolbar">
      <select id="f-year" data-filter="year" aria-label="Année"><option value="">Toutes les années</option>${Array.from(new Set(data.entries.map((e) => e.date.slice(0, 4)))).sort().reverse().map((y) => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <select id="f-account" data-filter="account" aria-label="Compte"><option value="">Tous les comptes</option>${visibleBanks(f.account).map((b) => `<option value="${b.id}" ${f.account === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="__journal" ${f.account === '__journal' ? 'selected' : ''}>Écritures de journal</option></select>
      <select id="f-acct" data-filter="acct" aria-label="Catégorie">${categoryFilterOptions(f.acct)}</select>
      <input type="search" id="f-q" data-filter="q" placeholder="Rechercher (texte, montant)" value="${esc(f.q)}" style="width:240px">
      ${f.year || f.account || f.acct || f.q ? '<button class="btn ghost" data-action="clear-filters">Effacer les filtres</button>' : ''}
    </div>
    <section class="panel"><div class="table-wrap">${txTable(shown, false)}</div>
      ${list.length > shown.length ? `<div class="panel-body" style="text-align:center"><button class="btn" data-action="more-tx">Afficher ${Math.min(200, list.length - shown.length)} de plus</button></div>` : ''}
    </section>`;
  }
  function categoryFilterOptions(sel) {
    let h = `<option value="">Toutes les catégories</option>`;
    for (const g of ['revenue', 'direct', 'overhead', 'asset', 'liability', 'equity']) {
      const list = data.accounts.filter((a) => a.group === g);
      if (!list.length) continue;
      h += `<optgroup label="${GROUPS[g]}">`;
      for (const a of list) {
        h += `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`;
        if (a.perLoan) for (const l of data.loans) h += `<option value="${a.id}|${l.id}" ${sel === `${a.id}|${l.id}` ? 'selected' : ''}>  ↳ ${esc(l.name)}</option>`;
      }
      h += '</optgroup>';
    }
    return h;
  }

  /* ---------------------------------------------------------------- prêts */
  function loanSummary(l) {
    const s = E.schedule(data, l.id, todayISO);
    const status = E.loanStatus(l, todayISO);
    const cur = s.rows.filter((r) => r.period <= todayISO.slice(0, 7)).pop() || s.rows[0];
    return { l, s, status, cur };
  }
  function viewLoans() {
    const all = data.loans.map(loanSummary);
    const card = ({ l, s, status, cur }) => {
      const strip = s.rows.filter((r) => r.period <= todayISO.slice(0, 7)).slice(-12);
      return `<button class="loan-card" data-action="open-loan" data-id="${l.id}">
        <div class="row"><span class="name">${esc(l.name)}</span>${pill(status)}</div>
        <div class="small muted">${esc(l.borrower || '')}${l.city ? ` · ${esc(l.city)}` : ''}${l.dossier ? ` · dossier n° ${l.dossier}` : ''}${window.TMap ? window.TMap.loanCardGeo(l) : ''}</div>
        <dl>
          <dt>Solde</dt><dt>Taux</dt>
          <dd>${m0(s.ledgerBalance)}</dd><dd>${cur && cur.rate != null ? PCT.format(cur.rate) : '—'}</dd>
          <dt>Intérêt mensuel</dt><dt>Arriérés</dt>
          <dd>${cur ? m(cur.expected) : '—'}</dd><dd class="${s.totals.arrears > 0.5 ? 'neg' : ''}">${m(s.totals.arrears)}</dd>
        </dl>
        <div class="months-strip" title="12 derniers mois">${strip.map((r) => `<span class="${r.status}" title="${r.label} · ${STATUS[r.status]}"></span>`).join('')}</div>
      </button>`;
    };
    const act = all.filter((x) => x.status !== 'closed'), closed = all.filter((x) => x.status === 'closed');
    const totalActive = act.reduce((s, x) => s + x.s.ledgerBalance, 0);
    const mode = ui.loansMode || 'cards';
    const modeSeg = `<div class="seg big" role="tablist" aria-label="Affichage">${[['cards', 'Cartes'], ['table', 'Sommaire des revenus'], ['gantt', 'Échéancier'], ['cal', 'Calendrier']].map(([k, lb]) => `<button role="tab" data-action="loans-mode" data-m="${k}" class="${mode === k ? 'on' : ''}">${lb}</button>`).join('')}</div>`;
    const head = `
    <div class="section-head"><div><h1>Prêts</h1><div class="sub">${act.length} prêts en cours · ${m0(totalActive)} prêtés</div></div>
      <div class="toolbar">${modeSeg}<button class="btn" data-action="new-loan">+ Nouveau prêt</button></div></div>`;
    if (mode === 'table') return head + viewLoansTable(all);
    if (mode === 'gantt') return head + window.TFTimeline.gantt();
    if (mode === 'cal') return head + window.TFTimeline.calendar();
    return `${head}
    <div class="loan-cards">${act.map(card).join('')}</div>
    ${closed.length ? `<h2>Prêts remboursés</h2><div class="loan-cards">${closed.map(card).join('')}</div>` : ''}`;
  }

  /* ---------- Prêts : sommaire des revenus par prêt (vue tableau) ---------- */
  function lsPeriod(k) {
    const first = data.entries.reduce((a, e) => (e.date < a ? e.date : a), todayISO);
    if (k === 'all') return [first, todayISO.slice(0, 4) + '-12-31', 'Depuis le début'];
    if (k === '12m') { const f = E.addMonths(todayISO.slice(0, 7), -11) + '-01'; return [f, todayISO, '12 derniers mois']; }
    return [`${k}-01-01`, `${k}-12-31`, `Année ${k}`];
  }
  function viewLoansTable(all) {
    const f = ui.ls = Object.assign({ status: 'active', period: todayISO.slice(0, 4), basis: 'cash', q: '', sort: 'name', dir: 1 }, ui.ls || {});
    if (!['name', 'revenue', 'yield', 'capital', 'rate', 'arrears', 'start', 'end'].includes(f.sort)) { f.sort = 'name'; f.dir = 1; }
    const [from, to, plabel] = lsPeriod(f.period);
    const P = E.loanRevenue(data, from, to, f.basis, todayISO), byId = Object.fromEntries(P.rows.map((r) => [r.loan, r]));
    const q = f.q.trim().toLowerCase();
    const rows = all.filter((x) => (f.status === 'all' || (f.status === 'closed' ? x.status === 'closed' : x.status !== 'closed'))
      && (!q || `${x.l.name} ${x.l.borrower || ''} ${x.l.city || ''} ${x.l.dossier || ''}`.toLowerCase().includes(q)))
      .map((x) => ({ ...x, p: byId[x.l.id], start: x.l.versions[0].from, end: x.l.closedOn || x.l.maturity || '' }));
    const key = { name: (x) => x.l.name.toLowerCase(), revenue: (x) => x.p.revenue, yield: (x) => x.p.yieldAnn == null ? -9 : x.p.yieldAnn,
      capital: (x) => x.s.ledgerBalance, rate: (x) => (x.cur && x.cur.rate) || 0, arrears: (x) => x.s.totals.arrears, start: (x) => x.start, end: (x) => x.end || '9999' }[f.sort];
    rows.sort((a, b) => { const A = key(a), B = key(b); return (A < B ? -1 : A > B ? 1 : 0) * f.dir; });
    const max = Math.max(1, ...rows.map((x) => x.p.revenue));
    const bar = (v) => `<span class="ivc-bar"><span class="inc" style="width:${v > 0 ? Math.max(3, v / max * 100) : 100}%" data-zero="${v > 0 ? '' : '1'}"></span></span>`;
    const th = (k, lb, cls = '') => `<th class="${cls} sortable" data-action="ls-sort" data-k="${k}" aria-sort="${f.sort === k ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}">${lb}${f.sort === k ? (f.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const T = rows.reduce((a, x) => ({ rev: a.rev + x.p.revenue, cap: a.cap + x.s.ledgerBalance, arr: a.arr + x.s.totals.arrears, cd: a.cd + x.p.capDays }), { rev: 0, cap: 0, arr: 0, cd: 0 });
    const tYield = T.cd ? T.rev / T.cd * 365 : null;
    const years = [...new Set(data.entries.map((e) => e.date.slice(0, 4)).concat(String(Number(todayISO.slice(0, 4)) + 1)))].sort();
    const opt = (v, cur, lb) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${lb}</option>`;
    return `
    <div class="filters ls-filters">
      <label>Statut<select id="ls-status">${opt('active', f.status, 'En cours')}${opt('closed', f.status, 'Remboursés')}${opt('all', f.status, 'Tous')}</select></label>
      <label>Période<select id="ls-period">${years.map((y) => opt(y, f.period, y)).join('')}${opt('12m', f.period, '12 derniers mois')}${opt('all', f.period, 'Depuis le début')}</select></label>
      <label>Revenus selon<select id="ls-basis">${opt('cash', f.basis, 'Encaissement')}${opt('accrual', f.basis, 'Reconnaissance (mois couvert)')}</select></label>
      <label>Recherche<input type="search" id="ls-q" value="${esc(f.q)}" placeholder="Prêt, emprunteur, ville, dossier"></label>
    </div>
    <div class="kpis">
      ${kpi('Revenus d\'intérêts', m(T.rev), `${plabel} · ${rows.length} prêt${rows.length > 1 ? 's' : ''}`)}
      ${kpi('Rendement annualisé', tYield == null ? '—' : PCT.format(tYield), 'Revenus ÷ capital moyen prêté')}
      ${kpi('Capital prêté', m0(T.cap), 'Solde actuel des prêts affichés')}
      ${kpi('Arriérés', `<span class="${T.arr > 0.5 ? 'neg' : ''}">${m(T.arr)}</span>`, 'Mois en retard ou partiels')}
    </div>
    <section class="panel"><div class="table-wrap"><table class="ls-table"><thead><tr>
      ${th('name', 'Prêt')}${th('revenue', 'Revenus d\'intérêts')}${th('yield', 'Rendement / an', 'num')}${th('capital', 'Capital', 'num')}${th('rate', 'Taux', 'num')}${th('arrears', 'Arriérés', 'num')}${th('start', 'Début')}${th('end', 'Fin')}<th>Actions</th>
    </tr></thead><tbody>
      ${rows.map((x) => `<tr>
        <td><button class="linklike" data-action="open-loan" data-id="${x.l.id}">${esc(x.l.name)}</button><div class="small muted">${[x.l.name.includes(x.l.borrower || '\u0000') ? '' : esc(x.l.borrower || ''), x.l.dossier ? `Dossier n° ${x.l.dossier}` : '', esc(x.l.city || '')].filter(Boolean).join(' · ')}</div></td>
        <td><div class="ivc one">${bar(x.p.revenue)}<span class="num">${m(x.p.revenue)}</span></div></td>
        <td class="num">${x.p.yieldAnn == null ? '<span class="muted">—</span>' : PCT.format(x.p.yieldAnn)}<div class="small muted">${x.p.avgCapital ? `sur ${m0(x.p.avgCapital)} moyen` : ''}</div></td>
        <td class="num">${m0(x.s.ledgerBalance)}</td>
        <td class="num">${x.cur && x.cur.rate != null ? PCT.format(x.cur.rate) : '—'}</td>
        <td class="num ${x.s.totals.arrears > 0.5 ? 'neg' : ''}">${m(x.s.totals.arrears)}</td>
        <td>${d(x.start)}</td>
        <td>${x.l.closedOn ? `${d(x.l.closedOn)}<div class="small muted">remboursé</div>` : x.l.maturity ? `${d(x.l.maturity)}<div class="small muted">échéance</div>` : '<span class="muted">—</span>'}</td>
        <td><button class="btn small" data-action="loan-statement" data-id="${x.l.id}" title="Ouvrir l'état de compte">État de compte</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Aucun prêt ne correspond aux filtres.</td></tr>'}
    </tbody><tfoot><tr class="grand"><td>Total</td><td><div class="ivc one"><span></span><span class="num">${m(T.rev)}</span></div></td>
      <td class="num">${tYield == null ? '' : PCT.format(tYield)}</td><td class="num">${m0(T.cap)}</td><td></td><td class="num">${m(T.arr)}</td><td colspan="3"></td></tr></tfoot></table></div></section>
    <p class="small muted">${f.basis === 'accrual' ? 'Reconnaissance : les intérêts comptent dans le mois couvert (mois terminés selon le calendrier; mois en cours et futurs seulement s\'ils sont déjà payés).' : 'Encaissement : les intérêts comptent à la date de réception.'} Rendement / an = revenus d'intérêts ÷ capital moyen prêté pendant la période, ramené sur un an.</p>`;
  }

  function viewLoan() {
    const l = loanById(ui.loanId); if (!l) { ui.loanId = null; return viewLoans(); }
    const { status } = loanSummary(l);
    const s = E.schedule(data, l.id, todayISO, ui.horizon == null ? 3 : ui.horizon);
    const capital = data.entries.filter((e) => e.lines.some((x) => x.acct === 'loans' && x.loan === l.id)).sort((a, b) => a.date.localeCompare(b.date));
    const rows = s.rows.slice().reverse();
    return `
    <div class="section-head"><div><button class="btn ghost small" data-action="go" data-view="loans">← Tous les prêts</button>
      <h1 style="margin-top:6px">${esc(l.name)} ${pill(status)}</h1>
      <div class="sub">${esc(l.borrower || '')}${l.city ? ` · ${esc(l.city)}` : ''}${l.dossier ? ` · dossier Terreno n° ${l.dossier}` : ''}${l.maturity ? ` · échéance ${d(l.maturity)}` : ''}${l.closedOn ? ` · remboursé le ${d(l.closedOn)}` : ''}</div></div>
      <div class="toolbar"><button class="btn" data-action="locate-loan" data-id="${l.id}" title="Centrer la carte sur les immeubles en garantie">⌖ Voir sur la carte</button><button class="btn" data-action="loan-statement" data-id="${l.id}">État de compte</button><button class="btn" data-action="edit-loan" data-id="${l.id}">Modifier le prêt</button><button class="btn primary" data-action="new-tx-loan" data-id="${l.id}">+ Paiement reçu</button></div></div>
    <div class="kpis">
      ${kpi('Solde du capital', m(s.ledgerBalance), 'Selon les déboursés et remboursements')}
      ${kpi('Intérêts reçus', m(s.totals.received), 'Depuis le début du prêt')}
      ${kpi('Intérêts attendus à ce jour', m(s.totals.expected), 'Mois échus')}
      ${kpi('Arriérés', `<span class="${s.totals.arrears > 0.5 ? 'neg' : ''}">${m(s.totals.arrears)}</span>`, 'Mois en retard ou partiels')}
      ${s.capitalizedTotal ? kpi('Intérêts capitalisés', m(s.capitalizedTotal), 'Ajoutés au capital (calendrier)') : ''}
    </div>
    ${window.TFDossiers ? window.TFDossiers.loanCard(l) : ''}
    <section class="panel"><div class="panel-head"><h2>Versions du prêt</h2><span class="muted small">Chaque augmentation, remboursement partiel ou changement de taux crée une version</span></div>
      <div class="table-wrap"><table><thead><tr><th>Version</th><th>À partir du</th><th class="num">Capital</th><th class="num">Taux</th><th class="num">Intérêt mensuel</th><th>Note</th></tr></thead><tbody>
      ${l.versions.map((v) => `<tr><td>${esc(v.label || '')}</td><td>${d(v.from)}</td><td class="num">${m(v.principal)}</td><td class="num">${PCT.format(v.rate)}</td>
        <td class="num">${m(v.monthly != null ? v.monthly : v.principal * v.rate / 12)}${v.monthly != null ? ' <span class="chip">fixé</span>' : ''}${v.capitalize ? `<div class="small muted">+ ${m(v.capitalize)} capitalisés</div>` : ''}</td><td class="small muted">${esc(v.note || '')}</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Calendrier des intérêts</h2>
      <div class="toolbar"><span class="muted small">Payable à terme échu · en retard après le 10 du mois suivant</span>
        <label class="small muted" style="display:flex;gap:6px;align-items:center">Mois à venir <select id="horizon" style="width:auto">${[3, 6, 12].map((n) => `<option value="${n}" ${(ui.horizon == null ? 3 : ui.horizon) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div></div>
      <div class="table-wrap"><table><thead><tr><th>Mois couvert</th><th>Version</th><th class="num">Capital</th><th class="num">Attendu</th><th class="num">Reçu</th><th class="num">Écart</th><th>Statut</th><th>Paiements</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.isFuture ? 'future' : ''}"><td style="white-space:nowrap">${r.label}${r.isMaturity ? ' <span class="chip">échéance</span>' : ''}${r.afterMaturity && r.isFuture ? ' <span class="chip warn">après l\'échéance</span>' : ''}</td><td class="small">${esc(r.version)}</td><td class="num">${m0(r.principal)}</td>
        <td class="num">${m(r.expected)}${r.adjustment ? `<div class="small muted" title="${esc(r.adjustment.note || '')}">calculé ${m(r.expectedCalc)}</div>` : ''}</td><td class="num">${m(r.received)}</td>
        <td class="num ${r.diff < -0.5 ? 'neg' : ''}">${r.status === 'upcoming' || Math.abs(r.diff) <= 0.5 ? '' : m(r.diff)}</td>
        <td style="white-space:nowrap">${pill(r.status)} ${r.status !== 'upcoming' && (r.expected || r.received || r.adjustment) ? `<button class="btn ghost small" data-action="adj-open" data-id="${l.id}" data-p="${r.period}" title="Ajuster le montant attendu de ce mois">${r.adjustment ? 'Modifier' : 'Ajuster'}</button>` : ''}
          ${r.adjustment && r.adjustment.note ? `<div class="small muted">${esc(r.adjustment.note)}</div>` : ''}</td>
        <td class="small">${r.prepaid ? '<span class="chip acc">payé d\'avance</span> ' : ''}${r.payments.map((p) => `<button class="btn ghost small" data-action="edit-tx" data-id="${p.entry}">${d(p.date)} · ${m(p.amt)}</button>`).join(' ')}</td></tr>`).join('')}
      </tbody></table></div>
      ${s.unassigned.length ? `<div class="panel-body callout">Paiements sans mois couvert : ${s.unassigned.map((p) => `<button class="btn ghost small" data-action="edit-tx" data-id="${p.entry}">${d(p.date)} · ${m(p.amt)}</button>`).join(' ')} — ouvrez-les pour indiquer le mois.</div>` : ''}
    </section>
    <section class="panel"><div class="panel-head"><h2>Mouvements de capital</h2></div><div class="table-wrap">${txTable(capital, false)}</div></section>
    ${l.legacyLabels && l.legacyLabels.length ? `<p class="small muted">Libellés dans l'ancien classeur : ${l.legacyLabels.map(esc).join(' · ')}</p>` : ''}`;
  }

  /* ---------------------------------------------------------------- P&L */
  function viewPnl() {
    const basis = ui.pnlBasis || 'cash';
    const y = ui.pnlYear, p = E.pnl(data, `${y}-01-01`, `${y}-12-31`, basis === 'compare' ? 'cash' : basis, todayISO);
    const basisSeg = `<div class="seg big" role="tablist" aria-label="Base de calcul">${[['cash', 'Encaissement'], ['accrual', 'Reconnaissance'], ['compare', 'Comparer']].map(([k, l]) => `<button role="tab" data-action="pnl-basis" data-b="${k}" class="${basis === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const basisNote = basis === 'accrual' ? "Reconnaissance : les intérêts d'un mois terminé comptent dans ce mois, selon le calendrier (payés ou non). Le mois en cours et les mois futurs ne comptent que ce qui est déjà payé d'avance. Les dépenses et les frais de dossier comptent dans leur mois couvert (sinon à leur date)."
      : "Encaissement : les revenus et les dépenses comptent à la date où ils passent au compte.";
    if (basis === 'compare') return viewPnlCompare(y, basisSeg);
    const ms = p.months, quarters = [0, 1, 2, 3].map((q) => ms.slice(q * 3, q * 3 + 3));
    const cells = (getter, cls = '') => ms.map((k) => { const v = getter(k); return `<td class="num ${cls} ${signCls(v)}">${v ? m0(v) : '<span class="muted">—</span>'}</td>`; }).join('');
    const qcells = (getter) => quarters.map((q) => { const v = E.r2(q.reduce((s, k) => s + getter(k), 0)); return `<td class="num ${signCls(v)}">${m0(v)}</td>`; }).join('');
    const line = (r) => `<tr class="clickable" data-action="filter-tx" data-acct="${r.loan ? `${r.acct}|${r.loan}` : r.acct}" data-year="${y}"><td>${esc(r.label)}</td>${cells((k) => r.byMonth[k] || 0)}<td class="num"><b>${m0(r.total)}</b></td><td class="num muted">${p.total.revenue ? PCT.format(r.total / p.total.revenue) : ''}</td>${qcells((k) => r.byMonth[k] || 0)}</tr>`;
    const tot = (label, key, cls) => `<tr class="${cls}"><td>${label}</td>${cells((k) => p.byMonth[k][key])}<td class="num">${m0(p.total[key])}</td><td class="num muted">${p.total.revenue ? PCT.format(p.total[key] / p.total.revenue) : ''}</td>${qcells((k) => p.byMonth[k][key])}</tr>`;
    const head = `<tr><th>${y}</th>${ms.map((k) => `<th class="num">${E.monthLabel(k).split(' ')[0]}</th>`).join('')}<th class="num">Total</th><th class="num">%</th><th class="num">T1</th><th class="num">T2</th><th class="num">T3</th><th class="num">T4</th></tr>`;
    const span = ms.length + 7;
    return `
    <div class="section-head"><div><h1>P&amp;L ${y} · ${basis === 'accrual' ? 'reconnaissance' : 'encaissement'}</h1><div class="sub">${basisNote} Cliquez une ligne pour voir ses transactions.</div></div>
      <div class="toolbar">${basisSeg}<select id="pnl-year" aria-label="Année">${years().reverse().map((x) => `<option ${x === y ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="kpis k8">
      ${kpi('Revenus totaux', m0(p.total.revenue), `dont ${m0(p.total.interest)} en intérêts`)}
      ${kpi("Dépenses d'intérêts", m0(p.total.direct), `Marge ${m0(p.total.margin)} (${PCT.format(p.total.marginPct)})`)}
      ${kpi('Autres dépenses', m0(p.total.overhead), '')}
      ${kpi('Profit avant impôts', m0(p.total.profit), `${PCT.format(p.total.profitPct)} des revenus d'intérêts`)}
    </div>
    <section class="panel"><div class="table-wrap"><table class="pnl"><thead>${head}</thead><tbody>
      <tr class="group"><td colspan="${span}">Revenus</td></tr>
      ${p.groups.revenue.map(line).join('')}
      ${tot('Total des revenus', 'revenue', 'total')}
      <tr class="group"><td colspan="${span}">Dépenses d'intérêts pour générer le revenu</td></tr>
      ${p.groups.direct.map(line).join('')}
      ${tot("Total des dépenses d'intérêts", 'direct', 'total')}
      ${tot('Marge de profit', 'margin', 'grand')}
      <tr class="group"><td colspan="${span}">Autres dépenses</td></tr>
      ${p.groups.overhead.map(line).join('')}
      ${tot('Total des autres dépenses', 'overhead', 'total')}
      ${tot('Profit avant impôts', 'profit', 'grand')}
    </tbody></table></div></section>`;
  }

  // dépenses déjà payées qui couvrent le mois en cours ou des mois futurs (charges payées d'avance)
  function prepaidExpenses(cut) {
    let v = 0;
    for (const e of data.entries) { if (e.date > cut) continue; for (const l of e.lines) { const g = (acc(l.acct) || {}).group; if ((g === 'direct' || g === 'overhead') && l.period && l.period >= cut.slice(0, 7)) v += l.amt; } }
    return E.r2(v);
  }
  function viewPnlCompare(y, basisSeg) {
    const from = `${y}-01-01`, to = `${y}-12-31`;
    const pc = E.pnl(data, from, to, 'cash', todayISO), pa = E.pnl(data, from, to, 'accrual', todayISO);
    const t = E.interestTiming(data, from, to, todayISO);
    const ms = t.months, cur = todayISO.slice(0, 7);
    const cell = (v, strong, k) => `<td class="num ${signCls(v)} ${k && k > cur ? 'muted' : ''}">${Math.abs(v) < 0.005 ? '<span class="muted">—</span>' : strong ? `<b>${m0(v)}</b>` : m0(v)}</td>`;
    const row = (label, get, total, cls = '', hint = '') => `<tr class="${cls}"><td>${label}${hint ? `<div class="small muted">${hint}</div>` : ''}</td>${ms.map((k) => cell(get(k), false, k)).join('')}${cell(total, true)}</tr>`;
    let cC = 0, cA = 0; const cum = {}; ms.forEach((k) => { cC += pc.byMonth[k].profit; cA += pa.byMonth[k].profit; cum[k] = [E.r2(cC), E.r2(cA)]; });
    const W = 640, H = 210, pl = 56, pr = 10, pt = 10, pb = 26, bw = (W - pl - pr) / ms.length;
    const max = Math.max(1000, ...ms.map((k) => Math.max(t.cash[k], t.earned[k])));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step, yy = (v) => pt + (H - pt - pb) * (top - v) / top;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Intérêts encaissés et gagnés par mois">`;
    for (let v = 0; v <= top + 0.1; v += step) svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy(v)}" y2="${yy(v)}"/><text x="${pl - 6}" y="${yy(v) + 4}" text-anchor="end">${Math.round(v / 1000)} k</text>`;
    ms.forEach((k, i) => { const x = pl + i * bw;
      svg += `<rect class="bar-exp" x="${x + bw * 0.14}" y="${yy(t.cash[k])}" width="${bw * 0.34}" height="${yy(0) - yy(t.cash[k])}" rx="1.5"><title>${E.monthLabel(k)} · encaissé ${m(t.cash[k])}</title></rect>`;
      svg += `<rect class="bar-rev" x="${x + bw * 0.5}" y="${yy(t.earned[k])}" width="${bw * 0.34}" height="${yy(0) - yy(t.earned[k])}" rx="1.5"><title>${E.monthLabel(k)} · reconnu ${m(t.earned[k])}</title></rect>`;
      svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${E.monthLabel(k).split(' ')[0]}</text>`; });
    svg += '</svg>';
    return `
    <div class="section-head"><div><h1>P&amp;L ${y} · encaissement et reconnaissance</h1><div class="sub">Encaissés : déposés dans le mois. Reconnus : gagnés dans le mois selon le calendrier des intérêts. Les dépenses avec un mois couvert sont reconnues dans ce mois.</div></div>
      <div class="toolbar">${basisSeg}<select id="pnl-year" aria-label="Année">${years().reverse().map((x) => `<option ${x === y ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="kpis">
      ${kpi('Intérêts encaissés', m0(t.totals.cash), `Profit ${m0(pc.total.profit)}`)}
      ${kpi('Intérêts reconnus', m0(t.totals.earned), `Profit ${m0(pa.total.profit)}`)}
      ${kpi('Gagnés, pas encore reçus', m0(t.totals.receivableOpen), `Au ${d(t.cut)} · intérêts à recevoir`)}
      ${kpi("Reçus d'avance", m0(t.totals.prepaidOpen), `Au ${d(t.cut)} · pour le mois en cours et les mois à venir`)}
      ${kpi("Dépenses payées d'avance", m0(prepaidExpenses(t.cut)), `Au ${d(t.cut)} · pour le mois en cours et les mois à venir`)}
    </div>
    <section class="panel"><div class="panel-head"><h2>Intérêts par mois</h2><div class="legend"><span><i style="background:var(--ink-2);opacity:.35"></i>Encaissés</span><span><i style="background:var(--accent)"></i>Reconnus (gagnés)</span></div></div>
      <div class="panel-body chart">${svg}</div></section>
    <section class="panel"><div class="table-wrap"><table class="pnl"><thead><tr><th>${y}</th>${ms.map((k) => `<th class="num">${E.monthLabel(k).split(' ')[0]}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      <tr class="group"><td colspan="${ms.length + 2}">Revenus d'intérêts</td></tr>
      ${row('Encaissés', (k) => t.cash[k], t.totals.cash, 'total', 'Déposés dans le mois (la plupart couvrent le mois précédent)')}
      ${row("dont reçus d'avance", (k) => t.aheadIn[k], t.totals.aheadIn, '', 'Pour des mois futurs')}
      ${row('Reconnus', (k) => t.earned[k], t.totals.earned, 'grand', 'Mois terminés : selon le calendrier · mois en cours et futurs : payés d\'avance')}
      ${row('dont pas encore reçus', (k) => t.receivable[k], t.totals.receivable, '', 'Mois terminés dont l\'intérêt est en attente de paiement')}
      ${t.totals.capitalized ? row('dont capitalisés', (k) => t.capitalized[k], t.totals.capitalized, '', 'Ajoutés au capital du prêt, non encaissés') : ''}
      ${row('Écart (reconnus − encaissés)', (k) => E.r2(t.earned[k] - t.cash[k]), E.r2(t.totals.earned - t.totals.cash))}
      <tr class="group"><td colspan="${ms.length + 2}">Dépenses d'intérêts (Doris, Guy, marge)</td></tr>
      ${row('Payées', (k) => pc.byMonth[k].direct, pc.total.direct, 'total', 'Versées dans le mois')}
      ${row('Reconnues', (k) => pa.byMonth[k].direct, pa.total.direct, 'grand', 'Selon le mois couvert (paiements d\'avance étalés)')}
      <tr class="group"><td colspan="${ms.length + 2}">Profit avant impôts</td></tr>
      ${row('Encaissement', (k) => pc.byMonth[k].profit, pc.total.profit, 'total')}
      ${row('Reconnaissance', (k) => pa.byMonth[k].profit, pa.total.profit, 'total')}
      ${row('Cumulé — encaissement', (k) => cum[k][0], pc.total.profit)}
      ${row('Cumulé — reconnaissance', (k) => cum[k][1], pa.total.profit)}
    </tbody></table></div></section>
    <p class="hint">Le mois en cours et les mois futurs ne comptent que les intérêts déjà payés d'avance (les intérêts se paient à terme échu). Si un écart du calendrier ne sera jamais dû (ex. : prorata au déboursé), utilisez « Ajuster » dans la fiche du prêt pour qu'il ne compte pas comme revenu à recevoir.</p>`;
  }

  /* ---------------------------------------------------------------- P&L d'une période (une colonne) */
  const QLABEL = ['T1 (janv.–mars)', 'T2 (avr.–juin)', 'T3 (juil.–sept.)', 'T4 (oct.–déc.)'];
  function periodRange(pp) {
    if (pp.kind === 'month') { const [y, mo] = pp.month.split('-').map(Number); return { from: `${pp.month}-01`, to: `${pp.month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`, label: E.monthLabel(pp.month) }; }
    if (pp.kind === 'quarter') { const [y, q] = pp.quarter.split('-Q').map(Number); const m1 = (q - 1) * 3 + 1, m3 = m1 + 2; return { from: `${y}-${String(m1).padStart(2, '0')}-01`, to: `${y}-${String(m3).padStart(2, '0')}-${String(new Date(Date.UTC(y, m3, 0)).getUTCDate()).padStart(2, '0')}`, label: `${QLABEL[q - 1]} ${y}` }; }
    return { from: `${pp.year}-01-01`, to: `${pp.year}-12-31`, label: `Année ${pp.year}` };
  }
  function shiftPeriod(pp, n) {
    const o = { ...pp };
    if (pp.kind === 'month') o.month = E.addMonths(pp.month, n);
    else if (pp.kind === 'quarter') { let [y, q] = pp.quarter.split('-Q').map(Number); q += n; while (q > 4) { q -= 4; y++; } while (q < 1) { q += 4; y--; } o.quarter = `${y}-Q${q}`; }
    else o.year = String(Number(pp.year) + n);
    return o;
  }
  function viewPnlPeriod() {
    const cy = todayISO.slice(0, 4), cq = Math.floor((Number(todayISO.slice(5, 7)) - 1) / 3) + 1;
    const pp = ui.pp = Object.assign({ kind: 'month', month: todayISO.slice(0, 7), quarter: `${cy}-Q${cq}`, year: cy, basis: 'cash' }, ui.pp || {});
    const { from, to, label } = periodRange(pp);
    const p = E.pnl(data, from, to, pp.basis, todayISO);
    const T = p.total, pct = (v) => (T.revenue ? PCT.format(v / T.revenue) : '');
    const ys = years();
    const line = (r) => `<tr class="clickable" data-action="filter-tx" data-acct="${r.loan ? `${r.acct}|${r.loan}` : r.acct}" data-year="${from.slice(0, 4)}"><td>${esc(r.label)}</td><td class="num ${signCls(r.total)}">${m(r.total)}</td><td class="num muted">${pct(r.total)}</td></tr>`;
    const tot = (lab, v, cls) => `<tr class="${cls}"><td>${lab}</td><td class="num ${signCls(v)}">${m(v)}</td><td class="num muted">${pct(v)}</td></tr>`;
    const grp = (lab) => `<tr class="group"><td colspan="3">${lab}</td></tr>`;
    const empty = (list) => (list.length ? '' : '<tr><td colspan="3" class="muted small">Aucun montant pour cette période</td></tr>');
    const picker = pp.kind === 'month' ? `<input type="month" id="pp-month" value="${pp.month}" aria-label="Mois">`
      : pp.kind === 'quarter' ? `<select id="pp-quarter" aria-label="Trimestre">${ys.slice().reverse().flatMap((y) => [4, 3, 2, 1].map((q) => `<option value="${y}-Q${q}" ${pp.quarter === `${y}-Q${q}` ? 'selected' : ''}>${QLABEL[q - 1]} ${y}</option>`)).join('')}</select>`
      : `<select id="pp-year" aria-label="Année">${ys.slice().reverse().map((y) => `<option ${pp.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
    const future = from.slice(0, 7) > todayISO.slice(0, 7);
    return `
    <div class="section-head"><div><h1>P&amp;L · ${esc(label)}</h1><div class="sub">${pp.basis === 'accrual' ? "Reconnaissance : intérêts des mois terminés selon le calendrier; le mois en cours et les mois futurs ne comptent que ce qui est payé d'avance." : 'Encaissement : montants déposés ou payés dans la période.'} Du ${d(from)} au ${d(to)}.</div></div></div>
    <div class="toolbar pp-bar">
      <div class="seg big" role="tablist" aria-label="Période">${[['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']].map(([k, l]) => `<button role="tab" data-action="pp-kind" data-k="${k}" class="${pp.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn" data-action="pp-shift" data-n="-1" aria-label="Période précédente">‹</button>${picker}<button class="btn" data-action="pp-shift" data-n="1" aria-label="Période suivante">›</button>
      <div class="seg big" role="tablist" aria-label="Base de calcul">${[['cash', 'Encaissement'], ['accrual', 'Reconnaissance']].map(([k, l]) => `<button role="tab" data-action="pp-basis" data-b="${k}" class="${pp.basis === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    ${future && pp.basis === 'cash' ? `<div class="callout">Période future : en encaissement, seuls les montants déjà passés au compte avec une date dans cette période apparaissent. Passez à « Reconnaissance » pour voir les intérêts déjà payés d'avance.</div>` : ''}
    <div class="kpis k8">
      ${kpi('Revenus totaux', m0(T.revenue), `dont ${m0(T.interest)} en intérêts`)}
      ${kpi("Dépenses d'intérêts", m0(T.direct), `Marge ${m0(T.margin)} (${PCT.format(T.marginPct)})`)}
      ${kpi('Autres dépenses', m0(T.overhead), '')}
      ${kpi('Profit avant impôts', m0(T.profit), T.interest ? `${PCT.format(T.profitPct)} des revenus d'intérêts` : '')}
    </div>
    <section class="panel pp-panel"><div class="table-wrap"><table class="pnl single"><thead><tr><th>${esc(label)}</th><th class="num">Montant</th><th class="num">% des revenus</th></tr></thead><tbody>
      ${grp('Revenus')}${p.groups.revenue.map(line).join('')}${empty(p.groups.revenue)}
      ${tot('Total des revenus', T.revenue, 'total')}
      ${grp("Dépenses d'intérêts pour générer le revenu")}${p.groups.direct.map(line).join('')}${empty(p.groups.direct)}
      ${tot("Total des dépenses d'intérêts", T.direct, 'total')}
      ${tot('Marge de profit', T.margin, 'grand')}
      ${grp('Autres dépenses')}${p.groups.overhead.map(line).join('')}${empty(p.groups.overhead)}
      ${tot('Total des autres dépenses', T.overhead, 'total')}
      ${tot('Profit avant impôts', T.profit, 'grand')}
    </tbody></table></div></section>`;
  }

  /* ---------------------------------------------------------------- bilan */
  function viewBalance() {
    const dt = ui.bsDate, b = E.balanceSheet(data, dt);
    const sh = b.liabilities.filter((x) => x.id.startsWith('liab:sh-'));
    const others = b.liabilities.filter((x) => !x.id.startsWith('liab:sh-'));
    const yrs = years();
    const row = (x, action) => `<tr ${action || ''}><td>${esc(x.label)}</td><td class="num ${signCls(x.value)}">${m(x.value)}</td></tr>`;
    const profitYtd = E.pnl(data, `${dt.slice(0, 4)}-01-01`, dt).total.profit;
    return `
    <div class="section-head"><div><h1>Bilan au ${d(dt)}</h1><div class="sub">Soldes calculés à partir de toutes les écritures jusqu'à cette date</div></div>
      <div class="toolbar"><input type="date" id="bs-date" value="${dt}" aria-label="Date du bilan">${yrs.map((y) => `<button class="btn small" data-action="bs-date" data-date="${y}-12-31">31 déc. ${y}</button>`).join('')}<button class="btn small" data-action="bs-date" data-date="${todayISO}">Aujourd'hui</button></div></div>
    <div class="kpis">
      ${kpi('Total des actifs', m0(b.totalAssets), `dont ${m0(b.loansTotal)} en prêts`)}
      ${kpi('Total du passif', m0(b.totalLiab), '')}
      ${kpi('Équité liée aux prêts', m0(b.equityCore), 'Prêts + banque − passif')}
      ${kpi('Équité totale', m0(b.equity), 'Incluant les autres placements')}
      ${kpi(`Profit ${dt.slice(0, 4)} à ce jour`, m0(profitYtd), 'Avant impôts')}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Actif</h2></div><div class="table-wrap"><table><tbody>
        <tr class="group"><td colspan="2">Encaisse</td></tr>${b.assets.filter((x) => x.kind === 'bank').map((x) => row(x)).join('')}
        <tr class="group"><td colspan="2">Prêts hypothécaires</td></tr>${b.assets.filter((x) => x.kind === 'loan').map((x) => row(x, `class="clickable" data-action="open-loan" data-id="${x.id}"`)).join('')}
        <tr class="total"><td>Total actif lié aux prêts</td><td class="num">${m(b.coreAssets)}</td></tr>
        ${b.assets.some((x) => x.kind === 'other') ? `<tr class="group"><td colspan="2">Autres actifs</td></tr>${b.assets.filter((x) => x.kind === 'other').map((x) => row(x)).join('')}` : ''}
        <tr class="grand"><td>Total des actifs</td><td class="num">${m(b.totalAssets)}</td></tr>
      </tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h2>Passif et équité</h2></div><div class="table-wrap"><table><tbody>
        <tr class="group"><td colspan="2">Avances d'apparentés et autres</td></tr>${others.map((x) => row(x)).join('') || '<tr><td colspan="2" class="muted">—</td></tr>'}
        <tr class="group"><td colspan="2">Avances de l'actionnaire</td></tr>${sh.map((x) => row(x)).join('') || '<tr><td colspan="2" class="muted">Aucune avance en cours</td></tr>'}
        <tr class="total"><td>Total du passif</td><td class="num">${m(b.totalLiab)}</td></tr>
        <tr class="grand"><td>Équité liée aux prêts</td><td class="num">${m(b.equityCore)}</td></tr>
        <tr class="grand"><td>Équité totale</td><td class="num">${m(b.equity)}</td></tr>
      </tbody></table></div></section>
    </div>`;
  }

  /* ---------------------------------------------------------------- import d'un relevé */
  const IMP_STATUS = { exists: ['paid', 'Déjà saisie'], added: ['over', 'Ajoutée'], new: ['partial', 'Nouvelle'], ignored: ['none', 'Ignorée'] };
  const CONF = { high: ['paid', 'Sûre'], medium: ['partial', 'À vérifier'], low: ['upcoming', 'À catégoriser'] };
  function computeImport() {
    const imp = ui.imp; if (!imp) return null;
    const rows = imp.rows.map((r) => ({ ...r }));
    const rec = window.FinImport.reconcile(data, imp.account, rows);
    // propositions en chaîne : chaque proposition « réserve » ses mensualités pour les lignes suivantes
    const temp = { ...data, entries: data.entries.slice() };
    const hist = window.FinImport.history(data, imp.account);
    for (const r of rec.rows) {
      if (r.status === 'exists' && (imp.added || []).includes(r.n)) r.status = 'added';
      if (r.status !== 'new') continue;
      if ((imp.ignored || []).includes(r.n)) { r.status = 'ignored'; continue; }
      r.prop = window.FinImport.propose(temp, imp.account, r, hist);
      if (r.prop.splits.length) temp.entries.push({ id: `tmp${r.n}`, ...window.FinImport.entryFromRow(imp.account, r, r.prop.splits) });
    }
    return rec;
  }
  function viewImport() {
    const imp = ui.imp;
    if (!imp) return `<div class="empty">Aucun relevé chargé. <button class="btn" data-action="import-csv">Choisir un fichier CSV</button></div>`;
    const rec = computeImport(), rows = rec.rows;
    const cnt = (st) => rows.filter((r) => r.status === st).length;
    const safe = rows.filter((r) => r.status === 'new' && r.prop && r.prop.confidence === 'high');
    const last = rows[rows.length - 1], lastCheck = last && rec.dayCheck[last.date];
    const badDays = Object.entries(rec.dayCheck).filter(([, c]) => !c.ok);
    const chip = (sp) => `<span class="chip ${sp.acct === 'rev:interest' ? 'acc' : ''}">${esc((SHORT[sp.acct] || (acc(sp.acct) || {}).name || sp.acct) + (sp.loan ? ` · ${loanShort(sp.loan)}` : '') + (sp.period ? ` · ${E.monthLabel(sp.period)}` : '') + (sp.memo ? ` · ${sp.memo}` : ''))} ${m(sp.amt)}</span>`;
    return `
    <div class="section-head"><div><button class="btn ghost small" data-action="go" data-view="transactions">← Transactions</button>
      <h1 style="margin-top:6px">Import du relevé ${esc(imp.fileName)}</h1>
      <div class="sub">${rows.length} lignes du ${d(rows[0].date)} au ${d(last.date)} · ${cnt('exists') + cnt('added')} déjà dans l'outil · ${cnt('new')} à traiter${cnt('ignored') ? ` · ${cnt('ignored')} ignorées` : ''}${imp.skipped && imp.skipped.length ? ` · ${imp.skipped.length} lignes illisibles` : ''}</div></div>
      <div class="toolbar">
        <label class="field" style="flex-direction:row;align-items:center;gap:6px"><span>Compte</span><select id="imp-account" style="width:auto">${visibleBanks(imp.account).filter((b) => !b.personal).map((b) => `<option value="${b.id}" ${b.id === imp.account ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        ${safe.length ? `<button class="btn primary" data-action="imp-add-safe">${safe.length === 1 ? 'Ajouter la proposition sûre' : `Ajouter les ${safe.length} propositions sûres`}</button>` : ''}
      </div></div>
    ${lastCheck ? `<div class="kpis">
      ${kpi('Solde du relevé', m(lastCheck.statement), `Au ${d(last.date)}`)}
      ${kpi("Solde dans l'outil", m(lastCheck.ledger), cnt('new') ? `${m(lastCheck.ledgerAfter)} une fois les ${cnt('new')} lignes ajoutées` : 'Toutes les lignes sont saisies')}
      ${kpi('Rapprochement', lastCheck.ok && !badDays.length ? '<span style="color:var(--good)">Concorde ✓</span>' : '<span class="neg">Écart</span>', badDays.length ? `${badDays.length} journée(s) à vérifier` : 'Soldes de fin de journée identiques')}
    </div>` : ''}
    ${rec.missing.length ? `<div class="callout">${rec.missing.length} écriture(s) de l'outil sur cette période ne figurent pas au relevé : ${rec.missing.map((id) => { const e = data.entries.find((x) => x.id === id); return `<button class="btn ghost small" data-action="edit-tx" data-id="${id}">${d(e.date)} · ${esc(e.description)} · ${m(entryAmount(e))}</button>`; }).join(' ')}</div>` : ''}
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Description</th><th class="num">Montant</th><th class="num">Solde relevé</th><th>État</th><th>Proposition</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const [cls, lab] = IMP_STATUS[r.status]; const c = rec.dayCheck[r.date];
        const isLastOfDay = rows.filter((x) => x.date === r.date).pop() === r;
        return `<tr>
        <td class="num" style="text-align:left">${d(r.date)}</td>
        <td style="min-width:170px">${esc(r.description)}</td>
        <td class="num ${signCls(r.amount)}">${m(r.amount)}</td>
        <td class="num">${r.balance != null ? m(r.balance) : ''}${isLastOfDay && c && !c.ok ? ' <span class="pill late">écart</span>' : ''}</td>
        <td><span class="pill ${cls}">${lab}</span></td>
        <td>${r.status === 'new' ? `<div>${r.prop.splits.map(chip).join('') || ''}</div><div class="small muted">${pill(CONF[r.prop.confidence][0]).replace(/>[^<]*<\/span>$/, `>${CONF[r.prop.confidence][1]}</span>`)} ${esc(r.prop.reason)}</div>`
          : r.status === 'exists' || r.status === 'added' ? `<span class="small muted">${(r.matches || []).map((id) => { const e = data.entries.find((x) => x.id === id); return e ? chipsFor(e) : ''; }).join(' ')}</span>` : ''}</td>
        <td style="white-space:nowrap">${r.status === 'new' ? `${r.prop.splits.length ? `<button class="btn small primary" data-action="imp-add" data-n="${r.n}">Ajouter</button> ` : ''}<button class="btn small" data-action="imp-edit" data-n="${r.n}">${r.prop.splits.length ? 'Modifier…' : 'Catégoriser…'}</button> <button class="btn ghost small" data-action="imp-ignore" data-n="${r.n}">Ignorer</button>`
          : r.status === 'ignored' ? `<button class="btn ghost small" data-action="imp-unignore" data-n="${r.n}">Rétablir</button>`
          : (r.matches || []).length === 1 ? `<button class="btn ghost small" data-action="edit-tx" data-id="${r.matches[0]}">Voir</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>
    <p class="hint">Les lignes déjà saisies sont reconnues par la date et le montant (une ligne du relevé peut correspondre à plusieurs écritures, ex. un câble et ses frais). Les propositions viennent de vos transactions passées et des intérêts attendus; rien n'est ajouté sans votre clic.</p>`;
  }
  function importRow(n) { const rec = computeImport(); return rec.rows.find((r) => r.n === n); }
  function addImported(r, splits) {
    const e = { id: `e${Date.now().toString(36)}${r.n}`, ...window.FinImport.entryFromRow(ui.imp.account, r, splits) };
    const errs = E.validateEntry(e, data); if (errs.length) { toast(errs[0]); return false; }
    data.entries.push(e); data.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    ui.imp.added = (ui.imp.added || []).concat(r.n); return true;
  }
  function saveUi() { try { sessionStorage.setItem('tf.view', JSON.stringify(ui)); } catch (e) { /* rien */ } }

  /* ---------------------------------------------------------------- banque (à la QuickBooks) */
  // data.bankFeed : lignes de relevé importées en attente { id, account, date, description, amount, balance, status: 'pending'|'excluded', splits? }
  // data.statements : dernier solde de relevé connu par compte { date, balance }
  const feed = () => (data.bankFeed = data.bankFeed || []);
  ui.bank = Object.assign({ account: 'bank:td', tab: 'pending', q: '', dates: 'all', type: 'all', page: 1, sel: [], month: '', from: '', to: '', cat: '', amin: '', amax: '' }, ui.bank || {});
  const pivotAcctFor = (account, splits) => (isPersonal(account) ? defaultCounter(account, splits) : account);
  function feedEntry(item, splits, counter) {
    const account = item.account, sign = item.amount >= 0 ? 1 : -1;
    const pivot = isPersonal(account) ? (counter || defaultCounter(account, splits)) : account;
    const e = { id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, date: item.date, account, description: item.description, source: 'banque',
      lines: [{ acct: pivot, amt: item.amount }].concat(splits.map((sp) => { const o = { acct: sp.acct, amt: E.r2(-sign * num(sp.amt)) }; if (sp.loan) o.loan = sp.loan; if (sp.period) o.period = sp.period; if (sp.memo) o.memo = sp.memo; return o; })) };
    if (isPersonal(account)) e.counter = pivot;
    if (item.balance != null) e.statementBalance = item.balance;
    if (item.notes) e.notes = item.notes;
    return e;
  }
  function splitErrors(e) {
    const errs = E.validateEntry(e, data);
    e.lines.forEach((l) => { if (l.acct === 'rev:interest' && !l.period) errs.push("Indiquez le mois couvert par l'intérêt"); });
    if (e.lines.length < 2 || e.lines.slice(1).some((l) => !l.acct)) errs.unshift('Choisissez une catégorie');
    return Array.from(new Set(errs.map((x) => x.replace(/Ligne \d+ : compte inconnu/, 'Choisissez une catégorie'))));
  }
  // propositions en chaîne, par ordre de date, pour ne pas réserver deux fois la même mensualité
  function feedProposals(account) {
    const items = feed().filter((x) => x.account === account && x.status === 'pending').sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const temp = { ...data, entries: data.entries.slice() }, hist = window.FinImport.history(data, account), out = {};
    for (const it of items) {
      const auto = window.FinImport.propose(temp, account, it, hist);
      const splits = it.splits || auto.splits;
      out[it.id] = { auto, splits, manual: !!it.splits };
      if (splits.length) temp.entries.push(feedEntry(it, splits));
    }
    return out;
  }
  // Périodes du filtre de dates (Banque)
  const BANK_DATES = [['all', 'Toutes les dates'], ['month', 'Ce mois-ci'], ['last', 'Le mois dernier'], ['3m', '3 derniers mois'], ['6m', '6 derniers mois'], ['12m', '12 derniers mois'],
    ['quarter', 'Ce trimestre'], ['lastq', 'Le trimestre dernier'], ['year', 'Cette année'], ['lastyear', "L'année dernière"], ['pick', 'Un mois précis…'], ['custom', 'Dates personnalisées…']];
  function bankDateRange() {
    const B = ui.bank, ym = todayISO.slice(0, 7), y = +todayISO.slice(0, 4), q0 = Math.floor((+todayISO.slice(5, 7) - 1) / 3) * 3 + 1;
    const eom = (k) => `${k}-${String(new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;
    const qStart = `${y}-${String(q0).padStart(2, '0')}`;
    switch (B.dates) {
      case 'month': return [`${ym}-01`, eom(ym)];
      case 'last': { const k = E.addMonths(ym, -1); return [`${k}-01`, eom(k)]; }
      case '3m': return [`${E.addMonths(ym, -2)}-01`, todayISO];
      case '6m': return [`${E.addMonths(ym, -5)}-01`, todayISO];
      case '12m': return [`${E.addMonths(ym, -11)}-01`, todayISO];
      case 'quarter': return [`${qStart}-01`, eom(E.addMonths(qStart, 2))];
      case 'lastq': { const k = E.addMonths(qStart, -3); return [`${k}-01`, eom(E.addMonths(k, 2))]; }
      case 'year': return [`${y}-01-01`, `${y}-12-31`];
      case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      case 'pick': return B.month ? [`${B.month}-01`, eom(B.month)] : null;
      case 'custom': return (B.from || B.to) ? [B.from || '0000-01-01', B.to || '9999-12-31'] : null;
      default: return null;
    }
  }
  function inDates(dte) { const r = bankDateRange(); return !r || (dte >= r[0] && dte <= r[1]); }
  // catégories d'une écriture comptabilisée ou d'une transaction à traiter (pour le filtre « Catégorie »)
  let bankRowIds = [];
  const bankFilteredIds = () => bankRowIds.slice();
  const entryCats = (e) => { const piv = pivotOf(e); return e.lines.filter((l) => l !== piv).map((l) => l.acct); };
  const bankFiltersActive = () => { const B = ui.bank; return B.q || B.dates !== 'all' || B.type !== 'all' || B.cat || B.amin !== '' || B.amax !== ''; };
  function viewBank() {
    const B = ui.bank;
    if (!bankById(B.account) || bankById(B.account).hidden) B.account = (visibleBanks()[0] || {}).id;
    const account = B.account;
    const bal = E.balances(data, todayISO);
    if (!bankById(B.account) || bankById(B.account).hidden) B.account = (visibleBanks()[0] || {}).id;
    const cards = visibleBanks().map((b) => {
      const pend = feed().filter((x) => x.account === b.id && x.status === 'pending').length;
      const st = (data.statements || {})[b.id];
      const isLiab = bankKind(b) === 'liability';
      const ledger = b.personal ? null : (isLiab ? -(bal[b.id] || 0) : (bal[b.id] || 0));
      const stLedger = st ? (E.balances(data, st.date)[b.id] || 0) : 0;
      const ok = st && ledger != null && (Math.abs(st.balance - stLedger) < 0.005 || Math.abs(st.balance + stLedger) < 0.005);
      return `<button class="bank-card ${b.id === account ? 'on' : ''}" data-action="bank-acct" data-id="${b.id}">
        <span class="bank-pending ${pend ? '' : 'zero'}">${pend ? `${pend} à traiter` : 'À jour'}</span>
        <span class="bank-name">${esc(b.name)}</span>
        <span class="bank-bal">${ledger != null ? m(ledger) : `${m(advancedBy(b.id))} <span class="small muted">avancés</span>`}${isLiab ? ' <span class="small muted">dû</span>' : ''}</span>
        <span class="bank-sub">${st ? `Relevé ${m(st.balance)} au ${d(st.date)} ${ok ? '<span class="ok-dot" title="Le relevé concorde">✓</span>' : ''}` : 'Aucun relevé importé'}</span>
      </button>`;
    }).join('');
    const q = B.q.trim().toLowerCase();
    const amin = B.amin === '' ? null : num(B.amin), amax = B.amax === '' ? null : num(B.amax);
    const catOk = (cats) => !B.cat || (B.cat === '__none' ? !cats.length : cats.includes(B.cat));
    const match = (dte, desc, amt, cats) => inDates(dte) && (B.type === 'all' || (B.type === 'in' ? amt > 0 : amt < 0)) && (!q || `${desc} ${Math.abs(amt).toFixed(2)}`.toLowerCase().includes(q))
      && (amin == null || Math.abs(amt) >= amin - 0.005) && (amax == null || Math.abs(amt) <= amax + 0.005) && catOk(cats);
    let rows, body;
    const pendingAll = feed().filter((x) => x.account === account && x.status === 'pending');
    const excludedAll = feed().filter((x) => x.account === account && x.status === 'excluded');
    const postedAll = data.entries.filter((e) => e.account === account);
    const counts = { pending: pendingAll.length, posted: postedAll.length, excluded: excludedAll.length };
    const propsAll = B.tab === 'pending' ? feedProposals(account) : null;
    if (B.tab === 'posted') rows = postedAll.filter((e) => match(e.date, `${e.description} ${e.notes || ''}`, entryAmount(e), entryCats(e))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    else rows = (B.tab === 'pending' ? pendingAll : excludedAll).filter((x) => match(x.date, x.description, x.amount, propsAll ? propsAll[x.id].splits.map((sp) => sp.acct).filter(Boolean) : [])).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const rowIds = bankRowIds = rows.map((x) => x.id);
    B.sel = B.sel.filter((id) => rowIds.includes(id));
    const selCount = B.sel.length, allPage = shownIds => shownIds.length && shownIds.every((id) => B.sel.includes(id));
    const bulkBar = (extra) => selCount ? `<div class="bulk"><b>${selCount}</b> sélectionnée(s)${selCount < rows.length && rows.length > per ? ` <button class="btn ghost small" data-action="bank-sel-all">Sélectionner les ${rows.length} transactions filtrées</button>` : ''} ${extra}<button class="btn ghost small" data-action="feed-unsel">Désélectionner</button></div>` : '';
    const per = 50, pages = Math.max(1, Math.ceil(rows.length / per)); B.page = Math.min(B.page, pages);
    const shown = rows.slice((B.page - 1) * per, B.page * per);
    const amtCells = (a) => `<td class="num">${a < 0 ? m(-a) : ''}</td><td class="num">${a > 0 ? m(a) : ''}</td>`;
    if (B.tab === 'pending') {
      const props = propsAll;
      body = `<thead><tr><th style="width:34px"><input type="checkbox" id="bank-all" aria-label="Tout sélectionner (page)" ${allPage(shown.map((x) => x.id)) ? 'checked' : ''}></th><th>Date</th><th>Description</th><th class="num">Dépensé</th><th class="num">Reçu</th><th>Catégorie ou ventilation</th><th class="num">Action</th></tr></thead><tbody>
      ${shown.map((it) => { const p = props[it.id], sp = p.splits, one = sp.length <= 1 ? (sp[0] || { acct: '', loan: '', period: '' }) : null;
        const a = one ? acc(one.acct) || {} : {}; const errs = sp.length ? splitErrors(feedEntry(it, sp)) : ['Choisissez une catégorie'];
        const badge = p.manual ? '' : p.auto.rule ? '<span class="rule">RÈGLE</span>' : p.auto.confidence === 'high' ? '<span class="rule">HISTORIQUE</span>' : p.auto.confidence === 'medium' && sp.length ? '<span class="rule soft">SUGGESTION</span>' : sp.length ? '<span class="rule soft">À CONFIRMER</span>' : '';
        const isOpen = B.open === it.id;
        return `<tr data-feed="${it.id}" class="feed-row ${isOpen ? 'open' : ''} ${B.sel.includes(it.id) ? 'selected' : ''}">
          <td><input type="checkbox" data-sel="${it.id}" aria-label="Sélectionner" ${B.sel.includes(it.id) ? 'checked' : ''}></td>
          <td style="white-space:nowrap" class="clickable" data-action="feed-open" data-id="${it.id}">${d(it.date)}</td>
          <td class="desc clickable" data-action="feed-open" data-id="${it.id}" title="Ouvrir pour catégoriser"><b>${esc(it.description)}</b>${it.notes ? `<div class="sub">${esc(it.notes)}</div>` : ''}${it.balance != null ? `<div class="sub">Solde au relevé ${m(it.balance)}</div>` : ''}</td>
          ${amtCells(it.amount)}
          <td class="cat-cell">${one ? `<div class="cat-line">${badge}
              <select data-cat="${it.id}" aria-label="Catégorie">${catOptions(one.acct, isPersonal(account) ? null : account)}</select>
              ${a.perLoan ? `<select data-loan="${it.id}" aria-label="Prêt">${loanOptions(one.loan)}</select>` : ''}
              ${hasPeriod(one.acct) ? `<input type="month" data-period="${it.id}" value="${one.period || ''}" aria-label="Mois couvert" title="Mois couvert">` : ''}</div>`
            : `<div class="cat-line">${badge}${groupSplits(sp).map((g) => splitChip(g, true)).join('')}${p.auto.advance && !p.manual ? ' <span class="rule soft">AVANCE</span>' : ''}</div>`}
            <div class="sub">${p.manual ? '' : esc(p.auto.reason)}${errs.length && sp.length ? ` <span class="neg">· ${esc(errs[0])}</span>` : ''}</div></td>
          <td class="act">${p.auto.personal && !p.manual ? `<button class="btn small primary" data-action="feed-exclude" data-id="${it.id}">Personnel</button>` : `<button class="btn small primary" data-action="feed-add" data-id="${it.id}" ${errs.length ? 'disabled' : ''}>Ajouter</button>`}
            <div class="act-links"><button class="btn ghost small" data-action="feed-split" data-id="${it.id}">Ventiler…</button>${!(it.amount > 0 && isPersonal(account)) ? `<button class="btn ghost small" data-action="feed-advance" data-id="${it.id}">Payé d'avance…</button>` : ''}<button class="btn ghost small" data-action="feed-exclude" data-id="${it.id}" title="${isPersonal(account) ? 'Transaction personnelle : ne pas comptabiliser' : 'Ne pas comptabiliser'}">${isPersonal(account) ? 'Personnel' : 'Exclure'}</button><button class="btn ghost small chev" data-action="feed-open" data-id="${it.id}" aria-expanded="${isOpen}" title="${isOpen ? 'Fermer' : 'Ouvrir le détail'}">${isOpen ? '▴' : '▾'}</button></div></td></tr>
          ${isOpen ? `<tr class="feed-detail"><td colspan="7">${feedDetail(it, p, account)}</td></tr>` : ''}`; }).join('')}
      </tbody>`;
      body = `${bulkBar(`<button class="btn small" data-action="bulk-cat">Catégoriser…</button><button class="btn small primary" data-action="feed-accept">Accepter</button><button class="btn small" data-action="feed-exclude-sel">${isPersonal(account) ? 'Personnel (exclure)' : 'Exclure'}</button>`)}<table class="bank-table">${body}</table>`;
    } else if (B.tab === 'posted') {
      body = `${bulkBar('<button class="btn small primary" data-action="bulk-cat">Recatégoriser…</button>')}<table class="bank-table"><thead><tr><th style="width:34px"><input type="checkbox" id="bank-all" aria-label="Tout sélectionner (page)" ${allPage(shown.map((x) => x.id)) ? 'checked' : ''}></th><th>Date</th><th>Description</th><th class="num">Dépensé</th><th class="num">Reçu</th><th>Catégorie</th><th>Écriture</th><th class="num">Action</th></tr></thead><tbody>
        ${shown.map((e) => { const a = entryAmount(e); return `<tr class="${B.sel.includes(e.id) ? 'selected' : ''}"><td><input type="checkbox" data-sel="${e.id}" aria-label="Sélectionner" ${B.sel.includes(e.id) ? 'checked' : ''}></td><td style="white-space:nowrap">${d(e.date)}</td><td class="desc">${esc(e.description)}${e.notes ? `<div class="sub">${esc(e.notes)}</div>` : ''}</td>${amtCells(a)}
          <td>${chipsFor(e)}</td><td><button class="btn ghost small" data-action="edit-tx" data-id="${e.id}">${e.lines.length > 2 ? 'Ventilation' : a < 0 ? 'Dépense' : 'Dépôt'} ${d(e.date)}</button></td>
          <td class="num" style="white-space:nowrap"><button class="btn ghost small" data-action="dup-tx" data-id="${e.id}">Dupliquer</button><button class="btn ghost small" data-action="feed-undo" data-id="${e.id}">Annuler</button></td></tr>`; }).join('')}</tbody></table>`;
    } else {
      body = `<table class="bank-table"><thead><tr><th>Date</th><th>Description</th><th class="num">Dépensé</th><th class="num">Reçu</th><th class="num">Action</th></tr></thead><tbody>
        ${shown.map((it) => `<tr><td>${d(it.date)}</td><td class="desc">${esc(it.description)}</td>${amtCells(it.amount)}<td class="num"><button class="btn ghost small" data-action="feed-restore" data-id="${it.id}">Rétablir</button></td></tr>`).join('')}</tbody></table>`;
    }
    const empty = !shown.length ? `<div class="empty">${B.tab === 'pending' ? (counts.pending ? 'Aucune transaction ne correspond aux filtres.' : 'Rien à traiter. Importez un relevé CSV pour ajouter des transactions.') : 'Aucune transaction.'}</div>` : '';
    return `
    <div class="section-head"><div><h1>Banque</h1><div class="sub">Classez les transactions de vos relevés : la catégorie proposée vient de votre historique et des intérêts attendus</div></div>
      <div class="toolbar"><button class="btn" data-action="import-csv">Importer un relevé (CSV)</button><button class="btn" data-action="new-tx">+ Transaction manuelle</button></div></div>
    <div class="bank-cards">${cards}<button class="bank-card add" data-action="bank-add-open"><span class="bank-name">+ Ajouter un compte</span><span class="bank-sub">Entreprise, marge, carte ou compte personnel</span></button></div>
    <div class="bank-bar">
      <div class="seg big" role="tablist">${[['pending', 'À traiter'], ['posted', 'Comptabilisées'], ['excluded', isPersonal(account) ? 'Personnelles' : 'Exclues']].map(([k, l]) => `<button role="tab" data-action="bank-tab" data-tab="${k}" class="${B.tab === k ? 'on' : ''}">${l} (${counts[k]})</button>`).join('')}</div>
      <button class="btn ghost" data-action="rules-open">Règles (${(data.rules || []).length})</button>
      ${B.tab === 'pending' && feedReadyCount(account) ? `<button class="btn primary" data-action="feed-accept-all">${feedReadyCount(account) === 1 ? 'Accepter la proposition « Historique »' : `Accepter les ${feedReadyCount(account)} propositions « Historique »`}</button>` : ''}
    </div>
    <section class="panel">
      <div class="panel-head bank-filters">
        <div class="toolbar">
          <input type="search" id="bank-q" placeholder="Rechercher (description, montant)" value="${esc(B.q)}" style="width:250px">
          <select id="bank-dates" aria-label="Période">${BANK_DATES.map(([k, l]) => `<option value="${k}" ${B.dates === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${B.dates === 'pick' ? `<input type="month" id="bank-month" value="${B.month}" aria-label="Mois">` : ''}
          ${B.dates === 'custom' ? `<span class="date-range"><input type="date" id="bank-from" value="${B.from}" aria-label="Du"> au <input type="date" id="bank-to" value="${B.to}" aria-label="Au"></span>` : ''}
          <select id="bank-type" aria-label="Type">${[['all', 'Reçues et dépensées'], ['in', 'Reçues'], ['out', 'Dépensées']].map(([k, l]) => `<option value="${k}" ${B.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${B.tab !== 'excluded' ? `<select id="bank-cat" aria-label="Catégorie">${catOptions(B.cat, null).replace('— Choisir —', 'Toutes les catégories')}${B.tab === 'pending' ? `<option value="__none" ${B.cat === '__none' ? 'selected' : ''}>Sans catégorie</option>` : ''}</select>` : ''}
          <span class="amt-range"><input type="text" inputmode="decimal" id="bank-amin" value="${esc(B.amin)}" placeholder="Montant min." aria-label="Montant minimum"> – <input type="text" inputmode="decimal" id="bank-amax" value="${esc(B.amax)}" placeholder="max." aria-label="Montant maximum"></span>
          ${bankFiltersActive() ? '<button class="btn ghost small" data-action="bank-reset">Effacer les filtres</button>' : ''}
        </div>
        <div class="toolbar small muted">${rows.length ? `${(B.page - 1) * per + 1}–${Math.min(B.page * per, rows.length)} de ${rows.length}` : '0'}${rows.length ? ` · ${B.type !== 'in' ? `dépensé ${m(-rows.reduce((a, x) => a + Math.min(0, B.tab === 'posted' ? entryAmount(x) : x.amount), 0))}` : ''}${B.type === 'all' ? ' · ' : ''}${B.type !== 'out' ? `reçu ${m(rows.reduce((a, x) => a + Math.max(0, B.tab === 'posted' ? entryAmount(x) : x.amount), 0))}` : ''}` : ''}
          <button class="btn small" data-action="bank-page" data-p="${B.page - 1}" ${B.page <= 1 ? 'disabled' : ''} aria-label="Page précédente">‹</button>
          Page ${B.page} de ${pages}
          <button class="btn small" data-action="bank-page" data-p="${B.page + 1}" ${B.page >= pages ? 'disabled' : ''} aria-label="Page suivante">›</button></div>
      </div>
      <div class="table-wrap">${shown.length ? body : empty}</div>
    </section>`;
  }
  // total avancé à l'entreprise par un compte personnel (dépenses moins remboursements reçus sur ce compte)
  function advancedBy(account) {
    return E.r2(data.entries.filter((e) => e.account === account && e.counter).reduce((s, e) => s - ((e.lines.find((l) => l.acct === e.counter) || {}).amt || 0), 0));
  }
  function feedReadyCount(account) {
    const props = feedProposals(account);
    return feed().filter((x) => x.account === account && x.status === 'pending' && !props[x.id].manual && props[x.id].auto.confidence === 'high' && !splitErrors(feedEntry(x, props[x.id].splits)).length).length;
  }
  function postFeed(ids) {
    let n = 0;
    for (const id of ids) {
      const it = feed().find((x) => x.id === id); if (!it || it.status !== 'pending') continue;
      const p = feedProposals(it.account)[id]; if (!p.splits.length) continue;
      const e = feedEntry(it, p.splits); if (splitErrors(e).length) continue;
      data.entries.push(e); data.bankFeed = feed().filter((x) => x.id !== id); n++;
    }
    data.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    ui.bank.sel = []; return n;
  }
  function undoEntry(id) {
    const e = data.entries.find((x) => x.id === id); if (!e) return;
    const piv = pivotOf(e);
    data.entries = data.entries.filter((x) => x !== e);
    const sign = piv && piv.amt < 0 ? -1 : 1;
    feed().push({ id: `f${Date.now().toString(36)}`, account: e.account, date: e.date, description: e.description, amount: piv ? piv.amt : 0, balance: e.statementBalance ?? null, status: 'pending',
      splits: e.lines.filter((l) => l !== piv).map((l) => ({ acct: l.acct, loan: l.loan || '', period: l.period || '', memo: l.memo || '', amt: E.r2(-sign * l.amt) })) });
  }
  function setFeedSplit(id, patch) {
    const it = feed().find((x) => x.id === id); if (!it) return;
    const cur = (feedProposals(it.account)[id] || {}).splits || [];
    const base = cur.length === 1 ? { ...cur[0] } : { acct: '', loan: '', period: '', memo: '' };
    const s = { ...base, ...patch, amt: Math.abs(it.amount) };
    const a = acc(s.acct) || {};
    if (!a.perLoan) s.loan = '';
    if (!hasPeriod(s.acct)) s.period = '';
    else if (!s.period || patch.acct) s.period = patch.period || defaultPeriod(s.acct, it.date);
    it.splits = s.acct ? [s] : [];
  }
  async function importCsvToFeed(file) {
    const text = await file.text();
    const p = window.FinImport.parseBankCsv(text);
    if (!p.rows.length) return toast("Aucune transaction reconnue. Formats acceptés : export CSV de TD (EasyWeb) ou de RBC (Banque en direct).");
    const account = ui.bank.account;
    const rec = window.FinImport.reconcile(data, account, p.rows);
    const key = (x) => `${x.date}|${E.r2(x.amount)}|${window.FinImport.norm(x.description)}`;
    const known = new Set(feed().filter((x) => x.account === account).map(key));
    let added = 0;
    for (const r of rec.rows) {
      if (r.status !== 'new' || known.has(key(r))) continue;
      feed().push({ id: `f${Date.now().toString(36)}${r.n}`, account, date: r.date, description: r.description, amount: r.amount, balance: r.balance, status: 'pending' });
      known.add(key(r)); added++;
    }
    const last = p.rows.filter((r) => r.balance != null).pop();
    if (last) { data.statements = data.statements || {}; const prev = data.statements[account]; if (!prev || prev.date <= last.date) data.statements[account] = { date: last.date, balance: last.balance }; }
    ui.bank.tab = 'pending'; ui.bank.page = 1;
    persist(`${added} transaction(s) à traiter · ${p.rows.length - added} déjà dans l'outil (${p.format}, ${(bankById(account) || {}).name})`);
    go('bank');
  }

  /* ---------------------------------------------------------------- configuration */
  function viewSettings() {
    const meta = S.meta();
    const used = new Set(data.entries.flatMap((e) => e.lines.map((l) => l.acct)));
    return `
    <div class="section-head"><div><h1>Configuration</h1><div class="sub">Plan comptable, prêts, comptes et sauvegarde des données</div></div></div>
    <section class="panel"><div class="panel-head"><h2>Données</h2></div><div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
      <dl class="kv"><dt>Écritures</dt><dd>${data.entries.length}</dd><dt>Dernière modification</dt><dd>${data.updatedAt ? new Date(data.updatedAt).toLocaleString('fr-CA') : 'données du classeur (aucune modification)'}</dd>
      <dt>Dernier fichier enregistré</dt><dd>${meta.exportedAt ? new Date(meta.exportedAt).toLocaleString('fr-CA') : 'jamais'}</dd></dl>
      <p class="hint" style="margin:0">Vos modifications sont gardées dans ce navigateur. Enregistrez régulièrement le fichier <b>terreno.json</b> : il contient les finances, les dossiers et les immeubles; c'est votre copie de sauvegarde.</p>
      <div class="toolbar"><button class="btn primary" data-action="export">${window.FIN_ARTIFACT ? 'Copier les données (terreno.json)' : 'Enregistrer terreno.json'}</button><button class="btn" data-action="import">Ouvrir un fichier…</button>
      <button class="btn danger" data-action="reset">Revenir aux données du classeur</button></div></div></section>

    <section class="panel"><div class="panel-head"><h2>Prêts</h2><button class="btn small" data-action="new-loan">+ Nouveau prêt</button></div><div class="table-wrap"><table>
      <thead><tr><th>Prêt</th><th>Dossier</th><th>Début</th><th class="num">Capital actuel</th><th>Statut</th><th></th></tr></thead><tbody>
      ${data.loans.map((l) => { const v = l.versions[l.versions.length - 1]; return `<tr><td>${esc(l.name)}<div class="small muted">${esc(l.borrower || '')}</div></td><td>${l.dossier || ''}</td><td>${d(l.versions[0].from)}</td><td class="num">${m0(v.principal)}</td><td>${pill(E.loanStatus(l, todayISO))}</td><td><button class="btn small" data-action="edit-loan" data-id="${l.id}">Modifier</button></td></tr>`; }).join('')}
      </tbody></table></div></section>

    <section class="panel"><div class="panel-head"><h2>Plan comptable</h2><span class="muted small">Les catégories utilisées pour ventiler les transactions</span></div><div class="table-wrap"><table>
      <thead><tr><th>Catégorie</th><th>Groupe</th><th>Utilisée</th></tr></thead><tbody>
      ${['revenue', 'direct', 'overhead', 'asset', 'liability', 'equity'].map((g) => data.accounts.filter((a) => a.group === g).map((a) => `<tr><td><input type="text" id="acc-${esc(a.id)}" value="${esc(a.name)}" data-action="rename-acc" data-id="${esc(a.id)}" aria-label="Nom de la catégorie"></td><td>${GROUPS[g]}</td><td>${used.has(a.id) ? 'Oui' : '<span class="muted">Non</span>'}</td></tr>`).join('')).join('')}
      </tbody></table></div>
      <div class="panel-body"><div class="toolbar"><input type="text" id="new-acc-name" placeholder="Nouvelle catégorie (ex. : Frais juridiques)" style="width:300px">
        <select id="new-acc-group" aria-label="Groupe">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${k === 'overhead' ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn" data-action="add-acc">Ajouter</button></div></div></section>

    <section class="panel"><div class="panel-head"><h2>Comptes bancaires</h2><span class="muted small">Renommez un compte directement dans la case. Un compte sans transaction peut être supprimé; sinon, masquez-le.</span></div><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Transactions</th><th></th></tr></thead><tbody>
      ${data.bankAccounts.map((b) => { const u = bankUsage(b.id); return `<tr class="${b.hidden ? 'muted' : ''}">
        <td><input type="text" id="bank-name-${esc(b.id.replace(':', '-'))}" value="${esc(b.name)}" data-action="rename-bank" data-id="${esc(b.id)}" aria-label="Nom du compte"></td>
        <td class="small">${bankTypeLabel(b)}${b.hidden ? ' · <b>masqué</b>' : ''}</td>
        <td class="num" style="text-align:left">${u.entries}${u.feed ? ` <span class="small muted">+ ${u.feed} à traiter</span>` : ''}</td>
        <td style="white-space:nowrap;text-align:right"><button class="btn small" data-action="bank-settings" data-id="${esc(b.id)}">Paramètres</button> ${u.entries || u.feed
          ? `<button class="btn small" data-action="toggle-bank" data-id="${esc(b.id)}">${b.hidden ? 'Réafficher' : 'Masquer'}</button>`
          : `<button class="btn small danger" data-action="delete-bank" data-id="${esc(b.id)}">Supprimer</button>`}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="panel-body"><button class="btn" data-action="bank-add-open">+ Ajouter un compte</button></div></section>`;
  }

  /* ---------------------------------------------------------------- événements de la vue */
  const view = $('#view');
  view.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    if (window.TMap && window.TMap.handleAction(a, t)) return;
    if (a === 'go') go(t.dataset.view, { loanId: null });
    else if (a === 'open-loan') go('loans', { loanId: t.dataset.id });
    else if (a === 'pp-kind') { ui.pp.kind = t.dataset.k; saveUi(); render(); }
    else if (a === 'pp-shift') { ui.pp = shiftPeriod(ui.pp, Number(t.dataset.n)); saveUi(); render(); }
    else if (a === 'pp-basis') { ui.pp.basis = t.dataset.b; saveUi(); render(); }
    else if (a === 'dash-bank-month') { Object.assign(ui.bank, { account: ui.dash.bank || 'bank:td', tab: 'posted', dates: 'pick', month: t.dataset.k, page: 1, sel: [] }); go('bank'); }
    else if (a === 'dash-set') { const k = t.dataset.k; ui.dash[k] = k === 'cumul' ? t.dataset.v === '1' : t.dataset.v; saveUi(); render(); }
    else if (a === 'loans-mode') { ui.loansMode = t.dataset.m; saveUi(); render(); }
    else if (a === 'ls-sort') { const k = t.dataset.k; ui.ls.dir = ui.ls.sort === k ? -ui.ls.dir : (['name', 'borrower', 'start', 'end'].includes(k) ? 1 : -1); ui.ls.sort = k; saveUi(); render(); }
    else if (a === 'pnl-basis') { ui.pnlBasis = t.dataset.b; saveUi(); render(); }
    else if (a === 'loan-statement') window.TFTools.openStatement(t.dataset.id);
    else if (a === 'adj-open') openAdjust(t.dataset.id, t.dataset.p);
    else if (a === 'dup-tx') openDuplicate(data.entries.find((e) => e.id === t.dataset.id));
    else if (a === 'edit-tx') openTxForm(data.entries.find((e) => e.id === t.dataset.id));
    else if (a === 'new-tx') openTxForm(null);
    else if (a === 'new-tx-loan') openTxForm(null, { loan: t.dataset.id });
    else if (a === 'more-tx') { ui.tx.limit += 200; render(); }
    else if (a === 'clear-filters') { ui.tx = { year: '', account: '', acct: '', q: '', limit: 200 }; render(); }
    else if (a === 'filter-tx') go('transactions', { tx: { year: t.dataset.year, account: '', acct: t.dataset.acct, q: '', limit: 200 } });
    else if (a === 'bs-date') { ui.bsDate = t.dataset.date; render(); }
    else if (a === 'edit-loan') openLoanForm(loanById(t.dataset.id));
    else if (a === 'new-loan') openLoanForm(null);
    else if (a === 'export') { const r = await S.exportFile(data); if (r.ok) { toast(r.how === 'file' ? `Enregistré dans ${r.name}` : r.how === 'clipboard' ? 'Données copiées : collez-les dans un fichier terreno.json' : 'Fichier finances.json téléchargé'); renderSaveState(); render(); } else if (r.error) toast(r.error); }
    else if (a === 'import') $('#file-import').click();
    else if (a === 'import-csv') $('#file-csv').click();
    else if (a === 'bank-acct') { ui.bank.account = t.dataset.id; ui.bank.page = 1; ui.bank.sel = []; saveUi(); render(); }
    else if (a === 'bank-tab') { ui.bank.tab = t.dataset.tab; ui.bank.page = 1; saveUi(); render(); }
    else if (a === 'bank-page') { ui.bank.page = +t.dataset.p; render(); }
    else if (a === 'feed-add') { const n = postFeed([t.dataset.id]); persist(n ? 'Transaction comptabilisée' : 'Catégorie incomplète'); render(); }
    else if (a === 'feed-accept') { const tot = ui.bank.sel.length, n = postFeed(ui.bank.sel.slice()); persist(n < tot ? `${n} comptabilisée(s) · ${tot - n} sans catégorie complète, laissée(s) à traiter` : `${n} transaction(s) comptabilisée(s)`); render(); }
    else if (a === 'feed-accept-all') {
      const props = feedProposals(ui.bank.account);
      const ids = feed().filter((x) => x.account === ui.bank.account && x.status === 'pending' && !props[x.id].manual && props[x.id].auto.confidence === 'high').sort((x, y) => x.date.localeCompare(y.date)).map((x) => x.id);
      const n = postFeed(ids); persist(`${n} transaction(s) comptabilisée(s)`); render();
    }
    else if (a === 'feed-exclude' || a === 'feed-restore') { const it = feed().find((x) => x.id === t.dataset.id); if (it) it.status = a === 'feed-exclude' ? 'excluded' : 'pending'; ui.bank.sel = ui.bank.sel.filter((x) => x !== t.dataset.id); persist(a === 'feed-exclude' ? 'Transaction exclue' : 'Transaction rétablie'); render(); }
    else if (a === 'feed-exclude-sel') { feed().forEach((x) => { if (ui.bank.sel.includes(x.id)) x.status = 'excluded'; }); ui.bank.sel = []; persist('Transactions exclues'); render(); }
    else if (a === 'feed-unsel') { ui.bank.sel = []; render(); }
    else if (a === 'bank-sel-all') { ui.bank.sel = bankFilteredIds(); render(); }
    else if (a === 'bank-reset') { Object.assign(ui.bank, { q: '', dates: 'all', type: 'all', month: '', from: '', to: '', cat: '', amin: '', amax: '', page: 1 }); saveUi(); render(); }
    else if (a === 'bulk-cat') openBulkCat();
    else if (a === 'feed-open') { const id = t.dataset.id; ui.bank.open = ui.bank.open === id ? null : id; render(); }
    else if (a === 'feed-use') { const it = feed().find((x) => x.id === t.dataset.id), e = data.entries.find((x) => x.id === t.dataset.e); if (it && e) { const piv = pivotOf(e), l = e.lines.find((x) => x !== piv); setFeedSplit(it.id, { acct: l.acct, loan: l.loan || '', memo: l.memo || '', period: hasPeriod(l.acct) && l.period ? E.addMonths(l.period, E.monthsBetween(e.date.slice(0, 7), it.date.slice(0, 7)).length - 1) : '' }); persist(); render(); } }
    else if (a === 'rule-new') openRuleForm(feed().find((x) => x.id === t.dataset.id), null);
    else if (a === 'rules-open') openRulesList();
    else if (a === 'feed-undo') { undoEntry(t.dataset.id); persist('Retournée dans « À traiter »'); render(); }
    else if (a === 'feed-split' || a === 'feed-advance') {
      const it = feed().find((x) => x.id === t.dataset.id); const p = feedProposals(it.account)[it.id];
      const openAdv = a === 'feed-advance';
      openTxForm(null, { prefill: { account: it.account, counter: isPersonal(it.account) ? defaultCounter(it.account, p.splits) : '', date: it.date, description: it.description, dir: it.amount >= 0 ? 'in' : 'out', amount: Math.abs(it.amount),
        splits: p.splits.length ? p.splits.map((x) => ({ acct: x.acct, loan: x.loan || '', period: x.period || '', memo: x.memo || '', amt: x.amt })) : [{ acct: '', loan: '', period: '', memo: '', amt: '' }] },
        onSaved: (e) => { e.source = 'banque'; if (it.balance != null) e.statementBalance = it.balance; data.bankFeed = feed().filter((x) => x.id !== it.id); }, advance: openAdv });
    }
    else if (a === 'imp-add') { const r = importRow(+t.dataset.n); if (r && addImported(r, r.prop.splits)) { persist('Transaction ajoutée'); saveUi(); render(); } }
    else if (a === 'imp-add-safe') {
      let n = 0;
      for (;;) { const r = computeImport().rows.find((x) => x.status === 'new' && x.prop.confidence === 'high'); if (!r || !addImported(r, r.prop.splits)) break; n++; }
      persist(`${n} transaction(s) ajoutée(s)`); saveUi(); render();
    }
    else if (a === 'imp-ignore' || a === 'imp-unignore') { const n = +t.dataset.n; ui.imp.ignored = (ui.imp.ignored || []).filter((x) => x !== n).concat(a === 'imp-ignore' ? [n] : []); saveUi(); render(); }
    else if (a === 'imp-edit') {
      const r = importRow(+t.dataset.n);
      openTxForm(null, { prefill: { account: ui.imp.account, date: r.date, description: r.description, dir: r.amount >= 0 ? 'in' : 'out', amount: Math.abs(r.amount),
        splits: r.prop.splits.length ? r.prop.splits.map((sp) => ({ acct: sp.acct, loan: sp.loan || '', period: sp.period || '', memo: sp.memo || '', amt: sp.amt })) : [{ acct: '', loan: '', period: '', memo: '', amt: '' }] },
        onSaved: () => { ui.imp.added = (ui.imp.added || []).concat(r.n); saveUi(); } });
    }
    else if (a === 'reset') {
      if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Confirmer : effacer mes modifications'; setTimeout(() => { t.classList.remove('armed'); t.textContent = 'Revenir aux données du classeur'; }, 4000); return; }
      S.reset(); loaded = S.load(); data = loaded.data; toast('Données du classeur rechargées'); render();
    }
    else if (a === 'add-acc') {
      const name = $('#new-acc-name').value.trim(), group = $('#new-acc-group').value;
      if (!name) return toast('Indiquez un nom de catégorie');
      const prefix = { revenue: 'rev', direct: 'exp', overhead: 'exp', asset: 'asset', liability: 'liab', equity: 'eq' }[group];
      let id = `${prefix}:${slug(name)}`; while (acc(id)) id += '-2';
      data.accounts.push({ id, name, group }); persist('Catégorie ajoutée'); render();
    }
    else if (a === 'add-bank') { if (addBank($('#new-bank-name').value, $('#new-bank-kind').value === 'personal')) render(); }
    else if (a === 'bank-add-open') openBankForm();
    else if (a === 'bank-settings') openBankForm(t.dataset.id);
    else if (a === 'toggle-bank') { const b = bankById(t.dataset.id); b.hidden = !b.hidden; if (!b.hidden) delete b.hidden; persist(b.hidden ? `« ${b.name} » est masqué` : `« ${b.name} » est réaffiché`); render(); }
    else if (a === 'delete-bank') {
      const b = bankById(t.dataset.id), u = bankUsage(b.id);
      if (u.entries || u.feed) return toast('Ce compte contient des transactions : masquez-le plutôt');
      if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Confirmer'; setTimeout(() => { t.classList.remove('armed'); t.textContent = 'Supprimer'; }, 4000); return; }
      data.bankAccounts = data.bankAccounts.filter((x) => x.id !== b.id);
      data.accounts = data.accounts.filter((x) => x.id !== b.id);
      if (data.statements) delete data.statements[b.id];
      persist(`« ${b.name} » supprimé`); render();
    }
  });
  view.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.filter) { ui.tx[t.dataset.filter] = t.value; ui.tx.limit = 200; render(); const el = $(`#${t.id}`); if (el && t.type === 'search') { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    else if (t.id === 'pnl-year') { ui.pnlYear = t.value; render(); }
    else if (t.id === 'dash-bank') { ui.dash.bank = t.value; saveUi(); render(); }
    else if (t.id && t.id.startsWith('ls-') && t.id !== 'ls-q') { ui.ls[t.id.slice(3)] = t.value; saveUi(); render(); }
    else if (t.id === 'pp-month' && t.value) { ui.pp.month = t.value; saveUi(); render(); }
    else if (t.id === 'pp-quarter') { ui.pp.quarter = t.value; saveUi(); render(); }
    else if (t.id === 'pp-year') { ui.pp.year = t.value; saveUi(); render(); }
    else if (t.id === 'horizon') { ui.horizon = Number(t.value); saveUi(); render(); }
    else if (t.dataset.ftype) { ui.bank.ftype = Object.assign({}, ui.bank.ftype, { [t.dataset.ftype]: t.value }); const it = feed().find((x) => x.id === t.dataset.ftype); const cur = it && ((feedProposals(it.account)[it.id] || {}).splits || [])[0]; if (cur && typeOfAcct(cur.acct) !== t.value) setFeedSplit(t.dataset.ftype, { acct: '', loan: '' }); render(); }
    else if (t.dataset.fmemo) { setFeedSplit(t.dataset.fmemo, { memo: t.value }); persist(); }
    else if (t.dataset.fnote) { const it = feed().find((x) => x.id === t.dataset.fnote); if (it) { it.notes = t.value.trim(); persist(); render(); } }
    else if (t.dataset.cat) { setFeedSplit(t.dataset.cat, { acct: t.value, loan: '' }); persist(); render(); }
    else if (t.dataset.loan) { setFeedSplit(t.dataset.loan, { loan: t.value }); persist(); render(); }
    else if (t.dataset.period) { setFeedSplit(t.dataset.period, { period: t.value }); persist(); render(); }
    else if (t.dataset.sel) { const id = t.dataset.sel; ui.bank.sel = t.checked ? ui.bank.sel.concat(id) : ui.bank.sel.filter((x) => x !== id); render(); }
    else if (t.id === 'bank-all') { const page = $$('input[data-sel]:not(:disabled)').map((x) => x.dataset.sel); ui.bank.sel = t.checked ? Array.from(new Set(ui.bank.sel.concat(page))) : ui.bank.sel.filter((id) => !page.includes(id)); render(); }
    else if (['bank-dates', 'bank-type', 'bank-month', 'bank-from', 'bank-to', 'bank-cat', 'bank-amin', 'bank-amax'].includes(t.id)) { ui.bank[t.id.slice(5)] = t.value; ui.bank.page = 1; saveUi(); render(); }
    else if (t.id === 'imp-account') { ui.imp.account = t.value; ui.imp.added = []; saveUi(); render(); }
    else if (t.id === 'bs-date' && t.value) { ui.bsDate = t.value; render(); }
    else if (t.dataset.action === 'rename-bank') {
      const b = bankById(t.dataset.id), name = t.value.trim(); if (!b || !name) return;
      b.name = name; const a = acc(b.id); if (a) a.name = name; persist('Compte renommé');
    }
    else if (t.dataset.action === 'rename-acc') { const a = acc(t.dataset.id); if (a && t.value.trim()) { a.name = t.value.trim(); persist('Catégorie renommée'); } }
  });
  let qTimer;
  view.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'bank-q') { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.bank.q = t.value; ui.bank.page = 1; render(); const el = $('#bank-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); return; }
    if (t.id === 'ls-q') { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.ls.q = t.value; render(); const el = $('#ls-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); return; }
    if (t.id !== 'f-q') return;
    clearTimeout(qTimer); qTimer = setTimeout(() => { ui.tx.q = t.value; render(); const el = $('#f-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250);
  });
  $('#file-import').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { data = await S.importFile(f); persist(`Fichier ${f.name} chargé`); render(); } catch (e) { toast(e.message); }
  });
  $('#file-csv').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    if (ui.view !== 'bank') ui.bank.account = 'bank:td';
    importCsvToFeed(f);
  });
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

  /* ---------------------------------------------------------------- fenêtre modale */
  const modal = $('#modal');
  let modalState = null;
  function openModal(title, body, foot) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = body; $('#modal-foot').innerHTML = foot; modal.hidden = false; }
  function closeModal() { modal.hidden = true; modalState = null; BK = null; }
  $('#modal-close').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', (ev) => { if (ev.target === modal) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !modal.hidden) closeModal(); });



  /* ---------- Banque : panneau de détail d'une transaction à traiter ---------- */
  const FTYPES = [['revenue', 'Revenu'], ['expense', 'Dépense'], ['capital', 'Capital de prêt (déboursé ou remboursement)'], ['debt', 'Dette ou avance (Doris, Guy, actionnaire)'], ['transfer', 'Transfert ou autre actif']];
  const typeOfAcct = (id) => { const a = acc(id); if (!a) return ''; if (id === 'loans') return 'capital'; return { revenue: 'revenue', direct: 'expense', overhead: 'expense', liability: 'debt', asset: 'transfer', equity: 'transfer' }[a.group] || ''; };
  function catOptionsFor(type, sel, exclude) {
    const groups = { revenue: ['revenue'], expense: ['direct', 'overhead'], capital: ['asset'], debt: ['liability'], transfer: ['asset', 'equity'] }[type] || ['revenue', 'direct', 'overhead', 'asset', 'liability', 'equity'];
    let h = '<option value="">— Choisir —</option>';
    for (const g of groups) {
      const list = data.accounts.filter((a) => a.group === g && a.id !== exclude && (type === 'capital' ? a.id === 'loans' : type === 'transfer' ? a.id !== 'loans' : true)); if (!list.length) continue;
      h += `<optgroup label="${GROUPS[g]}">${list.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>`;
    }
    return h;
  }
  const descKey = (s0) => String(s0 || '').toLowerCase().replace(/[*#]+\w*/g, ' ').replace(/\d+/g, ' ').replace(/[^a-zà-ÿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ');
  // transactions passées semblables : même description d'abord, puis mêmes premiers mots (sans numéros de référence)
  function similarEntries(it) {
    const exact = String(it.description || '').trim().toLowerCase(), k = descKey(it.description);
    const byDate = (a, b) => b.date.localeCompare(a.date);
    const same = data.entries.filter((e) => String(e.description || '').trim().toLowerCase() === exact).sort(byDate);
    const near = k ? data.entries.filter((e) => !same.includes(e) && descKey(e.description) === k).sort(byDate) : [];
    return same.concat(near).slice(0, 4);
  }
  function feedDetail(it, p, account) {
    const B = ui.bank, sp = p.splits, one = sp.length <= 1 ? (sp[0] || { acct: '', loan: '', period: '', memo: '' }) : null;
    const type = (B.ftype || {})[it.id] || typeOfAcct(one && one.acct) || (it.amount > 0 ? 'revenue' : 'expense');
    const a = one ? acc(one.acct) || {} : {}, errs = sp.length ? splitErrors(feedEntry(it, sp)) : [];
    const sim = similarEntries(it).filter((e) => !(e.source === 'banque' && e.date === it.date && e.description === it.description));
    const head = `<div class="fd-head"><h4>Catégoriser la transaction</h4><button class="btn ghost small" data-action="feed-open" data-id="${it.id}" aria-label="Fermer">✕</button></div>
      <div class="fd-desc"><span class="muted small">Description complète de la banque</span><b>${esc(it.description)}</b><span class="small muted">${d(it.date)} · ${it.amount < 0 ? `dépense de ${m(-it.amount)}` : `dépôt de ${m(it.amount)}`}${it.balance != null ? ` · solde au relevé ${m(it.balance)}` : ''}</span></div>`;
    const fields = one ? `<div class="fd-grid">
        <label class="field"><span>Type de transaction</span><select data-ftype="${it.id}">${FTYPES.map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Catégorie</span><select data-cat="${it.id}">${catOptionsFor(type, one.acct, isPersonal(account) ? null : account)}</select></label>
        ${a.perLoan ? `<label class="field"><span>Prêt</span><select data-loan="${it.id}">${loanOptions(one.loan)}</select></label>` : ''}
        ${hasPeriod(one.acct) ? `<label class="field"><span>Mois couvert</span><input type="month" data-period="${it.id}" value="${one.period || ''}"><small class="muted">${one.acct === 'rev:interest' || /^exp:int-/.test(one.acct) ? "Intérêts payés à terme échu : en général le mois précédent" : 'Facultatif : mois auquel se rapporte ce montant'}</small></label>` : ''}
        <label class="field"><span>Mémo</span><input type="text" data-fmemo="${it.id}" value="${esc(one.memo || '')}" placeholder="Ex. : fournisseur, détail"></label>
      </div>`
      : `<div class="fd-split"><span class="muted small">Ventilation proposée</span><div>${groupSplits(sp).map((g) => splitChip(g, true)).join('')}</div><button class="btn small" data-action="feed-split" data-id="${it.id}">Modifier la ventilation…</button></div>`;
    return `<div class="fd">${head}
      <div class="fd-body"><div>${fields}
        <label class="field fd-note"><span>Note</span><textarea data-fnote="${it.id}" rows="2" placeholder="Visible dans les transactions et l'état de compte">${esc(it.notes || '')}</textarea></label>
        ${errs.length ? `<p class="neg small">${esc(errs[0])}</p>` : ''}</div>
        <aside class="fd-side">
          <div><span class="muted small">Proposition</span><p>${p.manual ? 'Catégorie choisie manuellement.' : esc(p.auto.reason || 'Aucune proposition')}${p.auto.rule && !p.manual ? ' <button class="btn ghost small" data-action="rules-open">Voir les règles</button>' : ''}</p></div>
          ${sim.length ? `<div><span class="muted small">Transactions semblables</span><ul class="fd-sim">${sim.map((e) => { const piv = pivotOf(e), cats = e.lines.filter((l) => l !== piv); return `<li><div><span class="small">${d(e.date)} · ${m(Math.abs(entryAmount(e)))}</span><div class="small">${chipsFor(e)}</div></div>${cats.length === 1 ? `<button class="btn ghost small" data-action="feed-use" data-id="${it.id}" data-e="${e.id}">Utiliser</button>` : ''}</li>`; }).join('')}</ul></div>` : ''}
        </aside></div>
      <div class="fd-foot"><button class="btn primary" data-action="feed-add" data-id="${it.id}" ${!sp.length || errs.length ? 'disabled' : ''}>Comptabiliser</button>
        <button class="btn" data-action="feed-split" data-id="${it.id}">Ventiler…</button>
        ${!(it.amount > 0 && isPersonal(account)) ? `<button class="btn ghost" data-action="feed-advance" data-id="${it.id}">Payé d'avance…</button>` : ''}
        <button class="btn ghost" data-action="rule-new" data-id="${it.id}">Créer une règle…</button>
        <button class="btn ghost" data-action="feed-exclude" data-id="${it.id}">${isPersonal(account) ? 'Personnel' : 'Exclure'}</button></div></div>`;
  }

  /* ---------- Banque : règles de catégorisation ---------- */
  const rules = () => (data.rules = data.rules || []);
  const RULE_PERIODS = [['prev', 'Mois précédant la transaction'], ['same', 'Mois de la transaction'], ['none', 'Aucun']];
  function openRuleForm(it, ruleId) {
    const ex = ruleId ? rules().find((r) => r.id === ruleId) : null;
    let st;
    if (ex) st = { ...ex };
    else {
      const p = it ? feedProposals(it.account)[it.id] : null, sp = p && p.splits.length === 1 ? p.splits[0] : {};
      const words = String(it ? it.description : '').replace(/[*#]+\w*/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => !/^\d+$/.test(w)).slice(0, 3).join(' ');
      st = { id: null, name: words, contains: words, account: it ? it.account : '', dir: it ? (it.amount > 0 ? 'in' : 'out') : 'any', amin: '', amax: '', acct: sp.acct || '', loan: sp.loan || '',
        periodMode: sp.period ? (sp.period === it.date.slice(0, 7) ? 'same' : 'prev') : (sp.acct && /^exp:int-|^rev:interest/.test(sp.acct) ? 'prev' : 'none'), memo: sp.memo || '', active: true };
    }
    modalState = { kind: 'rule', st }; renderRuleForm();
  }
  function ruleMatches(st) { return feed().filter((x) => x.status === 'pending' && window.FinImport.matchRule({ rules: [{ ...st, active: true }] }, x.account, x)); }
  function renderRuleForm() {
    const st = modalState.st, a = acc(st.acct) || {}, n = st.contains ? ruleMatches(st).length : 0;
    const body = `<div class="form-grid">
      <label class="field span-2"><span>Nom de la règle</span><input type="text" id="rl-name" value="${esc(st.name)}"></label>
      <label class="field span-2"><span>La description contient</span><input type="text" id="rl-contains" value="${esc(st.contains)}" placeholder="Ex. : SEND E-TFR FEE"></label>
      <label class="field"><span>Compte</span><select id="rl-account"><option value="">Tous les comptes</option>${visibleBanks().map((b) => `<option value="${b.id}" ${b.id === st.account ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Sens</span><select id="rl-dir">${[['any', 'Dépenses et dépôts'], ['out', 'Dépenses seulement'], ['in', 'Dépôts seulement']].map(([k, l]) => `<option value="${k}" ${st.dir === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Montant minimum (facultatif)</span><input type="text" inputmode="decimal" id="rl-amin" value="${esc(st.amin ?? '')}"></label>
      <label class="field"><span>Montant maximum (facultatif)</span><input type="text" inputmode="decimal" id="rl-amax" value="${esc(st.amax ?? '')}"></label>
      <label class="field span-2"><span>Catégorie à appliquer</span><select id="rl-acct">${catOptions(st.acct, null)}</select></label>
      ${a.perLoan ? `<label class="field"><span>Prêt</span><select id="rl-loan">${loanOptions(st.loan)}</select></label>` : ''}
      ${hasPeriod(st.acct) ? `<label class="field"><span>Mois couvert</span><select id="rl-period">${RULE_PERIODS.filter(([k]) => !(k === 'none' && st.acct === 'rev:interest')).map(([k, l]) => `<option value="${k}" ${st.periodMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      <label class="field ${a.perLoan && hasPeriod(st.acct) ? 'span-2' : ''}"><span>Mémo (facultatif)</span><input type="text" id="rl-memo" value="${esc(st.memo || '')}"></label>
      <label class="field span-2 check"><input type="checkbox" id="rl-active" ${st.active !== false ? 'checked' : ''}> Règle active</label>
    </div>
    <p class="small muted">${st.contains ? `${n} transaction(s) à traiter correspondent maintenant.` : ''} Une règle a priorité sur l'historique : la catégorie est proposée avec l'étiquette « RÈGLE » et peut être acceptée en lot.</p>`;
    const foot = `<div class="toolbar">${st.id ? '<button class="btn danger" data-rule-del>Supprimer</button>' : ''}<button class="btn ghost" data-rules-list>Toutes les règles</button></div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-rule-save ${st.contains && st.acct ? '' : 'disabled'}>${st.id ? 'Enregistrer' : 'Créer la règle'}</button></div>`;
    openModal(st.id ? 'Modifier la règle' : 'Créer une règle', body, foot);
  }
  function readRuleForm() {
    const st = modalState.st, v = (id) => { const el = $(`#${id}`, modal); return el ? el.value : undefined; };
    st.name = v('rl-name') ?? st.name; st.contains = (v('rl-contains') ?? st.contains).trim(); st.account = v('rl-account') ?? st.account; st.dir = v('rl-dir') ?? st.dir;
    st.amin = v('rl-amin') ?? st.amin; st.amax = v('rl-amax') ?? st.amax; st.memo = v('rl-memo') ?? st.memo;
    const na = v('rl-acct');
    if (na !== undefined && na !== st.acct) { st.acct = na; st.loan = ''; st.periodMode = /^exp:int-|^rev:interest/.test(na) ? 'prev' : 'none'; }
    else { if (v('rl-loan') !== undefined) st.loan = v('rl-loan'); if (v('rl-period') !== undefined) st.periodMode = v('rl-period'); }
    const ac = $('#rl-active', modal); if (ac) st.active = ac.checked;
    if (!(acc(st.acct) || {}).perLoan) st.loan = ''; if (!hasPeriod(st.acct)) st.periodMode = 'none';
  }
  function openRulesList() {
    const list = rules();
    const body = list.length ? `<table><thead><tr><th>Règle</th><th>Condition</th><th>Catégorie</th><th></th></tr></thead><tbody>${list.map((r) => `<tr class="${r.active === false ? 'muted' : ''}">
        <td><b>${esc(r.name || r.contains)}</b>${r.active === false ? ' <span class="small">(inactive)</span>' : ''}</td>
        <td class="small">contient « ${esc(r.contains)} »${r.account ? ` · ${esc((bankById(r.account) || {}).name || r.account)}` : ''}${r.dir && r.dir !== 'any' ? ` · ${r.dir === 'in' ? 'dépôts' : 'dépenses'}` : ''}${r.amin !== '' && r.amin != null ? ` · ≥ ${m(num(r.amin))}` : ''}${r.amax !== '' && r.amax != null ? ` · ≤ ${m(num(r.amax))}` : ''}</td>
        <td class="small">${esc((acc(r.acct) || {}).name || r.acct)}${r.loan ? ` · ${esc(loanShort(r.loan))}` : ''}</td>
        <td><button class="btn ghost small" data-rule-edit="${r.id}">Modifier</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aucune règle. Ouvrez une transaction à traiter et cliquez « Créer une règle… » pour catégoriser automatiquement les transactions semblables.</p>';
    modalState = { kind: 'rules' };
    openModal('Règles de catégorisation', body, '<div></div><div class="toolbar"><button class="btn" data-rule-blank>+ Nouvelle règle</button><button class="btn primary" data-close>Fermer</button></div>');
  }
  modal.addEventListener('change', (ev) => {
    if (!modalState || modalState.kind !== 'rule') return;
    if (['rl-acct', 'rl-contains', 'rl-account', 'rl-dir', 'rl-amin', 'rl-amax'].includes(ev.target.id)) { readRuleForm(); renderRuleForm(); }
  });
  modal.addEventListener('click', (ev) => {
    if (!modalState || !['rule', 'rules'].includes(modalState.kind)) return;
    const t = ev.target;
    if (t.closest('[data-rule-edit]')) return openRuleForm(null, t.closest('[data-rule-edit]').dataset.ruleEdit);
    if (t.closest('[data-rule-blank]')) return openRuleForm(null, null);
    if (t.closest('[data-rules-list]')) return openRulesList();
    if (modalState.kind !== 'rule') return;
    if (t.closest('[data-rule-del]')) { data.rules = rules().filter((r) => r.id !== modalState.st.id); persist('Règle supprimée'); openRulesList(); return render(); }
    if (t.closest('[data-rule-save]')) {
      readRuleForm(); const st = modalState.st; if (!st.contains || !st.acct) return;
      const rec = { id: st.id || `r${Date.now().toString(36)}`, name: st.name || st.contains, contains: st.contains, account: st.account || '', dir: st.dir || 'any', amin: st.amin === '' ? '' : num(st.amin), amax: st.amax === '' ? '' : num(st.amax), acct: st.acct, loan: st.loan || '', periodMode: st.periodMode || 'none', memo: st.memo || '', active: st.active !== false };
      if (!rec.amin && rec.amin !== 0) rec.amin = ''; if (!rec.amax && rec.amax !== 0) rec.amax = '';
      const k = rules().findIndex((r) => r.id === rec.id); if (k >= 0) rules()[k] = rec; else rules().push(rec);
      const n = ruleMatches(rec).length; closeModal(); persist(`Règle enregistrée · ${n} transaction(s) à traiter correspondent`); render();
    }
  });

  /* ---------- Banque : catégoriser plusieurs transactions à la fois ---------- */
  let BK = null;
  const PERIOD_MODES = [['default', 'Règle habituelle (intérêts : mois précédent)'], ['keep', 'Garder le mois déjà indiqué'], ['prev', 'Mois précédant la date de la transaction'], ['same', 'Mois de la transaction'], ['fixed', 'Un mois précis…'], ['none', 'Aucun mois couvert']];
  function bulkItems() {
    if (BK.tab === 'posted') return BK.ids.map((id) => data.entries.find((e) => e.id === id)).filter(Boolean);
    return BK.ids.map((id) => feed().find((x) => x.id === id)).filter(Boolean);
  }
  function bulkPeriod(acct, date, cur) {
    if (!hasPeriod(acct)) return '';
    switch (BK.periodMode) {
      case 'keep': return cur || defaultPeriod(acct, date);
      case 'prev': return E.addMonths(date.slice(0, 7), -1);
      case 'same': return date.slice(0, 7);
      case 'fixed': return BK.month || '';
      case 'none': return '';
      default: return defaultPeriod(acct, date);
    }
  }
  // Prépare les changements sans les appliquer : { ok: [{item, apply()}], skipped: [{item, reason}] }
  function bulkPlan() {
    const items = bulkItems(), a = acc(BK.acct) || {}, out = { ok: [], skipped: [] };
    if (!BK.acct) return out;
    for (const it of items) {
      if (BK.tab === 'posted') {
        const piv = pivotOf(it), cats = it.lines.filter((l) => l !== piv);
        const targets = BK.only ? cats.filter((l) => l.acct === BK.only) : cats.length === 1 ? cats : [];
        if (!targets.length) { out.skipped.push({ item: it, reason: BK.only ? 'aucune ligne de cette catégorie' : 'transaction ventilée sur plusieurs catégories' }); continue; }
        const copy = JSON.parse(JSON.stringify(it)), idx = targets.map((l) => it.lines.indexOf(l));
        idx.forEach((i) => { const l = copy.lines[i]; l.acct = BK.acct;
          if (a.perLoan) { if (BK.loan) l.loan = BK.loan; } else delete l.loan;
          const per = bulkPeriod(BK.acct, it.date, l.period); if (per) l.period = per; else delete l.period; });
        const errs = E.validateEntry(copy, data); copy.lines.forEach((l) => { if (l.acct === 'rev:interest' && !l.period) errs.push('mois couvert manquant'); if (a.perLoan && !l.loan && idx.includes(copy.lines.indexOf(l))) errs.push('prêt à choisir'); });
        if (errs.length) { out.skipped.push({ item: it, reason: errs[0] }); continue; }
        out.ok.push({ item: it, apply: () => { const k = data.entries.indexOf(it); if (k >= 0) data.entries[k] = copy; } });
      } else {
        const cur = ((feedProposals(it.account)[it.id] || {}).splits || [])[0] || {};
        const loan = a.perLoan ? (BK.loan || cur.loan || '') : '';
        const period = bulkPeriod(BK.acct, it.date, cur.period);
        out.ok.push({ item: it, apply: () => { const sp = { acct: BK.acct, loan, period, memo: '', amt: Math.abs(it.amount) }; it.splits = [sp]; } });
      }
    }
    return out;
  }
  function openBulkCat() {
    const B = ui.bank;
    BK = { tab: B.tab, account: B.account, ids: B.sel.slice(), acct: '', loan: '', periodMode: 'default', month: '', only: '' };
    renderBulkCat();
  }
  function renderBulkCat() {
    const items = bulkItems(), posted = BK.tab === 'posted', a = acc(BK.acct) || {};
    const amt = (x) => (posted ? entryAmount(x) : x.amount);
    const out = E.r2(-items.reduce((s0, x) => s0 + Math.min(0, amt(x)), 0)), inn = E.r2(items.reduce((s0, x) => s0 + Math.max(0, amt(x)), 0));
    const curCats = {}; if (posted) items.forEach((e) => entryCats(e).forEach((c) => { curCats[c] = (curCats[c] || 0) + 1; }));
    const plan = bulkPlan();
    const multi = !posted && items.some((x) => ((feedProposals(x.account)[x.id] || {}).splits || []).length > 1);
    const body = `
      <p class="muted" style="margin-top:0"><b>${items.length}</b> transaction(s) sélectionnée(s)${out ? ` · dépensé ${m(out)}` : ''}${inn ? ` · reçu ${m(inn)}` : ''}</p>
      <div class="form-grid">
        <label class="field span-2"><span>Nouvelle catégorie</span><select id="bk-acct">${catOptions(BK.acct, isPersonal(BK.account) ? null : BK.account)}</select></label>
        ${a.perLoan ? `<label class="field span-2"><span>Prêt</span><select id="bk-loan"><option value="">— Garder le prêt déjà indiqué —</option>${data.loans.map((l) => `<option value="${l.id}" ${l.id === BK.loan ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
        ${hasPeriod(BK.acct) ? `<label class="field ${BK.periodMode === 'fixed' ? '' : 'span-2'}"><span>Mois couvert</span><select id="bk-period">${PERIOD_MODES.filter(([k]) => !(k === 'none' && BK.acct === 'rev:interest')).map(([k, l]) => `<option value="${k}" ${BK.periodMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${BK.periodMode === 'fixed' ? `<label class="field"><span>Mois</span><input type="month" id="bk-month" value="${BK.month}"></label>` : ''}` : ''}
        ${posted ? `<label class="field span-2"><span>Lignes à modifier</span><select id="bk-only"><option value="">Toute la catégorie (transactions à une seule catégorie)</option>${Object.entries(curCats).map(([c, n]) => `<option value="${c}" ${BK.only === c ? 'selected' : ''}>Seulement les lignes « ${esc((acc(c) || {}).name || c)} » (${n})</option>`).join('')}</select></label>` : ''}
      </div>
      ${multi ? '<p class="small muted">Les transactions déjà ventilées sur plusieurs catégories seront remplacées par une seule catégorie pour le montant total.</p>' : ''}
      ${BK.acct ? `<div class="bulk-preview"><b>${plan.ok.length}</b> transaction(s) seront modifiées${plan.skipped.length ? `, <b>${plan.skipped.length}</b> laissée(s) telles quelles :<ul>${plan.skipped.slice(0, 6).map((x) => `<li>${d(x.item.date)} · ${esc(x.item.description)} — ${esc(x.reason)}</li>`).join('')}${plan.skipped.length > 6 ? `<li>et ${plan.skipped.length - 6} autre(s)</li>` : ''}</ul>` : '.'}</div>` : ''}
      ${!posted ? '<p class="small muted">Les transactions restent dans « À traiter » avec la nouvelle catégorie; cliquez ensuite « Accepter » pour les comptabiliser.</p>' : ''}`;
    const foot = `<div></div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-bk-apply ${plan.ok.length ? '' : 'disabled'}>${posted ? 'Recatégoriser' : 'Appliquer'} ${plan.ok.length || ''}</button></div>`;
    openModal(posted ? 'Recatégoriser les transactions' : 'Catégoriser les transactions', body, foot);
    modalState = { kind: 'bulk' };
  }
  modal.addEventListener('change', (ev) => {
    if (!BK || modal.hidden) return; const t = ev.target;
    const map = { 'bk-acct': 'acct', 'bk-loan': 'loan', 'bk-period': 'periodMode', 'bk-month': 'month', 'bk-only': 'only' };
    if (!map[t.id]) return;
    BK[map[t.id]] = t.value;
    if (t.id === 'bk-acct') { BK.loan = ''; if (BK.periodMode === 'none' && t.value === 'rev:interest') BK.periodMode = 'default'; }
    renderBulkCat();
  });
  modal.addEventListener('click', (ev) => {
    if (!BK || !ev.target.closest('[data-bk-apply]')) return;
    const plan = bulkPlan(); plan.ok.forEach((x) => x.apply());
    const n = plan.ok.length, skip = plan.skipped.length, tab = BK.tab;
    if (tab === 'posted') data.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    ui.bank.sel = []; BK = null; closeModal();
    persist(`${n} transaction(s) ${tab === 'posted' ? 'recatégorisée(s)' : 'catégorisée(s)'}${skip ? ` · ${skip} laissée(s) telles quelles` : ''}`); render();
  });

  /* ---------- formulaire de transaction ---------- */
  function formFromEntry(e) {
    if (!e) return null;
    if (!e.account) return { id: e.id, mode: 'journal', account: '', date: e.date, description: e.description, notes: e.notes || '', lines: e.lines.map((l) => ({ acct: l.acct, loan: l.loan || '', period: l.period || '', memo: l.memo || '', debit: l.amt > 0 ? l.amt : '', credit: l.amt < 0 ? -l.amt : '' })) };
    const piv = pivotOf(e); const sign = piv && piv.amt < 0 ? -1 : 1;
    return { id: e.id, mode: 'bank', account: e.account, counter: e.counter || '', date: e.date, description: e.description, notes: e.notes || '', dir: sign > 0 ? 'in' : 'out', amount: piv ? Math.abs(piv.amt) : '',
      splits: e.lines.filter((l) => l !== piv).map((l) => ({ acct: l.acct, loan: l.loan || '', period: l.period || '', memo: l.memo || '', amt: E.r2(-sign * l.amt) })) };
  }
  function openTxForm(entry, preset) {
    modalState = formFromEntry(entry) || { id: null, mode: 'bank', account: 'bank:td', counter: '', date: todayISO, description: '', notes: '', dir: 'in', amount: '',
      splits: [{ acct: preset && preset.loan ? 'rev:interest' : '', loan: (preset && preset.loan) || '', period: preset && preset.loan ? E.addMonths(todayISO.slice(0, 7), -1) : '', memo: '', amt: '' }],
      lines: [{ acct: '', loan: '', period: '', memo: '', debit: '', credit: '' }, { acct: '', loan: '', period: '', memo: '', debit: '', credit: '' }] };
    if (preset && preset.prefill) modalState = { id: null, mode: 'bank', counter: '', notes: '', lines: null, ...preset.prefill };
    modalState.kind = 'tx'; modalState.suggest = null; modalState.errors = []; modalState.onSaved = preset && preset.onSaved;
    if (preset && preset.advance) modalState.adv = defaultAdvance(modalState);
    if (!modalState.lines) modalState.lines = [{ acct: '', loan: '', debit: '', credit: '' }, { acct: '', loan: '', debit: '', credit: '' }];
    if (!modalState.splits) modalState.splits = [{ acct: '', loan: '', period: '', memo: '', amt: '' }];
    renderTxForm();
  }
  const isPersonal = (id) => !!(bankById(id) || {}).personal;
  function catOptions(sel, exclude) {
    let h = '<option value="">— Choisir —</option>';
    for (const g of ['revenue', 'direct', 'overhead', 'asset', 'liability', 'equity']) {
      const list = data.accounts.filter((a) => a.group === g && a.id !== exclude); if (!list.length) continue;
      h += `<optgroup label="${GROUPS[g]}">${list.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>`;
    }
    return h;
  }
  const loanOptions = (sel) => `<option value="">— Prêt —</option>${data.loans.map((l) => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}${E.loanStatus(l, todayISO) === 'closed' ? ' (remboursé)' : ''}</option>`).join('')}`;
  const num = (v) => { const x = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };

  function renderTxForm() {
    const f = modalState, journal = f.mode === 'journal';
    const shAccts = data.accounts.filter((a) => a.id.startsWith('liab:sh-'));
    const pivot = journal ? null : (isPersonal(f.account) ? f.counter : f.account);
    let body = `
      <div class="form-grid">
        <label class="field span-2"><span>Compte</span><select id="tx-account">${visibleBanks(f.account).map((b) => `<option value="${b.id}" ${b.id === f.account ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="__journal" ${journal ? 'selected' : ''}>Écriture de journal (sans compte bancaire)</option></select></label>
        <label class="field"><span>Date</span><input type="date" id="tx-date" value="${f.date}"></label>
        ${journal ? '<div></div>' : `<div class="field"><span>Sens</span><div class="seg" role="group" aria-label="Sens"><button type="button" data-dir="in" class="${f.dir === 'in' ? 'on' : ''}">Entrée</button><button type="button" data-dir="out" class="${f.dir === 'out' ? 'on' : ''}">Sortie</button></div></div>`}
        <label class="field span-2"><span>Description</span><input type="text" id="tx-desc" value="${esc(f.description)}" placeholder="Ex. : E-TRANSFER ***fJn"></label>
        ${journal ? '' : `<label class="field"><span>Montant</span><input type="text" inputmode="decimal" class="num" id="tx-amount" value="${f.amount === '' ? '' : f.amount}" placeholder="0,00"></label>`}
        ${!journal && isPersonal(f.account) ? `<label class="field"><span>Avance de l'actionnaire (contrepartie)</span><select id="tx-counter">${shAccts.map((a) => `<option value="${a.id}" ${a.id === f.counter ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field span-4"><span>Notes</span><input type="text" id="tx-notes" value="${esc(f.notes)}"></label>
      </div>`;
    if (!journal) {
      const showSuggest = f.dir === 'in' && (f.splits.every((s) => !s.acct || s.acct === 'rev:interest'));
      body += `
      <div class="splits"><table><thead><tr><th>Catégorie</th><th>Prêt / détail</th><th>Mois couvert</th><th class="num">Montant</th><th></th></tr></thead><tbody>
        ${f.splits.map((s, i) => { const a = acc(s.acct) || {}; return `<tr data-i="${i}">
          <td class="wide"><select data-k="acct" aria-label="Catégorie">${catOptions(s.acct, pivot)}</select></td>
          <td class="wide">${a.perLoan ? `<select data-k="loan" aria-label="Prêt">${loanOptions(s.loan)}</select>` : `<input type="text" data-k="memo" value="${esc(s.memo)}" placeholder="Détail (facultatif)" aria-label="Détail">`}</td>
          <td>${hasPeriod(s.acct) ? `<input type="month" data-k="period" value="${s.period || ''}" aria-label="Mois couvert" title="${s.acct === 'rev:interest' ? 'Mois couvert par cet intérêt' : (acc(s.acct) || {}).group === 'revenue' ? 'Mois auquel ce revenu se rapporte (facultatif)' : 'Mois auquel cette dépense se rapporte (facultatif)'}">` : '<span class="muted small">—</span>'}</td>
          <td><input type="text" inputmode="decimal" class="num" data-k="amt" value="${s.amt === '' ? '' : s.amt}" placeholder="${f.splits.length === 1 ? 'Tout' : '0,00'}" aria-label="Montant"></td>
          <td><button class="icon-btn" data-split-del="${i}" aria-label="Retirer la ligne" ${f.splits.length === 1 ? 'disabled' : ''}>×</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="remain"><div><button class="btn small" data-split-add>+ Ajouter une ligne</button> ${showSuggest ? '<button class="btn small" data-suggest>Suggérer la ventilation</button>' : ''} <button class="btn small" data-adv-open>${f.dir === 'in' ? "Paiement d'avance…" : "Dépense payée d'avance…"}</button></div>
        <div id="remain-text"></div></div>
      ${f.suggest ? suggestBox(f.suggest) : ''}
      ${f.adv ? advanceBox(f) : ''}`;
    } else {
      body += `<p class="hint" style="margin:0">Une écriture de journal sert aux mouvements qui ne passent pas par un compte de l'entreprise (ex. : un prêteur qui dépose directement sur ta marge). Le total des débits doit égaler celui des crédits.</p>
      <div class="splits"><table><thead><tr><th>Compte</th><th>Prêt / détail</th><th class="num">Débit</th><th class="num">Crédit</th><th></th></tr></thead><tbody>
        ${f.lines.map((l, i) => { const a = acc(l.acct) || {}; return `<tr data-j="${i}">
          <td class="wide"><select data-k="acct" aria-label="Compte">${catOptions(l.acct)}</select></td>
          <td class="wide">${a.perLoan ? `<select data-k="loan" aria-label="Prêt">${loanOptions(l.loan)}</select>` : `<input type="text" data-k="memo" value="${esc(l.memo || '')}" placeholder="Détail" aria-label="Détail">`}</td>
          <td><input type="text" inputmode="decimal" class="num" data-k="debit" value="${l.debit}" aria-label="Débit"></td>
          <td><input type="text" inputmode="decimal" class="num" data-k="credit" value="${l.credit}" aria-label="Crédit"></td>
          <td><button class="icon-btn" data-line-del="${i}" aria-label="Retirer la ligne" ${f.lines.length <= 2 ? 'disabled' : ''}>×</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="remain"><button class="btn small" data-line-add>+ Ajouter une ligne</button><div id="remain-text"></div></div>`;
    }
    if (f.errors.length) body += `<div class="errors"><ul>${f.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    const foot = `<div class="toolbar">${f.id ? '<button class="btn danger" data-tx-del>Supprimer</button><button class="btn" data-tx-dup>Dupliquer</button>' : ''}</div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-tx-save>${f.id ? 'Enregistrer' : 'Ajouter la transaction'}</button></div>`;
    const focusId = document.activeElement && modal.contains(document.activeElement) ? document.activeElement : null;
    const focusSel = focusId ? (focusId.id ? `#${focusId.id}` : focusId.closest('tr') ? `tr[${focusId.closest('tr').dataset.i != null ? 'data-i' : 'data-j'}="${focusId.closest('tr').dataset.i ?? focusId.closest('tr').dataset.j}"] [data-k="${focusId.dataset.k}"]` : null) : null;
    openModal(f.id ? 'Modifier la transaction' : f.duplicateOf ? `Nouvelle transaction (copie du ${d(f.duplicateOf)})` : 'Nouvelle transaction', body, foot);
    updateRemain();
    if (focusSel) { const el = $(focusSel, modal); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
  }
  /* ---------- paiement d'avance ---------- */
  function defaultAdvance(f) {
    if (f.dir === 'out') {
      const cur = (f.splits.find((x) => x.acct && hasPeriod(x.acct)) || {}).acct || 'exp:int-doris';
      return { kind: 'expense', acct: cur, from: f.date.slice(0, 7), months: 6, per: num(f.amount) ? E.r2(num(f.amount) / 6) : '', detected: [] };
    }
    const others = { ...data, entries: data.entries.filter((e) => e.id !== f.id) };
    const det = num(f.amount) ? E.suggestAdvance(others, num(f.amount), f.date) : [];
    if (det.length) return { kind: 'revenue', loan: det[0].loan, from: det[0].from, months: det[0].months, per: det[0].perMonth, detected: det };
    const loan = (f.splits.find((x) => x.loan) || {}).loan || '';
    const months = 6;
    return { kind: 'revenue', loan, from: loan ? firstOpenMonth(others, loan, f.date) : f.date.slice(0, 7), months, per: num(f.amount) ? E.r2(num(f.amount) / months) : '', detected: [] };
  }
  function firstOpenMonth(d0, loanId, date) {
    const r = E.schedule(d0, loanId, date, 14).rows.find((x) => x.expected > 0 && x.received < x.expected - 0.5 && x.period >= E.addMonths(date.slice(0, 7), -2));
    return r ? r.period : date.slice(0, 7);
  }
  function advanceBox(f) {
    const a = f.adv, total = E.r2(num(a.per) * (Number(a.months) || 0)), amount = num(f.amount);
    const to = a.from && a.months ? E.addMonths(a.from, Number(a.months) - 1) : '';
    let expectedNote = '';
    if (a.loan && a.from) { const r = E.schedule({ ...data, entries: data.entries.filter((e) => e.id !== f.id) }, a.loan, f.date, 14).rows.find((x) => x.period === a.from); if (r) expectedNote = `Intérêt attendu en ${r.label} : ${m(r.expected)}${r.received ? `, déjà reçu ${m(r.received)}` : ''}`; }
    const isExp = a.kind === 'expense';
    const expOptions = () => data.accounts.filter((x) => x.group === 'direct' || x.group === 'overhead').map((x) => `<option value="${x.id}" ${x.id === a.acct ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    return `<div class="suggest adv"><b>${isExp ? "Dépense payée d'avance" : "Paiement d'avance"}</b>
      <span class="hint">${isExp ? "Répartit la dépense sur les mois qu'elle couvre (charge payée d'avance amortie). En encaissement, elle compte à la date du paiement; en reconnaissance, dans chaque mois couvert." : "Répartit le montant reçu sur plusieurs mois du calendrier. Le revenu compte au P&amp;L à la date de réception; le calendrier marque chaque mois couvert comme payé."}</span>
      ${a.detected && a.detected.length ? `<div class="opt"><span class="small muted">Détecté :</span>${a.detected.map((x, i) => `<button class="btn small" data-adv-pick="${i}">${esc(loanShort(x.loan))} · ${x.months} × ${m(x.perMonth)} dès ${E.monthLabel(x.from)}</button>`).join('')}</div>` : ''}
      <div class="form-grid">
        ${isExp ? `<label class="field span-2"><span>Catégorie de dépense</span><select id="adv-acct">${expOptions()}</select></label>` : `<label class="field span-2"><span>Prêt</span><select id="adv-loan">${loanOptions(a.loan)}</select></label>`}
        <label class="field"><span>Premier mois couvert</span><input type="month" id="adv-from" value="${a.from || ''}"></label>
        <label class="field"><span>Nombre de mois</span><input type="number" id="adv-months" min="1" max="36" value="${a.months}"></label>
        <label class="field"><span>Montant par mois</span><input type="text" inputmode="decimal" class="num" id="adv-per" value="${a.per}"></label>
        <div class="field span-3"><span>&nbsp;</span><div class="small">${a.months && a.from ? `${E.monthLabel(a.from)} → ${E.monthLabel(to)} · total ${m(total)}` : ''}${amount && Math.abs(total - amount) > 0.005 ? ` <span class="neg">(montant ${isExp ? 'payé' : 'reçu'} : ${m(amount)})</span>` : amount ? ` <span class="ok" style="color:var(--good)">= montant ${isExp ? 'payé' : 'reçu'} ✓</span>` : ''}${expectedNote ? `<div class="muted">${esc(expectedNote)}</div>` : ''}</div></div>
      </div>
      <div class="opt"><button class="btn small primary" data-adv-apply>Répartir sur ${a.months || 0} mois</button><button class="btn small ghost" data-adv-close>Fermer</button></div></div>`;
  }
  function readAdv() {
    const f = modalState; if (!f || !f.adv) return;
    const g = (id) => { const el = $(`#${id}`, modal); return el ? el.value : null; };
    if (g('adv-loan') != null) f.adv.loan = g('adv-loan');
    if (g('adv-acct') != null) f.adv.acct = g('adv-acct');
    if (g('adv-from') != null) f.adv.from = g('adv-from');
    if (g('adv-months') != null) f.adv.months = Math.max(1, Math.min(36, parseInt(g('adv-months'), 10) || 1));
    if (g('adv-per') != null) f.adv.per = g('adv-per');
  }

  function suggestBox(sg) {
    if (!sg.options.length) return `<div class="suggest"><b>Aucune combinaison trouvée.</b><span class="hint">Aucun groupe de mensualités impayées ne donne exactement ce montant. Ventilez à la main (paiement partiel, avance ou montant différent).</span></div>`;
    return `<div class="suggest"><b>Combinaisons possibles</b><span class="hint">D'après les intérêts attendus et pas encore reçus.</span>
      ${sg.options.map((o, i) => `<div class="opt"><button class="btn small primary" data-apply="${i}">Appliquer</button>${o.map((x) => `<span class="chip acc">${esc(loanShort(x.loan))} · ${E.monthLabel(x.period)} · ${m(x.amt)}</span>`).join('')}</div>`).join('')}</div>`;
  }
  function buildEntry() {
    const f = modalState, journal = f.mode === 'journal';
    const e = { id: f.id || `e${Date.now().toString(36)}`, date: f.date, account: journal ? null : f.account, description: f.description.trim() || '(sans description)', lines: [] };
    if (f.notes.trim()) e.notes = f.notes.trim();
    const clean = (l, amt) => { const o = { acct: l.acct, amt: E.r2(amt) }; const a = acc(l.acct) || {}; if (a.perLoan && l.loan) o.loan = l.loan; if (hasPeriod(l.acct) && l.period) o.period = l.period; if (!a.perLoan && l.memo && l.memo.trim()) o.memo = l.memo.trim(); return o; };
    if (journal) { e.lines = f.lines.filter((l) => l.acct || num(l.debit) || num(l.credit)).map((l) => clean(l, num(l.debit) - num(l.credit))); }
    else {
      const sign = f.dir === 'in' ? 1 : -1, amount = num(f.amount);
      const pivot = isPersonal(f.account) ? f.counter : f.account;
      if (isPersonal(f.account)) e.counter = f.counter;
      const splits = f.splits.filter((s) => s.acct || num(s.amt));
      if (splits.length === 1 && String(splits[0].amt).trim() === '') splits[0] = { ...splits[0], amt: amount };
      e.lines = [{ acct: pivot, amt: E.r2(sign * amount) }].concat(splits.map((s) => clean(s, -sign * num(s.amt))));
    }
    return e;
  }
  function readTxInputs() {
    const f = modalState; if (!f || f.kind !== 'tx') return;
    const v = (id) => { const el = $(`#${id}`, modal); return el ? el.value : null; };
    f.date = v('tx-date') || f.date; f.description = v('tx-desc') ?? f.description; f.notes = v('tx-notes') ?? f.notes;
    if (v('tx-amount') != null) f.amount = v('tx-amount');
    if (v('tx-counter') != null) f.counter = v('tx-counter');
    $$('tr[data-i]', modal).forEach((tr) => { const s = f.splits[+tr.dataset.i]; $$('[data-k]', tr).forEach((el) => (s[el.dataset.k] = el.value)); });
    $$('tr[data-j]', modal).forEach((tr) => { const l = f.lines[+tr.dataset.j]; $$('[data-k]', tr).forEach((el) => (l[el.dataset.k] = el.value)); });
    readAdv();
  }
  const defaultCounter = (account, splits) => {
    if (!isPersonal(account)) return '';
    const b = bankById(account); if (b && b.defaultCounter) return b.defaultCounter;
    const cats = splits.map((s) => s.acct);
    if (cats.includes('exp:int-marge')) return 'liab:sh-int';
    if (cats.includes('loans')) return 'liab:sh-marge';
    if (cats.includes('exp:bank-transfer')) return 'liab:sh-frais';
    return account === 'rbc-perso' ? 'liab:sh-autres' : 'liab:sh-marge';
  };

  /* ---------- duplication ---------- */
  function nextMonthDate(iso) {
    const [y, mo, dd] = iso.split('-').map(Number);
    const [ny, nm] = E.addMonths(`${y}-${String(mo).padStart(2, '0')}`, 1).split('-').map(Number);
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
  }
  // Copie une transaction (ou le formulaire en cours) et la décale d'un mois : date et mois couvert par les intérêts
  function duplicateForm(f) {
    const c = JSON.parse(JSON.stringify({ ...f, onSaved: null, suggest: null }));
    c.id = null; c.errors = []; c.date = nextMonthDate(f.date);
    (c.splits || []).forEach((s) => { if (s.period) s.period = E.addMonths(s.period, 1); });
    (c.lines || []).forEach((l) => { if (l.period) l.period = E.addMonths(l.period, 1); });
    c.duplicateOf = f.date;
    return c;
  }
  function openDuplicate(entry) {
    const f = formFromEntry(entry);
    openTxForm(null, { prefill: duplicateForm(f) });
    toast(`Copie de la transaction du ${d(entry.date)} — vérifiez le montant`);
  }

  /* ---------- comptes bancaires ---------- */
  const BANK_KINDS = {
    asset: { label: "Compte de l'entreprise", help: "Compte bancaire au nom de l'entreprise (chèques, épargne). Son solde fait partie de l'actif au bilan." },
    liability: { label: "Marge ou carte de l'entreprise", help: "Marge de crédit ou carte de crédit au nom de l'entreprise. Le solde utilisé est une dette au passif du bilan; les intérêts se classent comme dépense." },
    card: { label: 'Carte de crédit personnelle', help: "Votre carte à vous, sur laquelle passent aussi des dépenses de l'entreprise. N'apparaît pas au bilan : chaque dépense d'entreprise devient une avance de l'actionnaire (« carte de crédit personnelle »). Les achats personnels et les paiements de la carte se mettent de côté avec « Personnel »." },
    personal: { label: "Compte personnel de l'actionnaire", help: "Marge, carte ou compte à votre nom, utilisé pour l'entreprise. N'apparaît pas au bilan : chaque dépense devient une avance de l'actionnaire (l'entreprise vous la doit), chaque remboursement la réduit." },
  };
  const bankKind = (b) => (b.personal ? (b.card ? 'card' : 'personal') : b.kind === 'liability' ? 'liability' : 'asset');
  const isPersonalKind = (k) => k === 'personal' || k === 'card';
  const CARD_ADV = 'liab:sh-carte';
  function ensureCardAdvance() {
    if (!acc(CARD_ADV)) { const i = data.accounts.findIndex((x) => x.id === 'liab:marc'); data.accounts.splice(i < 0 ? data.accounts.length : i, 0, { id: CARD_ADV, name: "Avances de l'actionnaire — carte de crédit personnelle", group: 'liability' }); }
    return CARD_ADV;
  }
  function bankTypeLabel(b) {
    const k = bankKind(b);
    if (!isPersonalKind(k)) return BANK_KINDS[k].label;
    return `${BANK_KINDS[k].label} · contrepartie : ${b.defaultCounter ? esc((acc(b.defaultCounter) || {}).name || b.defaultCounter) : 'automatique selon la catégorie'}`;
  }
  // Applique nom, type et paramètres; crée le compte si id est nul. Renvoie l'id ou null (avec un message).
  function saveBank(id, { name, kind, defaultCounter, hidden }) {
    name = String(name || '').trim(); if (!name) { toast('Indiquez un nom de compte'); return null; }
    if (data.bankAccounts.some((b) => b.id !== id && b.name.toLowerCase() === name.toLowerCase())) { toast('Un compte porte déjà ce nom'); return null; }
    let b = id && bankById(id);
    if (b) {
      const was = bankKind(b), used = bankUsage(b.id);
      if (isPersonalKind(was) !== isPersonalKind(kind) && (used.entries || used.feed)) {
        toast("Ce compte contient déjà des transactions : on ne peut pas le changer entre « personnel » et « entreprise ». Créez plutôt un nouveau compte.");
        return null;
      }
    } else {
      let nid = isPersonalKind(kind) ? slug(name) : `bank:${slug(name)}`; while (bankById(nid) || acc(nid)) nid += '-2';
      b = { id: nid }; data.bankAccounts.push(b);
    }
    b.name = name;
    if (kind === 'card' && !defaultCounter && !b.card) defaultCounter = ensureCardAdvance();
    if (isPersonalKind(kind)) { b.personal = true; delete b.kind; if (kind === 'card') b.card = true; else delete b.card; if (defaultCounter) b.defaultCounter = defaultCounter; else delete b.defaultCounter; }
    else { delete b.personal; delete b.card; delete b.defaultCounter; if (kind === 'liability') b.kind = 'liability'; else delete b.kind; }
    if (hidden) b.hidden = true; else delete b.hidden;
    // compte du grand livre : seulement pour les comptes de l'entreprise
    const a = acc(b.id);
    if (isPersonalKind(kind)) { if (a) data.accounts = data.accounts.filter((x) => x.id !== b.id); }
    else {
      const group = kind === 'liability' ? 'liability' : 'asset';
      if (a) { a.name = name; a.group = group; a.bank = true; }
      else {
        const i = group === 'asset' ? data.accounts.findIndex((x) => x.group === 'asset' && !x.bank) : data.accounts.findIndex((x) => x.group === 'equity');
        data.accounts.splice(i < 0 ? data.accounts.length : i, 0, { id: b.id, name, group, bank: true });
      }
    }
    persist(id ? `Compte « ${name} » mis à jour` : `Compte « ${name} » ajouté`);
    return b.id;
  }
  function addBank(rawName, personal) { return saveBank(null, { name: rawName, kind: personal ? 'personal' : 'asset' }); }
  function openBankForm(id) {
    const b = id ? bankById(id) : { name: '', id: null };
    modalState = { kind: 'bank', id: id || null, sel: id ? bankKind(b) : 'asset' };
    renderBankForm();
  }
  function renderBankForm() {
    const st = modalState, b = st.id ? bankById(st.id) : { name: st.name || '' };
    const used = st.id ? bankUsage(st.id) : { entries: 0, feed: 0 };
    const locked = used.entries || used.feed;
    const sh = data.accounts.filter((a) => a.id.startsWith('liab:sh-'));
    let cur = st.counter !== undefined ? st.counter : (b.defaultCounter || '');
    if (st.sel === 'card' && st.counter === undefined && !b.defaultCounter) cur = CARD_ADV;
    const shList = data.accounts.filter((a) => a.id.startsWith('liab:sh-')).concat(acc(CARD_ADV) ? [] : [{ id: CARD_ADV, name: "Avances de l'actionnaire — carte de crédit personnelle (sera créée)" }]);
    const body = `
      <label class="field"><span>Nom du compte</span><input type="text" id="nb-name" value="${esc(st.name !== undefined ? st.name : b.name)}" placeholder="Ex. : Desjardins — compte d'entreprise"></label>
      <div class="field"><span>Type de compte</span>
        <div class="kind-list" role="radiogroup" aria-label="Type de compte">
        ${Object.entries(BANK_KINDS).map(([k, v]) => { const dis = locked && (isPersonalKind(bankKind(b)) !== isPersonalKind(k));
          return `<label class="kind ${st.sel === k ? 'on' : ''} ${dis ? 'dis' : ''}"><input type="radio" name="nb-kind" value="${k}" ${st.sel === k ? 'checked' : ''} ${dis ? 'disabled' : ''}>
            <span><b>${v.label}</b><span class="hint">${v.help}</span></span></label>`; }).join('')}
        </div>
        ${locked ? `<span class="hint">Ce compte contient ${used.entries} transaction(s)${used.feed ? ` et ${used.feed} ligne(s) à traiter` : ''} : ${isPersonalKind(bankKind(b)) ? "il doit rester un compte personnel ou une carte personnelle. Pour un compte d'entreprise, créez un nouveau compte." : "il peut passer d'actif à passif, mais pas devenir un compte personnel."}</span>` : ''}
      </div>
      ${isPersonalKind(st.sel) ? `<label class="field"><span>Avance de l'actionnaire utilisée par défaut</span>
        <select id="nb-counter"><option value="">Automatique selon la catégorie (intérêts de marge, frais, capital de prêt…)</option>${shList.map((a) => `<option value="${a.id}" ${cur === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <span class="hint">C'est le compte d'avance qui s'inscrit en contrepartie de chaque dépense. Vous pouvez toujours le changer dans une transaction.</span></label>` : ''}
      ${st.id ? `<label class="check"><input type="checkbox" id="nb-hidden" ${(st.hidden !== undefined ? st.hidden : b.hidden) ? 'checked' : ''}> Masquer ce compte dans Banque et dans les formulaires</label>` : ''}`;
    openModal(st.id ? 'Paramètres du compte' : 'Ajouter un compte', body,
      `<div></div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-bank-save>${st.id ? 'Enregistrer' : 'Ajouter le compte'}</button></div>`);
    if (!st.id) setTimeout(() => { const el = $('#nb-name'); if (el && !el.value) el.focus(); }, 0);
  }
  function readBankForm() {
    const st = modalState;
    st.name = $('#nb-name').value;
    const r = $('input[name="nb-kind"]:checked', modal); if (r) st.sel = r.value;
    const c = $('#nb-counter'); if (c) st.counter = c.value;
    const h = $('#nb-hidden'); if (h) st.hidden = h.checked;
  }

  /* ---------- ajustement d'un mois du calendrier ---------- */
  function openAdjust(loanId, period) {
    const l = loanById(loanId), r = E.schedule(data, loanId, todayISO).rows.find((x) => x.period === period);
    const adj = (l.adjustments || {})[period];
    modalState = { kind: 'adj', loanId, period, mode: adj ? adj.mode : 'settled' };
    const diff = E.r2(r.received - r.expectedCalc);
    openModal(`Ajuster ${r.label} — ${loanShort(loanId)}`, `
      <dl class="kv"><dt>Intérêt calculé</dt><dd class="num" style="text-align:left">${m(r.expectedCalc)} <span class="small muted">(${esc(r.version)}, ${m0(r.principal)} à ${r.rate != null ? PCT.format(r.rate) : '—'})</span></dd>
        <dt>Reçu pour ce mois</dt><dd class="num" style="text-align:left">${m(r.received)}</dd>
        <dt>Écart</dt><dd class="num ${diff < -0.5 ? 'neg' : ''}" style="text-align:left">${m(diff)}</dd></dl>
      <div class="kind-list" role="radiogroup" aria-label="Ajustement">
        <label class="kind ${modalState.mode === 'settled' ? 'on' : ''}"><input type="radio" name="adj-mode" value="settled" ${modalState.mode === 'settled' ? 'checked' : ''}>
          <span><b>Réglé : le montant reçu correspond à ce qui était dû</b><span class="hint">L'écart n'est ni dû ni en arriérés (ex. : changement de capital ou date de déboursé en cours de mois). L'attendu devient le reçu.</span></span></label>
        <label class="kind ${modalState.mode === 'amount' ? 'on' : ''}"><input type="radio" name="adj-mode" value="amount" ${modalState.mode === 'amount' ? 'checked' : ''}>
          <span><b>Fixer le montant attendu</b><span class="hint">Pour une entente différente du calcul. Si le reçu est plus bas, la différence reste en arriérés.</span>
          <input type="text" inputmode="decimal" class="num" id="adj-amount" value="${adj && adj.mode === 'amount' ? adj.amount : E.r2(r.received || r.expectedCalc)}" style="max-width:160px;margin-top:6px" aria-label="Montant attendu"></span></label>
      </div>
      <label class="field"><span>Note (facultatif)</span><input type="text" id="adj-note" value="${esc((adj && adj.note) || '')}" placeholder="Ex. : déboursé le 15 juillet, intérêt calculé au prorata par l'emprunteur"></label>`,
      `<div>${adj ? '<button class="btn danger" data-adj-clear>Revenir au calcul</button>' : ''}</div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-adj-save>Enregistrer</button></div>`);
  }

  /* ---------- formulaire de prêt ---------- */
  function openLoanForm(loan, asNew) {
    const l = loan ? JSON.parse(JSON.stringify(loan)) : { id: null, name: '', borrower: '', city: '', dossier: '', maturity: '', closedOn: '', versions: [{ label: 'Prêt initial', from: todayISO, principal: '', rate: 0.12 }] };
    modalState = { kind: 'loan', loan: l, isNew: !loan || asNew, errors: [] };
    renderLoanForm();
  }
  function renderLoanForm() {
    const { loan: l, errors } = modalState;
    const body = `
      <div class="form-grid">
        <label class="field span-2"><span>Nom du prêt</span><input type="text" id="ln-name" value="${esc(l.name)}" placeholder="Ex. : Julie Maisonneuve — Saint-Hippolyte"></label>
        <label class="field span-2"><span>Emprunteur</span><input type="text" id="ln-borrower" value="${esc(l.borrower || '')}"></label>
        <label class="field"><span>Ville</span><input type="text" id="ln-city" value="${esc(l.city || '')}"></label>
        <label class="field"><span>N° de dossier (Terreno)</span><input type="number" id="ln-dossier" value="${l.dossier || ''}"></label>
        <label class="field"><span>Échéance</span><input type="date" id="ln-maturity" value="${l.maturity || ''}"></label>
        <label class="field"><span>Remboursé le</span><input type="date" id="ln-closed" value="${l.closedOn || ''}"></label>
      </div>
      <div><h3>Versions</h3><p class="hint" style="margin:2px 0 8px">Ajoutez une version à chaque augmentation, remboursement partiel ou changement de taux. L'intérêt mensuel est calculé (capital × taux ÷ 12), au prorata des jours pour un mois partiel. Remplissez « Intérêt fixé » seulement si l'entente prévoit un autre montant.</p>
      <div class="splits"><table><thead><tr><th>Nom</th><th>À partir du</th><th class="num">Capital</th><th class="num">Taux (%)</th><th class="num">Intérêt fixé</th><th class="num">Capitalisé / mois</th><th>Note</th><th></th></tr></thead><tbody>
      ${l.versions.map((v, i) => `<tr data-v="${i}">
        <td><input type="text" data-k="label" value="${esc(v.label || '')}" aria-label="Nom de la version"></td>
        <td><input type="date" data-k="from" value="${v.from || ''}" aria-label="Date de début"></td>
        <td><input type="text" inputmode="decimal" class="num" data-k="principal" value="${v.principal === '' ? '' : v.principal}" aria-label="Capital"></td>
        <td><input type="text" inputmode="decimal" class="num" data-k="ratePct" value="${v.rate != null && v.rate !== '' ? E.r2(v.rate * 100 * 1000) / 1000 : ''}" aria-label="Taux"></td>
        <td><input type="text" inputmode="decimal" class="num" data-k="monthly" value="${v.monthly != null ? v.monthly : ''}" placeholder="calculé" aria-label="Intérêt fixé"></td>
        <td><input type="text" inputmode="decimal" class="num" data-k="capitalize" value="${v.capitalize || ''}" aria-label="Capitalisé"></td>
        <td class="wide"><input type="text" data-k="note" value="${esc(v.note || '')}" aria-label="Note"></td>
        <td><button class="icon-btn" data-ver-del="${i}" aria-label="Retirer la version" ${l.versions.length === 1 ? 'disabled' : ''}>×</button></td></tr>`).join('')}
      </tbody></table></div>
      <div style="margin-top:8px"><button class="btn small" data-ver-add>+ Ajouter une version</button></div></div>
      ${errors.length ? `<div class="errors"><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
    const foot = `<div class="hint">Les déboursés et remboursements de capital s'inscrivent comme transactions (catégorie « Prêts hypothécaires à recevoir »).</div><div class="toolbar"><button class="btn" data-close>Annuler</button><button class="btn primary" data-loan-save>${modalState.isNew ? 'Créer le prêt' : 'Enregistrer'}</button></div>`;
    openModal(modalState.isNew ? 'Nouveau prêt' : 'Modifier le prêt', body, foot);
  }
  function readLoanInputs() {
    const l = modalState.loan, v = (id) => $(`#${id}`, modal).value;
    l.name = v('ln-name').trim(); l.borrower = v('ln-borrower').trim(); l.city = v('ln-city').trim();
    l.dossier = v('ln-dossier') ? Number(v('ln-dossier')) : ''; l.maturity = v('ln-maturity'); l.closedOn = v('ln-closed');
    $$('tr[data-v]', modal).forEach((tr) => {
      const x = l.versions[+tr.dataset.v];
      $$('[data-k]', tr).forEach((el) => {
        const k = el.dataset.k, val = el.value.trim();
        if (k === 'ratePct') x.rate = val === '' ? '' : num(val) / 100;
        else if (k === 'principal') x.principal = val === '' ? '' : num(val);
        else if (k === 'monthly') { if (val === '') delete x.monthly; else x.monthly = num(val); }
        else if (k === 'capitalize') { if (val === '' || !num(val)) delete x.capitalize; else x.capitalize = num(val); }
        else x[k] = val;
      });
    });
  }

  /* ---------- événements de la fenêtre ---------- */
  modal.addEventListener('click', (ev) => {
    const t = ev.target; if (!modalState) return;
    if (t.closest('[data-close]')) return closeModal();
    if (modalState.kind === 'adj') {
      const st = modalState, l = loanById(st.loanId);
      if (t.closest('[data-adj-clear]')) { delete (l.adjustments || {})[st.period]; if (l.adjustments && !Object.keys(l.adjustments).length) delete l.adjustments; closeModal(); persist('Calcul rétabli'); return render(); }
      if (t.closest('[data-adj-save]')) {
        const mode = ($('input[name="adj-mode"]:checked', modal) || {}).value || 'settled';
        const o = { mode }, note = $('#adj-note').value.trim();
        if (mode === 'amount') { o.amount = num($('#adj-amount').value); }
        if (note) o.note = note;
        l.adjustments = l.adjustments || {}; l.adjustments[st.period] = o;
        closeModal(); persist('Mois ajusté'); return render();
      }
      return;
    }
    if (modalState.kind === 'bank' && t.closest('[data-bank-save]')) {
      readBankForm(); const st = modalState;
      if (st.counter === CARD_ADV || (st.sel === 'card' && st.counter === undefined)) { ensureCardAdvance(); if (st.counter === undefined) st.counter = CARD_ADV; }
      const id = saveBank(st.id, { name: st.name, kind: st.sel, defaultCounter: st.counter, hidden: st.hidden });
      if (id) { const isNew = !st.id; closeModal(); if (isNew && ui.view === 'bank') { ui.bank.account = id; ui.bank.tab = 'pending'; } render(); }
      return;
    }
    if (modalState.kind === 'tx') {
      const f = modalState;
      readTxInputs();
      if (t.closest('[data-dir]')) { f.dir = t.closest('[data-dir]').dataset.dir; f.suggest = null; return renderTxForm(); }
      if (t.closest('[data-split-add]')) { const rem = E.r2(num(f.amount) - f.splits.reduce((s, x) => s + num(x.amt), 0)); f.splits.push({ acct: f.splits[f.splits.length - 1].acct, loan: '', period: f.splits[f.splits.length - 1].period, memo: '', amt: rem > 0 ? rem : '' }); return renderTxForm(); }
      if (t.closest('[data-split-del]')) { f.splits.splice(+t.closest('[data-split-del]').dataset.splitDel, 1); return renderTxForm(); }
      if (t.closest('[data-line-add]')) { f.lines.push({ acct: '', loan: '', debit: '', credit: '' }); return renderTxForm(); }
      if (t.closest('[data-line-del]')) { f.lines.splice(+t.closest('[data-line-del]').dataset.lineDel, 1); return renderTxForm(); }
      if (t.closest('[data-suggest]')) {
        if (!num(f.amount)) { toast("Indiquez d'abord le montant reçu"); return; }
        const others = { ...data, entries: data.entries.filter((e) => e.id !== f.id) };
        f.suggest = E.suggestSplit(others, num(f.amount), f.date); return renderTxForm();
      }
      if (t.closest('[data-adv-open]')) { f.adv = defaultAdvance(f); f.suggest = null; return renderTxForm(); }
      if (t.closest('[data-adv-close]')) { f.adv = null; return renderTxForm(); }
      if (t.closest('[data-adv-pick]')) { readAdv(); const x = f.adv.detected[+t.closest('[data-adv-pick]').dataset.advPick]; Object.assign(f.adv, { loan: x.loan, from: x.from, months: x.months, per: x.perMonth }); return renderTxForm(); }
      if (t.closest('[data-adv-apply]')) {
        readAdv(); const a = f.adv, isExp = a.kind === 'expense';
        if (!isExp && !a.loan) { toast('Choisissez le prêt'); return; }
        if (isExp && !a.acct) { toast('Choisissez la catégorie'); return; }
        if (!a.from) { toast('Choisissez le premier mois couvert'); return; }
        const per = num(a.per), n = Number(a.months), amount = num(f.amount);
        if (!(per > 0)) { toast('Indiquez le montant par mois'); return; }
        const total = E.r2(per * n);
        const lines = E.advanceSplits(a.loan || '', a.from, n, per, Math.abs(total - amount) < 0.05 ? amount : total)
          .map((x) => (isExp ? { acct: a.acct, loan: '', period: x.period, memo: '', amt: x.amt } : { ...x, memo: '' }));
        const rest = E.r2(amount - lines.reduce((s2, x) => s2 + x.amt, 0));
        f.splits = lines.concat(rest > 0.004 ? [{ acct: '', loan: '', period: '', memo: '', amt: rest }] : []);
        f.adv = null; toast(rest > 0.004 ? `Réparti sur ${n} mois — il reste ${m(rest)} à ventiler` : `Réparti sur ${n} mois`); return renderTxForm();
      }
      if (t.closest('[data-apply]')) {
        const o = f.suggest.options[+t.closest('[data-apply]').dataset.apply];
        f.splits = o.map((x) => ({ acct: 'rev:interest', loan: x.loan, period: x.period, memo: '', amt: x.amt })); f.suggest = null; return renderTxForm();
      }
      if (t.closest('[data-tx-dup]')) { const c = duplicateForm(f); modalState = { ...c, kind: 'tx' }; renderTxForm(); toast('Copie créée — vérifiez le montant, puis ajoutez'); return; }
      if (t.closest('[data-tx-del]')) {
        const b = t.closest('[data-tx-del]');
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmer la suppression'; return; }
        data.entries = data.entries.filter((e) => e.id !== f.id); closeModal(); persist('Transaction supprimée'); return render();
      }
      if (t.closest('[data-tx-save]')) {
        const e = buildEntry();
        const errs = E.validateEntry(e, data).map((x) => x.replace('compte inconnu', 'choisir une catégorie'));
        if (f.mode === 'bank' && !num(f.amount)) errs.unshift('Indiquez le montant');
        e.lines.forEach((l, i) => { if (l.acct === 'rev:interest' && !l.period) errs.push(`Ligne ${i}: indiquez le mois couvert par l'intérêt`); });
        f.errors = Array.from(new Set(errs));
        if (f.errors.length) return renderTxForm();
        const i = data.entries.findIndex((x) => x.id === e.id);
        if (i >= 0) data.entries[i] = e; else data.entries.push(e);
        data.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        const cb = f.onSaved; closeModal(); if (cb) cb(e); persist(i >= 0 ? 'Transaction modifiée' : 'Transaction ajoutée'); render();
      }
    } else if (modalState.kind === 'loan') {
      readLoanInputs();
      const l = modalState.loan;
      if (t.closest('[data-ver-add]')) { const last = l.versions[l.versions.length - 1]; l.versions.push({ label: `Modification #${l.versions.length}`, from: todayISO, principal: last.principal, rate: last.rate }); return renderLoanForm(); }
      if (t.closest('[data-ver-del]')) { l.versions.splice(+t.closest('[data-ver-del]').dataset.verDel, 1); return renderLoanForm(); }
      if (t.closest('[data-loan-save]')) {
        const errs = [];
        if (!l.name) errs.push('Indiquez le nom du prêt');
        l.versions.forEach((v, i) => { if (!v.from) errs.push(`Version ${i + 1} : date manquante`); if (!(v.principal > 0)) errs.push(`Version ${i + 1} : capital manquant`); if (!(v.rate >= 0) || v.rate === '') errs.push(`Version ${i + 1} : taux manquant`); });
        modalState.errors = errs; if (errs.length) return renderLoanForm();
        l.versions.sort((a, b) => a.from.localeCompare(b.from));
        ['maturity', 'closedOn', 'dossier', 'city', 'borrower'].forEach((k) => { if (l[k] === '' || l[k] == null) delete l[k]; });
        if (modalState.isNew) { let id = slug(l.name); while (loanById(id)) id += '-2'; l.id = id; data.loans.push(l); }
        else { const i = data.loans.findIndex((x) => x.id === l.id); data.loans[i] = l; }
        const id = l.id; closeModal(); persist('Prêt enregistré'); go('loans', { loanId: id });
      }
    }
  });
  modal.addEventListener('change', (ev) => {
    if (modalState && modalState.kind === 'bank' && ev.target.name === 'nb-kind') { readBankForm(); return renderBankForm(); }
    if (modalState && modalState.kind === 'tx' && modalState.adv && ['adv-loan', 'adv-months', 'adv-from'].includes(ev.target.id)) {
      const f = modalState, before = { ...f.adv }; readAdv();
      if (ev.target.id === 'adv-loan' && f.adv.loan) f.adv.from = firstOpenMonth({ ...data, entries: data.entries.filter((e) => e.id !== f.id) }, f.adv.loan, f.date);
      if (ev.target.id === 'adv-months' && num(f.amount) && (!before.per || Math.abs(num(before.per) * before.months - num(f.amount)) < 0.05)) f.adv.per = E.r2(num(f.amount) / f.adv.months);
      return renderTxForm();
    }
    if (modalState && modalState.kind === 'adj' && ev.target.name === 'adj-mode') { $$('.kind', modal).forEach((k) => k.classList.toggle('on', k.querySelector('input').checked)); return; }
    if (!modalState || modalState.kind !== 'tx') return;
    const t = ev.target, f = modalState;
    readTxInputs();
    if (t.id === 'tx-account') {
      if (t.value === '__journal') { f.mode = 'journal'; }
      else {
        if (f.mode === 'journal') f.mode = 'bank';
        f.account = t.value; f.counter = defaultCounter(f.account, f.splits);
      }
      return renderTxForm();
    }
    if (t.dataset.k === 'acct') {
      const tr = t.closest('tr'), row = tr.dataset.i != null ? f.splits[+tr.dataset.i] : f.lines[+tr.dataset.j];
      const a = acc(row.acct) || {};
      if (!a.perLoan) row.loan = '';
      if (!hasPeriod(row.acct)) row.period = '';
      else if (!row.period) row.period = defaultPeriod(row.acct, f.date);
      if (f.mode === 'bank' && isPersonal(f.account)) f.counter = defaultCounter(f.account, f.splits);
      f.suggest = null;
      return renderTxForm();
    }
  });
  // Les montants se mettent à jour sans redessiner la fenêtre (sinon le premier clic sur « Enregistrer » serait perdu)
  modal.addEventListener('input', (ev) => {
    if (!modalState || modalState.kind !== 'tx') return;
    const t = ev.target;
    if (!(t.dataset.k === 'amt' || t.id === 'tx-amount' || t.dataset.k === 'debit' || t.dataset.k === 'credit')) return;
    readTxInputs(); updateRemain();
  });
  function updateRemain() {
    const f = modalState, el = $('#remain-text', modal); if (!el) return;
    if (f.mode === 'journal') {
      const dt = E.r2(f.lines.reduce((s, l) => s + num(l.debit), 0)), ct = E.r2(f.lines.reduce((s, l) => s + num(l.credit), 0));
      el.innerHTML = `Débits ${m(dt)} · Crédits ${m(ct)} · ${Math.abs(dt - ct) < 0.005 ? '<span class="ok">balancé ✓</span>' : `<span class="ko">écart ${m(dt - ct)}</span>`}`;
    } else {
      const total = E.r2(f.splits.reduce((s, x) => s + num(x.amt), 0));
      const effective = f.splits.length === 1 && String(f.splits[0].amt).trim() === '' ? num(f.amount) : total;
      const remain = E.r2(num(f.amount) - effective);
      el.innerHTML = `Ventilé ${m(effective)} · ${Math.abs(remain) < 0.005 ? '<span class="ok">balancé ✓</span>' : `<span class="ko">reste ${m(remain)}</span>`}`;
    }
  }

  /* ---------------------------------------------------------------- pont pour les outils clients (js/tools.js) */
  window.TF = {
    get data() { return data; }, ui, E, esc, m, m0, d, PCT, kpi, toast, render, persist, saveUi, todayISO, loanById, netEquity, go, openLoanForm, pill, STATUS, loanSummary, loanShort, openTxForm, $, $$, modal,
    openModal, closeModal, get modalState() { return modalState; }, set modalState(v) { modalState = v; },
  };

  /* ---------------------------------------------------------------- démarrage */
  $('#entity-name').textContent = data.entity || '';
  render();
})();

