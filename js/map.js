/* =====================================================================
   map.js — Mapbox, clustering, sélection, cadrage multi-immeubles
   ===================================================================== */

let map;
let geocoder;
let collateralHighlightMarkers = [];
let searchHighlightMarker = null;

function initMap() {
  mapboxgl.accessToken = CONFIG.mapboxToken;

  map = new mapboxgl.Map({
    container: "mapbox-canvas",
    style: CONFIG.styles.standard,
    center: CONFIG.map.center,
    zoom: CONFIG.map.zoom
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  geocoder = new MapboxGeocoder({
    accessToken: CONFIG.mapboxToken,
    mapboxgl: mapboxgl,
    marker: false,
    placeholder: "Chercher une adresse...",
    countries: CONFIG.map.country,
    // Pas de bbox : ça restreignait les résultats à Montréal/Laval/Longueuil.
    // proximity biaise juste les résultats proches en premier, sans rien exclure.
    proximity: { longitude: CONFIG.map.center[0], latitude: CONFIG.map.center[1] },
    flyTo: { zoom: 16, speed: 1.4 }
  });
  document.getElementById("geocoder-wrap").appendChild(geocoder.onAdd(map));
  geocoder.setPlaceholder("Chercher une adresse ou un numéro de lot...");

  // Interception : si la recherche ressemble à un numéro de lot (que des chiffres/espaces),
  // on court-circuite le géocodeur Mapbox et on fait notre propre recherche locale.
  // Important : l'écouteur est posé sur le conteneur parent (pas l'input lui-même), en phase
  // de capture — sinon le géocodeur (dont l'écouteur est déjà posé sur l'input avant le nôtre)
  // s'exécute en premier peu importe l'option capture, puisque les deux seraient sur le même élément.
  document.getElementById("geocoder-wrap").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const target = e.target;
    if (!target || target.tagName !== "INPUT") return;
    const query = target.value;
    if (looksLikeLotNumber(query)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectByLotNumber(query.trim());
    }
  }, true); // phase de capture sur le parent : s'exécute avant tout écouteur posé sur l'input

  // Cache la liste déroulante d'adresses de Mapbox tant que la saisie ressemble à un numéro de lot
  document.getElementById("geocoder-wrap").addEventListener("input", (e) => {
    const suggestionsEl = document.querySelector("#geocoder-wrap .suggestions");
    if (!suggestionsEl) return;
    suggestionsEl.style.display = looksLikeLotNumber(e.target.value) ? "none" : "";
  }, true);

  // ---- Résultat de recherche : cas A (immeuble existant) / cas B (nouvelle adresse)
  geocoder.on("result", (e) => {
    const result = e.result;
    const [lng, lat] = result.center;
    const match = findMatchingProperty(lng, lat);
    if (match) {
      selectProperty(match.id);
    } else {
      selectSearchResult(result, lng, lat);
    }
    // Marqueur pulsant à l'emplacement recherché — ajouté après la sélection
    // pour ne pas être effacé par le clearSearchHighlight() du début de selectProperty().
    showSearchHighlight(lng, lat);
  });

  // Si la recherche est effacée, on retire les surlignages et on ferme le panneau si besoin
  geocoder.on("clear", () => {
    clearSearchHighlight();
    clearSelectedParcelHighlight();
    if (state.selectedType === "search") closePanel();
  });

  map.on("load", () => {
    setupMunicipalityLayer();
    setupFloodZoneLayer();
    setupLandslideZoneLayer();
    setupContaminatedSitesLayer();
    setupAgriculturalZoneLayer();
    setupCoastalErosionLayer();
    setupClusterLayers();
    refreshMap();
    wirePinModeClick();
    map.on("render", scheduleBubbleRender);
  });
}

/* ---------- Regroupement visuel par municipalité (couleurs pastel, visible en dézoomant) ---------- */
function setupMunicipalityLayer() {
  if (!CONFIG.municipalityTileset || !CONFIG.municipalityTileset.id) return;
  if (map.getLayer("gt-municipality-fill")) return; // déjà en place

  const pastelPalette = [
    "#FBC9B0", "#B8E3C4", "#AECBF0", "#F0B8D8", "#D0BCF0",
    "#F5DA8A", "#9EE0D8", "#F0C6E8", "#C4D98A", "#F0A8A8",
    "#A8D8F0", "#E8C87A"
  ];

  map.addSource("gt-municipalities", {
    type: "vector",
    url: `mapbox://${CONFIG.municipalityTileset.id}`
  });

  map.addLayer({
    id: "gt-municipality-fill",
    type: "fill",
    source: "gt-municipalities",
    "source-layer": CONFIG.municipalityTileset.sourceLayer,
    minzoom: 5,
    maxzoom: 13,
    paint: {
      "fill-color": [
        "match", ["%", ["to-number", ["get", "MUS_CO_GEO"]], 12],
        0, pastelPalette[0], 1, pastelPalette[1], 2, pastelPalette[2],
        3, pastelPalette[3], 4, pastelPalette[4], 5, pastelPalette[5],
        6, pastelPalette[6], 7, pastelPalette[7], 8, pastelPalette[8],
        9, pastelPalette[9], 10, pastelPalette[10],
        pastelPalette[11]
      ],
      "fill-opacity": [
        "interpolate", ["linear"], ["zoom"],
        5, 0.65,
        11, 0.6,
        13, 0
      ]
    }
  });

  map.addLayer({
    id: "gt-municipality-outline",
    type: "line",
    source: "gt-municipalities",
    "source-layer": CONFIG.municipalityTileset.sourceLayer,
    minzoom: 5,
    maxzoom: 13,
    paint: {
      "line-color": "rgba(90,90,105,0.32)",
      "line-width": 1.2
    }
  });

  map.addLayer({
    id: "gt-municipality-label",
    type: "symbol",
    source: "gt-municipalities",
    "source-layer": CONFIG.municipalityTileset.sourceLayer,
    minzoom: 7,
    maxzoom: 13,
    layout: {
      "text-field": ["get", "MUS_NM_MUN"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 15],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"]
    },
    paint: {
      "text-color": "#4A4A52",
      "text-halo-color": "rgba(255,255,255,0.85)",
      "text-halo-width": 1.2
    }
  });
}

/* ---------- Zones inondables officielles (BDZI) ---------- */
function setupFloodZoneLayer() {
  if (!CONFIG.floodZonesTileset || !CONFIG.floodZonesTileset.id) return;
  if (map.getLayer("gt-flood-zone-fill")) return; // déjà en place

  map.addSource("gt-flood-zones", {
    type: "vector",
    url: `mapbox://${CONFIG.floodZonesTileset.id}`
  });

  // Couleurs officielles reprises du gouvernement du Québec
  const floodColorMatch = [
    "match", ["get", "Description"],
    "Zone de grand courant", "#97DBF2",
    "Zone de faible courant", "#FF0000",
    "Zone de crue 0-100 ans", "#FFBEBE",
    "Autre zone inondable", "#0070FF",
    "#8FA6C7"
  ];

  map.addLayer({
    id: "gt-flood-zone-fill",
    type: "fill",
    source: "gt-flood-zones",
    "source-layer": CONFIG.floodZonesTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "fill-color": floodColorMatch,
      "fill-opacity": 0.45
    }
  });

  map.addLayer({
    id: "gt-flood-zone-outline",
    type: "line",
    source: "gt-flood-zones",
    "source-layer": CONFIG.floodZonesTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "line-color": floodColorMatch,
      "line-width": 1.2
    }
  });
}

