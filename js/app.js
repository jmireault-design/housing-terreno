/* =====================================================================
   app.js — initialisation et interface globale
   ===================================================================== */

function switchView(v) {
  document.querySelectorAll(".gt-tab").forEach(t => t.classList.toggle("active", t.dataset.view === v));
  document.querySelectorAll(".gt-view").forEach(el => el.classList.toggle("active", el.id === "view-" + v));
  if (v === "map") setTimeout(() => map && map.resize(), 50);
}

function populatePortfolioFilters() {
  const cities = [...new Set(state.properties.map(p => p.city).filter(Boolean))].sort();
  const types = [...new Set(state.properties.map(p => p.type).filter(Boolean))].sort();

  const citySel = document.getElementById("props-filter-city");
  citySel.innerHTML = `<option value="all">Toutes les villes</option>` +
    cities.map(c => `<option value="${c}">${c}</option>`).join("");

  const typeSel = document.getElementById("props-filter-type");
  typeSel.innerHTML = `<option value="all">Tous les types</option>` +
    types.map(t => `<option value="${t}">${t}</option>`).join("");

  populateMapCityChips(cities);
  populateMapTypeChips();
  populateMapLenderChips();
  populateMapRankChips();
  populateMapLoanTypeChips();
}

// Chips "Ville" du filtre carte — générées à partir des vraies villes présentes dans
// le portfolio, plutôt qu'une liste figée (Montréal/Laval/Longueuil ne suffit plus
// une fois que le portfolio couvre bien plus de villes).
function populateMapCityChips(cities) {
  const container = document.getElementById("city-filter-chips");
  if (!container) return;
  const currentActive = state.filters.city;

  container.innerHTML = `<span class="gt-chip ${currentActive === "all" ? "active" : ""}" data-f="city" data-v="all">Toutes</span>` +
    cities.map(c => `<span class="gt-chip ${currentActive === c ? "active" : ""}" data-f="city" data-v="${c}">${c}</span>`).join("");

  // Re-branche le clic sur ces chips (regénérées après le passage initial de wireUI())
  container.querySelectorAll(".gt-chip").forEach(c => {
    c.addEventListener("click", () => {
      container.querySelectorAll(".gt-chip").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      state.filters.city = c.dataset.v;
      refreshMap();
    });
  });
}

// Chips "Type" du filtre carte — générées à partir de la même liste "Type d'immeuble"
// que Paramètres/formulaires (CONFIG.options.propertyTypes), pour qu'elles restent
// toujours synchronisées (y compris les types ajoutés/retirés depuis Paramètres).
function populateMapTypeChips() {
  const container = document.getElementById("type-filter-chips");
  if (!container) return;
  const currentActive = state.filters.type;
  const types = CONFIG.options.propertyTypes;

  container.innerHTML = `<span class="gt-chip ${currentActive === "all" ? "active" : ""}" data-f="type" data-v="all">Tous</span>` +
    types.map(t => `<span class="gt-chip ${currentActive === t ? "active" : ""}" data-f="type" data-v="${t}">${t}</span>`).join("");

  container.querySelectorAll(".gt-chip").forEach(c => {
    c.addEventListener("click", () => {
      container.querySelectorAll(".gt-chip").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      state.filters.type = c.dataset.v;
      refreshMap();
    });
  });
}

const THEME_KEY = "terreno_theme";

// Chip générique réutilisée pour Prêteur / Rang / Type de prêt
function populateGenericChips(containerId, filterKey, values) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const currentActive = state.filters[filterKey];

  container.innerHTML = `<span class="gt-chip ${currentActive === "all" ? "active" : ""}" data-f="${filterKey}" data-v="all">Tous</span>` +
    values.map(v => `<span class="gt-chip ${currentActive === v ? "active" : ""}" data-f="${filterKey}" data-v="${v}">${v}</span>`).join("");

  container.querySelectorAll(".gt-chip").forEach(c => {
    c.addEventListener("click", () => {
      container.querySelectorAll(".gt-chip").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      state.filters[filterKey] = c.dataset.v;
      refreshMap();
    });
  });
}

