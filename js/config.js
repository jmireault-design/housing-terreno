/* =====================================================================
   config.js — configuration centrale
   ===================================================================== */

const CONFIG = {
  // ----- CLÉS API -----
  mapboxToken: "pk.eyJ1Ijoiam1pcmVhdWx0IiwiYSI6ImNtcG5icWltdzJkaDMycm9idnZmdW5xam8ifQ.TVUnjlPLBHPvPr8tw0nkZw",
  googleKey: "AIzaSyBlbQernSotuM0WhLGtyIkrsvjl1ebkbJg",

  // ----- CARTE -----
  map: {
    center: [-73.585, 45.530],
    zoom: 10.5,
    bbox: [-74.3, 45.3, -73.3, 45.8],
    country: "ca"
  },

  styles: {
    standard: "mapbox://styles/mapbox/standard",
    streets: "mapbox://styles/mapbox/streets-v12",
    light: "mapbox://styles/mapbox/light-v11",
    satellite: "mapbox://styles/mapbox/satellite-streets-v12"
  },

  // Tileset de lots réels (généré via download_quebec_cadastre.py + tippecanoe,
  // hébergé sur Mapbox). Couvre Montréal + Laval + Longueuil (cadastre officiel du Québec).
  // Laisser id vide pour revenir à l'effet bâtiments générique.
  parcelTileset: {
    id: "jmireault.7ik5nc",
    sourceLayer: "parcels"
  },

  // Tileset de lots avec vraie valeur (Terrain + Bâtiment) via jointure spatiale
  // cadastre ↔ rôle d'évaluation — généré via join_cadastre_values.py + tippecanoe.
  // Si renseigné, remplace la mosaïque générique par une coloration dégradée
  // selon la valeur (clair = faible, foncé = élevée), façon Doormath.
  parcelValuesTileset: {
    id: "jmireault.q6cphe",
    sourceLayer: "parcels"
  },

  // Limites municipales du Québec (1343 municipalités), pour le regroupement visuel
  // par région en dézoomant — généré via download_municipality_boundaries.py + tippecanoe.
  municipalityTileset: {
    id: "jmireault.9u483v",
    sourceLayer: "municipalities"
  },

  // Zones inondables officielles (BDZI), généré via download_flooded_zones.py + tippecanoe.
  floodZonesTileset: {
    id: "jmireault.dcx07i",
    sourceLayer: "flood_zones"
  },

  // Zones de glissements de terrain (ZPEGT), généré via download_landslide_zones.sh + tippecanoe.
  landslideZonesTileset: {
    id: "jmireault.tmnqyt",
    sourceLayer: "landslide_zones"
  },

  // Répertoire des terrains contaminés (GTC), généré via download_contaminated_sites.py + tippecanoe.
  contaminatedSitesTileset: {
    id: "jmireault.hc0pul",
    sourceLayer: "contaminated_sites"
  },

  // Zone agricole protégée (CPTAQ), généré via download_agricultural_zone.sh + tippecanoe.
  agriculturalZoneTileset: {
    id: "jmireault.kiye0n",
    sourceLayer: "agricultural_zone"
  },

  // Zones de contraintes érosion côtière / mouvements de terrain (ZEMT), généré
  // via download_coastal_erosion.py + tippecanoe.
  coastalErosionTileset: {
    id: "jmireault.kpao8u",
    sourceLayer: "coastal_erosion"
  },

  // Zonage des régimes de feux du Québec méridional (13 zones historiques, MRNF),
  // généré via download_wildfire_regime_zones.py + tippecanoe. Statique — mise à
  // jour rare, donc figé en tileset comme les autres couches de risque.
  // Laisser id vide pour désactiver la couche (fichier non encore uploadé).
  wildfireRegimeTileset: {
    id: "",
    sourceLayer: "wildfire_regime"
  },

  // Mesures préventives feux de forêt (IFCO/ICAF/RTF) émises par la SOPFEU/MSP.
  // Contrairement aux autres couches, PAS de tileset ici — ces zones changent en
  // cours de saison, donc on les charge en direct depuis l'API WFS publique du
  // gouvernement (voir setupFireRestrictionLayer() dans map.js). Rien à générer
  // ni à uploader pour cette couche.
  fireRestrictionSources: {
    ifco: "https://geoegl.msp.gouv.qc.ca/apis/wss/complet.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=msp_interdiction_feu_ciel_ouvert_ifco&outputformat=geojson&srsName=epsg:4326",
    icaf: "https://geoegl.msp.gouv.qc.ca/apis/wss/complet.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=msp_interdiction_circuler_foret_icaf&outputformat=geojson&srsName=epsg:4326",
    rtf: "https://geoegl.msp.gouv.qc.ca/apis/wss/complet.fcgi?service=wfs&version=1.1.0&request=getfeature&typename=msp_restriction_travaux_foret_rtf&outputformat=geojson&srsName=epsg:4326"
  },

  // Lignes de métro STM et trains de banlieue exo, généré via download_transit_routes.py + tippecanoe.
  metroTileset: {
    id: "jmireault.9xbiig",
    sourceLayer: "metro_stm"
  },
  trainTileset: {
    id: "jmireault.e64m3w",
    sourceLayer: "trains_exo"
  },

  // Arrêts d'autobus STM, généré via download_bus_stops.py + tippecanoe.
  busStopsTileset: {
    id: "jmireault.waa9op",
    sourceLayer: "bus_stops_stm"
  },

  // Stations de métro STM, généré via download_metro_stations.py + tippecanoe.
  metroStationsTileset: {
    id: "jmireault.4lcpv0",
    sourceLayer: "metro_stations_stm"
  },

  // Tileset de points matricule (mat18 + code_mun), généré via extract_matricule_points.sh
  // + tippecanoe. Permet de retrouver le matricule d'un lot au clic, peu importe la ville.
  // Laisser id vide si non configuré.
  matriculeTileset: {
    id: "jmireault.oq7hvz",
    sourceLayer: "matricule"
  },

  // Tileset des vraies valeurs Terrain/Bâtiment/Total (RL0402A/RL0403A/RL0404A du rôle
  // d'évaluation officiel), généré via extract_matricule_values.sh + tippecanoe.
  // Laisser id vide pour revenir aux ratios estimés par type d'immeuble.
  valuesTileset: {
    id: "jmireault.ymt4tc",
    sourceLayer: "valeurs"
  },

  // Statuts s'appliquent aux PRÊTS, pas aux immeubles
  statusMap: {
    active:   { color: "#1D9E75", icon: "ti-check",          label: "Actif",         badge: "gt-b-active" },
    pending:  { color: "#EF9F27", icon: "ti-clock",          label: "En attente",    badge: "gt-b-pending" },
    high:     { color: "#E24B4A", icon: "ti-alert-triangle", label: "Risque élevé",  badge: "gt-b-high" },
    missing:  { color: "#D85A30", icon: "ti-file-alert",     label: "Docs manquants",badge: "gt-b-missing" },
    verified: { color: "#378ADD", icon: "ti-shield-check",   label: "Vérifié",       badge: "gt-b-verified" },
    released: { color: "#888780", icon: "ti-lock-open",      label: "Libéré",        badge: "gt-b-released" },
    refused:  { color: "#6B7280", icon: "ti-file-x",         label: "Dossier refusé",badge: "gt-b-refused" },
    new:      { color: "#534AB7", icon: "ti-search",         label: "Nouveau",       badge: "gt-b-new" }
  },

  options: {
    propertyTypes: ["Unifamiliale", "Condo", "Duplex", "Triplex", "Multi-logements", "Commercial", "Terrain"],
    loanTypes: ["Personnel", "Corporatif", "Hypothécaire", "Marge de crédit", "Co-signé", "Actionnaire", "Autre"],
    ranks: ["1er rang", "2e rang", "3e rang", "Sans garantie", "Libéré"],
    risks: ["Faible", "Moyen", "Élevé"],

    // Genre de construction (code officiel RL0310A du rôle d'évaluation, 1 à 5).
    // Confiance élevée pour 1 et 2 (confirmés dans de vrais rôles municipaux) ;
    // 3-5 sont des meilleures estimations basées sur la terminologie standard —
    // modifiable dans Paramètres si tu confirmes le vrai libellé d'un immeuble.
    constructionTypes: [
      "1 - De plain-pied",
      "2 - À étages entiers",
      "3 - À étages mansardés",
      "4 - À paliers multiples",
      "5 - En rangée"
    ],
    statuses: ["active", "pending", "high", "missing", "verified", "released", "refused"]
  },

  docLabels: {
    loan: "Contrat de prêt",
    guarantee: "Garantie",
    mortgage: "Hypothèque",
    appraisal: "Évaluation",
    insurance: "Assurance",
    tax: "Taxes municip.",
    title: "Recherche titre"
  },

  cluster: {
    maxZoom: 14,
    radius: 50
  },

  // Taux annuels — Résidentiel Île de Montréal depuis 2000
  // Utilisé pour ajuster la valeur des ventes passées à la valeur d'aujourd'hui.
  // indexImmo = indice immobilier base 2000 ; indexInflation = indice inflation base 2000
  // indexCombined = indice combiné (capitalisation composée du taux combiné) base 2000
  montrealResidentialRates: {
    2000: { realEstateRate: 0.0,  inflationRate: 2.7, combinedRate: 2.7,  indexImmo: 100.0, indexInflation: 100.0, indexCombined: 100.0 },
    2001: { realEstateRate: 5.5,  inflationRate: 2.5, combinedRate: 8.1,  indexImmo: 105.5, indexInflation: 102.5, indexCombined: 108.1 },
    2002: { realEstateRate: 9.5,  inflationRate: 2.3, combinedRate: 12.0, indexImmo: 115.5, indexInflation: 104.9, indexCombined: 121.1 },
    2003: { realEstateRate: 10.5, inflationRate: 2.8, combinedRate: 13.6, indexImmo: 127.7, indexInflation: 107.8, indexCombined: 137.5 },
    2004: { realEstateRate: 9.0,  inflationRate: 1.9, combinedRate: 11.1, indexImmo: 139.1, indexInflation: 109.8, indexCombined: 152.8 },
    2005: { realEstateRate: 7.0,  inflationRate: 2.2, combinedRate: 9.4,  indexImmo: 148.9, indexInflation: 112.3, indexCombined: 167.2 },
    2006: { realEstateRate: 5.5,  inflationRate: 2.0, combinedRate: 7.6,  indexImmo: 157.1, indexInflation: 114.5, indexCombined: 179.9 },
    2007: { realEstateRate: 4.8,  inflationRate: 2.1, combinedRate: 7.0,  indexImmo: 164.6, indexInflation: 116.9, indexCombined: 192.5 },
    2008: { realEstateRate: 3.5,  inflationRate: 2.4, combinedRate: 6.0,  indexImmo: 170.4, indexInflation: 119.7, indexCombined: 204.0 },
    2009: { realEstateRate: 2.0,  inflationRate: 0.3, combinedRate: 2.3,  indexImmo: 173.8, indexInflation: 120.1, indexCombined: 208.7 },
    2010: { realEstateRate: 5.0,  inflationRate: 1.8, combinedRate: 6.9,  indexImmo: 182.5, indexInflation: 122.2, indexCombined: 223.1 },
    2011: { realEstateRate: 3.0,  inflationRate: 2.9, combinedRate: 6.0,  indexImmo: 187.9, indexInflation: 125.8, indexCombined: 236.5 },
    2012: { realEstateRate: 2.0,  inflationRate: 1.5, combinedRate: 3.5,  indexImmo: 191.7, indexInflation: 127.7, indexCombined: 244.8 },
    2013: { realEstateRate: 0.8,  inflationRate: 0.9, combinedRate: 1.7,  indexImmo: 193.2, indexInflation: 128.8, indexCombined: 248.9 },
    2014: { realEstateRate: 1.2,  inflationRate: 2.0, combinedRate: 3.2,  indexImmo: 195.6, indexInflation: 131.4, indexCombined: 256.9 },
    2015: { realEstateRate: 2.5,  inflationRate: 1.1, combinedRate: 3.6,  indexImmo: 200.4, indexInflation: 132.8, indexCombined: 266.1 },
    2016: { realEstateRate: 2.8,  inflationRate: 0.7, combinedRate: 3.5,  indexImmo: 206.1, indexInflation: 133.8, indexCombined: 275.5 },
    2017: { realEstateRate: 4.8,  inflationRate: 1.0, combinedRate: 5.8,  indexImmo: 215.9, indexInflation: 135.1, indexCombined: 291.4 },
    2018: { realEstateRate: 5.0,  inflationRate: 1.7, combinedRate: 6.8,  indexImmo: 226.7, indexInflation: 137.4, indexCombined: 311.3 },
    2019: { realEstateRate: 7.0,  inflationRate: 2.1, combinedRate: 9.2,  indexImmo: 242.6, indexInflation: 140.3, indexCombined: 339.9 },
    2020: { realEstateRate: 13.5, inflationRate: 0.8, combinedRate: 14.4, indexImmo: 275.4, indexInflation: 141.4, indexCombined: 388.8 },
    2021: { realEstateRate: 15.0, inflationRate: 3.8, combinedRate: 19.4, indexImmo: 316.7, indexInflation: 146.8, indexCombined: 464.3 },
    2022: { realEstateRate: 7.0,  inflationRate: 6.7, combinedRate: 14.2, indexImmo: 338.8, indexInflation: 156.6, indexCombined: 530.2 },
    2023: { realEstateRate: -2.5, inflationRate: 4.5, combinedRate: 1.9,  indexImmo: 330.4, indexInflation: 163.7, indexCombined: 540.3 },
    2024: { realEstateRate: 4.5,  inflationRate: 2.3, combinedRate: 6.9,  indexImmo: 345.2, indexInflation: 167.4, indexCombined: 577.5 },
    2025: { realEstateRate: 3.5,  inflationRate: 2.1, combinedRate: 5.7,  indexImmo: 357.3, indexInflation: 170.9, indexCombined: 610.5 },
    2026: { realEstateRate: 2.0,  inflationRate: 2.0, combinedRate: 4.0,  indexImmo: 364.5, indexInflation: 174.4, indexCombined: 634.9 }
  }
};