// Vérifie si un point (immeuble) tombe dans une zone inondable connue, via Tilequery
// (ne nécessite pas que la caméra soit sur place, contrairement à queryRenderedFeatures).
async function fetchFloodZoneStatus(lng, lat) {
  if (!CONFIG.floodZonesTileset || !CONFIG.floodZonesTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.floodZonesTileset.id, lng, lat);
  if (!props || !props.Description) return null;
  return { description: props.Description, report: props.Nm_rapport || "" };
}

/* ---------- Zones de glissements de terrain (ZPEGT) ---------- */
function setupLandslideZoneLayer() {
  if (!CONFIG.landslideZonesTileset || !CONFIG.landslideZonesTileset.id) return;
  if (map.getLayer("gt-landslide-fill")) return;

  map.addSource("gt-landslide-zones", {
    type: "vector",
    url: `mapbox://${CONFIG.landslideZonesTileset.id}`
  });

  map.addLayer({
    id: "gt-landslide-fill",
    type: "fill",
    source: "gt-landslide-zones",
    "source-layer": CONFIG.landslideZonesTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "fill-color": "#B45309",
      "fill-opacity": 0.35
    }
  });

  map.addLayer({
    id: "gt-landslide-outline",
    type: "line",
    source: "gt-landslide-zones",
    "source-layer": CONFIG.landslideZonesTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "line-color": "#92400E",
      "line-width": 1
    }
  });
}

async function fetchLandslideZoneStatus(lng, lat) {
  if (!CONFIG.landslideZonesTileset || !CONFIG.landslideZonesTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.landslideZonesTileset.id, lng, lat);
  if (!props) return null;
  const label = props.etq_contr || props.fam_gliss || props.descriptio;
  if (!label) return null;
  return { label, family: props.fam_gliss || "" };
}

/* ---------- Répertoire des terrains contaminés (GTC) ---------- */
function setupContaminatedSitesLayer() {
  if (!CONFIG.contaminatedSitesTileset || !CONFIG.contaminatedSitesTileset.id) return;
  if (map.getLayer("gt-contaminated-points")) return;

  map.addSource("gt-contaminated-sites", {
    type: "vector",
    url: `mapbox://${CONFIG.contaminatedSitesTileset.id}`
  });

  const milieuColorMatch = [
    "match", ["get", "DESC_MILIEU_RECEPT"],
    "Sol", "#1A1A1A",
    "Eau souterraine", "#00A9E6",
    "Sol et eau souterraine", "#FF3300",
    "#686868"
  ];

  // Halo semi-transparent sous chaque point, pour que ça se voie bien même
  // dézoomé et parmi d'autres éléments de la carte.
  map.addLayer({
    id: "gt-contaminated-halo",
    type: "circle",
    source: "gt-contaminated-sites",
    "source-layer": CONFIG.contaminatedSitesTileset.sourceLayer,
    minzoom: 8,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 16, 22],
      "circle-color": milieuColorMatch,
      "circle-opacity": 0.25,
      "circle-blur": 0.6
    }
  });

  map.addLayer({
    id: "gt-contaminated-points",
    type: "circle",
    source: "gt-contaminated-sites",
    "source-layer": CONFIG.contaminatedSitesTileset.sourceLayer,
    minzoom: 8,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 16, 14],
      "circle-color": milieuColorMatch,
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 2.5
    }
  });
}

async function fetchContaminatedSiteStatus(lng, lat) {
  if (!CONFIG.contaminatedSitesTileset || !CONFIG.contaminatedSitesTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.contaminatedSitesTileset.id, lng, lat);
  if (!props || !props.NO_MEF_LIEU) return null;
  return {
    reference: props.NO_MEF_LIEU,
    milieu: props.DESC_MILIEU_RECEPT || "",
    address: props.ADR_CIV_LIEU || ""
  };
}

/* ---------- Zone agricole protégée (CPTAQ) ---------- */
function setupAgriculturalZoneLayer() {
  if (!CONFIG.agriculturalZoneTileset || !CONFIG.agriculturalZoneTileset.id) return;
  if (map.getLayer("gt-agricultural-fill")) return;

  map.addSource("gt-agricultural-zone", {
    type: "vector",
    url: `mapbox://${CONFIG.agriculturalZoneTileset.id}`
  });

  map.addLayer({
    id: "gt-agricultural-fill",
    type: "fill",
    source: "gt-agricultural-zone",
    "source-layer": CONFIG.agriculturalZoneTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "fill-color": "#4D7C0F",
      "fill-opacity": 0.2
    }
  });

  map.addLayer({
    id: "gt-agricultural-outline",
    type: "line",
    source: "gt-agricultural-zone",
    "source-layer": CONFIG.agriculturalZoneTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "line-color": "#4D7C0F",
      "line-width": 1
    }
  });
}

async function fetchAgriculturalZoneStatus(lng, lat) {
  if (!CONFIG.agriculturalZoneTileset || !CONFIG.agriculturalZoneTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.agriculturalZoneTileset.id, lng, lat);
  if (!props) return null;
  return { inZone: true };
}

/* ---------- Zones de contraintes érosion côtière / mouvements de terrain (ZEMT) ---------- */
function setupCoastalErosionLayer() {
  if (!CONFIG.coastalErosionTileset || !CONFIG.coastalErosionTileset.id) return;
  if (map.getLayer("gt-coastal-erosion-fill")) return;

  map.addSource("gt-coastal-erosion", {
    type: "vector",
    url: `mapbox://${CONFIG.coastalErosionTileset.id}`
  });

  map.addLayer({
    id: "gt-coastal-erosion-fill",
    type: "fill",
    source: "gt-coastal-erosion",
    "source-layer": CONFIG.coastalErosionTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "fill-color": "#0891B2",
      "fill-opacity": 0.35
    }
  });

  map.addLayer({
    id: "gt-coastal-erosion-outline",
    type: "line",
    source: "gt-coastal-erosion",
    "source-layer": CONFIG.coastalErosionTileset.sourceLayer,
    minzoom: 6,
    paint: {
      "line-color": "#0E7490",
      "line-width": 1
    }
  });
}

async function fetchCoastalErosionStatus(lng, lat) {
  if (!CONFIG.coastalErosionTileset || !CONFIG.coastalErosionTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.coastalErosionTileset.id, lng, lat);
  if (!props) return null;
  return { mrc: props.mrc_nom || "", zoneType: props.zone_type || "" };
}

/* ---------- Surlignage du lot sélectionné (le polygone entier, pas un point) ---------- */
function setupSelectedParcelLayer() {
  if (map.getSource("gt-selected-parcel")) return;

  map.addSource("gt-selected-parcel", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map.addLayer({
    id: "gt-selected-parcel-fill",
    type: "fill",
    source: "gt-selected-parcel",
    paint: {
      "fill-color": "#FFD400",
      "fill-opacity": 0.35
    }
  });
  map.addLayer({
    id: "gt-selected-parcel-outline-halo",
    type: "line",
    source: "gt-selected-parcel",
    paint: {
      "line-color": "#ffffff",
      "line-width": 6,
      "line-opacity": 0.85
    }
  });
  map.addLayer({
    id: "gt-selected-parcel-outline",
    type: "line",
    source: "gt-selected-parcel",
    paint: {
      "line-color": "#FFD400",
      "line-width": 3
    }
  });
}

function showSelectedParcelHighlight(geometry) {
  if (!geometry || !map.getSource("gt-selected-parcel")) return;
  map.getSource("gt-selected-parcel").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties: {} }]
  });
}

