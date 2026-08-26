/* =====================================================================
   map.js — Mapbox, clustering, sélection, cadrage multi-immeubles
   ===================================================================== */

let map;
let geocoder;
let collateralHighlightMarkers = [];
let searchHighlightMarker = null;
let parcelDimensionMarkers = [];

function initMap() {
  mapboxgl.accessToken = CONFIG.mapboxToken;

  map = new mapboxgl.Map({
    container: "mapbox-canvas",
    style: CONFIG.styles.standard,
    center: CONFIG.map.center,
    zoom: CONFIG.map.zoom
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
  map.on("zoom", updateParcelDimensionLabelsVisibility);

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
    setupWildfireRegimeLayer();
    setupFireRestrictionLayer();
    setupAddressLabelsLayer();
    setupMetroLayer();
    setupTrainLayer();
    setupBusStopsLayer();
    setupTrafficLayer();
    setupClusterLayers();
    syncRiskLayerVisibilityFromCheckboxes();
    refreshMap();
    wireRightClickPreview();
    map.on("render", scheduleBubbleRender);
  });
}

// Clic droit n'importe où sur la carte → aperçu rapide (adresse, Street View),
// même par-dessus un lot coloré ou un immeuble. Contrairement à l'ancien mode
// "Pin" (bouton à activer/désactiver), le clic droit n'entre jamais en conflit
// avec les autres gestionnaires de clic (gauche) — rien d'autre ne l'utilise,
// donc pas besoin de vérifier ce qui est "en dessous".
let rightClickPreviewWired = false;
function wireRightClickPreview() {
  if (rightClickPreviewWired) return; // jamais de doublon, même si rappelée
  rightClickPreviewWired = true;

  map.on("contextmenu", (e) => {
    e.preventDefault();
    selectByCoordinate(e.lngLat.lng, e.lngLat.lat);
  });
}

/* ---------- Regroupement visuel par municipalité (couleurs pastel, visible en dézoomant) ---------- */
// Trouve la première couche d'étiquettes (noms de rues, adresses, villes) du style
// actif, pour insérer nos couches personnalisées EN DESSOUS — sinon elles cachent
// les adresses du fond de carte là où elles se superposent.
function getFirstLabelLayerId() {
  const layers = map.getStyle() && map.getStyle().layers;
  if (!layers) return undefined;
  const symbolLayer = layers.find(l => l.type === "symbol");
  return symbolLayer ? symbolLayer.id : undefined;
}

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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
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
  }, getFirstLabelLayerId());

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
  }, getFirstLabelLayerId());
}

async function fetchCoastalErosionStatus(lng, lat) {
  if (!CONFIG.coastalErosionTileset || !CONFIG.coastalErosionTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.coastalErosionTileset.id, lng, lat);
  if (!props) return null;
  return { mrc: props.mrc_nom || "", zoneType: props.zone_type || "" };
}

/* ---------- Zonage des régimes de feux du Québec méridional (MRNF) ---------- */
function setupWildfireRegimeLayer() {
  if (!CONFIG.wildfireRegimeTileset || !CONFIG.wildfireRegimeTileset.id) return;
  if (map.getLayer("gt-wildfire-regime-fill")) return;

  map.addSource("gt-wildfire-regime", {
    type: "vector",
    url: `mapbox://${CONFIG.wildfireRegimeTileset.id}`
  });

  map.addLayer({
    id: "gt-wildfire-regime-fill",
    type: "fill",
    source: "gt-wildfire-regime",
    "source-layer": CONFIG.wildfireRegimeTileset.sourceLayer,
    minzoom: 4,
    paint: {
      "fill-color": "#D97706",
      "fill-opacity": 0.18
    }
  }, getFirstLabelLayerId());

  map.addLayer({
    id: "gt-wildfire-regime-outline",
    type: "line",
    source: "gt-wildfire-regime",
    "source-layer": CONFIG.wildfireRegimeTileset.sourceLayer,
    minzoom: 4,
    paint: {
      "line-color": "#B45309",
      "line-width": 1,
      "line-dasharray": [2, 1]
    }
  }, getFirstLabelLayerId());
}

