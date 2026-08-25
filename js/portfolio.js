/* =====================================================================
   portfolio.js — deux sous-onglets : Prêts et Immeubles
   ===================================================================== */

const RISK_ORDER = { "Élevé": 0, "Moyen": 1, "Faible": 2 };

// Tri par en-tête de colonne, pour les tableaux Prêts et Immeubles — cliquer une
// fois trie en ordre croissant, recliquer inverse le sens.
let loanSort = { key: null, dir: "asc" };
let propSort = { key: null, dir: "asc" };

function sortTh(label, key, sortState) {
  const active = sortState.key === key;
  const arrow = active ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
  return `<th data-sort-key="${key}" style="cursor:pointer;user-select:none;" title="Cliquer pour trier">${label}${arrow}</th>`;
}

function wireSortHeaders(body, sortState, rerenderFn) {
  body.querySelectorAll("th[data-sort-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = "asc";
      }
      rerenderFn();
    });
  });
}

function applySort(list, sortState, getters) {
  if (!sortState.key || !getters[sortState.key]) return list;
  const getter = getters[sortState.key];
  const sorted = [...list].sort((a, b) => {
    const va = getter(a), vb = getter(b);
    let cmp;
    if (typeof va === "string") cmp = va.localeCompare(vb, "fr-CA");
    else cmp = (va || 0) - (vb || 0);
    return sortState.dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}


function renderPortfolio() {
  document.querySelectorAll(".gt-subtab").forEach(t => {
    t.classList.toggle("active", t.dataset.subtab === state.portfolioTab);
  });
  document.getElementById("portfolio-loans").style.display =
    state.portfolioTab === "loans" ? "block" : "none";
  document.getElementById("portfolio-properties").style.display =
    state.portfolioTab === "properties" ? "block" : "none";

  if (state.portfolioTab === "loans") renderLoansList();
  else renderPropertiesList();
}

/* ---------- Sous-onglet : Prêts ---------- */
function renderLoansList() {
  const sortBy = document.getElementById("loans-sort-by").value;
  const fStatus = document.getElementById("loans-filter-status").value;
  const fRisk = document.getElementById("loans-filter-risk").value;

  let list = state.loans.filter(l => state.savedLoans.has(l.id));
  if (fStatus !== "all") list = list.filter(l => l.status === fStatus);
  if (fRisk !== "all") list = list.filter(l => l.risk === fRisk);

  list.sort((a, b) => {
    if (sortBy === "amount") return b.balance - a.balance;
    if (sortBy === "ltv") return loanLtv(b, state.propertyMap) - loanLtv(a, state.propertyMap);
    if (sortBy === "risk") return RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
    if (sortBy === "maturity") return (a.maturity || "").localeCompare(b.maturity || "");
    return 0;
  });

  document.getElementById("loans-count").textContent = `${list.length} prêts suivis`;

  const body = document.getElementById("loans-body");
  if (list.length === 0) {
    body.innerHTML = `<div class="gt-empty"><i class="ti ti-folder-open"></i><div>Aucun prêt ne correspond aux filtres.</div></div>`;
    return;
  }

  // Une ligne par immeuble en garantie (comme le fichier d'origine) — un prêt avec
  // plusieurs immeubles apparaît donc sur plusieurs lignes consécutives.
  let rows = [];
  list.forEach(loan => {
    const collateral = loan.collateral && loan.collateral.length > 0 ? loan.collateral : [null];
    collateral.forEach(c => {
      const p = c ? state.propertyMap[c.propertyId] : null;
      const lotInfo = p && typeof getLotInfo === "function" ? getLotInfo(p) : { postalCode: "", matricule: "", lotNumber: "" };
      const amount = c ? c.amount : loan.principal;
      const lv = p ? propertyLtv(p, amount) : 0;
      const priorDebt = c ? (c.priorDebt || 0) : 0;
      const equity = p ? Math.max(p.value - amount - priorDebt, 0) : null;
      rows.push({ loan, c, p, lotInfo, amount, lv, priorDebt, equity });
    });
  });

  // Le tri par en-tête de colonne (s'il est actif) prend le dessus sur le menu
  // déroulant "Trier :" ci-dessus.
  const LOAN_SORT_GETTERS = {
    id: r => r.loan.id,
    notes: r => r.loan.notes || "",
    borrower: r => r.loan.borrower || "",
    lender: r => r.loan.lender || "",
    type: r => r.loan.type || "",
    rank: r => (r.c ? r.c.rank : "") || "",
    amount: r => r.amount || 0,
    startDate: r => r.loan.startDate || "",
    maturity: r => r.loan.maturity || "",
    rate: r => r.loan.rate || 0,
    rateAfterMaturity: r => r.loan.rateAfterMaturity || 0,
    termMonths: r => r.loan.termMonths || 0,
    minInterestMonths: r => r.loan.minInterestMonths || 0,
    status: r => r.loan.status || "",
    referredBy: r => r.loan.referredBy || "",
    addr: r => (r.p ? r.p.addr : "") || "",
    postalCode: r => r.lotInfo.postalCode || "",
    lotNumber: r => r.lotInfo.lotNumber || "",
    matricule: r => r.lotInfo.matricule || "",
    ltv: r => r.lv || 0,
    value: r => (r.p ? r.p.value : 0) || 0,
    priorDebt: r => r.priorDebt || 0,
    equity: r => (r.equity !== null ? r.equity : -Infinity),
  };
  rows = applySort(rows, loanSort, LOAN_SORT_GETTERS);

  body.innerHTML = `
    <table>
      <thead>
        <tr>
          <th></th>
          ${sortTh("N°", "id", loanSort)}
          ${sortTh("Prêt / Dossier", "notes", loanSort)}
          ${sortTh("Contact", "borrower", loanSort)}
          ${sortTh("Prêteur", "lender", loanSort)}
          ${sortTh("Type de prêt", "type", loanSort)}
          ${sortTh("Rang", "rank", loanSort)}
          ${sortTh("Montant financé", "amount", loanSort)}
          ${sortTh("Date de début", "startDate", loanSort)}
          ${sortTh("Échéance contractuelle", "maturity", loanSort)}
          ${sortTh("Taux d'intérêt (%)", "rate", loanSort)}
          ${sortTh("Taux après échéance (%)", "rateAfterMaturity", loanSort)}
          ${sortTh("Échéance (mois)", "termMonths", loanSort)}
          ${sortTh("Nb mois min. intérêt", "minInterestMonths", loanSort)}
          ${sortTh("Statut", "status", loanSort)}
          ${sortTh("Apporteur d'affaires", "referredBy", loanSort)}
          ${sortTh("Adresse civique", "addr", loanSort)}
          <th>Province</th>
          ${sortTh("Code postal", "postalCode", loanSort)}
          <th>Pays</th>
          ${sortTh("Lot cadastral", "lotNumber", loanSort)}
          ${sortTh("Matricule", "matricule", loanSort)}
          ${sortTh("LTV part", "ltv", loanSort)}
          <th>Google Maps</th>
          <th>Apple Maps</th>
          <th>Street View</th>
          <th>Rôle / taxes</th>
          <th>Lot cadastral (recherche)</th>
          <th>Notes</th>
          ${sortTh("Valeur estimée", "value", loanSort)}
          ${sortTh("Dette de 1er rang", "priorDebt", loanSort)}
          ${sortTh("Équité restante", "equity", loanSort)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ loan, c, p, lotInfo, amount, lv, priorDebt, equity }) => {
          const mapsUrl = p ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : "";
          const appleMapsUrl = p ? `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(p.addr)}` : "";
          const streetViewUrl = p ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}` : "";
          const roleSearchUrl = p ? `https://www.google.com/search?q=${encodeURIComponent("rôle évaluation " + p.addr + " " + p.city)}` : "";
          return `
            <tr data-loan-id="${loan.id}" data-property-id="${p ? p.id : ""}">
              <td>
                <button class="gt-open-loan-btn" data-loan-id="${loan.id}" title="Voir la fiche complète du prêt" style="display:flex;align-items:center;gap:4px;background:var(--color-brand-blue,#2277B5);color:#FFFFFF;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
                  <i class="ti ti-file-text"></i> Voir
                </button>
              </td>
              <td style="color:var(--color-text-secondary);font-size:11px">${loan.id.replace(/\D/g, "")}</td>
              <td><input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="notes" value="${loan.notes || ""}" style="font-weight:500" /></td>
              <td><input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="borrower" value="${loan.borrower || ""}" /></td>
              <td><input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="lender" value="${loan.lender || ""}" /></td>
              <td>
                <select class="gt-inline-edit" data-loan-id="${loan.id}" data-field="type">
                  <option value="">—</option>
                  ${CONFIG.options.loanTypes.map(t => `<option value="${t}" ${t === loan.type ? "selected" : ""}>${t}</option>`).join("")}
                </select>
              </td>
              <td>
                ${c ? `
                  <select class="gt-inline-edit" data-loan-id="${loan.id}" data-property-id="${p ? p.id : ""}" data-field="rank">
                    ${CONFIG.options.ranks.map(r => `<option value="${r}" ${r === c.rank ? "selected" : ""}>${r}</option>`).join("")}
                  </select>
                ` : "—"}
              </td>
              <td>
                ${c ? `<input class="gt-inline-edit gt-inline-edit-num" data-loan-id="${loan.id}" data-property-id="${p ? p.id : ""}" data-field="amount" value="${formatNumberWithCommas(amount)}" style="font-weight:500" />`
                    : `<input class="gt-inline-edit gt-inline-edit-num" data-loan-id="${loan.id}" data-field="principal" value="${formatNumberWithCommas(amount)}" style="font-weight:500" />`}
              </td>
              <td>
                <input class="gt-inline-edit" type="date" data-loan-id="${loan.id}" data-field="startDate" value="${loan.startDate || ""}" style="width:130px" />
              </td>
              <td>
                <input class="gt-inline-edit" type="date" data-loan-id="${loan.id}" data-field="maturity" value="${loan.maturity || ""}" style="width:130px" />
              </td>
              <td>
                <input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="rate" value="${loan.rate || ""}" style="width:60px" />
              </td>
              <td>
                <input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="rateAfterMaturity" value="${loan.rateAfterMaturity || ""}" placeholder="—" style="width:60px" />
              </td>
              <td>
                <input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="termMonths" value="${loan.termMonths || ""}" placeholder="—" style="width:55px" />
              </td>
              <td>
                <input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="minInterestMonths" value="${loan.minInterestMonths || ""}" placeholder="—" style="width:55px" />
              </td>
              <td>
                <select class="gt-inline-edit gt-status-select" data-loan-id="${loan.id}" data-field="status" style="${statusSelectStyle(loan.status)}">
                  ${CONFIG.options.statuses.map(s => `<option value="${s}" ${s === loan.status ? "selected" : ""}>${CONFIG.statusMap[s].label}</option>`).join("")}
                </select>
              </td>
              <td><input class="gt-inline-edit" data-loan-id="${loan.id}" data-field="referredBy" value="${loan.referredBy || ""}" /></td>
              <td>${p ? p.addr : "—"}</td>
              <td style="font-size:12px;color:var(--color-text-secondary)">Québec</td>
              <td>${p ? `<input class="gt-inline-edit" data-property-id="${p.id}" data-field="postalCode" value="${lotInfo.postalCode || ""}" />` : "—"}</td>
              <td style="font-size:12px;color:var(--color-text-secondary)">Canada</td>
              <td>${p ? `<input class="gt-inline-edit" data-property-id="${p.id}" data-field="lotNumber" value="${lotInfo.lotNumber || ""}" />` : "—"}</td>
              <td>${p ? `<input class="gt-inline-edit" data-property-id="${p.id}" data-field="matricule" value="${lotInfo.matricule || ""}" />` : "—"}</td>
              <td style="color:${ltvColor(lv)};font-weight:500">${p ? lv + "%" : "—"}</td>
              <td>${p ? `<a href="${mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ouvrir</a>` : "—"}</td>
              <td>${p ? `<a href="${appleMapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ouvrir</a>` : "—"}</td>
              <td>${p ? `<a href="${streetViewUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Street View</a>` : "—"}</td>
              <td>${p ? `<a href="${roleSearchUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Rôle / taxes</a>` : "—"}</td>
              <td><a href="https://www.registrefoncier.gouv.qc.ca/Sirf/" target="_blank" rel="noopener" onclick="event.stopPropagation()">Lot / cadastre</a></td>
              <td><input class="gt-inline-edit" data-property-id="${p ? p.id : ""}" data-field="propNotes" value="${p ? (p.notes || "") : ""}" /></td>
              <td>${p ? `<input class="gt-inline-edit gt-inline-edit-num" data-property-id="${p.id}" data-field="value" value="${formatNumberWithCommas(p.value)}" />` : "—"}</td>
              <td>${c ? `<input class="gt-inline-edit gt-inline-edit-num" data-loan-id="${loan.id}" data-property-id="${p ? p.id : ""}" data-field="priorDebt" value="${formatNumberWithCommas(priorDebt)}" />` : "—"}</td>
              <td style="font-weight:500">${equity !== null ? fmtK(equity) : "—"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wireInlineEdits(body);
  wireSortHeaders(body, loanSort, renderLoansList);

  body.querySelectorAll("tr[data-loan-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("input, select")) return;
      selectLoan(row.dataset.loanId);
    });
  });
}