function clearSelectedParcelHighlight() {
  if (!map.getSource("gt-selected-parcel")) return;
  map.getSource("gt-selected-parcel").setData({ type: "FeatureCollection", features: [] });
}

/* ---------- Halo pulsant sur l'emplacement recherché ---------- */
function showSearchHighlight(lng, lat) {
  clearSearchHighlight();
  const el = document.createElement("div");
  el.className = "gt-search-highlight";
  searchHighlightMarker = new mapboxgl.Marker({ element: el, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map);
}

function clearSearchHighlight() {
  if (searchHighlightMarker) {
    searchHighlightMarker.remove();
    searchHighlightMarker = null;
  }
}

/* =====================================================================
   Recherche par numéro de lot (index chargé une seule fois, à la demande)
   ===================================================================== */
let lotIndexCache = null;
let lotIndexLoading = null;

async function loadLotIndex() {
  if (lotIndexCache) return lotIndexCache;
  if (lotIndexLoading) return lotIndexLoading;

  lotIndexLoading = fetch("data/lot_index.csv")
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(text => {
      const arr = text.split("\n").filter(Boolean).map(line => {
        const [key, lng, lat] = line.split(",");
        return [key, parseFloat(lng), parseFloat(lat)];
      });
      lotIndexCache = arr; // déjà trié à la génération (Python sorted())
      console.log(`Terreno: index de ${arr.length} numéros de lot chargé.`);
      return arr;
    })
    .catch(err => {
      console.warn("Terreno: data/lot_index.csv introuvable ou invalide — recherche par lot désactivée.", err);
      lotIndexCache = [];
      return lotIndexCache;
    });

  return lotIndexLoading;
}

function binarySearchLotIndex(arr, key) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][0] === key) return arr[mid];
    if (arr[mid][0] < key) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

// Une requête est traitée comme un numéro de lot si elle ne contient que des chiffres
// et des espaces (ex: "6582823" ou "6 582 823"), avec au moins 4 chiffres.
function looksLikeLotNumber(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) return false;
  return /^[\d\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, "").length >= 4;
}

async function selectByLotNumber(rawQuery) {
  const key = rawQuery.replace(/\s+/g, "");
  const arr = await loadLotIndex();
  const match = binarySearchLotIndex(arr, key);

  if (!match) {
    alert(`Aucun lot trouvé pour le numéro "${rawQuery}".`);
    return;
  }

  const [, lng, lat] = match;

  clearCollateralHighlights();
  clearSearchHighlight();
  state.selectedType = "search";
  state.selectedId = null;
  state.editing = false;

  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });

  // On affiche déjà un état "en attente" pendant que le vrai polygone se charge
  let built = {
    id: null, addr: "Adresse inconnue", fullAddress: `Lot ${rawQuery}`, city: "", neighborhood: "",
    type: "", owner: "", value: null, assessment: null, purchase: null, lng, lat, notes: "",
    matricule: "", lotNumber: rawQuery, parcelGeometry: null, needsReverseGeocode: true
  };
  state.searchResult = built;
  renderPanel();
  showSearchHighlight(lng, lat);

  const feature = await queryParcelAfterFlyTo(lng, lat);
  if (feature && state.searchResult === built) {
    const updated = buildParcelSearchProperty(feature, lng, lat);
    updated.lotNumber = updated.lotNumber || rawQuery;
    built = updated;
    state.searchResult = built;
    clearSearchHighlight();
    showSelectedParcelHighlight(feature.geometry);
    renderPanel();
  }

  // Adresse (si pas déjà connue) + matricule, comme pour une recherche par adresse
  if (built.needsReverseGeocode) {
    reverseGeocodeAddress(lng, lat).then(geo => {
      if (!geo || state.searchResult !== built) return;
      const firstPart = (geo.place_name || "").split(",")[0].trim();
      if (firstPart) built.addr = firstPart;
      const context = geo.context || [];
      const neighborhoodEntry = context.find(c => (c.id || "").startsWith("neighborhood"))
        || context.find(c => (c.id || "").startsWith("locality"));
      if (neighborhoodEntry) built.neighborhood = neighborhoodEntry.text;
      const placeEntry = context.find(c => (c.id || "").startsWith("place"));
      if (placeEntry) built.city = placeEntry.text;
      const postcodeEntry = context.find(c => (c.id || "").startsWith("postcode"));
      if (postcodeEntry) built.postalCode = postcodeEntry.text;
      built.fullAddress = `${built.addr}, ${built.neighborhood || built.city || "Québec"}`;
      renderPanel();
    });
  }
  if (!built.matricule && CONFIG.matriculeTileset && CONFIG.matriculeTileset.id) {
    tilequeryLookup(CONFIG.matriculeTileset.id, lng, lat).then(props => {
      if (!props || state.searchResult !== built) return;
      if (props.mat18) built.matricule = props.mat18;
      renderPanel();
    });
  }

  // Vraies valeurs Terrain/Bâtiment (rôle officiel), si le tileset est configuré
  fetchRealEstateValues(lng, lat).then(vals => {
    if (!vals || state.searchResult !== built) return;
    built.landValue = vals.landValue;
    built.buildingValue = vals.buildingValue;
    built.assessment = vals.totalValue;
    built.valuesFromOfficialRoll = true;
    if (vals.matricule && !built.matricule) built.matricule = vals.matricule;
    built.codeMun = vals.codeMun; built.secteur = vals.secteur; built.typePropriete = vals.typePropriete;
    renderPanel();
  });
}


function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- Trouve un immeuble déjà enregistré près des coordonnées cherchées ---------- */
/* ---------- Test point-dans-polygone (ray casting) ---------- */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polys.some(poly => pointInRing(lng, lat, poly[0]) && !poly.slice(1).some(hole => pointInRing(lng, lat, hole)));
}

function findMatchingProperty(lng, lat) {
  // Priorité 1 : si on connaît le vrai polygone d'un immeuble suivi, on vérifie
  // si le point cliqué tombe dedans — beaucoup plus précis qu'une distance, et ça
  // évite qu'un lot voisin soit confondu avec l'immeuble déjà enregistré.
  for (const pc of (state.parcels || [])) {
    const p = state.propertyMap[pc.propertyId];
    if (p && pointInGeometry(lng, lat, pc.geometry)) return p;
  }

  // Repli : distance au point enregistré, seulement pour les immeubles sans polygone
  // connu (ex. ajoutés manuellement sans clic sur le tileset). Tolérance resserrée
  // pour éviter les faux positifs entre lots voisins rapprochés.
  const THRESHOLD_M = 15;
  const knownGeomIds = new Set((state.parcels || []).map(pc => pc.propertyId));
  let best = null;
  let bestDist = Infinity;
  state.properties.forEach(p => {
    if (knownGeomIds.has(p.id)) return; // déjà testé précisément ci-dessus
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d < THRESHOLD_M && d < bestDist) {
      bestDist = d;
      best = p;
    }
  });
  return best;
}