async function fetchWildfireRegimeStatus(lng, lat) {
  if (!CONFIG.wildfireRegimeTileset || !CONFIG.wildfireRegimeTileset.id) return null;
  const props = await tilequeryLookup(CONFIG.wildfireRegimeTileset.id, lng, lat);
  if (!props) return null;
  return { zone: props.zone_nom || props.ZONE || "", regime: props.regime || props.REGIME || "" };
}

/* ---------- Labels de numéros civiques (rive-nord/rive-sud — zones où le style
   Mapbox Standard n'affiche pas assez d'adresses natives) ---------- */
function setupAddressLabelsLayer() {
  if (!CONFIG.addressLabelsTileset || !CONFIG.addressLabelsTileset.id) return;
  if (map.getLayer("gt-address-labels")) return;

  map.addSource("gt-address-labels", {
    type: "vector",
    url: `mapbox://${CONFIG.addressLabelsTileset.id}`
  });

  map.addLayer({
    id: "gt-address-labels",
    type: "symbol",
    source: "gt-address-labels",
    "source-layer": CONFIG.addressLabelsTileset.sourceLayer,
    minzoom: 17,
    layout: {
      "text-field": ["get", "civique"],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": 11,
      "text-anchor": "center",
      "text-allow-overlap": false
    },
    paint: {
      "text-color": "#3A3A3A",
      "text-halo-color": "rgba(255,255,255,0.9)",
      "text-halo-width": 1.3
    }
  });
}

/* ---------- Mesures préventives feux de forêt actives (IFCO/ICAF/RTF — SOPFEU/MSP) ----------
   Contrairement aux autres couches de risque, ces zones bougent en cours de saison :
   pas de tileset Mapbox ici, on les charge en direct depuis l'API WFS publique du
   gouvernement à chaque ouverture de la carte. */
let fireRestrictionRefreshTimer = null;

async function setupFireRestrictionLayer() {
  if (!CONFIG.fireRestrictionSources) return;
  if (!map.getSource("gt-fire-restrictions")) {
    map.addSource("gt-fire-restrictions", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });

    const restrictionColorMatch = [
      "match", ["get", "mesure"],
      "IFCO", "#DC2626",
      "ICAF", "#EA580C",
      "RTF", "#D97706",
      "#B45309"
    ];

    map.addLayer({
      id: "gt-fire-restriction-fill",
      type: "fill",
      source: "gt-fire-restrictions",
      minzoom: 4,
      paint: {
        "fill-color": restrictionColorMatch,
        "fill-opacity": 0.22
      }
    }, getFirstLabelLayerId());

    map.addLayer({
      id: "gt-fire-restriction-outline",
      type: "line",
      source: "gt-fire-restrictions",
      minzoom: 4,
      paint: {
        "line-color": restrictionColorMatch,
        "line-width": 1.5
      }
    }, getFirstLabelLayerId());
  }

  await refreshFireRestrictionData();

  // Rafraîchit automatiquement toutes les 30 minutes tant que la page reste ouverte
  // (ces zones peuvent changer en pleine journée lors d'alertes SOPFEU).
  if (!fireRestrictionRefreshTimer) {
    fireRestrictionRefreshTimer = setInterval(refreshFireRestrictionData, 30 * 60 * 1000);
  }
}

