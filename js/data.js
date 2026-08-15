/* =====================================================================
   data.js — chargement des données depuis les fichiers JSON
   ===================================================================== */

const LOAN_OVERRIDES_KEY = "terreno_loan_overrides";
const PROPERTY_OVERRIDES_KEY = "terreno_property_overrides";
const EXTRA_PARCELS_KEY = "terreno_extra_parcels";
const SAVED_LOANS_KEY = "terreno_saved_loans";
const DELETED_PROPERTIES_KEY = "terreno_deleted_properties";
const DELETED_LOANS_KEY = "terreno_deleted_loans";

/* ---------- Immeubles supprimés (à exclure définitivement, même de properties.json) ---------- */
function loadDeletedPropertyIds() {
  try {
    const raw = localStorage.getItem(DELETED_PROPERTIES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return new Set();
  }
}

function markPropertyDeleted(propertyId) {
  try {
    const ids = loadDeletedPropertyIds();
    ids.add(propertyId);
    localStorage.setItem(DELETED_PROPERTIES_KEY, JSON.stringify([...ids]));

    // Retire aussi toute surcharge/override existante pour cet immeuble, pour ne pas
    // qu'elle "ressuscite" la fiche au prochain chargement.
    const overrides = loadPropertyOverrides();
    if (overrides[propertyId]) {
      delete overrides[propertyId];
      localStorage.setItem(PROPERTY_OVERRIDES_KEY, JSON.stringify(overrides));
    }
    const extra = loadExtraParcels();
    if (extra[propertyId]) {
      delete extra[propertyId];
      localStorage.setItem(EXTRA_PARCELS_KEY, JSON.stringify(extra));
    }
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

/* ---------- Prêts supprimés (à exclure définitivement, même de loans.json) ---------- */
function loadDeletedLoanIds() {
  try {
    const raw = localStorage.getItem(DELETED_LOANS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return new Set();
  }
}

function markLoanDeleted(loanId) {
  try {
    const ids = loadDeletedLoanIds();
    ids.add(loanId);
    localStorage.setItem(DELETED_LOANS_KEY, JSON.stringify([...ids]));

    // Retire aussi toute surcharge existante pour ce prêt, pour qu'elle ne le
    // "ressuscite" pas au prochain chargement.
    const overrides = loadLoanOverrides();
    if (overrides[loanId]) {
      delete overrides[loanId];
      localStorage.setItem(LOAN_OVERRIDES_KEY, JSON.stringify(overrides));
    }
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

/* ---------- Surcharge localStorage des prêts modifiés ---------- */
function loadLoanOverrides() {
  try {
    const raw = localStorage.getItem(LOAN_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return {};
  }
}

function saveLoanOverride(loan) {
  try {
    const overrides = loadLoanOverrides();
    overrides[loan.id] = loan;
    localStorage.setItem(LOAN_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

/* ---------- Surcharge localStorage des immeubles (modifiés OU nouvellement ajoutés) ---------- */
function loadPropertyOverrides() {
  try {
    const raw = localStorage.getItem(PROPERTY_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return {};
  }
}

function savePropertyOverride(property) {
  try {
    const overrides = loadPropertyOverrides();
    overrides[property.id] = property;
    localStorage.setItem(PROPERTY_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

/* ---------- Polygones de lot ajoutés localement (clic sur le tileset, hors extract_parcels.py) ---------- */
function loadExtraParcels() {
  try {
    const raw = localStorage.getItem(EXTRA_PARCELS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return {};
  }
}

function saveExtraParcel(propertyId, geometry) {
  try {
    const extra = loadExtraParcels();
    extra[propertyId] = geometry;
    localStorage.setItem(EXTRA_PARCELS_KEY, JSON.stringify(extra));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

/* ---------- Persistance de l'ensemble des prêts suivis ---------- */
function loadSavedLoanIds() {
  try {
    const raw = localStorage.getItem(SAVED_LOANS_KEY);
    return raw ? JSON.parse(raw) : null; // null = jamais sauvegardé, utiliser le défaut
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return null;
  }
}

function persistSavedLoanIds() {
  try {
    localStorage.setItem(SAVED_LOANS_KEY, JSON.stringify([...state.savedLoans]));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

async function loadData() {
  try {
    const [propsRes, loansRes] = await Promise.all([
      fetch("data/properties.json"),
      fetch("data/loans.json")
    ]);

    if (!propsRes.ok) throw new Error(`properties.json → HTTP ${propsRes.status}`);
    if (!loansRes.ok) throw new Error(`loans.json → HTTP ${loansRes.status}`);

    state.properties = await propsRes.json();
    state.loans = await loansRes.json();

    // Table des valeurs moyennes par secteur (municipalité + secteur + type) — optionnelle,
    // n'empêche pas le reste de l'app de fonctionner si le fichier n'existe pas encore.
    try {
      const sectorRes = await fetch("data/sector_values.json");
      if (sectorRes.ok) {
        state.sectorValues = await sectorRes.json();
        console.log(`Terreno: ${Object.keys(state.sectorValues).length} groupes de valeurs sectorielles chargés.`);
      }
    } catch (e) {
      console.warn("Terreno: table des valeurs sectorielles non chargée.", e);
    }

    // Applique les modifications sauvegardées localement (localStorage) par-dessus loans.json / properties.json
    const loanOverrides = loadLoanOverrides();
    if (Object.keys(loanOverrides).length > 0) {
      state.loans = state.loans.map(l => loanOverrides[l.id] || l);
    }

    // Immeubles : d'abord appliquer les modifications sur les entrées existantes,
    // puis ajouter les immeubles entièrement nouveaux (créés via recherche/clic sur un lot,
    // donc absents de properties.json) qui ne seraient sinon pas restaurés au chargement.
    const propertyOverrides = loadPropertyOverrides();
    const existingIds = new Set(state.properties.map(p => p.id));
    if (Object.keys(propertyOverrides).length > 0) {
      state.properties = state.properties.map(p => propertyOverrides[p.id] || p);
      Object.values(propertyOverrides).forEach(p => {
        if (!existingIds.has(p.id)) state.properties.push(p);
      });
    }

    if (Object.keys(loanOverrides).length > 0 || Object.keys(propertyOverrides).length > 0) {
      console.log(`Terreno: ${Object.keys(loanOverrides).length} prêt(s) et ${Object.keys(propertyOverrides).length} immeuble(s) modifié(s)/ajouté(s) restaurés depuis localStorage.`);
    }

    // Exclut définitivement les immeubles supprimés (et nettoie les références dans les prêts)
    const deletedIds = loadDeletedPropertyIds();
    if (deletedIds.size > 0) {
      state.properties = state.properties.filter(p => !deletedIds.has(p.id));
      state.loans.forEach(l => {
        if (l.collateral) l.collateral = l.collateral.filter(c => !deletedIds.has(c.propertyId));
      });
      console.log(`Terreno: ${deletedIds.size} immeuble(s) supprimé(s) exclu(s).`);
    }

    const deletedLoanIds = loadDeletedLoanIds();
    if (deletedLoanIds.size > 0) {
      state.loans = state.loans.filter(l => !deletedLoanIds.has(l.id));
      console.log(`Terreno: ${deletedLoanIds.size} prêt(s) supprimé(s) exclu(s).`);
    }

    migrateLegacyEnglishValues();

    buildIndexes();

    // Prêts suivis : reprend la sélection de l'utilisateur si elle a déjà été sauvegardée,
    // sinon comportement par défaut (tous les prêts non libérés)
    const savedLoanIds = loadSavedLoanIds();
    state.savedLoans = savedLoanIds
      ? new Set(savedLoanIds.filter(id => state.loanMap[id]))
      : new Set(state.loans.filter(l => l.status !== "released").map(l => l.id));

    // Polygones de lot réels (optionnel — généré via extract_parcels.py)
    try {
      const parcelsRes = await fetch("data/parcels.json");
      if (parcelsRes.ok) {
        state.parcels = await parcelsRes.json();
      }
    } catch (e) {
      // data/parcels.json absent — pas grave, on utilise le style de bâtiments générique en attendant
    }

    // Ajoute les lots trouvés localement (clic direct sur le tileset) qui ne sont pas
    // encore dans data/parcels.json, pour qu'ils survivent à un rechargement de page.
    const extraParcels = loadExtraParcels();
    const knownParcelIds = new Set(state.parcels.map(pc => pc.propertyId));
    Object.entries(extraParcels).forEach(([propertyId, geometry]) => {
      if (!knownParcelIds.has(propertyId) && state.propertyMap[propertyId]) {
        state.parcels.push({ propertyId, geometry });
      }
    });

    if (deletedIds.size > 0) {
      state.parcels = state.parcels.filter(pc => !deletedIds.has(pc.propertyId));
    }

    console.log(`Terreno: ${state.parcels.length} polygones de lot chargés.`);

  } catch (err) {
    console.error("Erreur de chargement des données :", err);
    alert(
      "Impossible de charger les fichiers de données.\n\n" +
      "Assure-toi d'utiliser un serveur local (Live Server, " +
      "python -m http.server, etc.). Ouvrir le fichier directement en file:// " +
      "va bloquer le fetch.\n\nDétail: " + err.message
    );
  }
}

/* ---------- Migration ponctuelle : anciennes valeurs anglaises → françaises ---------- */
const LEGACY_VALUE_MAP = {
  type: {
    "Personal": "Personnel", "Corporate": "Corporatif", "Mortgage-backed": "Hypothécaire",
    "Collateral": "Marge de crédit", "Co-signed": "Co-signé", "Shareholder": "Actionnaire", "Other": "Autre"
  },
  propertyType: {
    "Single-family": "Unifamiliale", "Multi-family": "Multi-logements", "Land": "Terrain"
    // Condo, Duplex, Triplex, Commercial restent identiques
  },
  rank: {
    "First rank": "1er rang", "Second rank": "2e rang", "Third rank": "3e rang",
    "Unsecured": "Sans garantie", "Released": "Libéré"
  },
  risk: { "Low": "Faible", "Medium": "Moyen", "High": "Élevé" }
};

function migrateLegacyEnglishValues() {
  let changed = false;

  state.loans.forEach(l => {
    if (LEGACY_VALUE_MAP.type[l.type]) { l.type = LEGACY_VALUE_MAP.type[l.type]; changed = true; }
    if (LEGACY_VALUE_MAP.risk[l.risk]) { l.risk = LEGACY_VALUE_MAP.risk[l.risk]; changed = true; }
    (l.collateral || []).forEach(c => {
      if (LEGACY_VALUE_MAP.rank[c.rank]) { c.rank = LEGACY_VALUE_MAP.rank[c.rank]; changed = true; }
    });
  });

  state.properties.forEach(p => {
    if (LEGACY_VALUE_MAP.propertyType[p.type]) { p.type = LEGACY_VALUE_MAP.propertyType[p.type]; changed = true; }
  });

  if (changed) {
    console.log("Terreno: anciennes valeurs (type/rang/risque) migrées vers le français.");
    // Sauvegarde les enregistrements migrés pour que ça reste correct au prochain chargement
    state.loans.forEach(l => saveLoanOverride(l));
    state.properties.forEach(p => savePropertyOverride(p));
  }
}