/* ---------- Construit un objet immeuble temporaire à partir d'un résultat geocoder ---------- */
function buildSearchProperty(result, lng, lat) {
  const context = result.context || [];
  const cityCtx = context.find(c => (c.id || "").startsWith("place"));
  const parts = (result.place_name || "").split(",");

  return {
    id: null,
    addr: (parts[0] || result.place_name || "").trim(),
    fullAddress: result.place_name || "",
    city: cityCtx ? cityCtx.text : (parts[1] || "").trim(),
    neighborhood: "",
    type: "",
    owner: "",
    value: null,
    assessment: null,
    purchase: null,
    lng, lat,
    notes: ""
  };
}

/* ---------- Interroge un tileset à une coordonnée précise (sans avoir besoin de cliquer dessus) ---------- */
async function tilequeryLookup(tilesetId, lng, lat) {
  try {
    const url = `https://api.mapbox.com/v4/${tilesetId}/tilequery/${lng},${lat}.json?radius=25&limit=1&access_token=${CONFIG.mapboxToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features.length > 0) return data.features[0].properties;
  } catch (err) {
    console.warn("Terreno: tilequery échouée.", err);
  }
  return null;
}

/* ---------- Interroge le tileset des vraies valeurs Terrain/Bâtiment/Total (rôle officiel) ---------- */
async function fetchRealEstateValues(lng, lat) {
  if (!CONFIG.valuesTileset || !CONFIG.valuesTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.valuesTileset.id, lng, lat);
  if (!props) return null;
  const land = Number(props.terrain) || 0;
  const building = Number(props.batiment) || 0;
  const matricule = props.mat18 || "";
  if (!land && !building && !matricule) return null;
  return {
    landValue: land, buildingValue: building, totalValue: land + building, matricule,
    codeMun: props.code_mun || "", secteur: props.secteur || "", typePropriete: props.type_propriete || ""
  };
}

// Compare la valeur d'un immeuble à la moyenne de son secteur (municipalité + secteur +
// type de propriété), si on a assez d'information pour le situer et une table chargée.
function lookupSectorAverage(p) {
  if (!p.codeMun || !p.secteur || !p.typePropriete) return null;
  if (!state.sectorValues || Object.keys(state.sectorValues).length === 0) return null;
  const key = `${p.codeMun}|${p.secteur}|${p.typePropriete}`;
  return state.sectorValues[key] || null;
}

/* ---------- Variante qui retourne le feature complet (géométrie + propriétés) ---------- */
async function tilequeryFeatureLookup(tilesetId, lng, lat) {
  try {
    const url = `https://api.mapbox.com/v4/${tilesetId}/tilequery/${lng},${lat}.json?radius=25&limit=1&geometry=polygon&access_token=${CONFIG.mapboxToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features.length > 0) return data.features[0];
  } catch (err) {
    console.warn("Terreno: tilequery échouée.", err);
  }
  return null;
}

/* ---------- Interroge le vrai polygone rendu à une coordonnée, après la fin du déplacement caméra ----------
   L'API Tilequery ne retourne JAMAIS la vraie forme d'un polygone (toujours un point, même avec
   geometry=polygon — c'est une limitation documentée de l'API). Pour avoir le vrai contour, il faut
   lire les tuiles déjà rendues sur la carte, une fois que la caméra a fini de bouger vers l'endroit. */
/* ---------- Calcule la superficie d'un polygone (approximation planaire, précise pour un lot) ---------- */
function ringAreaSqMeters(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const mPerDegLng = 111320 * Math.cos(lat0 * Math.PI / 180);
  const mPerDegLat = 110540;
  const pts = ring.map(([lng, lat]) => [lng * mPerDegLng, lat * mPerDegLat]);
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return area / 2;
}

function polygonAreaSqMeters(geometry) {
  if (!geometry) return null;
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  let total = 0;
  polys.forEach(poly => {
    poly.forEach((ring, idx) => {
      const a = ringAreaSqMeters(ring);
      total += idx === 0 ? a : -a; // les anneaux après le premier sont des trous, à soustraire
    });
  });
  return Math.round(Math.abs(total));
}

function queryParcelAfterFlyTo(lng, lat) {
  return new Promise(resolve => {
    const doQuery = () => {
      // Petit délai additionnel : le temps que les tuiles finissent de se dessiner après moveend
      setTimeout(() => {
        try {
          const px = map.project([lng, lat]);
          const box = [[px.x - 5, px.y - 5], [px.x + 5, px.y + 5]];
          const found = map.queryRenderedFeatures(box, { layers: ["gt-city-parcel-fill"] });
          resolve(found.length > 0 ? found[0] : null);
        } catch (err) {
          console.warn("Terreno: requête du polygone après déplacement échouée.", err);
          resolve(null);
        }
      }, 200);
    };

    if (map.isMoving() || map.isEasing()) {
      map.once("moveend", doQuery);
    } else {
      doQuery();
    }
  });
}

/* ---------- Sélection : résultat de recherche non enregistré (cas B) ---------- */
/* ---------- Sélection : épingle posée à main levée sur la carte (mode "Épingle") ---------- */
function selectByCoordinate(lng, lat) {
  clearCollateralHighlights();
  clearSelectedParcelHighlight();
  state.selectedType = "search";
  state.selectedId = null;
  state.editing = false;

  const built = {
    id: null, addr: "Recherche en cours…", fullAddress: "Recherche en cours…", city: "",
    neighborhood: "", type: "", owner: "", value: null, assessment: null, purchase: null,
    lng, lat, notes: ""
  };
  state.searchResult = built;

  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });

  renderPanel();
  showSearchHighlight(lng, lat);

  reverseGeocodeAddress(lng, lat).then(geo => {
    if (!geo || state.searchResult !== built) return;
    const firstPart = (geo.place_name || "").split(",")[0].trim();
    built.addr = firstPart || "Adresse inconnue";
    const context = geo.context || [];
    const neighborhoodEntry = context.find(c => (c.id || "").startsWith("neighborhood"))
      || context.find(c => (c.id || "").startsWith("locality"));
    if (neighborhoodEntry) built.neighborhood = neighborhoodEntry.text;
    const placeEntry = context.find(c => (c.id || "").startsWith("place"));
    if (placeEntry) built.city = placeEntry.text;
    const postcodeEntry = context.find(c => (c.id || "").startsWith("postcode"));
    if (postcodeEntry) built.postalCode = postcodeEntry.text;
    built.fullAddress = `${built.addr}, ${built.neighborhood || built.city || "Québec"}`;
    renderPanel();
  });

  if (CONFIG.parcelTileset && CONFIG.parcelTileset.id) {
    tilequeryLookup(CONFIG.parcelTileset.id, lng, lat).then(props => {
      if (!props || state.searchResult !== built) return;
      if (props.NO_LOT) built.lotNumber = props.NO_LOT;
      renderPanel();
    });
  }
  if (CONFIG.matriculeTileset && CONFIG.matriculeTileset.id) {
    tilequeryLookup(CONFIG.matriculeTileset.id, lng, lat).then(props => {
      if (!props || state.searchResult !== built) return;
      if (props.mat18) built.matricule = props.mat18;
      renderPanel();
    });
  }

  fetchRealEstateValues(lng, lat).then(vals => {
    if (!vals || state.searchResult !== built) return;
    built.landValue = vals.landValue;
    built.buildingValue = vals.buildingValue;
    built.assessment = vals.totalValue;
    built.valuesFromOfficialRoll = true;
    if (vals.matricule && !built.matricule) built.matricule = vals.matricule;
    built.codeMun = vals.codeMun; built.secteur = vals.secteur; built.typePropriete = vals.typePropriete;
    renderPanel();
  });

  queryParcelAfterFlyTo(lng, lat).then(feature => {
    if (!feature || state.searchResult !== built) return;
    clearSearchHighlight();
    showSelectedParcelHighlight(feature.geometry);
    built.lotAreaSqM = polygonAreaSqMeters(feature.geometry);
    built.parcelGeometry = feature.geometry;
    renderPanel();
  });
}