// Prêteur — généré à partir des vraies valeurs présentes dans tes prêts (pas une
// liste figée, puisque ce n'est pas un champ géré dans Paramètres)
function populateMapLenderChips() {
  const lenders = [...new Set(state.loans.map(l => l.lender).filter(Boolean))].sort();
  populateGenericChips("lender-filter-chips", "lender", lenders);
}

// Rang — depuis la même liste gérée que Paramètres/formulaires
function populateMapRankChips() {
  populateGenericChips("rank-filter-chips", "rank", CONFIG.options.ranks);
}

// Type de prêt — depuis la même liste gérée que Paramètres/formulaires
function populateMapLoanTypeChips() {
  populateGenericChips("loantype-filter-chips", "loanType", CONFIG.options.loanTypes);
}

function applyTheme(theme) {
  document.body.classList.toggle("dark-theme", theme === "dark");
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = theme === "dark" ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
}

function initTheme() {
  let theme = "light";
  try {
    theme = localStorage.getItem(THEME_KEY) || "light";
  } catch (e) {
    console.warn("Terreno: lecture localStorage impossible.", e);
  }
  applyTheme(theme);
}

function wireThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-theme");
    const next = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      console.warn("Terreno: sauvegarde localStorage impossible.", e);
    }
  });
}