// Branche la sauvegarde automatique des champs éditables en ligne (Prêts et Immeubles).
// text/number : sauvegarde au "blur" (en quittant le champ). select : au "change".
function wireInlineEdits(container) {
  container.querySelectorAll(".gt-inline-edit").forEach(el => {
    el.addEventListener("click", e => e.stopPropagation());
    el.addEventListener("mousedown", e => e.stopPropagation());

    const eventName = el.tagName === "SELECT" ? "change" : "blur";
    el.addEventListener(eventName, () => {
      const loanId = el.dataset.loanId;
      const propertyId = el.dataset.propertyId;
      const field = el.dataset.field;
      const isNum = el.classList.contains("gt-inline-edit-num");
      const val = isNum ? parseFormattedNumber(el.value) : el.value.trim();

      if (loanId && ["notes", "borrower", "lender", "type", "status", "referredBy"].includes(field)) {
        const loan = state.loanMap[loanId];
        if (loan) {
          loan[field] = val;
          if (field === "status" && el.classList.contains("gt-status-select")) {
            el.setAttribute("style", statusSelectStyle(val));
          }
          saveLoanOverride(loan);
        }
      } else if (loanId && propertyId && ["rank", "amount", "priorDebt"].includes(field)) {
        const loan = state.loanMap[loanId];
        const entry = loan && loan.collateral.find(c => c.propertyId === propertyId);
        if (entry) {
          entry[field] = val;
          saveLoanOverride(loan);
        }
      } else if (loanId && field === "principal") {
        const loan = state.loanMap[loanId];
        if (loan) { loan.principal = val; saveLoanOverride(loan); }
      } else if (loanId && ["rate", "rateAfterMaturity", "termMonths", "minInterestMonths"].includes(field)) {
        const loan = state.loanMap[loanId];
        if (loan) { loan[field] = Number(val) || (field === "rate" ? 0 : null); saveLoanOverride(loan); }
      } else if (loanId && ["startDate", "maturity"].includes(field)) {
        const loan = state.loanMap[loanId];
        if (loan) { loan[field] = val; saveLoanOverride(loan); }
      } else if (propertyId && field === "propNotes") {
        const p = state.propertyMap[propertyId];
        if (p) { p.notes = val; savePropertyOverride(p); }
      } else if (propertyId && ["postalCode", "lotNumber", "matricule"].includes(field)) {
        const p = state.propertyMap[propertyId];
        if (p) { p[field] = val; savePropertyOverride(p); }
      } else if (propertyId && !loanId && ["addr", "neighborhood", "owner", "value", "city", "type", "yearBuilt"].includes(field)) {
        const p = state.propertyMap[propertyId];
        if (p) {
          p[field] = val;
          savePropertyOverride(p);
        }
      }

      buildIndexes();
      if (isNum) el.value = formatNumberWithCommas(val);
      if (typeof populatePortfolioFilters === "function") populatePortfolioFilters();
      if (typeof populateMapLenderChips === "function") populateMapLenderChips();
      if (typeof populateMapTypeChips === "function") populateMapTypeChips();
      if (typeof populateMapRankChips === "function") populateMapRankChips();
      if (typeof populateMapLoanTypeChips === "function") populateMapLoanTypeChips();
      refreshMap();
      renderDashboard();
      if (loanId || !propertyId || el.closest("#portfolio-loans")) renderLoansList();
      else renderPropertiesList();
    });
  });
}