/* ---------- Mode "Épingle" : clic libre sur la carte ---------- */
let pinModeActive = false;

function togglePinMode() {
  pinModeActive = !pinModeActive;
  const btn = document.getElementById("toggle-pin-mode");
  if (btn) btn.classList.toggle("active", pinModeActive);
  if (map) map.getCanvas().style.cursor = pinModeActive ? "crosshair" : "";
  return pinModeActive;
}

function wirePinModeClick() {
  map.on("click", (e) => {
    if (!pinModeActive) return;
    // Si le clic touche déjà un immeuble suivi ou un lot cliquable, laisse leurs
    // propres gestionnaires s'en occuper (évite un double déclenchement).
    const hit = map.queryRenderedFeatures(e.point, {
      layers: ["unclustered-point", "clusters", "gt-city-parcel-fill"].filter(id => map.getLayer(id))
    });
    if (hit.length > 0) return;
    selectByCoordinate(e.lngLat.lng, e.lngLat.lat);
  });
}


function selectSearchResult(result, lng, lat) {
  clearCollateralHighlights();
  clearSelectedParcelHighlight();
  state.selectedType = "search";
  state.selectedId = null;
  state.editing = false;
  const built = buildSearchProperty(result, lng, lat);
  state.searchResult = built;

  map.flyTo({
    center: [lng, lat],
    zoom: Math.max(map.getZoom(), 16),
    duration: 800
  });

  renderPanel();
  showSearchHighlight(lng, lat);

  // Le géocodeur ne connaît pas nos tilesets — on va chercher le numéro de lot et le
  // matricule via Tilequery (propriétés uniquement, ça fonctionne bien pour du texte).
  if (CONFIG.parcelTileset && CONFIG.parcelTileset.id) {
    tilequeryLookup(CONFIG.parcelTileset.id, lng, lat).then(props => {
      if (!props || state.searchResult !== built) return;
      if (props.NO_LOT) built.lotNumber = props.NO_LOT;
      renderPanel();
    });
  }
  if (CONFIG.matriculeTileset && CONFIG.matriculeTileset.id) {
    tilequeryLookup(CONFIG.matriculeTileset.id, lng, lat).then(props => {
      if (!props || state.searchResult !== built) return;
      if (props.mat18) built.matricule = props.mat18;
      renderPanel();
    });
  }

  // Vraies valeurs Terrain/Bâtiment (rôle officiel), si le tileset est configuré
  fetchRealEstateValues(lng, lat).then(vals => {
    if (!vals || state.searchResult !== built) return;
    built.landValue = vals.landValue;
    built.buildingValue = vals.buildingValue;
    built.assessment = vals.totalValue;
    built.valuesFromOfficialRoll = true;
    if (vals.matricule && !built.matricule) built.matricule = vals.matricule;
    built.codeMun = vals.codeMun; built.secteur = vals.secteur; built.typePropriete = vals.typePropriete;
    renderPanel();
  });

  // Pour le vrai contour du lot (Tilequery ne le fournit jamais), on attend que la caméra
  // ait fini de bouger, puis on lit les tuiles réellement rendues à cet endroit.
  queryParcelAfterFlyTo(lng, lat).then(feature => {
    if (!feature || state.searchResult !== built) return;
    clearSearchHighlight();
    showSelectedParcelHighlight(feature.geometry);
    built.lotAreaSqM = polygonAreaSqMeters(feature.geometry);
    built.parcelGeometry = feature.geometry;
    if (!built.lotNumber && feature.properties && feature.properties.NO_LOT) {
      built.lotNumber = feature.properties.NO_LOT;
    }
    renderPanel();
  });
}

/* ---------- GeoJSON dérivé de l'état actuel ---------- */
function buildGeoJSON() {
  return {
    type: "FeatureCollection",
    features: state.properties.filter(propertyPassesFilters).map(p => {
      const status = propertyStatus(p.id);
      const s = CONFIG.statusMap[status];
      const loans = loansForProperty(p.id);
      const totalGuaranteed = loans.reduce((sum, l) => sum + l.amount, 0);
      const anySaved = loans.some(l => state.savedLoans.has(l.loan.id));

      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          color: s.color,
          saved: anySaved ? 1 : 0,
          loanCount: loans.length,
          totalGuaranteed: totalGuaranteed
        }
      };
    })
  };
}

/* ---------- Vrais polygones de lot (si data/parcels.json existe) ---------- */
function buildParcelGeoJSON() {
  return {
    type: "FeatureCollection",
    features: (state.parcels || [])
      .filter(pc => {
        const p = state.propertyMap[pc.propertyId];
        return p && propertyPassesFilters(p);
      })
      .map(pc => {
        const status = propertyStatus(pc.propertyId);
        const s = CONFIG.statusMap[status];
        return {
          type: "Feature",
          geometry: pc.geometry,
          properties: { propertyId: pc.propertyId, color: s.color }
        };
      })
  };
}

function setupParcelLayer() {
  if (!state.parcels || state.parcels.length === 0) return false;

  if (map.getSource("gt-parcels")) {
    map.getSource("gt-parcels").setData(buildParcelGeoJSON());
    return true;
  }

  map.addSource("gt-parcels", { type: "geojson", data: buildParcelGeoJSON() });
  map.addLayer({
    id: "gt-parcel-fill",
    type: "fill",
    source: "gt-parcels",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.5
    }
  });
  map.addLayer({
    id: "gt-parcel-outline",
    type: "line",
    source: "gt-parcels",
    paint: {
      "line-color": "#ffffff",
      "line-width": 3
    }
  });
  return true;
}

/* ---------- Points matricule (invisibles, uniquement pour recherche au clic) ---------- */
function setupMatriculePointsLayer() {
  if (!CONFIG.matriculeTileset || !CONFIG.matriculeTileset.id) return false;
  if (map.getLayer("gt-matricule-points")) return true; // déjà en place

  try {
    map.addSource("gt-matricule-points-src", {
      type: "vector",
      url: `mapbox://${CONFIG.matriculeTileset.id}`
    });
    map.addLayer({
      id: "gt-matricule-points",
      type: "circle",
      source: "gt-matricule-points-src",
      "source-layer": CONFIG.matriculeTileset.sourceLayer,
      minzoom: 13,
      paint: {
        "circle-radius": 15,
        "circle-opacity": 0,
        "circle-stroke-opacity": 0
      }
    });
    return true;
  } catch (err) {
    console.warn("Terreno: impossible d'ajouter le tileset de points matricule.", err);
    return false;
  }
}

