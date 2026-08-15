/* =====================================================================
   dashboard.js — métriques basées sur les PRÊTS (pas d'immeubles double-comptés)
   ===================================================================== */

function renderDashboard() {
  const savedLoans = state.loans.filter(l => state.savedLoans.has(l.id));

  renderMetrics(savedLoans);
  renderExposureByLender(savedLoans);
  renderExposureByType(savedLoans);
  renderAlerts(savedLoans);
  renderGanttChart(savedLoans);
}

function renderMetrics(loans) {
  const totalBalance = loans.reduce((s, l) => s + l.balance, 0);

  // Somme des valeurs uniques d'immeubles impliqués (évite double-comptage)
  const propertyIds = new Set();
  loans.forEach(l => (l.collateral || []).forEach(c => propertyIds.add(c.propertyId)));
  const totalCollateralValue = [...propertyIds].reduce((s, pid) => {
    const p = state.propertyMap[pid];
    return s + (p ? p.value : 0);
  }, 0);

  const avgLtv = loans.length
    ? Math.round(loans.reduce((s, l) => s + loanLtv(l, state.propertyMap), 0) / loans.length)
    : 0;
  const highRisk = loans.filter(l => l.risk === "Élevé").length;
  const maturingSoon = loans.filter(l =>
    l.maturity && l.maturity < "2026-12-31" && l.maturity > "2025-01-01"
  ).length;

  document.getElementById("metrics").innerHTML = `
    <div class="gt-metric">
      <div class="gt-metric-label">Prêts suivis</div>
      <div class="gt-metric-val">${loans.length}</div>
      <div class="gt-metric-sub">${propertyIds.size} immeubles impliqués</div>
    </div>
    <div class="gt-metric">
      <div class="gt-metric-label">Encours total</div>
      <div class="gt-metric-val">${fmtK(totalBalance)}</div>
      <div class="gt-metric-sub">vs ${fmtK(totalCollateralValue)} en garantie</div>
    </div>
    <div class="gt-metric">
      <div class="gt-metric-label">LTV moyen</div>
      <div class="gt-metric-val">${avgLtv}%</div>
      <div class="gt-metric-sub">${highRisk} prêts risque élevé</div>
    </div>
    <div class="gt-metric">
      <div class="gt-metric-label">Échéances à venir</div>
      <div class="gt-metric-val">${maturingSoon}</div>
      <div class="gt-metric-sub">prêt${maturingSoon > 1 ? "s" : ""} arrivant à échéance</div>
    </div>
  `;
}

function renderExposureByLender(loans) {
  renderBarChart(loans, "lender", "lender-bars", "");
}

function renderExposureByType(loans) {
  renderBarChart(loans, "type", "type-bars", "gt-bar-fill-alt");
}

function renderBarChart(loans, key, mountId, fillClass) {
  const tally = {};
  loans.forEach(l => {
    const k = l[key] || "—";
    tally[k] = (tally[k] || 0) + l.balance;
  });

  const mount = document.getElementById(mountId);
  if (Object.keys(tally).length === 0) {
    mount.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:12px">Aucun prêt suivi.</div>`;
    return;
  }
  const max = Math.max(...Object.values(tally), 1);

  mount.innerHTML = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="gt-bar">
        <span class="gt-bar-label">${k}</span>
        <span class="gt-bar-track">
          <span class="gt-bar-fill ${fillClass}" style="width:${(v / max) * 100}%"></span>
        </span>
        <span class="gt-bar-val">${fmtK(v)}</span>
      </div>
    `).join("");
}

function renderAlerts(loans) {
  const alerts = [];
  loans.forEach(l => {
    if (l.maturity && l.maturity < "2026-07-01" && l.maturity > "2025-01-01") {
      alerts.push({ type: "warn", msg: `Échéance ${l.maturity}`, loan: l });
    }
    const lv = loanLtv(l, state.propertyMap);
    if (lv > 75) {
      alerts.push({ type: "danger", msg: `LTV à ${lv}% — revoir la garantie`, loan: l });
    }
  });

  const mount = document.getElementById("alerts");
  if (alerts.length === 0) {
    mount.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:12px">Aucune alerte.</div>`;
    return;
  }

  mount.innerHTML = alerts.slice(0, 12).map(a => `
    <div class="gt-alert ${a.type === 'danger' ? 'danger' : ''}" data-loan-id="${a.loan.id}">
      <i class="ti ti-${a.type === 'danger' ? 'alert-octagon' : 'bell'}"></i>
      <div class="gt-alert-msg">
        ${a.msg}
        <div class="gt-alert-prop">Prêt ${a.loan.borrower} • ${a.loan.lender}</div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--color-text-tertiary)"></i>
    </div>
  `).join("");

  mount.querySelectorAll("[data-loan-id]").forEach(el => {
    el.addEventListener("click", () => selectLoan(el.dataset.loanId));
  });
}