async function refreshFireRestrictionData() {
  if (!map.getSource("gt-fire-restrictions")) return;
  const sources = CONFIG.fireRestrictionSources;
  const labels = { ifco: "IFCO", icaf: "ICAF", rtf: "RTF" };

  try {
    const results = await Promise.all(
      Object.entries(sources).map(([key, url]) =>
        fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)
      )
    );

    const features = [];
    Object.keys(sources).forEach((key, i) => {
      const fc = results[i];
      if (!fc || !fc.features) return;
      fc.features.forEach(f => {
        features.push({
          ...f,
          properties: { ...f.properties, mesure: labels[key] }
        });
      });
    });

    map.getSource("gt-fire-restrictions").setData({ type: "FeatureCollection", features });
    console.log(`Terreno: ${features.length} zone(s) de mesures préventives feux de forêt chargée(s).`);
  } catch (e) {
    console.warn("Terreno: impossible de charger les mesures préventives feux de forêt.", e);
  }
}

// Un point (immeuble) est-il actuellement dans une zone de mesure active ? Vérifie
// contre les données déjà chargées dans la source (pas de requête réseau séparée).
function fireRestrictionStatusAt(lng, lat) {
  if (!map.getSource("gt-fire-restrictions") || !map.getLayer("gt-fire-restriction-fill")) return null;
  const point = map.project([lng, lat]);
  const found = map.queryRenderedFeatures(point, { layers: ["gt-fire-restriction-fill"] });
  if (!found.length) return null;
  return [...new Set(found.map(f => f.properties.mesure))];
}

/* ---------- Métro STM ---------- */
function setupMetroLayer() {
  if (!CONFIG.metroTileset || !CONFIG.metroTileset.id) return;
  if (map.getLayer("gt-metro-line")) return;

  map.addSource("gt-metro", {
    type: "vector",
    url: `mapbox://${CONFIG.metroTileset.id}`
  });

  const beforeId = typeof getFirstLabelLayerId === "function" ? getFirstLabelLayerId() : undefined;

  map.addLayer({
    id: "gt-metro-line",
    type: "line",
    source: "gt-metro",
    "source-layer": CONFIG.metroTileset.sourceLayer,
    minzoom: 9,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["concat", "#", ["get", "route_color"]],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 16, 5]
    }
  }, beforeId);

  map.addLayer({
    id: "gt-metro-label",
    type: "symbol",
    source: "gt-metro",
    "source-layer": CONFIG.metroTileset.sourceLayer,
    minzoom: 11,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "route_long_name"],
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"]
    },
    paint: {
      "text-color": ["concat", "#", ["get", "route_color"]],
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5
    }
  }, beforeId);

  setupMetroStationsLayer(beforeId);
}

// Stations de métro — icône ronde "M" (façon logo classique de métro), liée à la
// même case "Métro" que les lignes (pas de case séparée).
function setupMetroStationsLayer(beforeId) {
  if (!CONFIG.metroStationsTileset || !CONFIG.metroStationsTileset.id) return;
  if (map.getLayer("gt-metro-stations-points")) return;

  map.addSource("gt-metro-stations", {
    type: "vector",
    url: `mapbox://${CONFIG.metroStationsTileset.id}`
  });

  const METRO_COLOR = "#1A1A2E";
  const metroBtn = document.getElementById("toggle-metro");
  const initialVisibility = (metroBtn && metroBtn.checked) ? "visible" : "none";

  const addStationLayers = () => {
    map.addLayer({
      id: "gt-metro-stations-points",
      type: "symbol",
      source: "gt-metro-stations",
      "source-layer": CONFIG.metroStationsTileset.sourceLayer,
      minzoom: 8,
      layout: {
        "icon-image": "gt-metro-icon",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.12, 12, 0.22, 17, 0.4],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "visibility": initialVisibility
      }
    }, beforeId);

    map.addLayer({
      id: "gt-metro-stations-label",
      type: "symbol",
      source: "gt-metro-stations",
      "source-layer": CONFIG.metroStationsTileset.sourceLayer,
      minzoom: 12,
      layout: {
        "text-field": ["get", "stop_name"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "visibility": initialVisibility
      },
      paint: {
        "text-color": METRO_COLOR,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5
      }
    }, beforeId);
  };

  if (map.hasImage("gt-metro-icon")) {
    addStationLayers();
    return;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = METRO_COLOR;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();

  // Icône "subway" fournie (tracé SVG original, viewBox 256x256), redimensionnée et
  // centrée dans le rond, dessinée en blanc.
  const subwayPath = new Path2D("M224,96V208a8,8,0,0,1-16,0V96a56.06,56.06,0,0,0-56-56H104A56.06,56.06,0,0,0,48,96V208a8,8,0,0,1-16,0V96a72.08,72.08,0,0,1,72-72h48A72.08,72.08,0,0,1,224,96Zm-40,0v72a24,24,0,0,1-19.29,23.53l2.45,4.89a8,8,0,0,1-14.32,7.16L147.06,192H108.94l-5.78,11.58a8,8,0,0,1-14.32-7.16l2.45-4.89A24,24,0,0,1,72,168V96A24,24,0,0,1,96,72h64A24,24,0,0,1,184,96ZM88,96v48h80V96a8,8,0,0,0-8-8H96A8,8,0,0,0,88,96Zm32,64v16h16V160ZM96,176h8V160H88v8A8,8,0,0,0,96,176Zm72-8v-8H152v16h8A8,8,0,0,0,168,168Z");
  const iconTargetSize = size * 0.56; // occupe ~56% du diamètre du rond
  const scale = iconTargetSize / 256;
  const offset = (size - iconTargetSize) / 2;

  ctx.save();
  ctx.translate(offset, offset);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill(subwayPath);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, size, size);
  map.addImage("gt-metro-icon", imageData);
  addStationLayers();
}