/* ---------- Cherche le numéro de lot du polygone sous un point (lng/lat) ---------- */
function findNearbyLotNumber(lng, lat) {
  if (!map.getLayer("gt-city-parcel-fill")) return "";
  try {
    const px = map.project([lng, lat]);
    const box = [[px.x - 5, px.y - 5], [px.x + 5, px.y + 5]];
    const found = map.queryRenderedFeatures(box, { layers: ["gt-city-parcel-fill"] });
    if (found.length > 0 && found[0].properties && found[0].properties.NO_LOT) {
      return found[0].properties.NO_LOT;
    }
  } catch (err) {
    console.warn("Terreno: recherche de numéro de lot échouée.", err);
  }
  return "";
}

/* ---------- Cherche le matricule le plus proche d'un point (lng/lat) ---------- */
function findNearbyMatricule(lng, lat) {
  if (!map.getLayer("gt-matricule-points")) return "";
  try {
    const px = map.project([lng, lat]);
    const box = [[px.x - 25, px.y - 25], [px.x + 25, px.y + 25]];
    const found = map.queryRenderedFeatures(box, { layers: ["gt-matricule-points"] });
    if (found.length > 0 && found[0].properties && found[0].properties.mat18) {
      return found[0].properties.mat18;
    }
  } catch (err) {
    console.warn("Terreno: recherche de matricule échouée.", err);
  }
  return "";
}

/* ---------- Vrais lots à l'échelle de la ville (tileset Mapbox généré via tippecanoe) ---------- */
function setupCityParcelLayer() {
  const useValues = CONFIG.parcelValuesTileset && CONFIG.parcelValuesTileset.id;
  const activeTileset = useValues ? CONFIG.parcelValuesTileset : CONFIG.parcelTileset;
  if (!activeTileset || !activeTileset.id) return false;
  if (map.getLayer("gt-city-parcel-fill")) return true; // déjà en place

  // Dégradé clair → foncé selon la valeur totale (Terrain + Bâtiment), façon Doormath.
  // Les lots sans valeur connue (~12%) restent en gris neutre plutôt que d'être colorés au hasard.
  const valueFillColor = [
    "case",
    ["<=", ["to-number", ["get", "valeur_totale"], 0], 0],
    "#E2E5EA",
    [
      "interpolate", ["linear"], ["get", "valeur_totale"],
      0, "#6B1E07",
      150000, "#B0301A",
      350000, "#E07B1E",
      550000, "#F2D027",
      750000, "#A8D62B",
      950000, "#2FA84F",
      1250000, "#1FA398",
      1600000, "#2E7FD6",
      2100000, "#6A5ACD",
      2800000, "#9B4FC7"
    ]
  ];

  const genericFillColor = [
    "match", ["%", ["id"], 4],
    0, "#8791E4",
    1, "#7C87DE",
    2, "#6D79D6",
    3, "#63D9A8",
    "#8791E4"
  ];

  try {
    map.addSource("gt-city-parcels", {
      type: "vector",
      url: `mapbox://${activeTileset.id}`
    });
    map.addLayer({
      id: "gt-city-parcel-fill",
      type: "fill",
      source: "gt-city-parcels",
      "source-layer": activeTileset.sourceLayer,
      minzoom: 13,
      paint: {
        "fill-color": useValues ? valueFillColor : genericFillColor,
        "fill-opacity": [
          "interpolate", ["linear"], ["zoom"],
          13, 0,
          14, useValues ? 0.62 : 0.45
        ]
      }
    });
    map.addLayer({
      id: "gt-city-parcel-outline",
      type: "line",
      source: "gt-city-parcels",
      "source-layer": activeTileset.sourceLayer,
      minzoom: 13,
      paint: {
        "line-color": "rgba(255,255,255,0.55)",
        "line-width": 1
      }
    });

    // Interactions : chaque lot devient cliquable
    map.on("mouseenter", "gt-city-parcel-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "gt-city-parcel-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "gt-city-parcel-fill", (e) => {
      if (!e.features || !e.features[0]) return;
      const feature = e.features[0];
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const match = findMatchingProperty(lng, lat);
      if (match) {
        selectProperty(match.id);
      } else {
        selectParcelResult(feature, lng, lat);
      }
      showSelectedParcelHighlight(feature.geometry);
    });

    return true;
  } catch (err) {
    console.warn("Terreno: impossible d'ajouter le tileset de lots.", err);
    return false;
  }
}

/* ---------- Construit un objet immeuble temporaire à partir d'un lot cliqué sur le tileset ---------- */
function buildParcelSearchProperty(feature, lng, lat) {
  const p = feature.properties || {};

  const civicPart = (p.SUITE_DEBUT !== null && p.SUITE_DEBUT !== undefined && p.SUITE_DEBUT !== "")
    ? String(p.SUITE_DEBUT) : "";
  const lettrePart = (p.LETTRE_DEBUT !== null && p.LETTRE_DEBUT !== undefined && p.LETTRE_DEBUT !== "")
    ? String(p.LETTRE_DEBUT) : "";
  const civic = civicPart + lettrePart;
  const addr = [civic, p.NOM_RUE].filter(v => v).join(" ").trim() || "Adresse inconnue";

  // MUNICIPALITE dans l'ancien jeu de données Montréal était un code numérique (pas un nom
  // de ville) ; le cadastre provincial n'a pas ce champ du tout — la ville vient du géocodage inversé.
  const city = "";

  return {
    id: null,
    addr,
    fullAddress: `${addr}${city ? ", " + city : ""}`,
    city,
    neighborhood: "",
    type: "",
    owner: "",
    value: null,
    assessment: null,
    purchase: null,
    lng, lat,
    notes: "",
    matricule: p.MATRICULE83 || "",
    lotNumber: p.NO_LOT || "",
    lotAreaSqM: polygonAreaSqMeters(feature.geometry),
    parcelGeometry: feature.geometry || null,
    needsReverseGeocode: civic === "" // pas de numéro civique dans le tileset pour ce lot
  };
}

/* ---------- Géocodage inversé Mapbox : trouve l'adresse exacte quand le tileset n'en a pas ---------- */
async function reverseGeocodeAddress(lng, lat) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${CONFIG.mapboxToken}&types=address&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features && data.features.length > 0) return data.features[0];
  } catch (err) {
    console.warn("Terreno: géocodage inversé échoué.", err);
  }
  return null;
}

