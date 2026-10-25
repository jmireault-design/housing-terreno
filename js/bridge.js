/* =====================================================================
   bridge.js — pont entre Terreno (carte : state.loans / state.properties)
   et Terreno Finances (window.TF : prêts, transactions, calendriers).
   -----------------------------------------------------------------
   Terreno (carte) est la source des DOSSIERS et des IMMEUBLES.
   Ce module expose :
     window.TFDossiers — l'API attendue par Terreno Finances (onglet « Dossiers
       et immeubles », encadré dossier d'un prêt, lettres d'approbation),
       calculée à partir de state.loans / state.properties de Terreno.
     window.TMap — ce que les vues Finances appellent pour parler à la carte.
   Et il greffe dans Terreno : un bloc « Finances » dans le panneau d'un prêt
   ou d'un immeuble, une couleur « Paiement en retard » sur les pins, et le
   rafraîchissement des finances quand on modifie un dossier sur la carte.
   ===================================================================== */
(function (root) {
  'use strict';
  const T = () => root.TF;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; };
  const MONEY0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const m0 = (x) => MONEY0.format(x || 0);
  const PCT0 = new Intl.NumberFormat('fr-CA', { style: 'percent', maximumFractionDigits: 0 });
  const mobile = () => window.innerWidth <= 900;
  const hasTerreno = () => typeof state !== 'undefined' && Array.isArray(state.loans);
  const loaded = () => hasTerreno() && state.loans.length + state.properties.length > 0;
  const setMode = (m) => { if (root.TerrenoApp) root.TerrenoApp.setMode(m); };

  /* ================================================================ adaptateur Terreno → schéma « dossiers / immeubles » */
  const DOS_STATUS = { active: 'Actif', verified: 'Actif', high: 'Actif', missing: 'Actif', pending: 'En analyse', released: 'Remboursé', refused: 'Dossier refusé', new: 'En analyse' };
  const LIVE = new Set(['active', 'verified', 'high', 'missing']);
  const dossierNo = (id) => { const n = parseInt(String(id || '').replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
  const dossierName = (l) => {
    const first = String(l.notes || '').split('\n')[0].trim();
    if (/^(Prêt|Dossier|Marge|Hypothèque)/i.test(first) && first.length < 70) return first;
    return `Prêt ${l.borrower || l.id}`;
  };
  function lotInfo(p) { return typeof getLotInfo === 'function' ? getLotInfo(p) : { lotNumber: p.lotNumber || '', matricule: p.matricule || '', postalCode: p.postalCode || '' }; }
  function toDossier(l) {
    const ranks = [...new Set((l.collateral || []).map((c) => c.rank).filter(Boolean))];
    const custom = (typeof CONFIG !== 'undefined' && CONFIG.statusMap[l.status]) ? CONFIG.statusMap[l.status].label : '';
    return { id: l.id, no: dossierNo(l.id), name: dossierName(l), contact: l.borrower || '', lender: l.lender || '', type: l.type || '', rank: ranks.join(' + '),
      amount: num(l.principal), balance: num(l.balance), start: l.startDate || '', maturity: l.maturity || '', rate: l.rate ?? '', rateAfter: l.rateAfterMaturity ?? '',
      termMonths: l.termMonths ?? '', minMonths: l.minInterestMonths ?? '', status: DOS_STATUS[l.status] || custom || 'Actif', tStatus: l.status, risk: l.risk || '',
      referrer: l.referredBy || '', properties: (l.collateral || []).map((c) => c.propertyId), collateral: l.collateral || [], notes: l.notes || '', docs: l.docs || {} };
  }
  function toProperty(p) {
    const li = lotInfo(p);
    return { id: p.id, address: p.addr || '', city: p.city || '', province: 'Québec', postal: li.postalCode || '', type: p.type || '', owner: p.owner || '',
      value: p.value != null ? num(p.value) : null, yearBuilt: p.yearBuilt || null, lot: li.lotNumber || '', matricule: li.matricule || '', notes: p.notes || '',
      lat: p.lat, lng: p.lng, geo: p.lat != null && p.lng != null ? 'exact' : 'none', neighborhood: p.neighborhood || '', assessment: p.assessment || 0, floodZone: p.floodZone || '' };
  }
  let DER = { key: '', dossiers: [], properties: [] };
  function ensure() {
    const d = T() ? T().data : null;
    if (!hasTerreno()) { if (d) { d.dossiers = d.dossiers || []; d.properties = d.properties || []; } return d || { dossiers: [], properties: [] }; }
    const key = `${state.loans.length}|${state.properties.length}|${derivedVersion}`;
    if (key !== DER.key) { DER = { key, dossiers: state.loans.map(toDossier), properties: state.properties.map(toProperty) }; }
    if (d) { d.dossiers = DER.dossiers; d.properties = DER.properties; }
    return d || DER;
  }
  let derivedVersion = 0;
  const invalidate = () => { derivedVersion++; FIN = null; };
  const dossiers = () => ensure().dossiers, properties = () => ensure().properties;
  const propById = (id) => properties().find((p) => p.id === id);
  const dossierById = (id) => dossiers().find((x) => x.id === id);
  const dossiersOfProp = (pid) => dossiers().filter((x) => (x.properties || []).includes(pid));
  const isLiveDs = (ds) => LIVE.has(ds.tStatus);
  // prêt Terreno Finances relié à un dossier : par n° de dossier
  function loanOf(ds) { const L = T().data.loans; return (ds.no != null && L.find((l) => Number(l.dossier) === Number(ds.no))) || (ds.loanId && L.find((l) => l.id === ds.loanId)) || null; }
  function dossierOfLoan(loan) { return loan.dossier ? dossiers().find((x) => Number(x.no) === Number(loan.dossier)) || null : null; }
  const stClass = (st) => ({ 'Actif': 'paid', 'Remboursé': 'none', 'En analyse': 'upcoming', 'Approuvé — en attente': 'upcoming', 'Dossier refusé': 'late', 'Abandonné': 'none' }[st] || 'none');
  const dueStatus = (sm) => { if (sm.status === 'closed') return 'closed'; const r = sm.s.rows.filter((x) => x.period < T().todayISO.slice(0, 7) && x.status !== 'upcoming').pop(); return r ? r.status : (sm.status === 'future' ? 'future' : 'upcoming'); };

  /* ================================================================ calculs financiers par dossier et par immeuble (cache) */
  let FIN = null, FIN_KEY = '';
  function finAll() {
    const Tf = T(); if (!Tf) return { byDossier: {}, byProp: {} };
    const key = `${Tf.data.updatedAt || ''}|${derivedVersion}|${Tf.todayISO}|${Tf.data.loans.length}`;
    if (FIN && key === FIN_KEY) return FIN;
    FIN_KEY = key; FIN = { byDossier: {}, byProp: {} };
    const sums = {}; for (const l of Tf.data.loans) sums[l.id] = Tf.loanSummary(l);
    for (const ds of dossiers()) { const l = loanOf(ds); FIN.byDossier[ds.id] = { ds, l, sm: l ? sums[l.id] : null }; }
    for (const p of properties()) {
      const items = dossiersOfProp(p.id).map((ds) => ({ ...FIN.byDossier[ds.id], share: 1 / Math.max(1, (ds.properties || []).length) }));
      const live = items.filter((x) => (x.sm ? x.sm.status !== 'closed' : isLiveDs(x.ds)) && x.ds.tStatus !== 'released' && x.ds.tStatus !== 'refused');
      const withLoan = live.filter((x) => x.sm);
      const balance = live.reduce((s, x) => s + (x.sm ? x.sm.s.ledgerBalance : num(x.ds.amount)) * x.share, 0);
      const arrears = withLoan.reduce((s, x) => s + x.sm.s.totals.arrears, 0);
      const monthly = withLoan.reduce((s, x) => s + ((x.sm.cur && x.sm.cur.expected) || 0), 0);
      const late = withLoan.some((x) => x.sm.s.rows.some((r) => r.status === 'late'));
      const partial = !late && (withLoan.some((x) => x.sm.s.rows.some((r) => r.status === 'partial')) || arrears > 0.5);
      FIN.byProp[p.id] = { p, items, live, withLoan, balance, arrears, monthly, late, partial, ltv: num(p.value) > 0 && balance > 0 ? balance / num(p.value) : null };
    }
    return FIN;
  }
  const finProp = (id) => finAll().byProp[id] || { items: [], live: [], withLoan: [], balance: 0, arrears: 0, monthly: 0, ltv: null };

  /* ================================================================ Terreno : couleur « paiement en retard » sur la carte */
  if (typeof CONFIG !== 'undefined' && CONFIG.statusMap && !CONFIG.statusMap.late) {
    CONFIG.statusMap.late = { color: '#C8302A', icon: 'ti-alert-octagon', label: 'Paiement en retard', badge: 'gt-b-high' };
  }
  if (typeof propertyStatus === 'function') {
    const base = propertyStatus;
    root.propertyStatus = function (propertyId) {
      try { if (T() && loaded()) { const f = finAll().byProp[propertyId]; if (f && f.late) return 'late'; } } catch (e) { /* rien */ }
      return base(propertyId);
    };
  }

  /* ================================================================ liens carte → finances (blocs injectés dans les panneaux Terreno) */
  function financeBlockForDossier(dsId, compact) {
    const Tf = T(); if (!Tf) return '';
    const f = finAll().byDossier[dsId]; if (!f) return '';
    const ds = f.ds;
    if (!f.l) {
      const canCreate = num(ds.amount) > 0 && isLiveDs(ds);
      return `<div class="gt-section-title">Finances</div><div class="tb-fin"><div class="tb-fin-row muted">Aucun prêt Terreno Finances ne porte le n° de dossier ${ds.no != null ? String(ds.no).padStart(3, '0') : '—'}.</div>
        <div class="tb-fin-actions">${canCreate ? `<button type="button" class="gt-secondary-btn" data-action="create-loan-fin" data-id="${ds.id}"><i class="ti ti-plus"></i> Créer le prêt dans Finances</button>` : ''}<button type="button" class="gt-secondary-btn" data-action="go" data-view="loans"><i class="ti ti-coin"></i> Ouvrir Finances</button></div></div>`;
    }
    const l = f.l, sm = f.sm, s = sm.s, PCT = Tf.PCT, m = Tf.m;
    const y = Tf.todayISO.slice(0, 4);
    const rev = Tf.E.loanRevenue(Tf.data, `${y}-01-01`, `${y}-12-31`, 'cash', Tf.todayISO).rows.find((r) => r.loan === l.id);
    const strip = s.rows.filter((r) => r.period <= Tf.todayISO.slice(0, 7)).slice(-12);
    return `<div class="gt-section-title">Finances — ${esc(l.name.split(' — ')[0])}</div>
      <div class="tb-fin">
        <div class="gt-stat-grid">
          <div class="gt-stat"><div class="gt-stat-label">Solde (grand livre)</div><div class="gt-stat-val">${m0(s.ledgerBalance)}</div></div>
          <div class="gt-stat"><div class="gt-stat-label">Dernier mois dû</div><div class="gt-stat-val">${Tf.pill(dueStatus(sm))}</div></div>
          <div class="gt-stat"><div class="gt-stat-label">Arriérés</div><div class="gt-stat-val" style="${s.totals.arrears > 0.5 ? 'color:#C8302A' : ''}">${m(s.totals.arrears)}</div></div>
          <div class="gt-stat"><div class="gt-stat-label">Intérêts ${y}</div><div class="gt-stat-val">${m0(rev ? rev.revenue : 0)}</div></div>
        </div>
        <div class="months-strip tb-strip" title="12 derniers mois d'intérêt">${strip.map((r) => `<span class="${r.status}" title="${r.label} · ${Tf.STATUS[r.status]}"></span>`).join('')}</div>
        <div class="tb-fin-row">${sm.cur && sm.cur.rate != null ? `${PCT.format(sm.cur.rate)} · ${m(sm.cur.expected)} / mois` : ''}${l.maturity ? ` · échéance ${Tf.d(l.maturity)}` : ''}${l.closedOn ? ` · remboursé le ${Tf.d(l.closedOn)}` : ''}</div>
        <div class="tb-fin-actions">
          <button type="button" class="gt-edit-btn-accent" data-action="open-loan" data-id="${l.id}"><i class="ti ti-coin"></i> Ouvrir dans Finances</button>
          <button type="button" class="gt-secondary-btn" data-action="new-tx-loan" data-id="${l.id}"><i class="ti ti-plus"></i> Paiement reçu</button>
          <button type="button" class="gt-secondary-btn" data-action="loan-statement" data-id="${l.id}"><i class="ti ti-file-text"></i> État de compte</button>
        </div>
      </div>`;
  }
  function financeBlockForProperty(pid) {
    const Tf = T(); if (!Tf) return '';
    const f = finProp(pid); if (!f.items.length) return '';
    const rows = f.items.map((x) => x.l
      ? `<div class="tb-fin-loan"><span>${esc(x.l.name.split(' — ')[0])}<br><small>${m0(x.sm.s.ledgerBalance)}${x.sm.cur && x.sm.cur.rate != null ? ` · ${Tf.PCT.format(x.sm.cur.rate)}` : ''}${x.sm.s.totals.arrears > 0.5 ? ` · <b style="color:#C8302A">${Tf.m(x.sm.s.totals.arrears)} en retard</b>` : ''}</small></span><span>${Tf.pill(dueStatus(x.sm))} <button type="button" class="gt-secondary-btn tb-mini" data-action="open-loan" data-id="${x.l.id}">Finances</button></span></div>`
      : `<div class="tb-fin-loan"><span>${esc(x.ds.name)}<br><small>${esc(x.ds.status)}${num(x.ds.amount) ? ` · ${m0(num(x.ds.amount))}` : ''}</small></span><span class="muted small">sans prêt Finances</span></div>`).join('');
    return `<div class="gt-section-title">Finances</div><div class="tb-fin">
      <div class="gt-stat-grid">
        <div class="gt-stat"><div class="gt-stat-label">Capital garanti</div><div class="gt-stat-val">${m0(f.balance)}</div></div>
        <div class="gt-stat"><div class="gt-stat-label">LTV</div><div class="gt-stat-val">${f.ltv != null ? PCT0.format(f.ltv) : '—'}</div></div>
        <div class="gt-stat"><div class="gt-stat-label">Intérêt / mois</div><div class="gt-stat-val">${m0(f.monthly)}</div></div>
        <div class="gt-stat"><div class="gt-stat-label">Arriérés</div><div class="gt-stat-val" style="${f.arrears > 0.5 ? 'color:#C8302A' : ''}">${m0(f.arrears)}</div></div>
      </div>${rows}
      <div class="tb-fin-actions"><button type="button" class="gt-secondary-btn" data-action="open-property" data-id="${pid}"><i class="ti ti-building"></i> Dossier immeuble (Finances)</button></div></div>`;
  }
  function injectIntoPanel() {
    if (!T() || typeof state === 'undefined') return;
    const panel = $('#panel-content'); if (!panel || !state.selectedId || state.editing) return;
    const anchor = panel.querySelector('.gt-stat-grid') || panel.querySelector('.gt-panel-addr');
    const html = state.selectedType === 'loan' ? financeBlockForDossier(state.selectedId) : state.selectedType === 'property' ? financeBlockForProperty(state.selectedId) : '';
    if (!html) return;
    const wrap = document.createElement('div'); wrap.className = 'tb-fin-wrap'; wrap.innerHTML = html;
    if (anchor) anchor.insertAdjacentElement('afterend', wrap); else panel.appendChild(wrap);
  }
  if (typeof renderPanel === 'function') { const base = renderPanel; root.renderPanel = function () { base.apply(this, arguments); try { injectIntoPanel(); } catch (e) { console.warn('Terreno bridge: bloc finances non affiché', e); } }; }
  if (typeof openLoanProfilePage === 'function') {
    const base = openLoanProfilePage;
    root.openLoanProfilePage = function (loanId) {
      base.apply(this, arguments);
      try { const c = $('#loan-profile-content'); const html = financeBlockForDossier(loanId); if (c && html) { const w = document.createElement('div'); w.className = 'tb-fin-wrap tb-fin-profile'; w.innerHTML = html; const a = c.querySelector('.gt-lp-header') || c.firstElementChild; if (a) a.insertAdjacentElement('afterend', w); else c.appendChild(w); } } catch (e) { /* rien */ }
    };
  }
  // clics dans les blocs Finances des panneaux Terreno
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('#map-col [data-action], #loan-profile-overlay [data-action]'); if (!t || !T()) return;
    const a = t.dataset.action, id = t.dataset.id, Tf = T();
    if (a === 'open-loan') { Tf.go('loans', { loanId: id }); if (mobile()) setMode('fin'); if (typeof closeLoanProfilePage === 'function') closeLoanProfilePage(); }
    else if (a === 'go') { Tf.go(t.dataset.view, { loanId: null }); if (mobile()) setMode('fin'); if (typeof closeLoanProfilePage === 'function') closeLoanProfilePage(); }
    else if (a === 'new-tx-loan') Tf.openTxForm(null, { loan: id });
    else if (a === 'loan-statement') root.TFTools.openStatement(id);
    else if (a === 'open-property') { Tf.go('property', { propertyId: id, loanId: null }); if (mobile()) setMode('fin'); }
    else if (a === 'create-loan-fin') { const ds = dossierById(id); if (ds) createLoanFrom(ds); if (mobile()) setMode('fin'); }
    else return;
    ev.preventDefault();
  });

  /* ================================================================ Terreno → Finances : rafraîchir quand un dossier ou un immeuble change */
  let rt;
  const refreshFinances = () => { invalidate(); clearTimeout(rt); rt = setTimeout(() => { if (T() && (!T().modalState)) T().render(); }, 250); };
  ['saveLoanOverride', 'savePropertyOverride', 'markLoanDeleted', 'markPropertyDeleted'].forEach((fn) => {
    if (typeof root[fn] === 'function') { const base = root[fn]; root[fn] = function () { const r = base.apply(this, arguments); refreshFinances(); return r; }; }
  });
  if (typeof buildIndexes === 'function') { const base = buildIndexes; root.buildIndexes = function () { base.apply(this, arguments); invalidate(); }; }
  if (typeof loadData === 'function') {
    const base = loadData;
    root.loadData = async function () { await base.apply(this, arguments); invalidate(); onTerrenoReady(); };
  }
  let terrenoReady = false;
  function onTerrenoReady() {
    terrenoReady = true; syncTheme();
    addLateLegend();
    if (T()) { T().render(); }
  }
  function addLateLegend() {
    const leg = $('#map-col .gt-legend'); if (leg && !leg.querySelector('[data-late]')) {
      const row = document.createElement('div'); row.className = 'gt-legend-row'; row.dataset.late = '1';
      row.innerHTML = '<span class="gt-legend-dot" style="background:#C8302A"></span>Paiement en retard (Finances)';
      const cluster = leg.querySelector('.gt-legend-cluster'); if (cluster) leg.insertBefore(row, cluster); else leg.appendChild(row);
    }
    const first = $('#map-col .gt-filters .gt-chip[data-f="status"]'); const chips = first && first.parentElement;
    if (chips && !chips.querySelector('[data-v="late"]')) {
      const c = document.createElement('span'); c.className = 'gt-chip'; c.dataset.f = 'status'; c.dataset.v = 'late'; c.textContent = 'Paiement en retard';
      chips.appendChild(c);
      c.addEventListener('click', () => { chips.querySelectorAll('.gt-chip').forEach((x) => x.classList.remove('active')); c.classList.add('active'); state.filters.status = 'late'; refreshMap(); });
    }
  }

  /* ================================================================ thème : Finances (data-theme / système) → Terreno (body.dark-theme) */
  function isDarkFinances() {
    const a = document.documentElement.getAttribute('data-theme');
    if (a === 'dark') return true; if (a === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncTheme() { const dark = isDarkFinances(); document.body.classList.toggle('dark-theme', dark); }
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', syncTheme) : mq.addListener(syncTheme)); }
  document.addEventListener('DOMContentLoaded', () => setTimeout(syncTheme, 0));

  /* ================================================================ création d'un prêt Finances à partir d'un dossier Terreno */
  function createLoanFrom(ds) {
    const t = T(), p = (ds.properties || []).map(propById).filter(Boolean)[0];
    const name = `${(p && p.address) || ds.name}${ds.contact ? ` — ${ds.contact}` : ''}`;
    const loan = { id: null, name, borrower: ds.contact || '', city: (p && p.city) || '', dossier: ds.no || '', maturity: ds.maturity || '', closedOn: '', versions: [{ label: 'Prêt initial', from: ds.start || t.todayISO, principal: num(ds.amount) || '', rate: ds.rate !== '' && ds.rate != null ? num(ds.rate) / 100 : 0.12 }] };
    t.modalState = null; t.openLoanForm(loan, true);
  }

  /* ================================================================ actions carte demandées par les vues Finances */
  function showLoanOnMap(dsId) {
    if (!loaded() || typeof state === 'undefined') { if (T()) T().toast('Carte non chargée'); return; }
    if (!state.loanMap[dsId]) { if (T()) T().toast('Ce dossier n\'existe pas sur la carte'); return; }
    if (mobile()) setMode('map');
    if (typeof closeLoanProfilePage === 'function') closeLoanProfilePage();
    if (typeof clearSearchHighlight === 'function') clearSearchHighlight();
    if (typeof clearSelectedParcelHighlight === 'function') clearSelectedParcelHighlight();
    state.selectedType = 'loan'; state.selectedId = dsId; state.editing = false; state.searchResult = null;
    if (typeof inlineEditingCollateralIds !== 'undefined') inlineEditingCollateralIds.clear();
    frameLoanCollateral(dsId); renderPanel();
  }
  function showPropertyOnMap(pid) {
    if (!loaded() || typeof state === 'undefined' || !state.propertyMap[pid]) { if (T()) T().toast('Immeuble introuvable sur la carte'); return; }
    if (mobile()) setMode('map');
    if (typeof closeLoanProfilePage === 'function') closeLoanProfilePage();
    selectProperty(pid);
  }
  function flyToCity(city) {
    if (!loaded() || typeof map === 'undefined' || !map) return;
    const ps = state.properties.filter((p) => (p.city || 'Ville inconnue') === city && p.lat != null);
    if (!ps.length) return T().toast('Aucun immeuble positionné dans cette ville');
    if (mobile()) setMode('map');
    switchView('map');
    if (ps.length === 1) map.flyTo({ center: [ps[0].lng, ps[0].lat], zoom: 14, duration: 800 });
    else { const b = new mapboxgl.LngLatBounds(); ps.forEach((p) => b.extend([p.lng, p.lat])); map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 800 }); }
  }
  let lastFocusLoan = null, lastPropView = null;
  function onFinanceRender() {
    if (!T()) return;
    const ui = T().ui;
    if (loaded() && typeof refreshMap === 'function' && typeof map !== 'undefined' && map) { try { refreshMap(); } catch (e) { /* rien */ } }
    if (ui.view === 'loans' && ui.loanId) {
      if (lastFocusLoan !== ui.loanId) { lastFocusLoan = ui.loanId; const l = T().loanById(ui.loanId); const ds = l && dossierOfLoan(l); if (ds && loaded() && document.body.dataset.mode !== 'fin') showLoanOnMap(ds.id); }
    } else if (ui.view === 'property' && ui.propertyId) {
      if (lastPropView !== ui.propertyId) { lastPropView = ui.propertyId; if (loaded() && document.body.dataset.mode !== 'fin') showPropertyOnMap(ui.propertyId); }
    } else { lastFocusLoan = null; lastPropView = null; }
  }
  function handleAction(a, t) {
    const Tf = T(); const id = t.dataset.id;
    switch (a) {
      case 'locate-loan': { const l = Tf.loanById(id); const ds = l && dossierOfLoan(l); if (!ds) { Tf.toast(`Aucun dossier Terreno n° ${l && l.dossier ? l.dossier : '—'} : indiquez le n° de dossier dans « Modifier le prêt ».`); return true; } showLoanOnMap(ds.id); return true; }
      case 'locate-dossier': case 'open-dossier-map': showLoanOnMap(id); return true;
      case 'map-prop': showPropertyOnMap(id); return true;
      case 'map-city': flyToCity(t.dataset.city); return true;
      case 'open-property': Tf.go('property', { propertyId: id, loanId: null }); return true;
      case 'edit-prop-map': showPropertyOnMap(id); setTimeout(() => { const b = $('#edit-property-btn'); if (b) b.click(); }, 900); return true;
      case 'edit-dossier-map': showLoanOnMap(id); setTimeout(() => { const b = $('#edit-loan-btn'); if (b) b.click(); }, 900); return true;
      case 'new-dossier-map': if (mobile()) setMode('map'); if (typeof createNewLoan === 'function') { switchView('map'); createNewLoan(); } return true;
      case 'new-prop-map': if (mobile()) setMode('map'); if (typeof createNewProperty === 'function') { switchView('map'); createNewProperty(); } return true;
      case 'create-loan': { const ds = dossierById(id); if (ds) createLoanFrom(ds); return true; }
      default: return false;
    }
  }

  /* ================================================================ vues Finances : onglet « Dossiers et immeubles » */
  let UI = (() => { try { return Object.assign({ tab: 'dossiers', status: 'all', q: '', pq: '', pfilter: 'all', sort: 'no' }, JSON.parse(sessionStorage.getItem('tf.dos') || '{}')); } catch (e) { return { tab: 'dossiers', status: 'all', q: '', pq: '', pfilter: 'all', sort: 'no' }; } })();
  const saveUi = () => { try { sessionStorage.setItem('tf.dos', JSON.stringify(UI)); } catch (e) { /* rien */ } };
  const STATUSES = ['Actif', 'Remboursé', 'En analyse', 'Dossier refusé'];
  const propLabel = (p) => `${p.address}${p.city ? `, ${p.city}` : ''}`;
  const geoBadge = (p) => p.lat == null ? '<span class="geo-badge none">⌖ sans position</span>' : '<span class="geo-badge">⌖ sur la carte</span>';
  const geoCell = (p) => `<button class="btn ghost small" data-action="map-prop" data-id="${p.id}" ${p.lat == null ? 'disabled' : ''}>⌖ Carte</button>`;
  const ltvBar = (f) => f.ltv == null ? '<span class="muted">—</span>' : `<span class="ltv"><span class="ltv-bar"><span class="${f.ltv > 0.8 ? 'vhi' : f.ltv > 0.65 ? 'hi' : ''}" style="width:${Math.min(100, f.ltv * 100)}%"></span></span><span class="num">${PCT0.format(f.ltv)}</span></span>`;

  function view() {
    ensure();
    const t = T(), { esc: e } = t;
    if (!loaded()) return `<div class="section-head"><div><h1>Dossiers et immeubles</h1><div class="sub">Les dossiers et les immeubles viennent de la carte Terreno.</div></div></div><div class="empty">${terrenoReady ? 'Aucun dossier chargé : vérifiez data/loans.json et data/properties.json.' : 'Chargement des données de la carte…'}</div>`;
    const seg = `<div class="seg big" role="tablist">${[['dossiers', `Dossiers (${dossiers().length})`], ['props', `Immeubles (${properties().length})`]].map(([k, l]) => `<button role="tab" data-action="dos-tab" data-k="${k}" class="${UI.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="section-head"><div><h1>Dossiers et immeubles</h1><div class="sub">Les dossiers de prêt et les immeubles de la carte Terreno, reliés aux prêts de Finances par le n° de dossier. Pour modifier un dossier ou un immeuble, ouvrez-le sur la carte.</div></div>
      <div class="toolbar">${seg}</div></div>
      ${UI.tab === 'props' ? propsView() : dossiersView()}`;
  }
  function dossiersView() {
    const t = T(), { esc: e, m0: M0, d, PCT, pill } = t; const F = finAll();
    const q = UI.q.trim().toLowerCase();
    let list = dossiers().filter((x) => (UI.status === 'all' || (UI.status === 'live' ? isLiveDs(x) : x.status === UI.status))
      && (!q || [x.no, x.name, x.contact, x.lender, x.referrer, x.notes, ...(x.properties || []).map((id) => propLabel(propById(id) || {}))].join(' ').toLowerCase().includes(q)));
    const key = { no: (x) => x.no == null ? 9999 : Number(x.no), name: (x) => x.name.toLowerCase(), amount: (x) => -num(x.amount), start: (x) => x.start || '9999', maturity: (x) => x.maturity || '9999', status: (x) => STATUSES.indexOf(x.status) }[UI.sort] || ((x) => Number(x.no) || 9999);
    list.sort((a, b) => { const A = key(a), B = key(b); return A < B ? -1 : A > B ? 1 : 0; });
    const live = dossiers().filter(isLiveDs), liveAmt = live.reduce((a, x) => a + num(x.amount), 0);
    const unlinkedLoans = t.data.loans.filter((l) => !dossierOfLoan(l));
    const th = (k, l, cls = '') => `<th class="${cls} sortable" data-action="dos-sort" data-k="${k}">${l}${UI.sort === k ? ' ↑' : ''}</th>`;
    const opt = (v, l) => `<option value="${v}" ${UI.status === v ? 'selected' : ''}>${l}</option>`;
    return `
    <div class="kpis">
      ${t.kpi('Dossiers actifs', String(live.length), `${M0(liveAmt)} financés (tous prêteurs)`)}
      ${t.kpi('Reliés à un prêt Finances', String(dossiers().filter((x) => loanOf(x)).length), unlinkedLoans.length ? `${unlinkedLoans.length} prêt(s) Finances sans dossier` : 'Tous les prêts Finances ont un dossier')}
      ${t.kpi('En analyse', String(dossiers().filter((x) => x.tStatus === 'pending').length), 'Statut « En attente » sur la carte')}
      ${t.kpi('Refusés ou remboursés', String(dossiers().filter((x) => x.tStatus === 'refused' || x.tStatus === 'released').length), "Gardés pour l'historique")}
    </div>
    ${unlinkedLoans.length ? `<div class="callout small">Prêts Finances sans dossier Terreno : ${unlinkedLoans.map((l) => `<button class="linklike" data-action="open-loan" data-id="${l.id}">${e(l.name.split(' — ')[0])}</button>`).join(' · ')} — indiquez le n° de dossier dans « Modifier le prêt » (ou créez le dossier sur la carte).</div>` : ''}
    <div class="ls-filters">
      <label>Statut<select id="dos-f-status">${opt('all', 'Tous')}${opt('live', 'Actifs')}${STATUSES.map((s) => opt(s, s)).join('')}</select></label>
      <label>Recherche<input type="search" id="dos-f-q" value="${e(UI.q)}" placeholder="Nom, contact, adresse, apporteur…"></label>
      <div class="toolbar" style="align-self:flex-end"><button class="btn primary" data-action="new-dossier-map">+ Nouveau dossier (carte)</button></div>
    </div>
    <section class="panel"><div class="table-wrap"><table class="dos-table"><thead><tr>${th('no', 'N°')}${th('name', 'Dossier')}<th>Contact</th><th>Prêteur</th><th>Type · rang</th>${th('amount', 'Montant', 'num')}<th class="num">Taux</th>${th('start', 'Début')}${th('maturity', 'Échéance')}${th('status', 'Statut')}<th>Immeubles</th><th>Prêt Finances</th><th></th></tr></thead><tbody>
      ${list.map((x) => { const f = F.byDossier[x.id]; const loan = f && f.l; return `<tr class="${isLiveDs(x) ? '' : 'muted-row'}">
        <td class="num">${x.no != null ? String(x.no).padStart(3, '0') : '<span class="muted">—</span>'}</td>
        <td class="dos-name"><button class="linklike" data-action="open-dossier-map" data-id="${x.id}">${e(x.name)}</button>${x.referrer ? `<div class="small muted">Apporteur : ${e(x.referrer)}</div>` : ''}</td>
        <td class="nowrap">${e(x.contact || '')}</td><td class="small lender">${e((x.lender || '—').replace(' & ', ' & '))}</td>
        <td class="small">${e(x.type || '')}${x.rank ? `<div class="muted">${e(x.rank)}</div>` : ''}</td>
        <td class="num">${num(x.amount) ? M0(num(x.amount)) : '<span class="muted">—</span>'}</td>
        <td class="num">${x.rate !== '' && x.rate != null ? `${x.rate} %` : '—'}${x.rateAfter ? `<div class="small muted">${x.rateAfter} % après</div>` : ''}</td>
        <td style="white-space:nowrap">${x.start ? d(x.start) : '—'}</td><td style="white-space:nowrap">${x.maturity ? d(x.maturity) : '—'}${x.termMonths ? `<div class="small muted">${x.termMonths} mois · min ${x.minMonths || 0}</div>` : ''}</td>
        <td><span class="pill ${stClass(x.status)}">${e(x.status)}</span></td>
        <td class="small dos-props-cell">${(x.properties || []).map((id) => { const p = propById(id); return p ? `<button class="linklike" data-action="open-property" data-id="${id}" title="${e(propLabel(p))}">${e(p.address)}</button><span class="muted"> · ${e(p.city || '')}</span>` : ''; }).join('<br>') || '<span class="muted">—</span>'}${(x.properties || []).length ? `<div><button class="btn ghost small" data-action="locate-dossier" data-id="${x.id}">⌖ Carte</button></div>` : ''}</td>
        <td class="small">${loan ? `<button class="linklike" data-action="open-loan" data-id="${loan.id}">${e(loan.name.split(' — ')[0])}</button>${f.sm ? `<div>${pill(dueStatus(f.sm))}</div>` : ''}` : num(x.amount) && isLiveDs(x) ? `<button class="btn ghost small" data-action="create-loan" data-id="${x.id}">Créer le prêt</button>` : '<span class="muted">—</span>'}</td>
        <td><button class="btn ghost small" data-action="edit-dossier-map" data-id="${x.id}">Modifier</button></td></tr>`; }).join('') || '<tr><td colspan="13" class="muted">Aucun dossier.</td></tr>'}
    </tbody></table></div></section>
    <p class="hint">Le n° de dossier (L001 → 1) relie chaque dossier de la carte au prêt correspondant dans Finances (champ « N° de dossier » du prêt). Un dossier peut exister sans prêt Finances (demande en analyse, dossier refusé, prêt d'un autre prêteur).</p>`;
  }
  function propsView() {
    const t = T(), { esc: e, m0: M0 } = t, q = UI.pq.trim().toLowerCase(); const F = finAll();
    let list = properties().filter((p) => (!q || [p.address, p.city, p.owner, p.postal, p.lot, p.matricule, p.notes].join(' ').toLowerCase().includes(q)));
    if (UI.pfilter === 'secured') list = list.filter((p) => F.byProp[p.id].live.length > 0);
    else if (UI.pfilter === 'late') list = list.filter((p) => F.byProp[p.id].late || F.byProp[p.id].partial);
    else if (UI.pfilter === 'free') list = list.filter((p) => !F.byProp[p.id].live.length);
    else if (UI.pfilter === 'none') list = list.filter((p) => !dossiersOfProp(p.id).length);
    list.sort((a, b) => (F.byProp[b.id].late - F.byProp[a.id].late) || F.byProp[b.id].balance - F.byProp[a.id].balance || (a.city || '').localeCompare(b.city || ''));
    const totVal = list.reduce((a, p) => a + num(p.value), 0), totSec = list.reduce((a, p) => a + F.byProp[p.id].balance, 0), totArr = list.reduce((a, p) => a + F.byProp[p.id].arrears, 0);
    const opt = (v, l) => `<option value="${v}" ${UI.pfilter === v ? 'selected' : ''}>${l}</option>`;
    return `
    <div class="kpis">
      ${t.kpi('Immeubles', String(properties().length), `${properties().filter((p) => F.byProp[p.id].live.length).length} en garantie d'un dossier actif`)}
      ${t.kpi('Valeur estimée (liste affichée)', M0(totVal), `${list.length} immeuble${list.length > 1 ? 's' : ''}`)}
      ${t.kpi('Capital garanti', M0(totSec), totVal ? `LTV moyen ${PCT0.format(totSec / totVal)}` : '')}
      ${t.kpi('Arriérés', `<span class="${totArr > 0.5 ? 'neg' : ''}">${M0(totArr)}</span>`, `${list.filter((p) => F.byProp[p.id].late).length} immeuble(s) avec paiement en retard`)}
    </div>
    <div class="ls-filters">
      <label>Afficher<select id="dos-f-pfilter">${opt('all', 'Tous')}${opt('secured', 'En garantie (dossier actif)')}${opt('late', 'Paiement en retard ou partiel')}${opt('free', 'Sans garantie active')}${opt('none', 'Jamais associés à un dossier')}</select></label>
      <label>Recherche<input type="search" id="dos-f-pq" value="${e(UI.pq)}" placeholder="Adresse, ville, propriétaire, lot…"></label>
      <div class="toolbar" style="align-self:flex-end"><button class="btn primary" data-action="new-prop-map">+ Nouvel immeuble (carte)</button></div>
    </div>
    <section class="panel"><div class="table-wrap"><table class="dos-table"><thead><tr><th>Adresse</th><th>Propriétaire</th><th>Type</th><th class="num">Valeur</th><th class="num">Capital garanti</th><th>LTV</th><th>Dossiers</th><th>Finances</th><th>Lot · matricule</th><th></th></tr></thead><tbody>
      ${list.map((p) => { const f = F.byProp[p.id], ds = dossiersOfProp(p.id); return `<tr>
        <td><button class="linklike" data-action="open-property" data-id="${p.id}">${e(p.address)}</button><div class="small muted">${e([p.city, p.postal].filter(Boolean).join(' · '))}</div></td>
        <td>${e(p.owner || '')}</td><td class="small">${e(p.type || '—')}</td>
        <td class="num">${num(p.value) ? M0(num(p.value)) : '<span class="muted">—</span>'}</td>
        <td class="num">${f.balance ? M0(f.balance) : '<span class="muted">0 $</span>'}</td>
        <td>${ltvBar(f)}</td>
        <td class="small">${ds.map((x) => `<button class="linklike" data-action="open-dossier-map" data-id="${x.id}">${e(x.name)}</button> <span class="pill ${stClass(x.status)}">${e(x.status)}</span>`).join('<br>') || '<span class="muted">Aucun</span>'}</td>
        <td class="small">${f.withLoan.map((x) => `<button class="linklike" data-action="open-loan" data-id="${x.l.id}">${e(x.l.name.split(' — ')[0])}</button> ${t.pill(dueStatus(x.sm))}${x.sm.s.totals.arrears > 0.5 ? `<div class="neg">${t.m(x.sm.s.totals.arrears)} en retard</div>` : ''}`).join('<br>') || '<span class="muted">—</span>'}</td>
        <td class="small muted">${e(p.lot || '')}${p.matricule ? `<br>${e(p.matricule)}` : ''}</td>
        <td style="white-space:nowrap">${geoCell(p)} <button class="btn ghost small" data-action="edit-prop-map" data-id="${p.id}">Modifier</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="muted">Aucun immeuble.</td></tr>'}
    </tbody></table></div></section>
    <p class="hint">Capital garanti = solde du prêt Finances relié (ou montant du dossier s'il n'y a pas de prêt Finances), réparti également entre les immeubles d'un même dossier. LTV = capital garanti ÷ valeur estimée.</p>`;
  }

  /* ---------- encadré « Dossier Terreno » dans la fiche d'un prêt Finances ---------- */
  function loanCard(loan) {
    ensure();
    const t = T(), { esc: e, m0: M0, d, PCT } = t, ds = dossierOfLoan(loan);
    if (!ds) return `<section class="panel"><div class="panel-head"><h2>Dossier Terreno (carte)</h2><button class="btn small" data-action="edit-loan" data-id="${loan.id}">Indiquer le n° de dossier</button></div><div class="panel-body muted small">${loaded() ? `Aucun dossier de la carte ne porte le n° ${loan.dossier || '—'}. Indiquez le bon numéro dans « Modifier le prêt », ou créez le dossier sur la carte.` : 'Carte non chargée.'}</div></section>`;
    const props = (ds.properties || []).map(propById).filter(Boolean), F = finAll();
    const totVal = props.reduce((a, p) => a + num(p.value), 0);
    return `<section class="panel"><div class="panel-head"><h2>Dossier Terreno n° ${String(ds.no).padStart(3, '0')} — ${e(ds.name)}</h2><div class="toolbar"><span class="pill ${stClass(ds.status)}">${e(ds.status)}</span><button class="btn small" data-action="locate-dossier" data-id="${ds.id}">⌖ Voir sur la carte</button><button class="btn ghost small" data-action="edit-dossier-map" data-id="${ds.id}">Modifier sur la carte</button></div></div>
      <div class="panel-body dos-card">
        <dl><dt>Contact</dt><dd>${e(ds.contact || '—')}</dd><dt>Prêteur(s)</dt><dd>${e(ds.lender || '—')}</dd><dt>Apporteur d'affaires</dt><dd>${e(ds.referrer || '—')}</dd>
          <dt>Type · rang</dt><dd>${e([ds.type, ds.rank].filter(Boolean).join(' · ') || '—')}</dd><dt>Montant financé (total)</dt><dd>${num(ds.amount) ? M0(num(ds.amount)) : '—'}${totVal && num(ds.amount) ? ` · LTV ${PCT.format(num(ds.amount) / totVal)}` : ''}</dd>
          <dt>Taux</dt><dd>${ds.rate !== '' && ds.rate != null ? `${ds.rate} %` : '—'}${ds.rateAfter ? ` · ${ds.rateAfter} % après échéance` : ''}</dd><dt>Terme</dt><dd>${ds.termMonths ? `${ds.termMonths} mois · minimum ${ds.minMonths || 0} mois d'intérêt` : '—'}</dd>
          <dt>Début · échéance</dt><dd>${ds.start ? d(ds.start) : '—'} · ${ds.maturity ? d(ds.maturity) : '—'}</dd><dt>Risque (carte)</dt><dd>${e(ds.risk || '—')}</dd></dl>
        <div><h4>Immeuble${props.length > 1 ? 's' : ''} en garantie</h4>${props.length ? props.map((p) => { const f = F.byProp[p.id]; const c = (ds.collateral || []).find((k) => k.propertyId === p.id) || {}; return `<div class="dos-prop"><b><button class="linklike" data-action="open-property" data-id="${p.id}">${e(p.address)}</button></b><div class="small muted">${e([p.city, p.postal, p.type].filter(Boolean).join(' · '))}${p.value ? ` · valeur ${M0(num(p.value))}` : ''}${p.yearBuilt ? ` · ${p.yearBuilt}` : ''}${c.rank ? ` · ${e(c.rank)}` : ''}${c.amount ? ` · garanti ${M0(c.amount)}` : ''}</div><div class="small muted">${p.lot ? `Lot ${e(p.lot)}` : ''}${p.matricule ? ` · matricule ${e(p.matricule)}` : ''}${f && f.ltv != null ? ` · LTV immeuble ${PCT0.format(f.ltv)}` : ''}</div><div class="small"><button class="linklike small" data-action="map-prop" data-id="${p.id}">⌖ Carte</button> · <button class="linklike small" data-action="open-property" data-id="${p.id}">Dossier immeuble</button></div></div>`; }).join('') : '<p class="muted small">Aucun immeuble relié.</p>'}
          ${ds.notes && ds.notes.split('\n').slice(1).join('\n').trim() ? `<p class="small muted" style="white-space:pre-wrap">${e(ds.notes.split('\n').slice(1).join('\n').trim())}</p>` : ''}</div>
      </div></section>`;
  }

  /* ---------- fiche d'un immeuble côté Finances ---------- */
  function viewProperty() {
    const Tf = T(); const p = propById(Tf.ui.propertyId);
    if (!p) { Tf.ui.propertyId = null; return view(); }
    const f = finProp(p.id); const PCT = Tf.PCT, m = Tf.m, e = Tf.esc, y = Tf.todayISO.slice(0, 4);
    const rev = Tf.E.loanRevenue(Tf.data, `${y}-01-01`, `${y}-12-31`, 'cash', Tf.todayISO), revBy = Object.fromEntries(rev.rows.map((r) => [r.loan, r]));
    const statusPill = f.late ? '<span class="pill late">Paiement en retard</span>' : f.partial ? '<span class="pill partial">Paiement partiel</span>' : f.withLoan.length ? '<span class="pill active">À jour</span>' : f.live.length ? '<span class="pill upcoming">Dossier actif</span>' : f.items.length ? '<span class="pill none">Aucun dossier actif</span>' : '<span class="pill none">Sans dossier</span>';
    const dsRow = (x) => {
      const c = (x.ds.collateral || []).find((k) => k.propertyId === p.id) || {};
      const common = `<td><button class="linklike" data-action="open-dossier-map" data-id="${x.ds.id}">${e(x.ds.name)}</button><div class="small muted">${e([x.ds.no != null ? `n° ${String(x.ds.no).padStart(3, '0')}` : '', x.ds.contact, x.ds.lender].filter(Boolean).join(' · '))}</div></td>
        <td class="small">${e(c.rank || x.ds.rank || '')}<div class="muted">${e(x.ds.type || '')}</div></td><td class="num">${c.amount ? m0(c.amount) : num(x.ds.amount) ? m0(num(x.ds.amount)) : '—'}${x.share < 1 && !c.amount ? `<div class="small muted">${Math.round(x.share * 100)} % ici</div>` : ''}</td>`;
      if (!x.l) return `<tr class="${isLiveDs(x.ds) ? '' : 'muted-row'}">${common}<td colspan="4"><span class="pill ${stClass(x.ds.status)}">${e(x.ds.status)}</span>${num(x.ds.amount) && isLiveDs(x.ds) ? ` <button class="btn ghost small" data-action="create-loan" data-id="${x.ds.id}">Créer le prêt Finances</button>` : ''}</td><td></td></tr>`;
      return `<tr>${common}<td><button class="linklike" data-action="open-loan" data-id="${x.l.id}">${e(x.l.name.split(' — ')[0])}</button><div class="small">${m0(x.sm.s.ledgerBalance)}${x.sm.cur && x.sm.cur.rate != null ? ` · ${PCT.format(x.sm.cur.rate)}` : ''}</div></td>
        <td>${Tf.pill(dueStatus(x.sm))}</td><td class="num ${x.sm.s.totals.arrears > 0.5 ? 'neg' : ''}">${m(x.sm.s.totals.arrears)}</td><td class="num">${m(revBy[x.l.id] ? revBy[x.l.id].revenue : 0)}</td>
        <td style="white-space:nowrap;text-align:right"><button class="btn small" data-action="loan-statement" data-id="${x.l.id}">État de compte</button></td></tr>`;
    };
    const gq = encodeURIComponent([p.address, p.city, p.postal].filter(Boolean).join(', '));
    return `
    <div class="section-head"><div><button class="btn ghost small" data-action="go" data-view="dossiers">← Dossiers et immeubles</button>
      <h1 style="margin-top:6px">${e(p.address)} ${statusPill}</h1>
      <div class="sub">${e([p.city, p.postal, p.type, p.owner ? `propriétaire : ${p.owner}` : ''].filter(Boolean).join(' · '))} · ${geoBadge(p)}</div></div>
      <div class="toolbar"><button class="btn" data-action="map-prop" data-id="${p.id}" ${p.lat == null ? 'disabled' : ''}>⌖ Voir sur la carte</button><button class="btn" data-action="edit-prop-map" data-id="${p.id}">Modifier sur la carte</button>${f.withLoan.length === 1 ? `<button class="btn primary" data-action="new-tx-loan" data-id="${f.withLoan[0].l.id}">+ Paiement reçu</button>` : ''}</div></div>
    <div class="kpis">
      ${Tf.kpi('Valeur estimée', num(p.value) ? m0(num(p.value)) : '—', p.yearBuilt ? `Construit en ${p.yearBuilt}` : p.assessment ? `Évaluation municipale ${m0(p.assessment)}` : 'Selon la fiche Terreno')}
      ${Tf.kpi('Capital garanti', m0(f.balance), `${f.live.length} dossier${f.live.length > 1 ? 's' : ''} actif${f.live.length > 1 ? 's' : ''}`)}
      ${Tf.kpi('LTV', f.ltv != null ? PCT0.format(f.ltv) : '—', 'Capital garanti ÷ valeur')}
      ${Tf.kpi('Intérêt mensuel attendu', m(f.monthly), 'Prêts Finances reliés')}
      ${Tf.kpi('Arriérés', `<span class="${f.arrears > 0.5 ? 'neg' : ''}">${m(f.arrears)}</span>`, 'Mois en retard ou partiels')}
    </div>
    ${p.floodZone ? `<div class="callout">Zone inondable officielle : ${e(p.floodZone)}</div>` : ''}
    <section class="panel"><div class="panel-head"><h2>Dossiers garantis par cet immeuble</h2></div>
      <div class="table-wrap"><table class="coll-table"><thead><tr><th>Dossier</th><th>Rang · type</th><th class="num">Garanti</th><th>Prêt Finances</th><th>Dernier mois dû</th><th class="num">Arriérés</th><th class="num">Intérêts ${y}</th><th></th></tr></thead><tbody>
      ${f.items.map(dsRow).join('') || '<tr><td colspan="8" class="muted">Aucun dossier ne prend cet immeuble en garantie. Ajoutez-le comme garantie d\'un dossier sur la carte.</td></tr>'}
      </tbody></table></div></section>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Localisation et cadastre</h2></div><div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
        <dl class="kv"><dt>Adresse</dt><dd>${e(p.address || '—')}</dd><dt>Ville</dt><dd>${e([p.neighborhood, p.city, p.postal].filter(Boolean).join(', ') || '—')}</dd><dt>Lot</dt><dd>${e(p.lot || '—')}</dd><dt>Matricule</dt><dd>${e(p.matricule || '—')}</dd><dt>Coordonnées</dt><dd class="num" style="text-align:left">${p.lat != null ? `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` : '—'}</dd></dl>
        <div class="ext-links"><a target="_blank" rel="noopener" href="${p.lat != null ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${gq}`}">Street View</a><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${gq}">Google Maps</a><a target="_blank" rel="noopener" href="https://maps.apple.com/?q=${gq}">Plans (Apple)</a></div>
        <p class="hint" style="margin:0">La position, les zones de risque, le lot et Street View intégré sont sur la carte (bouton « Voir sur la carte »).</p>
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Notes (carte)</h2></div><div class="panel-body">${p.notes ? `<p style="margin:0;white-space:pre-wrap">${e(p.notes)}</p>` : '<p class="muted" style="margin:0">Aucune note.</p>'}</div></section>
    </div>`;
  }

  /* ---------- tableau de bord Finances : répartition géographique ---------- */
  function dashboardPanel() {
    if (!loaded()) return '';
    const Tf = T(), F = finAll(); const byCity = {};
    for (const p of properties()) {
      const k = p.city || 'Ville inconnue'; const c = byCity[k] = byCity[k] || { n: 0, live: 0, bal: 0, arr: 0, val: 0, late: 0 };
      const f = F.byProp[p.id]; c.n++; c.live += f.live.length ? 1 : 0; c.bal += f.balance; c.arr += f.arrears; c.val += num(p.value); c.late += f.late ? 1 : 0;
    }
    const rows = Object.entries(byCity).sort((a, b) => b[1].bal - a[1].bal || b[1].n - a[1].n);
    const T0 = rows.reduce((s, [, c]) => ({ bal: s.bal + c.bal, arr: s.arr + c.arr, n: s.n + c.n, live: s.live + c.live }), { bal: 0, arr: 0, n: 0, live: 0 });
    return `<section class="panel"><div class="panel-head"><h2>Répartition géographique</h2><span class="muted small">Immeubles de la carte Terreno · cliquez une ville pour centrer la carte</span></div>
      <div class="table-wrap"><table class="geo-city-table"><thead><tr><th>Ville</th><th class="num">Immeubles</th><th class="num">En garantie</th><th class="num">Capital garanti</th><th class="num">Part</th><th class="num">Arriérés</th><th class="num">En retard</th></tr></thead><tbody>
      ${rows.map(([city, c]) => `<tr class="clickable" data-action="map-city" data-city="${Tf.esc(city)}"><td>${Tf.esc(city)}</td><td class="num">${c.n}</td><td class="num">${c.live}</td><td class="num">${m0(c.bal)}</td><td class="num">${T0.bal ? PCT0.format(c.bal / T0.bal) : '—'}</td><td class="num ${c.arr > 0.5 ? 'neg' : ''}">${m0(c.arr)}</td><td class="num ${c.late ? 'neg' : ''}">${c.late || ''}</td></tr>`).join('')}
      </tbody><tfoot><tr class="grand"><td>Total</td><td class="num">${T0.n}</td><td class="num">${T0.live}</td><td class="num">${m0(T0.bal)}</td><td></td><td class="num">${m0(T0.arr)}</td><td></td></tr></tfoot></table></div></section>`;
  }
  function loanCardGeo(l) { const ds = dossierOfLoan(l); const n = ds ? (ds.properties || []).map(propById).filter((p) => p && p.lat != null).length : 0; return n ? `<span class="geo" title="${n} immeuble(s) sur la carte">⌖ ${n}</span>` : ''; }

  /* ---------- événements des vues Finances (onglet Dossiers) ---------- */
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#fin-col [data-action="dos-tab"], #fin-col [data-action="dos-sort"]'); if (!b || !T()) return;
    if (b.dataset.action === 'dos-tab') UI.tab = b.dataset.k; else UI.sort = b.dataset.k;
    saveUi(); T().render();
  });
  let qt;
  document.addEventListener('input', (ev) => {
    const el = ev.target; if (!el.id || !el.id.startsWith('dos-f-') || !T()) return;
    const k = el.id.slice(6); UI[k] = el.value; saveUi();
    clearTimeout(qt); qt = setTimeout(() => { T().render(); const n = document.getElementById(el.id); if (n && n.type === 'search') { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, el.type === 'search' ? 250 : 0);
  });

  root.TFDossiers = { view, loanCard, dossierOfLoan, loanOf, openDossier: (id) => showLoanOnMap(id), openProp: (id) => id && showPropertyOnMap(id), ensure };
  root.TMap = { viewProperty, dashboardPanel, loanCardGeo, geoCell, onFinanceRender, handleAction, showLoanOnMap, showPropertyOnMap, flyToCity,
    resize: () => { try { if (typeof map !== 'undefined' && map) map.resize(); } catch (e) { /* rien */ } } };
})(window);
