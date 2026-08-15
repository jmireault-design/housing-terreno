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

const THEME_KEY = "terreno_theme";

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
  // Barre de filtres rétractable
  const filtersSidebar = document.getElementById("filters-sidebar");
  const filtersToggle = document.getElementById("filters-collapse-toggle");
  if (filtersSidebar && filtersToggle) {
    try {
      if (localStorage.getItem("terreno_filters_collapsed") === "true") {
        filtersSidebar.classList.add("collapsed");
      }
    } catch (e) {
      console.warn("Terreno: lecture localStorage impossible.", e);
    }
    filtersToggle.addEventListener("click", () => {
      const collapsed = filtersSidebar.classList.toggle("collapsed");
      try {
        localStorage.setItem("terreno_filters_collapsed", collapsed ? "true" : "false");
      } catch (e) {
        console.warn("Terreno: sauvegarde localStorage impossible.", e);
      }
      // Mapbox ne redimensionne pas tout seul son canvas quand l'espace change via CSS —
      // on le force une fois la transition (0.22s) terminée.
      if (typeof map !== "undefined" && map) {
        setTimeout(() => map.resize(), 240);
      }
    });
  }

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