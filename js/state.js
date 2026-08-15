/* =====================================================================
   state.js — état central
   ===================================================================== */

const state = {
  // Données brutes
  loans: [],
  properties: [],
  parcels: [], // Polygones de lot réels (optionnel — voir extract_parcels.py)
  sectorValues: {}, // Moyennes par secteur (code_mun|secteur|type_propriete) — voir compute_sector_values.py

  // Index pour recherche rapide
  propertyMap: {},        // { propertyId → property }
  loanMap: {},            // { loanId → loan }
  loansByProperty: {},    // { propertyId → [loans qui la grèvent] }

  // Portfolio suivi (par prêt, puisque le suivi est financier)
  savedLoans: new Set(),

  // Sélection courante
  // selectedType: "loan" | "property" | "search" | null
  // selectedId: id correspondant (null si selectedType === "search")
  selectedType: null,
  selectedId: null,
  // Objet immeuble temporaire quand selectedType === "search"
  // (résultat du geocoder qui ne correspond à aucun immeuble existant)
  searchResult: null,
  editing: false,

  // Filtres carte
  filters: {
    status: "all",
    city: "all",
    type: "all",
    view: "all"
  },

  // Sous-onglet du portfolio: "loans" ou "properties"
  portfolioTab: "loans"
};

/* ---------- Construction des index ---------- */
function buildIndexes() {
  state.propertyMap = {};
  state.loanMap = {};
  state.loansByProperty = {};

  state.properties.forEach(p => { state.propertyMap[p.id] = p; });
  state.loans.forEach(l => { state.loanMap[l.id] = l; });

  state.loans.forEach(loan => {
    (loan.collateral || []).forEach(c => {
      if (!state.loansByProperty[c.propertyId]) {
        state.loansByProperty[c.propertyId] = [];
      }
      state.loansByProperty[c.propertyId].push({
        loanId: loan.id,
        amount: c.amount,
        rank: c.rank
      });
    });
  });
}

/* ---------- Prochain ID disponible pour un nouvel immeuble ---------- */
function nextPropertyId() {
  const nums = state.properties
    .map(p => parseInt(String(p.id || "").replace(/\D/g, ""), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "P" + String(max + 1).padStart(3, "0");
}

/* ---------- Prochain ID disponible pour un nouveau prêt ---------- */
function nextLoanId() {
  const nums = state.loans
    .map(l => parseInt(String(l.id || "").replace(/\D/g, ""), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "L" + String(max + 1).padStart(3, "0");
}

/* ---------- Statut agrégé d'un immeuble ---------- */
// Un immeuble n'a pas de statut propre — il hérite du statut le plus "chaud"
// parmi les prêts qui le grèvent.
const STATUS_PRIORITY = ["high", "missing", "pending", "refused", "active", "verified", "released"];

function propertyStatus(propertyId) {
  const links = state.loansByProperty[propertyId] || [];
  if (links.length === 0) return "released";
  const statuses = links.map(l => state.loanMap[l.loanId].status);
  for (const s of STATUS_PRIORITY) {
    if (statuses.includes(s)) return s;
  }
  return "active";
}

/* ---------- Prêts qui grèvent un immeuble ---------- */
function loansForProperty(propertyId) {
  const links = state.loansByProperty[propertyId] || [];
  return links.map(l => ({
    loan: state.loanMap[l.loanId],
    amount: l.amount,
    rank: l.rank
  }));
}

/* ---------- Immeubles en garantie d'un prêt ---------- */
function propertiesForLoan(loanId) {
  const loan = state.loanMap[loanId];
  if (!loan || !loan.collateral) return [];
  return loan.collateral.map(c => ({
    property: state.propertyMap[c.propertyId],
    amount: c.amount,
    rank: c.rank
  })).filter(x => x.property);
}

/* ---------- Filtres de la carte ---------- */
function propertyPassesFilters(p) {
  const f = state.filters;
  if (f.city !== "all" && p.city !== f.city) return false;
  if (f.type !== "all" && p.type !== f.type) return false;

  const status = propertyStatus(p.id);
  if (f.status !== "all" && status !== f.status) return false;

  if (f.view === "saved") {
    const loans = loansForProperty(p.id);
    const anySaved = loans.some(l => state.savedLoans.has(l.loan.id));
    if (!anySaved) return false;
  }

  return true;
}