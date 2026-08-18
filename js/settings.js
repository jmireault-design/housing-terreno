/* =====================================================================
   settings.js — page Paramètres : gérer les listes de choix des menus
   déroulants (ajouter / supprimer des options)
   ===================================================================== */

const SETTINGS_GROUPS = [
  { field: "propertyTypes", label: "Type d'immeuble", promptLabel: "Type d'immeuble" },
  { field: "loanTypes", label: "Type de prêt", promptLabel: "Type de prêt" },
  { field: "ranks", label: "Rang de garantie", promptLabel: "Rang" },
  { field: "risks", label: "Niveau de risque", promptLabel: "Niveau de risque" },
  { field: "constructionTypes", label: "Genre de construction", promptLabel: "Genre de construction" }
];

function renderSettingsPage() {
  const mount = document.getElementById("settings-groups");
  if (!mount) return;

  const groupsHtml = SETTINGS_GROUPS.map(g => `
    <div class="gt-settings-group">
      <div class="gt-settings-group-title">${g.label}</div>
      <div class="gt-settings-chips" data-field="${g.field}">
        ${CONFIG.options[g.field].map(v => `
          <span class="gt-settings-chip">
            ${v}
            <button type="button" class="gt-settings-chip-remove" data-field="${g.field}" data-value="${v}" title="Supprimer">
              <i class="ti ti-x"></i>
            </button>
          </span>
        `).join("")}
      </div>
      <div class="gt-settings-add-row">
        <input type="text" class="gt-settings-add-input" data-field="${g.field}" placeholder="Ajouter une option..." />
        <button type="button" class="gt-secondary-btn gt-settings-add-btn" data-field="${g.field}">
          <i class="ti ti-plus"></i> Ajouter
        </button>
      </div>
    </div>
  `).join("");

  const statusesHtml = `
    <div class="gt-settings-group">
      <div class="gt-settings-group-title">Statuts</div>
      <div class="gt-settings-chips" id="settings-status-chips">
        ${CONFIG.options.statuses.map(key => {
          const s = CONFIG.statusMap[key];
          if (!s) return "";
          return `
            <span class="gt-settings-chip" style="background:${s.color}18;color:${s.color};border-color:${s.color}55;">
              ${s.label}
              <button type="button" class="gt-settings-status-remove" data-key="${key}" title="Supprimer" style="color:${s.color};">
                <i class="ti ti-x"></i>
              </button>
            </span>
          `;
        }).join("")}
      </div>
      <div class="gt-settings-add-row">
        <input type="text" class="gt-settings-add-input" id="settings-status-add-input" placeholder="Ajouter un statut..." />
        <button type="button" class="gt-secondary-btn" id="settings-status-add-btn">
          <i class="ti ti-plus"></i> Ajouter
        </button>
      </div>
    </div>
  `;

  mount.innerHTML = groupsHtml + statusesHtml;
  wireSettingsPage();
}

function wireSettingsPage() {
  const mount = document.getElementById("settings-groups");
  if (!mount) return;

  // Suppression d'une option (Type, Rang, Risque)
  mount.querySelectorAll(".gt-settings-chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      removeCustomOption(btn.dataset.field, btn.dataset.value);
      renderSettingsPage();
      if (btn.dataset.field === "propertyTypes" && typeof populateMapTypeChips === "function") populateMapTypeChips();
    });
  });

  // Ajout d'une option (Type, Rang, Risque)
  mount.querySelectorAll(".gt-settings-add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field;
      const input = mount.querySelector(`.gt-settings-add-input[data-field="${field}"]`);
      const val = (input.value || "").trim();
      if (!val) return;
      if (!CONFIG.options[field].includes(val)) {
        CONFIG.options[field].push(val);
        saveCustomOptions();
      }
      renderSettingsPage();
      if (field === "propertyTypes" && typeof populateMapTypeChips === "function") populateMapTypeChips();
    });
  });
  mount.querySelectorAll(".gt-settings-add-input[data-field]").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") mount.querySelector(`.gt-settings-add-btn[data-field="${input.dataset.field}"]`).click();
    });
  });

  // Suppression d'un statut
  mount.querySelectorAll(".gt-settings-status-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      if (CONFIG.options.statuses.length <= 1) {
        alert("Il doit rester au moins un statut disponible.");
        return;
      }
      removeStatusOption(btn.dataset.key);
      renderSettingsPage();
    });
  });

  // Ajout d'un statut (couleur assignée automatiquement)
  const statusAddBtn = document.getElementById("settings-status-add-btn");
  const statusAddInput = document.getElementById("settings-status-add-input");
  if (statusAddBtn) {
    statusAddBtn.addEventListener("click", () => {
      const label = (statusAddInput.value || "").trim();
      if (!label) return;
      addCustomStatus(label);
      renderSettingsPage();
    });
  }
  if (statusAddInput) {
    statusAddInput.addEventListener("keydown", e => {
      if (e.key === "Enter") statusAddBtn.click();
    });
  }
}