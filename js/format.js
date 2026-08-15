/* =====================================================================
   format.js — formatage & calculs
   ===================================================================== */

function fmtK(n) {
  n = Number(n || 0);
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(2) + "M";
  return "$" + Math.round(n / 1000) + "K";
}

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("en-CA");
}

// Comme fmt(), mais toujours avec 2 décimales (ex: pour les valeurs ajustées).
function fmt2(n) {
  return "$" + Number(n || 0).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// LTV d'un prêt sur un immeuble: montant garanti / valeur immeuble
function propertyLtv(property, guaranteedAmount) {
  if (!property || !property.value) return 0;
  return Math.round((guaranteedAmount / property.value) * 100);
}

// LTV pondéré d'un prêt réparti sur plusieurs immeubles
function loanLtv(loan, propertyMap) {
  if (!loan.collateral || loan.collateral.length === 0) return 0;
  const totalValue = loan.collateral.reduce((sum, c) => {
    const p = propertyMap[c.propertyId];
    return sum + (p ? p.value : 0);
  }, 0);
  if (totalValue === 0) return 0;
  return Math.round((loan.balance / totalValue) * 100);
}

function ltvColor(lv) {
  if (lv > 75) return "#A32D2D";
  if (lv > 60) return "#854F0B";
  return "#0F6E56";
}

// Ajuste une valeur de vente passée à la valeur d'aujourd'hui, selon un des indices
// de la table de taux (immobilier résidentiel de l'Île de Montréal, base 2000).
// method: "immo" (défaut, indice immobilier seul), "inflation", ou "combine" (immo + inflation)
function adjustedValue(amount, saleYear, method) {
  method = method || "immo";
  const rates = CONFIG.montrealResidentialRates;
  if (!rates || !amount || !saleYear) return null;
  const years = Object.keys(rates).map(Number);
  const latestYear = Math.max(...years);
  const fromEntry = rates[saleYear];
  const toEntry = rates[latestYear];
  if (!fromEntry || !toEntry) return null;

  const field = method === "combine" ? "indexCombined" : method === "inflation" ? "indexInflation" : "indexImmo";
  if (!fromEntry[field] || !toEntry[field]) return null;
  return Math.round(amount * (toEntry[field] / fromEntry[field]));
}

// Raccourci pour la valeur ajustée combinée (immobilier + inflation)
function adjustedValueCombined(amount, saleYear) {
  return adjustedValue(amount, saleYear, "combine");
}

function docCount(x) {
  return Object.values(x.docs || {}).filter(Boolean).length;
}

function docTotal(x) {
  return Object.keys(x.docs || {}).length;
}

/* ---------- Champs $ avec virgules de milliers, formatés en direct ---------- */
function formatNumberWithCommas(n) {
  return Number(n || 0).toLocaleString("fr-CA");
}

function parseFormattedNumber(str) {
  return Number(String(str || "").replace(/[^\d.-]/g, "")) || 0;
}

// Ajoute le formatage en direct (virgules) sur un <input type="text"> — préserve
// la position du curseur pendant la frappe pour rester agréable à utiliser.
function attachNumberFormatting(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener("input", () => {
    const cursorFromEnd = inputEl.value.length - inputEl.selectionStart;
    const raw = parseFormattedNumber(inputEl.value);
    inputEl.value = raw ? formatNumberWithCommas(raw) : "";
    const newPos = Math.max(0, inputEl.value.length - cursorFromEnd);
    inputEl.setSelectionRange(newPos, newPos);
  });
}

// Badge de statut générique — fonctionne pour les statuts intégrés (classe CSS)
// comme pour les statuts personnalisés (couleur en ligne, pas de classe dédiée).
function statusBadgeHtml(statusKey) {
  const s = CONFIG.statusMap[statusKey] || CONFIG.statusMap.active;
  if (s.custom) {
    return `<span class="gt-badge" style="background:${s.color}22;color:${s.color};">${s.label}</span>`;
  }
  return `<span class="gt-badge ${s.badge}">${s.label}</span>`;
}