/* ---------- Trains de banlieue exo ---------- */
function setupTrainLayer() {
  if (!CONFIG.trainTileset || !CONFIG.trainTileset.id) return;
  if (map.getLayer("gt-train-line")) return;

  map.addSource("gt-train", {
    type: "vector",
    url: `mapbox://${CONFIG.trainTileset.id}`
  });

  const beforeId = typeof getFirstLabelLayerId === "function" ? getFirstLabelLayerId() : undefined;

  map.addLayer({
    id: "gt-train-line",
    type: "line",
    source: "gt-train",
    "source-layer": CONFIG.trainTileset.sourceLayer,
    minzoom: 7,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["concat", "#", ["get", "route_color"]],
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.5, 14, 4],
      "line-dasharray": [2, 1.5]
    }
  }, beforeId);

  map.addLayer({
    id: "gt-train-label",
    type: "symbol",
    source: "gt-train",
    "source-layer": CONFIG.trainTileset.sourceLayer,
    minzoom: 9,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "route_long_name"],
      "text-size": 11,
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"]
    },
    paint: {
      "text-color": ["concat", "#", ["get", "route_color"]],
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1.5
    }
  }, beforeId);
}

/* ---------- Arrêts d'autobus STM ---------- */
function setupBusStopsLayer() {
  if (!CONFIG.busStopsTileset || !CONFIG.busStopsTileset.id) return;
  if (map.getLayer("gt-bus-stops-points")) return;

  map.addSource("gt-bus-stops", {
    type: "vector",
    url: `mapbox://${CONFIG.busStopsTileset.id}`
  });

  const beforeIdBus = typeof getFirstLabelLayerId === "function" ? getFirstLabelLayerId() : undefined;
  const BUS_COLOR = "#E8601C"; // orange bien visible, distinct des autres couches

  const addBusLayers = () => {
    // Comme le chargement de la police est asynchrone, ces couches peuvent apparaître
    // bien après la vérification initiale des cases à cocher — on fixe donc leur
    // visibilité directement ici, selon l'état actuel de la case, plutôt que de
    // compter sur un contrôle externe qui pourrait s'exécuter trop tôt.
    const busBtn = document.getElementById("toggle-bus-stops");
    const initialVisibility = (busBtn && busBtn.checked) ? "visible" : "none";

    map.addLayer({
      id: "gt-bus-stops-points",
      type: "symbol",
      source: "gt-bus-stops",
      "source-layer": CONFIG.busStopsTileset.sourceLayer,
      minzoom: 13,
      layout: {
        "icon-image": "gt-bus-icon",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 17, 0.55],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "visibility": initialVisibility
      }
    }, beforeIdBus);

    map.addLayer({
      id: "gt-bus-stops-label",
      type: "symbol",
      source: "gt-bus-stops",
      "source-layer": CONFIG.busStopsTileset.sourceLayer,
      minzoom: 16,
      layout: {
        "text-field": ["get", "stop_name"],
        "text-size": 10,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "visibility": initialVisibility
      },
      paint: {
        "text-color": BUS_COLOR,
        "text-halo-color": "#FFFFFF",
        "text-halo-width": 1.5
      }
    }, beforeIdBus);
  };

  if (map.hasImage("gt-bus-icon")) {
    addBusLayers();
    return;
  }

  // Dessine la vraie icône "Bus" de Phosphor Icons (phosphoricons.com) dans un rond
  // orange, en chargeant leur police officielle et en dessinant le glyphe exact
  // (codepoint 57606, poids "bold") sur un canvas — plutôt qu'une silhouette
  // approximative, c'est le vrai tracé de leur bibliothèque.
  const drawBusIcon = () => {
    const size = 80;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = BUS_COLOR;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `${Math.round(size * 0.52)}px "Phosphor-Bold"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String.fromCodePoint(57606), size / 2, size / 2 + 2);

    const imageData = ctx.getImageData(0, 0, size, size);
    if (!map.hasImage("gt-bus-icon")) map.addImage("gt-bus-icon", imageData);
    addBusLayers();
  };

  if (!document.getElementById("gt-phosphor-font-link")) {
    const link = document.createElement("link");
    link.id = "gt-phosphor-font-link";
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/bold/style.css";
    document.head.appendChild(link);
  }

  const fontFace = new FontFace(
    "Phosphor-Bold",
    "url(https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/bold/Phosphor-Bold.woff)"
  );
  fontFace.load().then(loaded => {
    document.fonts.add(loaded);
    drawBusIcon();
  }).catch(() => {
    // Si la police échoue à charger pour une raison ou une autre, on retombe sur un
    // simple rond orange plutôt que de ne rien afficher du tout.
    drawBusIcon();
  });
}

/* ---------- Trafic routier en direct (fourni nativement par Mapbox) ---------- */
function setupTrafficLayer() {
  if (map.getLayer("gt-traffic-line")) return;

  map.addSource("gt-traffic", {
    type: "vector",
    url: "mapbox://mapbox.mapbox-traffic-v1"
  });

  const beforeId = typeof getFirstLabelLayerId === "function" ? getFirstLabelLayerId() : undefined;
  const trafficBtn = document.getElementById("toggle-traffic");
  const initialVisibility = (trafficBtn && trafficBtn.checked) ? "visible" : "none";

  map.addLayer({
    id: "gt-traffic-line",
    type: "line",
    source: "gt-traffic",
    "source-layer": "traffic",
    minzoom: 8,
    layout: {
      "line-cap": "round",
      "line-join": "round",
      "visibility": initialVisibility
    },
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 16, 5],
      "line-color": [
        "match", ["get", "congestion"],
        "low", "#4CAF50",
        "moderate", "#FFC107",
        "heavy", "#FF5722",
        "severe", "#B71C1C",
        "rgba(0,0,0,0)"
      ]
    }
  }, beforeId);
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
  showParcelDimensionLabels(geometry);
}

function clearSelectedParcelHighlight() {
  if (!map.getSource("gt-selected-parcel")) return;
  map.getSource("gt-selected-parcel").setData({ type: "FeatureCollection", features: [] });
  clearParcelDimensionLabels();
}

/* ---------- Labels de dimensions (longueur de chaque côté) du lot sélectionné ---------- */

// Distance en mètres entre deux points [lng, lat] (formule haversine — pas besoin de turf.js)
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function clearParcelDimensionLabels() {
  parcelDimensionMarkers.forEach(m => m.remove());
  parcelDimensionMarkers = [];
}

// Affiche un label "XX m" au milieu de chaque côté du polygone (Polygon ou premier
// anneau du premier polygone d'un MultiPolygon). Segments trop courts ignorés
// (souvent des artefacts d'arrondi de coin dans le cadastre).
function showParcelDimensionLabels(geometry) {
  clearParcelDimensionLabels();
  if (!geometry) return;

  let ring;
  if (geometry.type === "Polygon") {
    ring = geometry.coordinates[0];
  } else if (geometry.type === "MultiPolygon") {
    ring = geometry.coordinates[0][0];
  } else {
    return;
  }
  if (!ring || ring.length < 3) return;

  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const dist = haversineMeters(a, b);
    if (dist < 1.5) continue;

    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const label = dist >= 10 ? `${Math.round(dist)} m` : `${dist.toFixed(1)} m`;

    const el = document.createElement("div");
    el.className = "gt-parcel-dim-label";
    el.textContent = label;
    el.style.cssText = `
      background:#ffffff;
      border:1px solid #d8d6d0;
      border-radius:999px;
      padding:4px 10px;
      font-family:var(--font-sans, sans-serif);
      font-size:12px;
      font-weight:700;
      color:#1a1a1a;
      box-shadow:0 1px 3px rgba(0,0,0,0.18);
      white-space:nowrap;
      pointer-events:none;
    `;

    const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat(mid)
      .addTo(map);
    parcelDimensionMarkers.push(marker);
  }

  updateParcelDimensionLabelsVisibility();
}

// Cache les labels quand on est trop dézoomé (ils se superposeraient tous) — appelé
// depuis initMap() sur l'évènement "zoom".
function updateParcelDimensionLabelsVisibility() {
  const visible = map.getZoom() >= 16.5;
  parcelDimensionMarkers.forEach(m => {
    m.getElement().style.display = visible ? "" : "none";
  });
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
    if (vals.yearBuilt && !built.yearBuilt) built.yearBuilt = vals.yearBuilt;
    if (vals.constructionCode && !built.constructionCode) built.constructionCode = vals.constructionCode;
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
// Traduit le code brut RL0310A (1 à 5) reçu du rôle d'évaluation vers le libellé
// correspondant dans la liste gérée (Paramètres) — pour que le menu déroulant
// présélectionne le bon choix. Si le libellé a été renommé/retiré par l'utilisateur,
// on retombe simplement sur le code brut.
function mapConstructionCodeToLabel(rawCode) {
  const match = CONFIG.options.constructionTypes.find(t => t.startsWith(`${rawCode} -`));
  return match || rawCode;
}

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
    codeMun: props.code_mun || "", secteur: props.secteur || "", typePropriete: props.type_propriete || "",
    yearBuilt: props.annee_construction ? Number(props.annee_construction) : null,
    constructionCode: props.genre_construction ? mapConstructionCodeToLabel(props.genre_construction) : null
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
    if (vals.yearBuilt && !built.yearBuilt) built.yearBuilt = vals.yearBuilt;
    if (vals.constructionCode && !built.constructionCode) built.constructionCode = vals.constructionCode;
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
    if (vals.yearBuilt && !built.yearBuilt) built.yearBuilt = vals.yearBuilt;
    if (vals.constructionCode && !built.constructionCode) built.constructionCode = vals.constructionCode;
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

    // Interactions : chaque lot devient cliquable — enregistré UNE SEULE FOIS
    // (même raison que pour les clusters, voir plus bas dans le fichier).
    if (!window._gtParcelFillHandlersWired) {
      window._gtParcelFillHandlersWired = true;
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
    }

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
    if (vals.yearBuilt && !built.yearBuilt) built.yearBuilt = vals.yearBuilt;
    if (vals.constructionCode && !built.constructionCode) built.constructionCode = vals.constructionCode;
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

  // Interactions — enregistrées UNE SEULE FOIS (jamais à chaque changement de
  // style), sinon elles s'accumulent en double à chaque fois et un ancien
  // gestionnaire cassé peut bloquer tous les clics suivants sur la carte.
  if (!window._gtClusterHandlersWired) {
    window._gtClusterHandlersWired = true;

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


/* =====================================================================
   Popup de prévisualisation au clic sur un immeuble/lot (photo + adresse +
   stats rapides + bouton "Voir" qui ouvre le panneau latéral complet).
   ===================================================================== */
let activePropertyPreviewPopup = null;

function propertyPreviewPhotoUrl(p) {
  if (!hasGoogleKey()) return null;
  return `https://www.google.com/maps/embed/v1/streetview?key=${CONFIG.googleKey}&location=${p.lat},${p.lng}&fov=90`;
}