/* ---------- Sélection : lot cliqué directement sur la mosaïque cadastrale ---------- */
function selectParcelResult(feature, lng, lat) {
  clearCollateralHighlights();
  clearSearchHighlight();
  state.selectedType = "search";
  state.selectedId = null;
  state.editing = false;
  const built = buildParcelSearchProperty(feature, lng, lat);
  const foundMatricule = findNearbyMatricule(lng, lat);
  if (foundMatricule) built.matricule = foundMatricule;
  state.searchResult = built;

  map.flyTo({
    center: [lng, lat],
    zoom: Math.max(map.getZoom(), 16),
    duration: 600
  });

  renderPanel();

  // Vraies valeurs Terrain/Bâtiment (rôle officiel), si le tileset est configuré
  fetchRealEstateValues(lng, lat).then(vals => {
    if (!vals || state.searchResult !== built) return;
    built.landValue = vals.landValue;
    built.buildingValue = vals.buildingValue;
    built.assessment = vals.totalValue;
    built.valuesFromOfficialRoll = true;
    if (vals.matricule && !built.matricule) built.matricule = vals.matricule;
    built.codeMun = vals.codeMun; built.secteur = vals.secteur; built.typePropriete = vals.typePropriete;
    renderPanel();
  });

  // Toujours interroger le géocodage inversé : pour le numéro civique s'il manque,
  // et dans tous les cas pour retrouver le quartier/arrondissement (sous-titre).
  reverseGeocodeAddress(lng, lat).then(geo => {
    if (!geo || state.searchResult !== built) return;

    if (built.needsReverseGeocode) {
      const firstPart = (geo.place_name || "").split(",")[0].trim();
      if (firstPart) built.addr = firstPart;
    }

    const context = geo.context || [];
    const neighborhoodEntry = context.find(c => (c.id || "").startsWith("neighborhood"))
      || context.find(c => (c.id || "").startsWith("locality"));
    if (neighborhoodEntry) built.neighborhood = neighborhoodEntry.text;

    const placeEntry = context.find(c => (c.id || "").startsWith("place"));
    if (placeEntry) built.city = placeEntry.text;

    const postcodeEntry = context.find(c => (c.id || "").startsWith("postcode"));
    if (postcodeEntry) built.postalCode = postcodeEntry.text;

    built.fullAddress = `${built.addr}, ${built.neighborhood || built.city || "Québec"}`;
    renderPanel();
  });
}

/* ---------- Bâtiments colorés façon Doormath (empreintes Mapbox teintées) ---------- */
/* Utilisé seulement en repli si CONFIG.parcelTileset.id n'est pas configuré */
function setupBuildingLayer() {
  if (map.getLayer("gt-building-fill")) return; // déjà en place
  if (!map.getSource("composite")) {
    console.warn('Terreno: source "composite" introuvable dans ce style — pas de coloration des bâtiments.');
    return;
  }
  try {
    map.addLayer({
      id: "gt-building-fill",
      type: "fill",
      source: "composite",
      "source-layer": "building",
      minzoom: 15,
      paint: {
        "fill-color": [
          "match", ["%", ["id"], 4],
          0, "#8791E4",
          1, "#7C87DE",
          2, "#6D79D6",
          3, "#63D9A8",
          "#8791E4"
        ],
        "fill-opacity": [
          "interpolate", ["linear"], ["zoom"],
          15, 0,
          16, 0.55
        ]
      }
    });
    map.addLayer({
      id: "gt-building-outline",
      type: "line",
      source: "composite",
      "source-layer": "building",
      minzoom: 15,
      paint: {
        "line-color": "rgba(255,255,255,0.55)",
        "line-width": 1
      }
    });
  } catch (err) {
    console.warn("Terreno: impossible d'ajouter la couche de bâtiments colorés.", err);
  }
}

/* ---------- Bascule Marche/Arrêt de la mosaïque de lots ---------- */
let parcelLayersVisible = true;

const PARCEL_LAYER_IDS = [
  "gt-city-parcel-fill", "gt-city-parcel-outline",
  "gt-building-fill", "gt-building-outline",
  "gt-parcel-fill", "gt-parcel-outline",
  "gt-selected-parcel-fill", "gt-selected-parcel-outline-halo", "gt-selected-parcel-outline"
];

function applyParcelVisibility() {
  PARCEL_LAYER_IDS.forEach(id => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", parcelLayersVisible ? "visible" : "none");
    }
  });
}

function toggleParcelLayers() {
  parcelLayersVisible = !parcelLayersVisible;
  applyParcelVisibility();
  return parcelLayersVisible;
}

function setupClusterLayers() {
  // Mosaïque de lots pour l'effet "vue d'ensemble" façon Doormath —
  // vrai tileset cadastral si configuré, sinon repli sur les empreintes Mapbox génériques
  const hasCityTileset = setupCityParcelLayer();
  if (!hasCityTileset) setupBuildingLayer();

  // Vrais polygones de lot par-dessus, pour tes immeubles suivis (plus précis, contour marqué)
  setupParcelLayer();

  // Points matricule invisibles (recherche au clic, peu importe la ville)
  setupMatriculePointsLayer();

  // Surlignage du lot actuellement sélectionné (rempli au clic)
  setupSelectedParcelLayer();

  // Réapplique l'état marche/arrêt (utile après un changement de style de carte)
  applyParcelVisibility();

  if (map.getSource("properties")) {
    map.getSource("properties").setData(buildGeoJSON());
    return;
  }

  map.addSource("properties", {
    type: "geojson",
    data: buildGeoJSON(),
    cluster: true,
    clusterMaxZoom: CONFIG.cluster.maxZoom,
    clusterRadius: CONFIG.cluster.radius,
    clusterProperties: { totalGuaranteed: ["+", ["get", "totalGuaranteed"]] }
  });

  // Clusters
  map.addLayer({
    id: "clusters", type: "circle", source: "properties",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": ["step", ["get", "point_count"], "#185FA5", 10, "#0C447C", 25, "#042C53"],
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 25, 30],
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff"
    }
  });
  map.addLayer({
    id: "cluster-count", type: "symbol", source: "properties",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 13
    },
    paint: { "text-color": "#ffffff" }
  });

  // Points individuels — bordure jaune si un prêt suivi grève l'immeuble
  map.addLayer({
    id: "unclustered-point", type: "circle", source: "properties",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 10,
      "circle-stroke-width": ["case", ["==", ["get", "saved"], 1], 3, 2],
      "circle-stroke-color": ["case", ["==", ["get", "saved"], 1], "#FAC775", "#ffffff"]
    }
  });

  // Interactions
  map.on("click", "clusters", e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource("properties").getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom, duration: 600 });
    });
  });
  map.on("click", "unclustered-point", e => selectProperty(e.features[0].properties.id));

  ["clusters", "unclustered-point"].forEach(layer => {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  });

  // Popup au survol d'un cluster
  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
  map.on("mouseenter", "clusters", e => {
    const f = e.features[0];
    popup.setLngLat(f.geometry.coordinates)
      .setHTML(`<div style="font-family:var(--font-sans);font-size:12px">
        <strong>${f.properties.point_count} immeubles</strong><br/>
        Total garanti : ${fmtK(f.properties.totalGuaranteed)}
      </div>`)
      .addTo(map);
  });
  map.on("mouseleave", "clusters", () => popup.remove());
}

/* ---------- Refresh + comptage visible ---------- */
function refreshMap() {
  if (map && map.getSource("properties")) {
    map.getSource("properties").setData(buildGeoJSON());
  }
  if (map && map.getSource("gt-parcels")) {
    map.getSource("gt-parcels").setData(buildParcelGeoJSON());
  }
  const count = state.properties.filter(propertyPassesFilters).length;
  document.getElementById("pin-count").textContent =
    `${count} / ${state.properties.length} immeubles visibles`;
  scheduleBubbleRender();
}