/* ---------- Sous-onglet : Immeubles ---------- */
function renderPropertiesList() {
  const fCity = document.getElementById("props-filter-city").value;
  const fType = document.getElementById("props-filter-type").value;

  let list = [...state.properties];
  if (fCity !== "all") list = list.filter(p => p.city === fCity);
  if (fType !== "all") list = list.filter(p => p.type === fType);

  // Trier par exposition totale par défaut (plus grand d'abord), sauf si un
  // tri par en-tête de colonne est actif.
  let enriched = list.map(p => {
    const loans = loansForProperty(p.id);
    const totalGuar = loans.reduce((s, l) => s + l.amount, 0);
    const lv = propertyLtv(p, totalGuar);
    const lotInfo = typeof getLotInfo === "function" ? getLotInfo(p) : { postalCode: "", matricule: "", lotNumber: "" };
    return { p, loans, totalGuar, lv, lotInfo };
  });

  if (!propSort.key) {
    enriched.sort((a, b) => b.totalGuar - a.totalGuar);
  } else {
    const PROP_SORT_GETTERS = {
      addr: r => r.p.addr || "",
      owner: r => r.p.owner || "",
      value: r => r.p.value || 0,
      yearBuilt: r => r.p.yearBuilt || 0,
      totalGuar: r => r.totalGuar || 0,
      ltv: r => r.lv || 0,
      loanCount: r => r.loans.length,
      city: r => r.p.city || "",
      type: r => r.p.type || "",
      postalCode: r => r.lotInfo.postalCode || "",
      lotNumber: r => r.lotInfo.lotNumber || "",
      matricule: r => r.lotInfo.matricule || "",
    };
    enriched = applySort(enriched, propSort, PROP_SORT_GETTERS);
  }

  document.getElementById("props-count").textContent = `${list.length} immeubles`;

  const body = document.getElementById("props-body");
  if (list.length === 0) {
    body.innerHTML = `<div class="gt-empty"><i class="ti ti-folder-open"></i><div>Aucun immeuble ne correspond aux filtres.</div></div>`;
    return;
  }

  body.innerHTML = `
    <table>
      <thead>
        <tr>
          <th></th>
          ${sortTh("Adresse", "addr", propSort)}
          ${sortTh("Propriétaire", "owner", propSort)}
          ${sortTh("Valeur", "value", propSort)}
          ${sortTh("Année construction", "yearBuilt", propSort)}
          ${sortTh("Total garanti", "totalGuar", propSort)}
          ${sortTh("LTV total", "ltv", propSort)}
          ${sortTh("Prêts", "loanCount", propSort)}
          ${sortTh("Ville", "city", propSort)}
          ${sortTh("Type", "type", propSort)}
          <th>Province</th>
          ${sortTh("Code postal", "postalCode", propSort)}
          <th>Pays</th>
          ${sortTh("Lot cadastral", "lotNumber", propSort)}
          ${sortTh("Matricule", "matricule", propSort)}
          <th>Google Maps</th>
        </tr>
      </thead>
      <tbody>
        ${enriched.map(({ p, loans, totalGuar, lv, lotInfo }) => {
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
          return `
            <tr data-property-id="${p.id}">
              <td>
                <button class="gt-open-loan-btn" data-property-id="${p.id}" title="Voir la fiche complète de l'immeuble" style="display:flex;align-items:center;gap:4px;background:var(--color-brand-blue,#2277B5);color:#FFFFFF;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
                  <i class="ti ti-building"></i> Voir
                </button>
              </td>
              <td>
                <input class="gt-inline-edit" data-property-id="${p.id}" data-field="addr" value="${p.addr || ""}" style="font-weight:500" />
                <input class="gt-inline-edit" data-property-id="${p.id}" data-field="neighborhood" value="${p.neighborhood || ""}" placeholder="Quartier" style="font-size:11px;color:var(--color-text-secondary)" />
              </td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="owner" value="${p.owner || ""}" /></td>
              <td><input class="gt-inline-edit gt-inline-edit-num" data-property-id="${p.id}" data-field="value" value="${formatNumberWithCommas(p.value)}" /></td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="yearBuilt" value="${p.yearBuilt || ""}" placeholder="—" style="width:70px" /></td>
              <td style="font-weight:500">${fmtK(totalGuar)}</td>
              <td style="color:${ltvColor(lv)};font-weight:500">${lv}%</td>
              <td><span class="gt-count-pill"><i class="ti ti-file-invoice"></i> ${loans.length}</span></td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="city" value="${p.city || ""}" /></td>
              <td>
                <select class="gt-inline-edit" data-property-id="${p.id}" data-field="type">
                  <option value="">—</option>
                  ${CONFIG.options.propertyTypes.map(t => `<option value="${t}" ${t === p.type ? "selected" : ""}>${t}</option>`).join("")}
                </select>
              </td>
              <td style="font-size:12px;color:var(--color-text-secondary)">Québec</td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="postalCode" value="${lotInfo.postalCode || ""}" /></td>
              <td style="font-size:12px;color:var(--color-text-secondary)">Canada</td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="lotNumber" value="${lotInfo.lotNumber || ""}" /></td>
              <td><input class="gt-inline-edit" data-property-id="${p.id}" data-field="matricule" value="${lotInfo.matricule || ""}" /></td>
              <td><a href="${mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ouvrir</a></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wireInlineEdits(body);
  wireSortHeaders(body, propSort, renderPropertiesList);

  body.querySelectorAll("tr[data-property-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("input, select")) return;
      selectProperty(row.dataset.propertyId);
    });
  });
}