/* =====================================================================
   rates.js — Table des taux annuels (immobilier / inflation) éditable
   ===================================================================== */

const RATE_OVERRIDES_KEY = "terreno_rate_overrides";

/* ---------- Persistance ---------- */
function loadRateOverrides() {
  try {
    const raw = localStorage.getItem(RATE_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return null;
  }
}

function saveRateOverrides() {
  try {
    localStorage.setItem(RATE_OVERRIDES_KEY, JSON.stringify(CONFIG.montrealResidentialRates));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

// Copie de référence des valeurs d'origine (avant toute modification utilisateur),
// utilisée par le bouton "Réinitialiser".
let DEFAULT_RATES_SNAPSHOT = null;

function applyRateOverridesOnBoot() {
  DEFAULT_RATES_SNAPSHOT = JSON.parse(JSON.stringify(CONFIG.montrealResidentialRates));
  const overrides = loadRateOverrides();
  if (overrides) {
    CONFIG.montrealResidentialRates = overrides;
    console.log("Terreno: table de taux personnalisée restaurée depuis localStorage.");
  }
}

/* ---------- Recalcul en cascade des taux combinés et indices ---------- */
function round1(n) {
  return Math.round(n * 10) / 10;
}

function recomputeRatesCascade() {
  const rates = CONFIG.montrealResidentialRates;
  const years = Object.keys(rates).map(Number).sort((a, b) => a - b);

  years.forEach((y, i) => {
    const entry = rates[y];
    // Taux combiné = capitalisation multiplicative immobilier × inflation, pas une simple somme
    entry.combinedRate = round1(((1 + entry.realEstateRate / 100) * (1 + entry.inflationRate / 100) - 1) * 100);

    if (i === 0) {
      entry.indexImmo = 100.0;
      entry.indexInflation = 100.0;
      entry.indexCombined = 100.0;
    } else {
      const prev = rates[years[i - 1]];
      entry.indexImmo = round1(prev.indexImmo * (1 + entry.realEstateRate / 100));
      entry.indexInflation = round1(prev.indexInflation * (1 + entry.inflationRate / 100));
      entry.indexCombined = round1(prev.indexCombined * (1 + entry.combinedRate / 100));
    }
  });
}

/* ---------- Rendu du tableau ---------- */
function renderRatesTable() {
  const mount = document.getElementById("rates-table-body");
  if (!mount) return;

  const rates = CONFIG.montrealResidentialRates;
  const years = Object.keys(rates).map(Number).sort((a, b) => a - b);

  mount.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Année</th>
          <th>Taux immobilier (%)</th>
          <th>Inflation (%)</th>
          <th>Taux combiné</th>
          <th>Indice immobilier</th>
          <th>Indice inflation</th>
          <th>Indice combiné</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${years.map(y => {
          const e = rates[y];
          return `
            <tr data-year="${y}">
              <td style="font-weight:600;">${y}</td>
              <td><input class="rate-input" data-year="${y}" data-field="realEstateRate" type="number" step="0.1" value="${e.realEstateRate}"
                     style="width:80px;height:30px;padding:0 6px;border-radius:6px;border:1px solid var(--color-border);font-family:var(--font-sans);font-size:13px;" /></td>
              <td><input class="rate-input" data-year="${y}" data-field="inflationRate" type="number" step="0.1" value="${e.inflationRate}"
                     style="width:80px;height:30px;padding:0 6px;border-radius:6px;border:1px solid var(--color-border);font-family:var(--font-sans);font-size:13px;" /></td>
              <td id="rate-combined-${y}" style="color:var(--color-text-secondary);">${e.combinedRate.toFixed(1)}%</td>
              <td id="rate-idximmo-${y}" style="color:var(--color-text-secondary);">${e.indexImmo.toFixed(1)}</td>
              <td id="rate-idxinfl-${y}" style="color:var(--color-text-secondary);">${e.indexInflation.toFixed(1)}</td>
              <td id="rate-idxcomb-${y}" style="color:var(--color-text-secondary);font-weight:600;">${e.indexCombined.toFixed(1)}</td>
              <td>
                <button type="button" class="gt-remove-rate-year" data-year="${y}" style="border:none;background:none;color:var(--color-text-tertiary);cursor:pointer;padding:4px;">
                  <i class="ti ti-trash"></i>
                </button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  mount.querySelectorAll(".rate-input").forEach(el => {
    el.addEventListener("input", () => {
      const year = Number(el.dataset.year);
      const field = el.dataset.field;
      CONFIG.montrealResidentialRates[year][field] = Number(el.value) || 0;
      recomputeRatesCascade();
      updateRatesTableComputedCells();
      saveRateOverrides();
    });
  });

  mount.querySelectorAll(".gt-remove-rate-year").forEach(el => {
    el.addEventListener("click", () => {
      const year = Number(el.dataset.year);
      if (!confirm(`Retirer l'année ${year} de la table de taux ?`)) return;
      delete CONFIG.montrealResidentialRates[year];
      recomputeRatesCascade();
      saveRateOverrides();
      renderRatesTable();
    });
  });
}

// Met à jour seulement les cellules calculées (sans reconstruire les inputs, pour ne pas perdre le focus)
function updateRatesTableComputedCells() {
  const rates = CONFIG.montrealResidentialRates;
  Object.keys(rates).forEach(y => {
    const e = rates[y];
    const combinedEl = document.getElementById(`rate-combined-${y}`);
    const idxImmoEl = document.getElementById(`rate-idximmo-${y}`);
    const idxInflEl = document.getElementById(`rate-idxinfl-${y}`);
    const idxCombEl = document.getElementById(`rate-idxcomb-${y}`);
    if (combinedEl) combinedEl.textContent = `${e.combinedRate.toFixed(1)}%`;
    if (idxImmoEl) idxImmoEl.textContent = e.indexImmo.toFixed(1);
    if (idxInflEl) idxInflEl.textContent = e.indexInflation.toFixed(1);
    if (idxCombEl) idxCombEl.textContent = e.indexCombined.toFixed(1);
  });
}

function renderRatesPage() {
  renderRatesTable();
}

/* ---------- Boutons d'action ---------- */
function wireRatesUI() {
  const addBtn = document.getElementById("add-rate-year-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      const years = Object.keys(CONFIG.montrealResidentialRates).map(Number);
      const nextYear = Math.max(...years) + 1;
      CONFIG.montrealResidentialRates[nextYear] = {
        realEstateRate: 0, inflationRate: 0, combinedRate: 0,
        indexImmo: 0, indexInflation: 0, indexCombined: 0
      };
      recomputeRatesCascade();
      saveRateOverrides();
      renderRatesTable();
    });
  }

  const resetBtn = document.getElementById("reset-rates-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm("Réinitialiser la table de taux aux valeurs par défaut ? Toutes tes modifications seront perdues.")) return;
      CONFIG.montrealResidentialRates = JSON.parse(JSON.stringify(DEFAULT_RATES_SNAPSHOT));
      localStorage.removeItem(RATE_OVERRIDES_KEY);
      renderRatesTable();
    });
  }
}