/* =====================================================================
   Bulles d'info sur les pins (façon arenarium.dev, version maison légère)
   Chaque immeuble individuel visible affiche une petite bulle avec le montant
   garanti si la place le permet ; sinon elle reste un simple point pour éviter
   le chevauchement. Recalculé à chaque déplacement/zoom de la carte.
   ===================================================================== */
let bubbleRenderScheduled = false;

function scheduleBubbleRender() {
  if (bubbleRenderScheduled) return;
  bubbleRenderScheduled = true;
  requestAnimationFrame(() => {
    bubbleRenderScheduled = false;
    renderPropertyBubbles();
  });
}

function renderPropertyBubbles() {
  const container = document.getElementById("bubble-labels");
  if (!container || !map || !map.getLayer("unclustered-point")) {
    if (container) container.innerHTML = "";
    return;
  }

  const canvas = map.getCanvas();
  const features = map.queryRenderedFeatures({ layers: ["unclustered-point"] });
  if (features.length === 0) {
    container.innerHTML = "";
    return;
  }

  // Dédoublonne (un même immeuble peut apparaître dans plusieurs tuiles) et calcule
  // sa position à l'écran + son "rang" (montant garanti, plus haut = prioritaire).
  const seen = new Set();
  const items = [];
  features.forEach(f => {
    const id = f.properties.id;
    if (seen.has(id)) return;
    seen.add(id);
    const p = state.propertyMap[id];
    if (!p) return;
    const px = map.project([p.lng, p.lat]);
    const totalGuaranteed = f.properties.totalGuaranteed || 0;
    items.push({ id, p, px, rank: totalGuaranteed, color: f.properties.color });
  });

  items.sort((a, b) => b.rank - a.rank);

  const BUBBLE_W = 118, BUBBLE_H = 42, GAP = 5;
  const placed = [];

  const html = items.map(item => {
    const box = {
      left: item.px.x - BUBBLE_W / 2,
      top: item.px.y - BUBBLE_H - 14,
      right: item.px.x + BUBBLE_W / 2,
      bottom: item.px.y - 14
    };
    const overlaps = placed.some(b =>
      box.left < b.right + GAP && box.right > b.left - GAP &&
      box.top < b.bottom + GAP && box.bottom > b.top - GAP
    );
    if (overlaps) return "";
    if (box.right < 0 || box.left > canvas.clientWidth || box.bottom < 0 || box.top > canvas.clientHeight) return "";

    placed.push(box);
    const amount = item.rank > 0 ? fmtK(item.rank) : (item.p.addr || "").split(" ").slice(0, 2).join(" ");
    const owner = item.p.owner || "";
    return `
      <div class="gt-bubble" data-property-id="${item.id}"
           style="left:${item.px.x}px; top:${item.px.y - 14}px; border-color:${item.color};">
        <span class="gt-bubble-dot" style="background:${item.color};"></span>
        <span class="gt-bubble-text">
          <span class="gt-bubble-amount">${amount}</span>
          ${owner ? `<span class="gt-bubble-owner">${owner}</span>` : ""}
        </span>
      </div>
    `;
  }).join("");

  container.innerHTML = html;
  container.querySelectorAll(".gt-bubble").forEach(el => {
    el.addEventListener("click", () => selectProperty(el.dataset.propertyId));
  });
}


function selectProperty(id) {
  clearCollateralHighlights();
  clearSearchHighlight();
  clearSelectedParcelHighlight();
  state.selectedType = "property";
  state.selectedId = id;
  state.editing = false;
  state.searchResult = null;
  const p = state.propertyMap[id];
  if (p) {
    if (typeof switchView === "function") switchView("map");
    map.flyTo({
      center: [p.lng, p.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800
    });
  }
  renderPanel();
}

/* ---------- Sélection : prêt (cadre tous les immeubles) ---------- */
function selectLoan(id) {
  clearSearchHighlight();
  clearSelectedParcelHighlight();
  state.selectedType = "loan";
  state.selectedId = id;
  state.editing = false;
  state.searchResult = null;
  frameLoanCollateral(id);
  renderPanel();
}

/* ---------- Cadrer les immeubles d'un prêt ---------- */
function frameLoanCollateral(loanId) {
  const props = propertiesForLoan(loanId);
  clearCollateralHighlights();

  if (props.length === 0) return;

  // Highlight markers overlay pour rendre les immeubles bien visibles
  props.forEach(x => {
    const el = document.createElement("div");
    el.className = "gt-highlight-marker";
    el.innerHTML = `<i class="ti ti-target"></i>`;
    const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat([x.property.lng, x.property.lat])
      .addTo(map);
    collateralHighlightMarkers.push(marker);
  });

  if (props.length === 1) {
    const p = props[0].property;
    map.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 800 });
  } else {
    const bounds = new mapboxgl.LngLatBounds();
    props.forEach(x => bounds.extend([x.property.lng, x.property.lat]));
    map.fitBounds(bounds, { padding: 100, maxZoom: 14, duration: 800 });
  }

  // S'assurer que la carte est visible
  switchView("map");
}

function clearCollateralHighlights() {
  collateralHighlightMarkers.forEach(m => m.remove());
  collateralHighlightMarkers = [];
}

/* ---------- Changement de style ---------- */
function setMapStyle(styleKey) {
  map.setStyle(CONFIG.styles[styleKey]);
  map.once("style.load", () => {
    setupClusterLayers();
    setupMunicipalityLayer();
    setupFloodZoneLayer();
    setupLandslideZoneLayer();
    setupContaminatedSitesLayer();
    setupAgriculturalZoneLayer();
    setupCoastalErosionLayer();

    // Respecte l'état actuel des cases à cocher plutôt que de tout réafficher
    // par défaut — sinon une couche désactivée reviendrait toute seule.
    const muniBtn = document.getElementById("toggle-municipalities");
    if (muniBtn && !muniBtn.classList.contains("active")) {
      ["gt-municipality-fill", "gt-municipality-outline", "gt-municipality-label"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
    }

    const floodBtn = document.getElementById("toggle-flood-zones");
    if (floodBtn && !floodBtn.checked) {
      ["gt-flood-zone-fill", "gt-flood-zone-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
    }

    const landslideBtn = document.getElementById("toggle-landslide-zones");
    if (landslideBtn && !landslideBtn.checked) {
      ["gt-landslide-fill", "gt-landslide-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
    }

    const contamBtn = document.getElementById("toggle-contaminated-sites");
    if (contamBtn && !contamBtn.checked) {
      if (map.getLayer("gt-contaminated-points")) map.setLayoutProperty("gt-contaminated-points", "visibility", "none");
    }

    const erosionBtn = document.getElementById("toggle-coastal-erosion");
    if (erosionBtn && !erosionBtn.checked) {
      ["gt-coastal-erosion-fill", "gt-coastal-erosion-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
    }

    const agriBtn = document.getElementById("toggle-agricultural-zone");
    if (agriBtn && !agriBtn.checked) {
      ["gt-agricultural-fill", "gt-agricultural-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      });
    }

    // Les lots (cadastre) ne se rattachent que si le bouton "Lots" est actif
    const parcelBtn = document.getElementById("toggle-parcels");
    if (parcelBtn && parcelBtn.classList.contains("active")) {
      setupCityParcelLayer();
    }
  });
}