function showPropertyPreviewPopup(p, lngLat) {
  if (activePropertyPreviewPopup) activePropertyPreviewPopup.remove();

  const photoUrl = propertyPreviewPhotoUrl(p);
  const sqft = p.lotAreaSqFt || (p.lotAreaSqM ? Math.round(p.lotAreaSqM * 10.7639) : 0);
  const subtitle = [p.neighborhood, p.city].filter(Boolean).join(", ") || p.city || "";

  const statRow = (icon, label, value) => `
    <div style="display:flex; align-items:center; gap:8px;">
      <div style="width:34px; height:34px; border-radius:9px; background:#EAF6F1; display:flex; align-items:center; justify-content:center; flex:0 0 auto;">
        <i class="ti ${icon}" style="color:#1D9E75; font-size:16px;"></i>
      </div>
      <div style="font-size:12px; line-height:1.3;">
        <div style="color:var(--color-text-tertiary,#8A8A85);">${label}</div>
        <div style="font-weight:600; color:var(--color-text-primary,#1a1a1a);">${value || "—"}</div>
      </div>
    </div>
  `;

  const html = `
    <div style="width:280px; font-family:var(--font-sans, sans-serif); border-radius:16px; overflow:hidden; background:#fff;">
      <div style="position:relative; height:150px; background:#E8E7E2;">
        ${photoUrl
          ? `<iframe class="gt-sv-frame" data-lat="${p.lat}" data-lng="${p.lng}" src="${photoUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allow="accelerometer; gyroscope" style="width:100%; height:100%; border:0; display:block;"></iframe>`
          : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#B5B4AE;"><i class="ti ti-photo-off" style="font-size:28px;"></i></div>`}
        <span style="position:absolute; top:10px; left:10px; background:rgba(255,255,255,0.95); padding:5px 12px; border-radius:999px; font-size:12px; font-weight:700;">${p.type || "Immeuble"}</span>
        <button class="gt-preview-close" style="position:absolute; top:10px; right:10px; width:28px; height:28px; border-radius:50%; background:rgba(0,0,0,0.55); border:none; color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer;">
          <i class="ti ti-x" style="font-size:15px;"></i>
        </button>
      </div>
      <div style="padding:14px 16px 16px;">
        <div style="font-size:15px; font-weight:700; color:var(--color-text-primary,#1a1a1a);">${p.addr}</div>
        <div style="font-size:12px; color:var(--color-text-tertiary,#8A8A85); margin-top:2px;">${subtitle}</div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px;">
          ${statRow("ti-calendar", "Construction", p.yearBuilt)}
          ${statRow("ti-stairs", "Genre", p.constructionCode)}
          ${statRow("ti-ruler-2", "Terrain", sqft ? `${sqft.toLocaleString("fr-CA")} pi²` : "")}
          ${statRow("ti-cash", "Valeur", p.value ? fmtK(p.value) : "")}
        </div>

        <button class="gt-preview-voir-btn" style="width:100%; margin-top:14px; background:#1a1a1a; color:#fff; border:none; border-radius:999px; padding:12px; font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          Voir <i class="ti ti-arrow-right"></i>
        </button>
      </div>
    </div>
  `;

  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "300px", offset: 16 })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  activePropertyPreviewPopup = popup;
  if (typeof renderStreetViewPanoramas === "function") renderStreetViewPanoramas();

  const el = popup.getElement();
  const closeBtn = el.querySelector(".gt-preview-close");
  if (closeBtn) closeBtn.addEventListener("click", () => popup.remove());

  const voirBtn = el.querySelector(".gt-preview-voir-btn");
  if (voirBtn) {
    voirBtn.addEventListener("click", () => {
      popup.remove();
      if (p.id) {
        selectProperty(p.id);
      } else {
        // Lot pas encore enregistré comme immeuble — on ouvre quand même le
        // panneau avec les infos déjà connues, comme selectParcelResult().
        clearCollateralHighlights();
        clearSearchHighlight();
        state.selectedType = "search";
        state.selectedId = null;
        state.editing = false;
        state.searchResult = p;
        renderPanel();
      }
    });
  }

  popup.on("close", () => {
    if (activePropertyPreviewPopup === popup) activePropertyPreviewPopup = null;
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
  if (typeof inlineEditingCollateralIds !== "undefined") inlineEditingCollateralIds.clear();
  frameLoanCollateral(id);
  if (typeof openLoanProfilePage === "function") {
    openLoanProfilePage(id);
  } else {
    renderPanel();
  }
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
// Applique l'état actuel des cases à cocher (Municipalités + les 5 couches de
// risque) aux couches de la carte — utilisé au chargement initial ET après chaque
// changement de style, pour qu'une couche désactivée ne revienne jamais toute seule.
function syncRiskLayerVisibilityFromCheckboxes() {
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
    ["gt-contaminated-halo", "gt-contaminated-points"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
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

  const wildfireRegimeBtn = document.getElementById("toggle-wildfire-regime");
  if (wildfireRegimeBtn && !wildfireRegimeBtn.checked) {
    ["gt-wildfire-regime-fill", "gt-wildfire-regime-outline"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  const fireRestrictionBtn = document.getElementById("toggle-fire-restrictions");
  if (fireRestrictionBtn && !fireRestrictionBtn.checked) {
    ["gt-fire-restriction-fill", "gt-fire-restriction-outline"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  const metroBtn = document.getElementById("toggle-metro");
  if (metroBtn && !metroBtn.checked) {
    ["gt-metro-line", "gt-metro-label", "gt-metro-stations-points", "gt-metro-stations-label"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  const trainBtn = document.getElementById("toggle-train");
  if (trainBtn && !trainBtn.checked) {
    ["gt-train-line", "gt-train-label"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  const busBtn = document.getElementById("toggle-bus-stops");
  if (busBtn && !busBtn.checked) {
    ["gt-bus-stops-points", "gt-bus-stops-label"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }

  const trafficBtn = document.getElementById("toggle-traffic");
  if (trafficBtn && !trafficBtn.checked) {
    if (map.getLayer("gt-traffic-line")) map.setLayoutProperty("gt-traffic-line", "visibility", "none");
  }
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
    setupWildfireRegimeLayer();
    setupFireRestrictionLayer();
    setupAddressLabelsLayer();
    setupMetroLayer();
    setupTrainLayer();
    setupBusStopsLayer();
    setupTrafficLayer();
    syncRiskLayerVisibilityFromCheckboxes();

    // Les lots (cadastre) ne se rattachent que si le bouton "Lots" est actif
    const parcelBtn = document.getElementById("toggle-parcels");
    if (parcelBtn && parcelBtn.classList.contains("active")) {
      setupCityParcelLayer();
    }
  });
}