function wireUI() {
  // Onglets principaux
  document.querySelectorAll(".gt-tab").forEach(t => {
    t.addEventListener("click", () => switchView(t.dataset.view));
  });

  // Sous-onglets du portfolio
  document.querySelectorAll(".gt-subtab").forEach(t => {
    t.addEventListener("click", () => {
      state.portfolioTab = t.dataset.subtab;
      renderPortfolio();
    });
  });

  // Filtres carte (chips)
  document.querySelectorAll(".gt-chip").forEach(c => {
    c.addEventListener("click", () => {
      const f = c.dataset.f;
      document.querySelectorAll(`.gt-chip[data-f="${f}"]`).forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      state.filters[f] = c.dataset.v;
      refreshMap();
    });
  });

  // Contrôles portfolio prêts
  ["loans-sort-by", "loans-filter-status", "loans-filter-risk"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderLoansList);
  });

  // Contrôles portfolio immeubles
  ["props-filter-city", "props-filter-type"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderPropertiesList);
  });

  // Style de carte
  document.querySelectorAll(".gt-style-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gt-style-toggle button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setMapStyle(btn.dataset.style);
    });
  });

  // Bascule marche/arrêt de la mosaïque de lots
  const parcelToggle = document.getElementById("toggle-parcels");
  const valueLegend = document.getElementById("value-legend");
  const usesValueColors = !!(CONFIG.parcelValuesTileset && CONFIG.parcelValuesTileset.id);
  if (valueLegend && parcelToggle && parcelToggle.classList.contains("active") && usesValueColors) {
    valueLegend.style.display = "block";
  }
  if (parcelToggle) {
    parcelToggle.addEventListener("click", () => {
      const visible = toggleParcelLayers();
      parcelToggle.classList.toggle("active", visible);
      if (valueLegend) valueLegend.style.display = (visible && usesValueColors) ? "block" : "none";
    });
  }

  // Mode "Épingle" : clic libre sur la carte pour un aperçu rapide
  const pinToggle = document.getElementById("toggle-pin-mode");
  if (pinToggle) {
    pinToggle.addEventListener("click", () => {
      if (typeof togglePinMode === "function") togglePinMode();
    });
  }

  // Menu déroulant "Couches de risque"
  const layersDropdownToggle = document.getElementById("layers-dropdown-toggle");
  const layersDropdownMenu = document.getElementById("layers-dropdown-menu");
  if (layersDropdownToggle && layersDropdownMenu) {
    layersDropdownToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      layersDropdownMenu.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!layersDropdownMenu.contains(e.target) && e.target !== layersDropdownToggle) {
        layersDropdownMenu.classList.remove("open");
      }
    });
  }

  // Afficher / masquer les limites municipales
  const muniToggle = document.getElementById("toggle-municipalities");
  if (muniToggle) {
    muniToggle.addEventListener("click", () => {
      if (!map) return;
      const layers = ["gt-municipality-fill", "gt-municipality-outline", "gt-municipality-label"];
      const isVisible = muniToggle.classList.contains("active");
      layers.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", isVisible ? "none" : "visible");
      });
      muniToggle.classList.toggle("active", !isVisible);
    });
  }

  // Afficher / masquer les zones inondables (+ sa légende)
  const floodToggle = document.getElementById("toggle-flood-zones");
  if (floodToggle) {
    floodToggle.addEventListener("change", () => {
      if (!map) return;
      const layers = ["gt-flood-zone-fill", "gt-flood-zone-outline"];
      layers.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", floodToggle.checked ? "visible" : "none");
      });
      const floodLegend = document.getElementById("flood-legend");
      if (floodLegend) floodLegend.style.display = floodToggle.checked ? "block" : "none";
    });
  }

  // Afficher / masquer les zones de glissements de terrain
  const landslideToggle = document.getElementById("toggle-landslide-zones");
  if (landslideToggle) {
    landslideToggle.addEventListener("change", () => {
      if (!map) return;
      const layers = ["gt-landslide-fill", "gt-landslide-outline"];
      layers.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", landslideToggle.checked ? "visible" : "none");
      });
      const landslideLegend = document.getElementById("landslide-legend");
      if (landslideLegend) landslideLegend.style.display = landslideToggle.checked ? "block" : "none";
    });
  }

  // Afficher / masquer les terrains contaminés
  const contamToggle = document.getElementById("toggle-contaminated-sites");
  if (contamToggle) {
    contamToggle.addEventListener("change", () => {
      if (!map) return;
      ["gt-contaminated-halo", "gt-contaminated-points"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", contamToggle.checked ? "visible" : "none");
      });
      const contamLegend = document.getElementById("contaminated-legend");
      if (contamLegend) contamLegend.style.display = contamToggle.checked ? "block" : "none";
    });
  }

  // Afficher / masquer les zones d'érosion côtière / mouvements de terrain
  const erosionToggle = document.getElementById("toggle-coastal-erosion");
  if (erosionToggle) {
    erosionToggle.addEventListener("change", () => {
      if (!map) return;
      ["gt-coastal-erosion-fill", "gt-coastal-erosion-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", erosionToggle.checked ? "visible" : "none");
      });
      const erosionLegend = document.getElementById("coastal-erosion-legend");
      if (erosionLegend) erosionLegend.style.display = erosionToggle.checked ? "block" : "none";
    });
  }

  // Afficher / masquer la zone agricole protégée
  const agriToggle = document.getElementById("toggle-agricultural-zone");
  if (agriToggle) {
    agriToggle.addEventListener("change", () => {
      if (!map) return;
      ["gt-agricultural-fill", "gt-agricultural-outline"].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", agriToggle.checked ? "visible" : "none");
      });
      const agriLegend = document.getElementById("agricultural-legend");
      if (agriLegend) agriLegend.style.display = agriToggle.checked ? "block" : "none";
    });
  }

  // Créer un prêt à partir de zéro
  const newLoanBtn = document.getElementById("new-loan-btn");
  if (newLoanBtn) {
    newLoanBtn.addEventListener("click", () => {
      if (typeof createNewLoan === "function") createNewLoan();
    });
  }

  // Créer un immeuble à partir de zéro
  const newPropertyBtn = document.getElementById("new-property-btn");
  if (newPropertyBtn) {
    newPropertyBtn.addEventListener("click", () => {
      if (typeof createNewProperty === "function") createNewProperty();
    });
  }
}

async function boot() {
  initTheme();
  if (typeof applyCustomOptionsOnBoot === "function") applyCustomOptionsOnBoot();
  if (typeof applyRateOverridesOnBoot === "function") applyRateOverridesOnBoot();
  await loadData();
  populatePortfolioFilters();
  initMap();
  wireUI();
  wireThemeToggle();
  renderPortfolio();
  renderDashboard();
  if (typeof renderRatesPage === "function") renderRatesPage();
  if (typeof wireRatesUI === "function") wireRatesUI();
  if (typeof renderSettingsPage === "function") renderSettingsPage();
}

document.addEventListener("DOMContentLoaded", boot);