function hasGoogleKey() {
  return CONFIG.googleKey &&
         CONFIG.googleKey !== "YOUR_GOOGLE_API_KEY" &&
         CONFIG.googleKey.length > 10;
}

/* =====================================================================
   Options personnalisées — menus déroulants extensibles
   ===================================================================== */
const CUSTOM_OPTIONS_KEY = "terreno_custom_options";

// Palette utilisée pour attribuer une couleur aux statuts ajoutés par l'utilisateur
const CUSTOM_STATUS_PALETTE = ["#0EA5E9", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

function loadCustomOptions() {
  try {
    const raw = localStorage.getItem(CUSTOM_OPTIONS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
    return null;
  }
}

function saveCustomOptions() {
  try {
    localStorage.setItem(CUSTOM_OPTIONS_KEY, JSON.stringify({
      propertyTypes: CONFIG.options.propertyTypes,
      loanTypes: CONFIG.options.loanTypes,
      ranks: CONFIG.options.ranks,
      risks: CONFIG.options.risks,
      statuses: CONFIG.options.statuses,
      constructionTypes: CONFIG.options.constructionTypes,
      customStatuses: Object.keys(CONFIG.statusMap)
        .filter(k => CONFIG.statusMap[k].custom)
        .map(k => ({ key: k, label: CONFIG.statusMap[k].label, color: CONFIG.statusMap[k].color }))
    }));
  } catch (e) {
    console.warn("Terreno: sauvegarde localStorage impossible.", e);
  }
}

function applyCustomOptionsOnBoot() {
  const saved = loadCustomOptions();
  if (!saved) return;

  // D'abord reconstruire les statuts personnalisés (leur entrée CONFIG.statusMap
  // n'existe qu'en mémoire, il faut la recréer avant que la liste "statuses" les
  // référence par leur clé).
  (saved.customStatuses || []).forEach(s => {
    if (CONFIG.statusMap[s.key]) return;
    CONFIG.statusMap[s.key] = {
      color: s.color, icon: "ti-tag", label: s.label, badge: "", custom: true
    };
    if (typeof STATUS_PRIORITY !== "undefined" && !STATUS_PRIORITY.includes(s.key)) STATUS_PRIORITY.push(s.key);
  });

  // Remplace entièrement chaque liste par la version sauvegardée (permet aussi bien
  // les ajouts que les suppressions faites depuis la page Paramètres).
  ["propertyTypes", "loanTypes", "ranks", "risks", "statuses", "constructionTypes"].forEach(field => {
    if (Array.isArray(saved[field]) && saved[field].length > 0) {
      CONFIG.options[field] = saved[field];
    }
  });
}

// Retire une option d'une liste (Type d'immeuble, Type de prêt, Rang, Risque), et
// sauvegarde. Ne touche pas aux immeubles/prêts déjà enregistrés avec cette valeur.
function removeCustomOption(field, value) {
  CONFIG.options[field] = CONFIG.options[field].filter(v => v !== value);
  saveCustomOptions();
}

// Retire un statut de la liste sélectionnable (garde son entrée statusMap pour que
// les enregistrements existants continuent de s'afficher correctement).
function removeStatusOption(key) {
  CONFIG.options.statuses = CONFIG.options.statuses.filter(k => k !== key);
  saveCustomOptions();
}

// Slug simple pour générer une clé de statut à partir du libellé saisi
function slugifyStatusKey(label) {
  const base = label.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  let key = base || "statut";
  let i = 1;
  while (CONFIG.statusMap[key]) { key = `${base}_${i}`; i++; }
  return key;
}

// Ajoute un nouveau statut personnalisé (couleur assignée automatiquement) et le sauvegarde
function addCustomStatus(label) {
  const key = slugifyStatusKey(label);
  const usedCount = Object.values(CONFIG.statusMap).filter(s => s.custom).length;
  const color = CUSTOM_STATUS_PALETTE[usedCount % CUSTOM_STATUS_PALETTE.length];
  CONFIG.statusMap[key] = { color, icon: "ti-tag", label, badge: "", custom: true };
  CONFIG.options.statuses.push(key);
  if (typeof STATUS_PRIORITY !== "undefined" && !STATUS_PRIORITY.includes(key)) STATUS_PRIORITY.push(key);
  saveCustomOptions();
  return key;
}