/* =====================================================================
   Gantt / calendrier des prêts (date de début → échéance)
   ===================================================================== */
function renderGanttChart(loans) {
  const mount = document.getElementById("gantt-chart");
  if (!mount) return;

  const withDates = loans.filter(l => l.startDate && l.maturity);
  const withoutDates = loans.length - withDates.length;

  if (withDates.length === 0) {
    mount.innerHTML = `
      <div style="color:var(--color-text-tertiary);font-size:12px;padding:8px 0">
        Aucun prêt suivi n'a encore de date de début ET d'échéance renseignées.
        ${withoutDates > 0 ? `(${withoutDates} prêt${withoutDates > 1 ? "s" : ""} sans dates — complète-les via "Modifier le prêt".)` : ""}
      </div>
    `;
    return;
  }

  // Plage globale (du premier début à la dernière échéance), avec un peu de marge
  const starts = withDates.map(l => new Date(l.startDate).getTime());
  const ends = withDates.map(l => new Date(l.maturity).getTime());
  let rangeStart = Math.min(...starts);
  let rangeEnd = Math.max(...ends);
  const pad = (rangeEnd - rangeStart) * 0.03 || (30 * 24 * 3600 * 1000);
  rangeStart -= pad;
  rangeEnd += pad;
  const totalSpan = rangeEnd - rangeStart;

  // Repères en janvier de chaque année couverte
  const startYear = new Date(rangeStart).getFullYear();
  const endYear = new Date(rangeEnd).getFullYear();
  const yearMarkers = [];
  for (let y = startYear; y <= endYear; y++) {
    const t = new Date(`${y}-01-01`).getTime();
    if (t >= rangeStart && t <= rangeEnd) {
      yearMarkers.push({ year: y, pct: ((t - rangeStart) / totalSpan) * 100 });
    }
  }

  const todayPct = ((Date.now() - rangeStart) / totalSpan) * 100;

  const rows = withDates
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .map(l => {
      const s = new Date(l.startDate).getTime();
      const e = new Date(l.maturity).getTime();
      const left = ((s - rangeStart) / totalSpan) * 100;
      const width = Math.max(((e - s) / totalSpan) * 100, 0.6);
      const status = CONFIG.statusMap[l.status] || CONFIG.statusMap.active;
      return `
        <div class="gt-gantt-row" data-loan-id="${l.id}">
          <div class="gt-gantt-label" title="${l.borrower}">${l.borrower}</div>
          <div class="gt-gantt-track">
            <div class="gt-gantt-bar" style="left:${left}%; width:${width}%; background:${status.color};"
                 title="${l.startDate} → ${l.maturity}"></div>
          </div>
        </div>
      `;
    }).join("");

  mount.innerHTML = `
    <div class="gt-gantt">
      <div class="gt-gantt-axis">
        <div class="gt-gantt-label"></div>
        <div class="gt-gantt-track">
          ${yearMarkers.map(m => `<div class="gt-gantt-year" style="left:${m.pct}%">${m.year}</div>`).join("")}
          ${todayPct >= 0 && todayPct <= 100 ? `<div class="gt-gantt-today" style="left:${todayPct}%"></div>` : ""}
        </div>
      </div>
      ${rows}
    </div>
    ${withoutDates > 0 ? `<div style="color:var(--color-text-tertiary);font-size:11px;margin-top:8px;">${withoutDates} prêt${withoutDates > 1 ? "s" : ""} sans dates, non affiché${withoutDates > 1 ? "s" : ""} ci-dessus.</div>` : ""}
  `;

  mount.querySelectorAll("[data-loan-id]").forEach(el => {
    el.addEventListener("click", () => selectLoan(el.dataset.loanId));
  });
}