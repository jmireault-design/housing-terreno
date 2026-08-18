/* =====================================================================
   panel.js — panneau latéral
   Trois modes : détail d'un IMMEUBLE (affiche les prêts qui le grèvent)
                 détail d'un PRÊT (affiche les immeubles en garantie)
                 résultat de RECHERCHE non enregistré (nouvelle adresse)
   ===================================================================== */

// Immeuble actuellement affiché en Street View dans le panneau prêt.
// (Utilisé quand un prêt a plusieurs immeubles pour permettre de changer.)
let currentLoanSvPropertyId = null;

/* ---------- Street View ---------- */
function streetViewBlock(p) {
  if (hasGoogleKey()) {
    const url = `https://www.google.com/maps/embed/v1/streetview?key=${CONFIG.googleKey}&location=${p.lat},${p.lng}&heading=0&pitch=0&fov=90`;
    return `
      <div class="gt-sv-wrap">
        <iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                src="${url}" allow="accelerometer; gyroscope"
                title="Street View de ${p.addr}"></iframe>
        <div class="gt-sv-actions">
          <a class="gt-sv-btn" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}"
             target="_blank" rel="noopener">
            <i class="ti ti-external-link"></i> Ouvrir
          </a>
        </div>
      </div>`;
  }
  return `
    <div class="gt-sv-wrap">
      <div class="gt-sv-placeholder">
        <i class="ti ti-camera-off"></i>
        <div><strong>Street View non configuré</strong></div>
        <div>Ajoute ta clé <code>googleKey</code> dans <code>js/config.js</code>.</div>
        <a class="gt-sv-btn" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}"
           target="_blank" rel="noopener">
          <i class="ti ti-external-link"></i> Voir sur google.com
        </a>
      </div>
    </div>`;
}

/* ---------- Barre d'actions carte (Google Maps + Street View) ---------- */
function mapActionsBlock(p) {
  return `
    <div style="display:flex;gap:6px;margin-top:12px;">
      <a class="gt-sv-btn" style="flex:1;justify-content:center;padding:7px;"
         href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}"
         target="_blank" rel="noopener">
        <i class="ti ti-brand-google-maps"></i> Google Maps
      </a>
      <a class="gt-sv-btn" style="flex:1;justify-content:center;padding:7px;"
         href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}"
         target="_blank" rel="noopener">
        <i class="ti ti-camera"></i> Street View plein écran
      </a>
    </div>`;
}

/* ---------- Valeur $ ou tiret si absente ---------- */
function fmtKOrDash(n) {
  return (n === null || n === undefined || n === "" || n === 0) ? "—" : fmtK(n);
}

/* =====================================================================
   Mode 1 : PANNEAU IMMEUBLE
   ===================================================================== */
// Récupère numéro de lot / matricule / code postal, avec repli sur le texte des
// Notes pour les immeubles importés avant que ces champs existent (ex. notes du type
// "Code postal: H2J 2K8 · Lot cadastral: 1 203 189").
function getLotInfo(p) {
  let lotNumber = p.lotNumber || "";
  let matricule = p.matricule || "";
  let postalCode = p.postalCode || "";

  if ((!lotNumber || !postalCode) && p.notes) {
    const lotMatch = p.notes.match(/Lot cadastral\s*:\s*([^\n·]+)/i);
    const postalMatch = p.notes.match(/Code postal\s*:\s*([A-Z0-9 ]{6,7})/i);
    if (!lotNumber && lotMatch) lotNumber = lotMatch[1].trim();
    if (!postalCode && postalMatch) postalCode = postalMatch[1].trim();
  }

  return { lotNumber, matricule, postalCode };
}

function renderPropertyPanel(p) {
  const loans = loansForProperty(p.id);
  const totalGuaranteed = loans.reduce((s, l) => s + l.amount, 0);
  const status = propertyStatus(p.id);
  const s = CONFIG.statusMap[status];
  const totalLtv = propertyLtv(p, totalGuaranteed);
  const lotInfo = getLotInfo(p);
  const sqft = p.lotAreaSqFt || (p.lotAreaSqM ? Math.round(p.lotAreaSqM * 10.7639) : 0);

  return `
    <button class="gt-panel-close" id="close-panel"><i class="ti ti-x"></i></button>
    <span class="gt-badge gt-badge-accent">${s.label}</span>
    <div class="gt-panel-header-row">
      <h3 style="margin:0;">${p.addr}</h3>
      <button class="gt-edit-btn-accent" id="edit-property-btn">
        <i class="ti ti-edit"></i> Modifier
      </button>
    </div>
    <div class="gt-panel-addr">${p.neighborhood ? p.neighborhood + ", " : ""}${p.city}${lotInfo.postalCode ? ", " + lotInfo.postalCode : ""} • ${p.type}</div>
    <div style="font-size:12px;color:var(--color-text-tertiary);margin:2px 0 2px;" id="lot-info-line">
      ${lotInfo.lotNumber ? `Lot ${lotInfo.lotNumber}` : ""}${lotInfo.lotNumber && lotInfo.matricule ? " · " : ""}${lotInfo.matricule ? `Matricule ${lotInfo.matricule}` : ""}${(lotInfo.lotNumber || lotInfo.matricule) && sqft ? " · " : ""}${sqft ? `${sqft.toLocaleString("fr-CA")} pi²` : ""}
      ${(!lotInfo.matricule || (!p.landValue && !p.buildingValue) || !sqft) && !p._lookupAttempted ? `<span id="auto-lookup-status"><i class="ti ti-loader-2"></i> Recherche des infos officielles...</span>` : ""}
    </div>
    ${(p.yearBuilt || p.constructionCode) ? `<div style="font-size:12px;color:var(--color-text-tertiary);margin:0 0 10px;">${p.yearBuilt ? `Construit en ${p.yearBuilt}` : ""}${p.yearBuilt && p.constructionCode ? " · " : ""}${p.constructionCode ? `Genre de construction : ${p.constructionCode}` : ""}</div>` : ""}

    ${p.floodZone ? `
      <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(220,38,38,0.1); border:1px solid rgba(220,38,38,0.35); border-radius:var(--radius-md,8px); padding:10px 12px; margin-bottom:12px;">
        <i class="ti ti-alert-triangle" style="color:#DC2626; font-size:18px; flex-shrink:0; margin-top:1px;"></i>
        <div style="font-size:12px; color:#DC2626;">
          <strong>Zone inondable officielle : ${p.floodZone}</strong>
          ${p.floodZoneReport ? `<div style="color:var(--color-text-tertiary); margin-top:2px;">Source : ${p.floodZoneReport}</div>` : ""}
        </div>
      </div>
    ` : ""}

    ${p.landslideZone ? `
      <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(180,83,9,0.1); border:1px solid rgba(180,83,9,0.35); border-radius:var(--radius-md,8px); padding:10px 12px; margin-bottom:12px;">
        <i class="ti ti-alert-triangle" style="color:#B45309; font-size:18px; flex-shrink:0; margin-top:1px;"></i>
        <div style="font-size:12px; color:#B45309;">
          <strong>Zone de glissement de terrain (ZPEGT) : ${p.landslideZone}</strong>
        </div>
      </div>
    ` : ""}

    ${p.contaminatedSite ? `
      <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(87,13,248,0.08); border:1px solid rgba(87,13,248,0.3); border-radius:var(--radius-md,8px); padding:10px 12px; margin-bottom:12px;">
        <i class="ti ti-alert-triangle" style="color:#5B21B6; font-size:18px; flex-shrink:0; margin-top:1px;"></i>
        <div style="font-size:12px; color:#5B21B6;">
          <strong>Terrain contaminé (répertoire GTC)</strong>
          <div style="color:var(--color-text-tertiary); margin-top:2px;">Milieu affecté : ${p.contaminatedSiteMilieu || "—"} · Dossier ${p.contaminatedSite}</div>
        </div>
      </div>
    ` : ""}

    ${p.coastalErosionZone ? `
      <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(8,145,178,0.08); border:1px solid rgba(8,145,178,0.3); border-radius:var(--radius-md,8px); padding:10px 12px; margin-bottom:12px;">
        <i class="ti ti-alert-triangle" style="color:#0891B2; font-size:18px; flex-shrink:0; margin-top:1px;"></i>
        <div style="font-size:12px; color:#0891B2;">
          <strong>Zone de contrainte : érosion côtière / mouvement de terrain (ZEMT)</strong>
        </div>
      </div>
    ` : ""}

    ${p.inAgriculturalZone ? `
      <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(77,124,15,0.08); border:1px solid rgba(77,124,15,0.3); border-radius:var(--radius-md,8px); padding:10px 12px; margin-bottom:12px;">
        <i class="ti ti-info-circle" style="color:#4D7C0F; font-size:18px; flex-shrink:0; margin-top:1px;"></i>
        <div style="font-size:12px; color:#4D7C0F;">
          <strong>Situé en zone agricole protégée (CPTAQ)</strong>
          <div style="color:var(--color-text-tertiary); margin-top:2px;">Restrictions possibles sur la construction/le lotissement — informatif, sans valeur légale.</div>
        </div>
      </div>
    ` : ""}

    ${streetViewBlock(p)}

    <div class="gt-stat-grid">
      <div class="gt-stat"><div class="gt-stat-label">Valeur est.</div><div class="gt-stat-val">${fmtKOrDash(p.value)}</div></div>
      <div class="gt-stat"><div class="gt-stat-label">Éval. municipale</div><div class="gt-stat-val">${fmtKOrDash(p.assessment)}</div></div>
      <div class="gt-stat"><div class="gt-stat-label">Total garanti</div><div class="gt-stat-val">${fmtKOrDash(totalGuaranteed)}</div></div>
      <div class="gt-stat"><div class="gt-stat-label">LTV total</div><div class="gt-stat-val" style="color:${ltvColor(totalLtv)}">${totalLtv}%</div></div>
    </div>

    <div class="gt-section-title">Propriétaire</div>
    <div class="gt-row"><span>Nom</span><span>${p.owner || "—"}</span></div>
    ${p.purchase ? `<div class="gt-row"><span>Prix d'achat</span><span>${fmtK(p.purchase)}</span></div>` : ""}

    <div class="gt-section-title">Terrain et bâtiment</div>
    ${(() => {
      const sqft = p.lotAreaSqFt || (p.lotAreaSqM ? Math.round(p.lotAreaSqM * 10.7639) : 0);
      const hasAny = p.landValue || p.buildingValue || sqft;
      if (!hasAny) {
        return `<div style="font-size:12px;color:var(--color-text-tertiary);padding:2px 0 8px">Aucune donnée — complète via "Modifier".</div>`;
      }
      const pricePerSqft = (sqft && p.assessment) ? Math.round(p.assessment / sqft) : null;
      return `
        ${p.landValue ? `<div class="gt-row"><span>Terrain</span><span>${fmtK(p.landValue)}</span></div>` : ""}
        ${p.buildingValue ? `<div class="gt-row"><span>Bâtiment</span><span>${fmtK(p.buildingValue)}</span></div>` : ""}
        ${sqft ? `<div class="gt-row"><span>Superficie</span><span>${sqft.toLocaleString("fr-CA")} pi²</span></div>` : ""}
        ${pricePerSqft ? `<div class="gt-row"><span>Prix/pi²</span><span>${fmt(pricePerSqft)}</span></div>` : ""}
      `;
    })()}

    ${(() => {
      const sector = typeof lookupSectorAverage === "function" ? lookupSectorAverage(p) : null;
      if (!sector) return "";
      const diff = p.assessment ? Math.round(((p.assessment - sector.v) / sector.v) * 100) : null;
      return `
        <div class="gt-section-title">Comparaison au secteur</div>
        <div class="gt-row"><span>Valeur moyenne du secteur</span><span>${fmtK(sector.v)}</span></div>
        ${diff !== null ? `<div class="gt-row"><span>Cet immeuble</span><span style="color:${diff >= 0 ? '#0F6E56' : '#A32D2D'}">${diff >= 0 ? "+" : ""}${diff}% vs secteur</span></div>` : ""}
        ${sector.s ? `<div class="gt-row"><span>Superficie habitable moyenne</span><span>${sector.s.toLocaleString("fr-CA")} pi²</span></div>` : ""}
        ${sector.t ? `<div class="gt-row"><span>Terrain moyen</span><span>${sector.t.toLocaleString("fr-CA")} pi²</span></div>` : ""}
        ${sector.a ? `<div class="gt-row"><span>Année construction moyenne</span><span>${sector.a}</span></div>` : ""}
        <div style="font-size:11px;color:var(--color-text-tertiary);padding:2px 0 8px">Basé sur ${sector.n} propriétés comparables du même secteur.</div>
      `;
    })()}

    ${(p.salesHistory && p.salesHistory.length > 0) ? `
      <div class="gt-section-title">Historique des ventes</div>
      ${p.salesHistory.map(s => {
        const year = s.date ? new Date(s.date).getFullYear() : null;
        const adj = (s.amount && year) ? adjustedValue(Number(s.amount), year) : null;
        const adjCombine = (s.amount && year) ? adjustedValueCombined(Number(s.amount), year) : null;
        return `
          <div class="gt-row"><span>${s.date || "—"}</span><span>${fmtK(s.amount)}</span></div>
          <div style="font-size:11px;color:var(--color-text-tertiary);padding:0 0 6px;">
            ${adj ? `Ajustée (immobilier) : ${fmt2(adj)}` : ""}${adj && adjCombine ? " · " : ""}${adjCombine ? `Ajustée (combinée) : ${fmt2(adjCombine)}` : ""}
            ${s.note ? `<br/>${s.note}` : ""}
          </div>
        `;
      }).join("")}
    ` : ""}

    ${p.valuationMethods ? `
      <div class="gt-section-title">Méthodes d'évaluation pondérées</div>
      ${VALUATION_METHOD_DEFS.map(def => {
        const entry = p.valuationMethods[def.key];
        if (!entry || !entry.value) return "";
        const weighted = entry.value * entry.weight / 100;
        return `<div class="gt-row"><span>${def.label} (${entry.weight}%)</span><span>${fmt2(entry.value)} → ${fmt2(weighted)}</span></div>`;
      }).join("")}
      ${(() => {
        const total = VALUATION_METHOD_DEFS.reduce((sum, def) => {
          const entry = p.valuationMethods[def.key];
          return sum + (entry ? entry.value * entry.weight / 100 : 0);
        }, 0);
        return total ? `<div class="gt-row" style="font-weight:600;"><span>Valeur estimée pondérée</span><span>${fmt2(total)}</span></div>` : "";
      })()}
    ` : ""}

    <div class="gt-section-title">Prêts sur cet immeuble (${loans.length})</div>
    ${loans.length === 0
      ? `<div style="font-size:12px;color:var(--color-text-tertiary);padding:8px 0">Aucun prêt actif sur cet immeuble.</div>`
      : loans.map(link => renderLoanLink(p, link)).join("")
    }

    ${p.notes ? `
      <div class="gt-section-title">Notes</div>
      <div class="gt-notes-block">${p.notes}</div>
    ` : ""}

    ${mapActionsBlock(p)}

    <button class="gt-secondary-btn" id="delete-property-btn" style="color:#A32D2D; border-color:#A32D2D;">
      <i class="ti ti-trash"></i> Supprimer l'immeuble
    </button>
  `;
}

// Une carte-résumé cliquable d'un prêt à l'intérieur du panneau immeuble
function renderLoanLink(property, link) {
  const loan = link.loan;
  const s = CONFIG.statusMap[loan.status];
  const isSaved = state.savedLoans.has(loan.id);
  const propLtv = propertyLtv(property, link.amount);
  return `
    <div class="gt-linked-loan" data-loan-id="${loan.id}">
      <div class="gt-linked-loan-head">
        <div>
          <div class="gt-linked-loan-title">
            ${isSaved ? '<i class="ti ti-bookmark-filled" style="color:var(--color-saved)"></i> ' : ''}
            Prêt ${loan.borrower}
          </div>
          <div class="gt-linked-loan-sub">${loan.lender} • ${loan.type}</div>
        </div>
        ${statusBadgeHtml(loan.status)}
      </div>
      <div class="gt-linked-loan-stats">
        <div><label>Rang</label><strong>${link.rank}</strong></div>
        <div><label>LTV part</label><strong style="color:${ltvColor(propLtv)}">${propLtv}%</strong></div>
      </div>
      <div class="gt-linked-loan-foot">
        Solde total: ${fmtK(loan.balance)} • Échéance: ${loan.maturity}
      </div>
    </div>
  `;
}

/* =====================================================================
   Mode 1b : FORMULAIRE D'ÉDITION D'UN IMMEUBLE
   ===================================================================== */
// Méthodes de pondération pour la valeur estimée finale
const VALUATION_METHOD_DEFS = [
  { key: "municipal", label: "Municipal capitalisé", defaultWeight: 35.0 },
  { key: "external", label: "Estimateurs externes", defaultWeight: 10.0 },
  { key: "historicalSales", label: "Ventes historiques", defaultWeight: 35.0 },
  { key: "comparableSales", label: "Ventes comparables", defaultWeight: 20.0 }
];

// Ratios terrain/bâtiment approximatifs par type — ce sont des estimations, pas une règle
// officielle (l'évaluateur municipal détermine ça au cas par cas via des comparables).
// Utilisés seulement comme point de départ suggéré, toujours modifiables.
const TYPE_LAND_RATIO_DEFAULTS = {
  "Condo": 12,
  "Unifamiliale": 30,
  "Duplex": 25,
  "Triplex": 22,
  "Multi-logements": 20,
  "Commercial": 35,
  "Terrain": 100
};

let editingSalesHistory = [];

function renderPropertyEditForm(p) {
  editingSalesHistory = (p.salesHistory || []).map(s => ({ ...s }));
  const defaultSqFt = p.lotAreaSqFt || (p.lotAreaSqM ? Math.round(p.lotAreaSqM * 10.7639) : 0);
  const lotInfo = getLotInfo(p);

  return `
    <button class="gt-panel-close" id="close-panel"><i class="ti ti-x"></i></button>
    <span class="gt-badge gt-badge-accent">Modification</span>
    <h3>Modifier — ${p.addr}</h3>
    <div class="gt-panel-addr">${p.neighborhood ? p.neighborhood + ", " : ""}${p.city}</div>

    <div class="gt-section-title">Détails</div>
    <div class="gt-new-prop-form">
      <label>Type
        <select id="pedit-type">
          <option value="">—</option>
          ${CONFIG.options.propertyTypes.map(t => `<option value="${t}" ${t === p.type ? "selected" : ""}>${t}</option>`).join("")}
          <option value="__add_option__">+ Ajouter un type...</option>
        </select>
      </label>
      <label>Ville
        <input id="pedit-city" type="text" value="${p.city || ""}" />
      </label>
      <label>Quartier
        <input id="pedit-neighborhood" type="text" value="${p.neighborhood || ""}" placeholder="Optionnel" />
      </label>
      <label>Année de construction
        <input id="pedit-yearBuilt" type="text" inputmode="numeric" value="${p.yearBuilt || ""}" placeholder="Ex. 1985" />
      </label>
      <label>Genre de construction
        <select id="pedit-constructionCode">
          <option value="">—</option>
          ${CONFIG.options.constructionTypes.map(t => `<option value="${t}" ${t === p.constructionCode ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label>Propriétaire
        <input id="pedit-owner" type="text" value="${p.owner || ""}" placeholder="Nom" />
      </label>
      <label>Prix d'achat ($)
        <input id="pedit-purchase" type="text" inputmode="numeric" value="${formatNumberWithCommas(p.purchase || 0)}" />
      </label>
      <label>Numéro de lot (cadastre)
        <input id="pedit-lotnumber" type="text" value="${lotInfo.lotNumber || ""}" placeholder="Optionnel" />
      </label>
      <label>Matricule
        <input id="pedit-matricule" type="text" value="${lotInfo.matricule || ""}" placeholder="Optionnel" />
      </label>
      <label>Code postal
        <input id="pedit-postalcode" type="text" value="${lotInfo.postalCode || ""}" placeholder="Optionnel" />
      </label>
    </div>

    <div class="gt-section-title">Valeurs</div>

    <div class="gt-new-prop-form">
      <label>Terrain ($)
        <input id="pedit-landvalue" type="text" inputmode="numeric" value="${formatNumberWithCommas(p.landValue || 0)}" />
      </label>
      <label>Bâtiment ($)
        <input id="pedit-buildingvalue" type="text" inputmode="numeric" value="${formatNumberWithCommas(p.buildingValue || 0)}" />
      </label>
      <label>Valeur municipale ($)
        <input id="pedit-assessment" type="text" inputmode="numeric" value="${formatNumberWithCommas((p.landValue || 0) + (p.buildingValue || 0))}" />
      </label>
      <label>Ratio terrain (%) — pour la répartition
        <input id="pedit-split-ratio" type="number" step="1" value="${TYPE_LAND_RATIO_DEFAULTS[p.type] || 30}" min="0" max="100" />
      </label>
      <label>Valeur estimée ($)
        <input id="pedit-value" type="text" inputmode="numeric" value="${formatNumberWithCommas(p.value || 0)}" />
      </label>
      <label>Superficie (pi²)
        <input id="pedit-sqft" type="number" step="1" value="${defaultSqFt}" />
      </label>
      <label class="gt-readonly-label">Prix/pi²
        <input id="pedit-price-per-sqft" type="text" value="—" disabled
               style="background:var(--color-border, #eee); color:var(--color-text-secondary);" />
      </label>
    </div>
    <div style="font-size:11px; color:var(--color-text-tertiary); margin:-4px 0 12px;">
      Tape dans <strong>Terrain</strong> ou <strong>Bâtiment</strong> → la Valeur municipale se recalcule. Tape dans <strong>Valeur municipale</strong> → elle se répartit selon le ratio (suggéré selon le type d'immeuble, mais c'est une estimation — pas une règle officielle). Le vrai ratio du rôle d'évaluation, quand disponible, est toujours plus précis.
    </div>

    <div class="gt-section-title">Historique des ventes (jusqu'à 3)</div>
    <div id="sales-history-edit"></div>
    <button class="gt-secondary-btn" id="add-sale-btn" type="button">
      <i class="ti ti-plus"></i> Ajouter une vente
    </button>

    <div class="gt-section-title">Méthodes d'évaluation pondérées</div>
    <div id="valuation-methods-edit"></div>
    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; padding:8px 4px; border-top:1px solid var(--color-border); margin-top:4px;">
      <span>Total pondération : <span id="vm-total-weight">—</span></span>
      <span>Valeur estimée pondérée : <span id="vm-total-value">—</span></span>
    </div>

    <div class="gt-section-title">Notes</div>
    <textarea id="pedit-notes" rows="3" style="width:100%; padding:8px; border-radius:var(--radius-md); border:1px solid var(--color-border); font-family:var(--font-sans); font-size:13px; resize:vertical;">${p.notes || ""}</textarea>

    <div class="gt-section-title">Associer à un prêt</div>
    ${(() => {
      const existingLoans = loansForProperty(p.id);
      return existingLoans.length > 0 ? `
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:8px;">
          Déjà lié à : ${existingLoans.map(l => l.borrower).join(", ")}
        </div>
      ` : "";
    })()}
    <div class="gt-new-prop-form">
      <label style="grid-column: 1 / -1;">Prêt
        <select id="pedit-loan-link">
          <option value="">— Aucun changement —</option>
          <option value="__new__">+ Créer un nouveau prêt</option>
          ${state.loans.map(l => `<option value="${l.id}">${l.borrower || "(sans nom)"} — ${l.lender || "—"}</option>`).join("")}
        </select>
      </label>
      <label id="pedit-loan-amount-wrap" style="display:none;">Montant garanti sur cet immeuble ($)
        <input id="pedit-loan-amount" type="text" inputmode="numeric" placeholder="0" />
      </label>
      <label id="pedit-loan-rank-wrap" style="display:none;">Rang
        <select id="pedit-loan-rank">
          ${CONFIG.options.ranks.map(r => `<option value="${r}">${r}</option>`).join("")}
        </select>
      </label>
    </div>

    <div style="display:flex; gap:8px; margin-top:16px;">
      <button class="gt-save-btn" id="save-property-edit" style="flex:1; justify-content:center;">
        <i class="ti ti-check"></i> Enregistrer
      </button>
      <button class="gt-secondary-btn" id="cancel-property-edit" style="flex:1; justify-content:center;">
        Annuler
      </button>
    </div>
  `;
}

function renderSalesHistoryEditList() {
  const mount = document.getElementById("sales-history-edit");
  if (!mount) return;

  const addBtn = document.getElementById("add-sale-btn");
  if (addBtn) addBtn.style.display = editingSalesHistory.length >= 3 ? "none" : "";

  if (editingSalesHistory.length === 0) {
    mount.innerHTML = `<div style="font-size:12px;color:var(--color-text-tertiary);padding:8px 0">Aucune vente enregistrée.</div>`;
    return;
  }

  mount.innerHTML = editingSalesHistory.map((s, idx) => {
    const year = s.date ? new Date(s.date).getFullYear() : null;
    const adj = (s.amount && year) ? adjustedValue(s.amount, year) : null;
    const adjCombine = (s.amount && year) ? adjustedValueCombined(s.amount, year) : null;
    return `
      <div style="border:1px solid var(--color-border); border-radius:var(--radius-md); padding:10px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:12px; font-weight:600; color:var(--color-text-tertiary);">Vente ${idx + 1}</div>
          <button type="button" class="gt-remove-sale" data-idx="${idx}" style="border:none; background:none; color:var(--color-text-tertiary); cursor:pointer; padding:4px;">
            <i class="ti ti-trash"></i>
          </button>
        </div>
        <div class="gt-new-prop-form" style="margin-bottom:6px;">
          <label>Date
            <input class="edit-sale-date" data-idx="${idx}" type="date" value="${s.date || ""}" />
          </label>
          <label>Montant ($)
            <input class="edit-sale-amount" data-idx="${idx}" type="number" step="1" value="${s.amount || 0}" />
          </label>
          <label style="grid-column: 1 / -1;">Note
            <input class="edit-sale-note" data-idx="${idx}" type="text" value="${s.note || ""}" placeholder="Optionnel" />
          </label>
        </div>
        <div style="font-size:12px; color:var(--color-text-tertiary); line-height:1.6;">
          Valeur ajustée (immobilier) : <strong id="sale-adjusted-${idx}" style="color:var(--color-text-primary);">${adj ? fmt2(adj) : "—"}</strong><br/>
          Valeur ajustée (combinée) : <strong id="sale-adjusted-combine-${idx}" style="color:var(--color-text-primary);">${adjCombine ? fmt2(adjCombine) : "—"}</strong>
        </div>
      </div>
    `;
  }).join("");

  function updateAdjustedDisplay(idx) {
    const s = editingSalesHistory[idx];
    const year = s.date ? new Date(s.date).getFullYear() : null;
    const adj = (s.amount && year) ? adjustedValue(s.amount, year) : null;
    const adjCombine = (s.amount && year) ? adjustedValueCombined(s.amount, year) : null;
    const el = document.getElementById(`sale-adjusted-${idx}`);
    const elCombine = document.getElementById(`sale-adjusted-combine-${idx}`);
    if (el) el.textContent = adj ? fmt2(adj) : "—";
    if (elCombine) elCombine.textContent = adjCombine ? fmt2(adjCombine) : "—";
  }

  mount.querySelectorAll(".edit-sale-date").forEach(el => {
    el.addEventListener("input", () => {
      editingSalesHistory[Number(el.dataset.idx)].date = el.value;
      updateAdjustedDisplay(Number(el.dataset.idx));
      syncHistoricalSalesToValuation();
    });
  });
  mount.querySelectorAll(".edit-sale-amount").forEach(el => {
    el.addEventListener("input", () => {
      editingSalesHistory[Number(el.dataset.idx)].amount = Number(el.value) || 0;
      updateAdjustedDisplay(Number(el.dataset.idx));
      syncHistoricalSalesToValuation();
    });
  });
  mount.querySelectorAll(".edit-sale-note").forEach(el => {
    el.addEventListener("input", () => {
      editingSalesHistory[Number(el.dataset.idx)].note = el.value;
    });
  });
  mount.querySelectorAll(".gt-remove-sale").forEach(el => {
    el.addEventListener("click", () => {
      editingSalesHistory.splice(Number(el.dataset.idx), 1);
      renderSalesHistoryEditList();
      syncHistoricalSalesToValuation();
    });
  });
}

// Calcule une estimation "Ventes historiques" à partir de la vente la plus récente
// (valeur ajustée combinée à aujourd'hui), pour préremplir le tableau de pondération.
function computeHistoricalSalesEstimate() {
  const valid = editingSalesHistory.filter(s => s.date && s.amount);
  if (valid.length === 0) return null;
  const mostRecent = valid.reduce((a, b) => (new Date(a.date) > new Date(b.date) ? a : b));
  const year = new Date(mostRecent.date).getFullYear();
  return adjustedValueCombined(mostRecent.amount, year) || mostRecent.amount;
}

// Répercute cette estimation dans le champ "Ventes historiques" du tableau de
// pondération, sans écraser une valeur que l'utilisateur aurait déjà personnalisée
// à la main (on ne touche que si le champ est encore à 0 ou vide).
function syncHistoricalSalesToValuation() {
  const valueEl = document.querySelector('.vm-value[data-key="historicalSales"]');
  if (!valueEl) return;
  const estimate = computeHistoricalSalesEstimate();
  if (estimate === null) return;
  if (!Number(valueEl.value)) {
    valueEl.value = estimate;
    if (typeof updateValuationMethodsCalc === "function") updateValuationMethodsCalc();
  }
}

function renderValuationMethodsEdit(p) {
  const mount = document.getElementById("valuation-methods-edit");
  if (!mount) return;
  const vm = p.valuationMethods || {};

  mount.innerHTML = VALUATION_METHOD_DEFS.map(def => {
    const entry = vm[def.key] || {};
    const value = entry.value !== undefined ? entry.value : (def.key === "municipal" ? (p.assessment || 0) : 0);
    const weight = entry.weight !== undefined ? entry.weight : def.defaultWeight;
    return `
      <div style="display:grid; grid-template-columns: 1fr 90px 100px; gap:8px; align-items:end; margin-bottom:8px;">
        <label style="display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-tertiary);">
          ${def.label}
          <input class="vm-value" data-key="${def.key}" type="number" step="1" value="${value}"
                 style="height:30px; padding:0 8px; border-radius:var(--radius-md); border:1px solid var(--color-border); font-family:var(--font-sans); font-size:13px; font-weight:400; text-transform:none;" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-tertiary);">
          Pond. (%)
          <input class="vm-weight" data-key="${def.key}" type="number" step="0.1" value="${weight}"
                 style="height:30px; padding:0 8px; border-radius:var(--radius-md); border:1px solid var(--color-border); font-family:var(--font-sans); font-size:13px; font-weight:400; text-transform:none;" />
        </label>
        <div style="display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; color:var(--color-text-tertiary);">
          Pondérée
          <div id="vm-weighted-${def.key}" style="height:30px; display:flex; align-items:center; font-size:13px; font-weight:600; text-transform:none; color:var(--color-text-primary);">
            ${fmt2(value * weight / 100)}
          </div>
        </div>
      </div>
    `;
  }).join("");

  mount.querySelectorAll(".vm-value, .vm-weight").forEach(el => {
    el.addEventListener("input", updateValuationMethodsCalc);
  });
  updateValuationMethodsCalc();
}

function updateValuationMethodsCalc() {
  let totalWeight = 0;
  let totalValue = 0;
  VALUATION_METHOD_DEFS.forEach(def => {
    const valueEl = document.querySelector(`.vm-value[data-key="${def.key}"]`);
    const weightEl = document.querySelector(`.vm-weight[data-key="${def.key}"]`);
    const weightedEl = document.getElementById(`vm-weighted-${def.key}`);
    if (!valueEl || !weightEl) return;
    const value = Number(valueEl.value) || 0;
    const weight = Number(weightEl.value) || 0;
    const weighted = value * weight / 100;
    if (weightedEl) weightedEl.textContent = fmt2(weighted);
    totalWeight += weight;
    totalValue += weighted;
  });

  const totalWeightEl = document.getElementById("vm-total-weight");
  const totalValueEl = document.getElementById("vm-total-value");
  if (totalWeightEl) {
    totalWeightEl.textContent = `${totalWeight.toFixed(1)}%`;
    totalWeightEl.style.color = Math.abs(totalWeight - 100) > 0.05 ? "#A32D2D" : "var(--color-text-primary)";
  }
  if (totalValueEl) totalValueEl.textContent = fmt2(totalValue);
}

// Recalcule Terrain/Bâtiment/Valeur municipale selon quel champ vient d'être modifié.
// source: "land" | "building" | "assessment"
function syncValueFields(source) {
  const landField = document.getElementById("pedit-landvalue");
  const buildingField = document.getElementById("pedit-buildingvalue");
  const assessmentField = document.getElementById("pedit-assessment");
  const ratioField = document.getElementById("pedit-split-ratio");
  if (!landField || !buildingField || !assessmentField) return 0;

  if (source === "assessment") {
    const total = parseFormattedNumber(assessmentField.value);
    const ratio = Number(ratioField ? ratioField.value : 30) || 0;
    const land = Math.round(total * (ratio / 100));
    landField.value = formatNumberWithCommas(land);
    buildingField.value = formatNumberWithCommas(total - land);
    return total;
  }

  // source === "land" ou "building" (ou premier rendu) : la valeur municipale = la somme
  const land = parseFormattedNumber(landField.value);
  const building = parseFormattedNumber(buildingField.value);
  const total = land + building;
  assessmentField.value = formatNumberWithCommas(total);
  // Met aussi à jour le ratio affiché pour refléter la vraie proportion actuelle
  if (ratioField && total > 0) {
    ratioField.value = Math.round((land / total) * 100);
  }
  return total;
}

function updatePricePerSqFtDisplay(source) {
  const priceField = document.getElementById("pedit-price-per-sqft");
  const sqftField = document.getElementById("pedit-sqft");
  if (!priceField || !sqftField) return;
  const sqft = Number(sqftField.value) || 0;
  const val = syncValueFields(source);
  priceField.value = (sqft > 0 && val > 0) ? `$${Math.round(val / sqft).toLocaleString("fr-CA")}` : "—";
}

function attachPropertyEditHandlers(p) {
  document.getElementById("close-panel").onclick = closePanel;

  renderSalesHistoryEditList();
  renderValuationMethodsEdit(p);
  syncHistoricalSalesToValuation();
  updatePricePerSqFtDisplay();

  ["pedit-landvalue", "pedit-buildingvalue", "pedit-assessment", "pedit-value", "pedit-purchase"].forEach(id => {
    attachNumberFormatting(document.getElementById(id));
  });

  wireExtensibleSelect(document.getElementById("pedit-type"), CONFIG.options.propertyTypes, "Type d'immeuble");

  document.getElementById("pedit-sqft").addEventListener("input", () => updatePricePerSqFtDisplay());
  document.getElementById("pedit-landvalue").addEventListener("input", () => updatePricePerSqFtDisplay("land"));
  document.getElementById("pedit-buildingvalue").addEventListener("input", () => updatePricePerSqFtDisplay("building"));
  document.getElementById("pedit-assessment").addEventListener("input", () => updatePricePerSqFtDisplay("assessment"));
  document.getElementById("pedit-split-ratio").addEventListener("input", () => updatePricePerSqFtDisplay("assessment"));

  document.getElementById("pedit-type").addEventListener("change", (e) => {
    const suggested = TYPE_LAND_RATIO_DEFAULTS[e.target.value];
    if (suggested !== undefined) {
      document.getElementById("pedit-split-ratio").value = suggested;
    }
  });

  document.getElementById("add-sale-btn").onclick = () => {
    if (editingSalesHistory.length >= 3) return;
    editingSalesHistory.push({ date: "", amount: 0, note: "" });
    renderSalesHistoryEditList();
  };

  document.getElementById("cancel-property-edit").onclick = () => {
    state.editing = false;
    renderPanel();
  };

  attachNumberFormatting(document.getElementById("pedit-loan-amount"));
  const peditLoanLinkSelect = document.getElementById("pedit-loan-link");
  if (peditLoanLinkSelect) {
    peditLoanLinkSelect.addEventListener("change", () => {
      const show = peditLoanLinkSelect.value !== "";
      document.getElementById("pedit-loan-amount-wrap").style.display = show ? "" : "none";
      document.getElementById("pedit-loan-rank-wrap").style.display = show ? "" : "none";
    });
  }

  document.getElementById("save-property-edit").onclick = () => {
    p.type = document.getElementById("pedit-type").value;
    p.city = document.getElementById("pedit-city").value.trim();
    p.neighborhood = document.getElementById("pedit-neighborhood").value.trim();
    p.yearBuilt = parseInt(document.getElementById("pedit-yearBuilt").value, 10) || p.yearBuilt || null;
    p.constructionCode = document.getElementById("pedit-constructionCode").value.trim() || p.constructionCode || null;
    p.owner = document.getElementById("pedit-owner").value.trim();
    p.value = parseFormattedNumber(document.getElementById("pedit-value").value);
    p.landValue = parseFormattedNumber(document.getElementById("pedit-landvalue").value);
    p.buildingValue = parseFormattedNumber(document.getElementById("pedit-buildingvalue").value);
    p.assessment = p.landValue + p.buildingValue;
    p.purchase = parseFormattedNumber(document.getElementById("pedit-purchase").value);
    p.lotNumber = document.getElementById("pedit-lotnumber").value.trim();
    p.matricule = document.getElementById("pedit-matricule").value.trim();
    p.postalCode = document.getElementById("pedit-postalcode").value.trim();
    p.lotAreaSqFt = Number(document.getElementById("pedit-sqft").value) || 0;
    p.notes = document.getElementById("pedit-notes").value.trim();
    p.salesHistory = editingSalesHistory
      .filter(s => s.date || s.amount)
      .map(s => ({ ...s }));

    p.valuationMethods = {};
    VALUATION_METHOD_DEFS.forEach(def => {
      const valueEl = document.querySelector(`.vm-value[data-key="${def.key}"]`);
      const weightEl = document.querySelector(`.vm-weight[data-key="${def.key}"]`);
      p.valuationMethods[def.key] = {
        value: Number(valueEl ? valueEl.value : 0) || 0,
        weight: Number(weightEl ? weightEl.value : def.defaultWeight) || 0
      };
    });

    buildIndexes();
    savePropertyOverride(p);

    // Associer à un prêt (existant ou nouveau), si demandé
    const loanLinkVal = document.getElementById("pedit-loan-link").value;
    const linkAmount = parseFormattedNumber(document.getElementById("pedit-loan-amount").value);
    const linkRank = document.getElementById("pedit-loan-rank").value;

    if (loanLinkVal === "__new__") {
      createNewLoan([{ propertyId: p.id, amount: linkAmount, rank: linkRank }]);
      return;
    }

    if (loanLinkVal) {
      const existingLoan = state.loanMap[loanLinkVal];
      if (existingLoan) {
        existingLoan.collateral = existingLoan.collateral || [];
        if (!existingLoan.collateral.some(c => c.propertyId === p.id)) {
          existingLoan.collateral.push({ propertyId: p.id, amount: linkAmount, rank: linkRank });
          buildIndexes();
          saveLoanOverride(existingLoan);
        }
      }
    }

    state.editing = false;
    renderPanel();
    refreshMap();
    if (typeof populatePortfolioFilters === "function") populatePortfolioFilters();
    if (typeof renderPortfolio === "function") renderPortfolio();
    if (typeof renderDashboard === "function") renderDashboard();
  };
}


/* =====================================================================
   Mode 2 : PANNEAU PRÊT
   ===================================================================== */
function renderLoanPanel(loan) {
  const s = CONFIG.statusMap[loan.status];
  const props = propertiesForLoan(loan.id);
  const totalCollateralValue = props.reduce((sum, x) => sum + x.property.value, 0);
  const lv = totalCollateralValue > 0
    ? Math.round((loan.balance / totalCollateralValue) * 100)
    : 0;
  const isSaved = state.savedLoans.has(loan.id);

  // Choisir l'immeuble à afficher en Street View
  // (par défaut le premier, mais gardé en mémoire si l'utilisateur change)
  let svProperty = null;
  if (props.length > 0) {
    const savedChoice = props.find(x => x.property.id === currentLoanSvPropertyId);
    svProperty = (savedChoice ? savedChoice.property : props[0].property);
  }

  // Sélecteur d'immeuble Street View si le prêt a plusieurs immeubles
  const svSelector = props.length > 1 ? `
    <div class="gt-sv-selector">
      <label>Street View :</label>
      <select id="sv-property-picker">
        ${props.map(x => `
          <option value="${x.property.id}" ${x.property.id === svProperty.id ? "selected" : ""}>
            ${x.property.addr}
          </option>
        `).join("")}
      </select>
    </div>
  ` : "";

  return `
    <button class="gt-panel-close" id="close-panel"><i class="ti ti-x"></i></button>
    <span class="gt-badge gt-badge-accent">${s.label}</span>
    <div class="gt-panel-header-row">
      <h3 style="margin:0;">Prêt ${loan.borrower}</h3>
      <button class="gt-edit-btn-accent" id="edit-loan-btn">
        <i class="ti ti-edit"></i> Modifier
      </button>
    </div>
    <div class="gt-panel-addr">${loan.lender} • ${loan.type}</div>

    ${svProperty ? svSelector + streetViewBlock(svProperty) : ""}

    <div class="gt-stat-grid">
      <div class="gt-stat"><div class="gt-stat-label">Principal</div><div class="gt-stat-val">${fmtK(loan.principal)}</div></div>
      <div class="gt-stat"><div class="gt-stat-label">Solde</div><div class="gt-stat-val">${fmtK(loan.balance)}</div></div>
      <div class="gt-stat"><div class="gt-stat-label">Taux</div><div class="gt-stat-val">${loan.rate}%</div></div>
      <div class="gt-stat"><div class="gt-stat-label">LTV global</div><div class="gt-stat-val" style="color:${ltvColor(lv)}">${lv}%</div></div>
    </div>

    <div class="gt-section-title">Détails du prêt</div>
    <div class="gt-row"><span>Emprunteur</span><span>${loan.borrower}</span></div>
    <div class="gt-row"><span>Garant</span><span>${loan.guarantor}</span></div>
    <div class="gt-row"><span>Prêteur</span><span>${loan.lender}</span></div>
    <div class="gt-row"><span>Date de début</span><span>${loan.startDate || "—"}</span></div>
    ${loan.minTermEndDate ? `<div class="gt-row"><span>Fin période minimum</span><span>${loan.minTermEndDate}</span></div>` : ""}
    <div class="gt-row"><span>Échéance contractuelle</span><span>${loan.maturity || "—"}</span></div>
    ${loan.earlyEndDate ? `<div class="gt-row"><span>Fin anticipée</span><span>${loan.earlyEndDate}</span></div>` : ""}
    <div class="gt-row"><span>Prochaine révision</span><span>${loan.review || "—"}</span></div>
    ${(loan.dossierFeeRate !== undefined && loan.dossierFeeRate !== null && loan.dossierFeeRate !== "") ? `<div class="gt-row"><span>Frais de dossier</span><span>${loan.dossierFeeRate}%</span></div>` : ""}
    ${loan.referredBy ? `<div class="gt-row"><span>Apporteur d'affaires</span><span>${loan.referredBy}</span></div>` : ""}
    <div class="gt-row"><span>Risque</span><span>${loan.risk}</span></div>

    <div class="gt-section-title">Immeubles en garantie (${props.length})</div>
    ${props.map(x => renderCollateralItem(loan, x)).join("")}

    <div class="gt-section-title">Notes</div>
    <textarea id="inline-loan-notes" class="gt-notes-editable" rows="3" placeholder="Ajouter une note...">${loan.notes || ""}</textarea>

    ${svProperty ? mapActionsBlock(svProperty) : ""}

    <button class="gt-save-btn ${isSaved ? 'saved' : ''}" id="toggle-save-loan">
      <i class="ti ti-${isSaved ? 'check' : 'bookmark'}"></i>
      ${isSaved ? 'Suivi dans le portfolio' : 'Suivre ce prêt'}
    </button>

    <button class="gt-secondary-btn" id="frame-collateral">
      <i class="ti ti-focus-2"></i> Cadrer les ${props.length} immeuble${props.length > 1 ? "s" : ""} sur la carte
    </button>

    <button class="gt-secondary-btn" id="delete-loan-btn" style="color:#A32D2D; border-color:#A32D2D;">
      <i class="ti ti-trash"></i> Supprimer le prêt
    </button>
  `;
}

// Une carte-résumé cliquable d'un immeuble à l'intérieur du panneau prêt
function renderCollateralItem(loan, x) {
  const p = x.property;
  const propLtv = propertyLtv(p, x.amount);
  return `
    <div class="gt-linked-prop" data-property-id="${p.id}">
      <div class="gt-linked-prop-head">
        <div>
          <div class="gt-linked-prop-title">${p.addr}</div>
          <div class="gt-linked-prop-sub">${p.city} • ${p.type}</div>
        </div>
        <i class="ti ti-arrow-right" style="color:var(--color-text-tertiary)"></i>
      </div>
      <div class="gt-linked-prop-stats">
        <div><label>Valeur</label><strong>${fmtK(p.value)}</strong></div>
        <div><label>Garanti</label><strong>${fmtK(x.amount)}</strong></div>
        <div><label>Rang</label><strong>${x.rank}</strong></div>
        <div><label>LTV part</label><strong style="color:${ltvColor(propLtv)}">${propLtv}%</strong></div>
      </div>
    </div>
  `;
}

/* =====================================================================
   Mode 2b : FORMULAIRE D'ÉDITION D'UN PRÊT
   ===================================================================== */

// Copie de travail du collatéral pendant l'édition (permet d'ajouter/retirer
// des immeubles sans toucher aux données réelles avant "Enregistrer")
let editingCollateral = [];

// Style le <select> de statut avec la couleur du statut choisi (fond teinté + bordure)
// Branche la gestion de "+ Ajouter..." sur un <select> : demande une nouvelle valeur,
// l'ajoute à la liste CONFIG concernée (persistée), et l'insère/sélectionne dans le menu.
function wireExtensibleSelect(selectEl, optionsArray, promptLabel) {
  if (!selectEl) return;
  selectEl.addEventListener("change", () => {
    if (selectEl.value !== "__add_option__") return;
    const newVal = (prompt(`Nouvelle option pour "${promptLabel}" :`) || "").trim();
    if (!newVal) { selectEl.value = selectEl.options[0].value; return; }
    if (!optionsArray.includes(newVal)) {
      optionsArray.push(newVal);
      saveCustomOptions();
    }
    const addOpt = selectEl.querySelector('option[value="__add_option__"]');
    const opt = document.createElement("option");
    opt.value = newVal;
    opt.textContent = newVal;
    selectEl.insertBefore(opt, addOpt);
    selectEl.value = newVal;
    selectEl.dispatchEvent(new Event("change"));
  });
}

// Cas spécial du statut : demande un libellé, assigne une couleur automatiquement
function wireExtensibleStatusSelect(selectEl) {
  if (!selectEl) return;
  selectEl.addEventListener("change", () => {
    if (selectEl.value !== "__add_option__") return;
    const label = (prompt("Nom du nouveau statut :") || "").trim();
    if (!label) { selectEl.value = selectEl.options[0].value; return; }
    const key = addCustomStatus(label);
    const addOpt = selectEl.querySelector('option[value="__add_option__"]');
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    selectEl.insertBefore(opt, addOpt);
    selectEl.value = key;
    selectEl.setAttribute("style", statusSelectStyle(key));
    selectEl.dispatchEvent(new Event("change"));
  });
}

function statusSelectStyle(statusKey) {
  const s = CONFIG.statusMap[statusKey] || CONFIG.statusMap.active;
  return `border-left: 4px solid ${s.color}; background: ${s.color}14; color: ${s.color}; font-weight: 600;`;
}

// Crée un prêt vierge, l'enregistre dans state, et l'ouvre directement en mode édition.
// initialCollateral (optionnel) : [{propertyId, amount, rank}] pour préremplir la garantie.
// Crée un immeuble vierge (positionné au centre de la carte par défaut, ajustable
// via le formulaire ou en le repositionnant plus tard), et l'ouvre en mode édition.
function createNewProperty() {
  const property = {
    id: nextPropertyId(),
    addr: "Nouvel immeuble",
    city: "",
    neighborhood: "",
    type: "",
    owner: "",
    value: 0,
    landValue: 0,
    buildingValue: 0,
    assessment: 0,
    purchase: 0,
    lng: CONFIG.map.center[0],
    lat: CONFIG.map.center[1],
    lotAreaSqM: null,
    notes: ""
  };

  state.properties.push(property);
  buildIndexes();
  savePropertyOverride(property);

  if (typeof populatePortfolioFilters === "function") populatePortfolioFilters();
  if (typeof setupParcelLayer === "function") setupParcelLayer();

  if (typeof switchView === "function") switchView("map");
  state.selectedType = "property";
  state.selectedId = property.id;
  state.searchResult = null;
  state.editing = true;

  renderPanel();
  refreshMap();
  if (typeof renderPortfolio === "function") renderPortfolio();

  return property;
}

function createNewLoan(initialCollateral) {
  const loan = {
    id: nextLoanId(),
    borrower: "",
    guarantor: "",
    lender: "",
    type: "",
    principal: 0,
    balance: 0,
    rate: 0,
    startDate: "",
    minTermEndDate: "",
    maturity: "",
    earlyEndDate: "",
    review: "",
    status: "pending",
    risk: "Moyen",
    referredBy: "",
    notes: "",
    collateral: initialCollateral || []
  };

  state.loans.push(loan);
  state.savedLoans.add(loan.id);
  buildIndexes();
  if (typeof persistSavedLoanIds === "function") persistSavedLoanIds();
  if (typeof saveLoanOverride === "function") saveLoanOverride(loan);

  if (typeof switchView === "function") switchView("map");
  state.selectedType = "loan";
  state.selectedId = loan.id;
  state.searchResult = null;
  state.editing = true;

  renderPanel();
  refreshMap();
  if (typeof renderPortfolio === "function") renderPortfolio();
  if (typeof renderDashboard === "function") renderDashboard();

  return loan;
}

function renderLoanEditForm(loan) {
  editingCollateral = (loan.collateral || []).map(c => ({ ...c }));

  return `
    <button class="gt-panel-close" id="close-panel"><i class="ti ti-x"></i></button>
    <span class="gt-badge gt-badge-accent">Modification</span>
    <h3>Modifier — ${loan.borrower}</h3>
    <div class="gt-panel-addr">${loan.lender} • ${loan.type}</div>

    <div class="gt-section-title">Statut</div>
    <div class="gt-new-prop-form">
      <label>Statut du prêt
        <select id="edit-status" style="${statusSelectStyle(loan.status)}">
          ${CONFIG.options.statuses.map(s => `<option value="${s}" ${s === loan.status ? "selected" : ""}>${CONFIG.statusMap[s].label}</option>`).join("")}
          <option value="__add_option__">+ Ajouter un statut...</option>
        </select>
      </label>
      <label>Niveau de risque
        <select id="edit-risk">
          ${CONFIG.options.risks.map(r => `<option value="${r}" ${r === loan.risk ? "selected" : ""}>${r}</option>`).join("")}
          <option value="__add_option__">+ Ajouter...</option>
        </select>
      </label>
    </div>

    <div class="gt-section-title">Dates</div>
    <div class="gt-new-prop-form">
      <label>Date de début
        <input id="edit-startDate" type="date" value="${loan.startDate || ""}" />
      </label>
      <label>Fin période minimum
        <input id="edit-minTermEndDate" type="date" value="${loan.minTermEndDate || ""}" />
      </label>
      <label>Échéance contractuelle
        <input id="edit-maturity" type="date" value="${loan.maturity || ""}" />
      </label>
      <label>Fin anticipée
        <input id="edit-earlyEndDate" type="date" value="${loan.earlyEndDate || ""}" />
      </label>
    </div>

    <div class="gt-section-title">Montants</div>
    <div class="gt-new-prop-form">
      <label>Montant du prêt ($)
        <input id="edit-principal" type="number" step="1" value="${loan.principal || 0}" />
      </label>
      <label>Solde actuel ($)
        <input id="edit-balance" type="number" step="1" value="${loan.balance || 0}" />
      </label>
      <label>Taux d'intérêt (%)
        <input id="edit-rate" type="number" step="0.01" value="${loan.rate || 0}" />
      </label>
      <label>Frais de dossier (%)
        <input id="edit-dossierFeeRate" type="number" step="0.01" value="${loan.dossierFeeRate || 0}" />
      </label>
    </div>

    <div class="gt-section-title">Apporteur d'affaires</div>
    <div class="gt-new-prop-form">
      <label style="grid-column: 1 / -1;">Nom
        <input id="edit-referredBy" type="text" value="${loan.referredBy || ""}" placeholder="Optionnel" />
      </label>
    </div>

    <div class="gt-section-title">Garanties couvertes par le prêt</div>
    <div id="loan-edit-collateral"></div>

    <div id="loan-edit-add-row" style="display:none; border:1px dashed var(--color-border); border-radius:var(--radius-md); padding:10px; margin-bottom:10px;">
      <div class="gt-new-prop-form" style="margin-bottom:8px;">
        <label style="grid-column: 1 / -1;">Immeuble
          <select id="new-collateral-property"></select>
        </label>
        <label>Montant garanti ($)
          <input id="new-collateral-amount" type="number" step="1" value="0" />
        </label>
        <label>Rang
          <select id="new-collateral-rank">
            ${CONFIG.options.ranks.map(r => `<option value="${r}">${r}</option>`).join("")}
            <option value="__add_option__">+ Ajouter...</option>
          </select>
        </label>
      </div>
      <button type="button" class="gt-save-btn" id="confirm-add-collateral" style="padding:8px;">
        <i class="ti ti-check"></i> Ajouter cette garantie
      </button>
    </div>

    <button class="gt-secondary-btn" id="add-collateral-btn" type="button">
      <i class="ti ti-plus"></i> Ajouter un immeuble en garantie
    </button>

    <div style="display:flex; gap:8px; margin-top:16px;">
      <button class="gt-save-btn" id="save-loan-edit" style="flex:1; justify-content:center;">
        <i class="ti ti-check"></i> Enregistrer
      </button>
      <button class="gt-secondary-btn" id="cancel-loan-edit" style="flex:1; justify-content:center;">
        Annuler
      </button>
    </div>
  `;
}

function renderCollateralEditList() {
  const mount = document.getElementById("loan-edit-collateral");
  if (!mount) return;

  if (editingCollateral.length === 0) {
    mount.innerHTML = `<div style="font-size:12px;color:var(--color-text-tertiary);padding:8px 0">Aucun immeuble en garantie.</div>`;
    return;
  }

  mount.innerHTML = editingCollateral.map((c, idx) => {
    const p = state.propertyMap[c.propertyId];
    return `
      <div style="border:1px solid var(--color-border); border-radius:var(--radius-md); padding:10px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-size:13px; font-weight:600;">${p ? p.addr : c.propertyId}</div>
          <button type="button" class="gt-remove-collateral" data-idx="${idx}" style="border:none; background:none; color:var(--color-text-tertiary); cursor:pointer; padding:4px;">
            <i class="ti ti-trash"></i>
          </button>
        </div>
        <div style="display:flex; gap:8px;">
          <input class="edit-collateral-amount" data-idx="${idx}" type="number" step="1" value="${c.amount}"
                 style="flex:1; height:32px; padding:0 8px; border-radius:var(--radius-md); border:1px solid var(--color-border); font-family:var(--font-sans); font-size:13px;" />
          <select class="edit-collateral-rank" data-idx="${idx}"
                  style="flex:1; height:32px; border-radius:var(--radius-md); border:1px solid var(--color-border); font-family:var(--font-sans); font-size:13px;">
            ${CONFIG.options.ranks.map(r => `<option value="${r}" ${r === c.rank ? "selected" : ""}>${r}</option>`).join("")}
            <option value="__add_option__">+ Ajouter...</option>
          </select>
        </div>
      </div>
    `;
  }).join("");

  mount.querySelectorAll(".edit-collateral-amount").forEach(el => {
    el.addEventListener("input", () => {
      editingCollateral[Number(el.dataset.idx)].amount = Number(el.value) || 0;
    });
  });
  mount.querySelectorAll(".edit-collateral-rank").forEach(el => {
    el.addEventListener("change", () => {
      if (el.value === "__add_option__") return;
      editingCollateral[Number(el.dataset.idx)].rank = el.value;
    });
    wireExtensibleSelect(el, CONFIG.options.ranks, "Rang");
  });
  mount.querySelectorAll(".gt-remove-collateral").forEach(el => {
    el.addEventListener("click", () => {
      editingCollateral.splice(Number(el.dataset.idx), 1);
      renderCollateralEditList();
    });
  });
}

function populateNewCollateralPropertySelect() {
  const select = document.getElementById("new-collateral-property");
  if (!select) return;
  const usedIds = new Set(editingCollateral.map(c => c.propertyId));
  const available = state.properties.filter(p => !usedIds.has(p.id));
  select.innerHTML = available.map(p => `<option value="${p.id}">${p.addr} — ${p.city}</option>`).join("");
}

function attachLoanEditHandlers(loan) {
  document.getElementById("close-panel").onclick = closePanel;

  const statusSelect = document.getElementById("edit-status");
  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      statusSelect.setAttribute("style", statusSelectStyle(statusSelect.value));
    });
  }
  wireExtensibleStatusSelect(statusSelect);
  wireExtensibleSelect(document.getElementById("edit-risk"), CONFIG.options.risks, "Niveau de risque");
  wireExtensibleSelect(document.getElementById("new-collateral-rank"), CONFIG.options.ranks, "Rang");

  renderCollateralEditList();

  document.getElementById("add-collateral-btn").onclick = () => {
    populateNewCollateralPropertySelect();
    document.getElementById("loan-edit-add-row").style.display = "block";
  };

  document.getElementById("confirm-add-collateral").onclick = () => {
    const propertyId = document.getElementById("new-collateral-property").value;
    const amount = Number(document.getElementById("new-collateral-amount").value) || 0;
    const rank = document.getElementById("new-collateral-rank").value;
    if (!propertyId) return;
    editingCollateral.push({ propertyId, amount, rank });
    document.getElementById("loan-edit-add-row").style.display = "none";
    renderCollateralEditList();
  };

  document.getElementById("cancel-loan-edit").onclick = () => {
    state.editing = false;
    renderPanel();
  };

  document.getElementById("save-loan-edit").onclick = () => {
    loan.status = document.getElementById("edit-status").value;
    loan.risk = document.getElementById("edit-risk").value;
    loan.startDate = document.getElementById("edit-startDate").value;
    loan.minTermEndDate = document.getElementById("edit-minTermEndDate").value;
    loan.maturity = document.getElementById("edit-maturity").value;
    loan.earlyEndDate = document.getElementById("edit-earlyEndDate").value;
    loan.principal = Number(document.getElementById("edit-principal").value) || 0;
    loan.balance = Number(document.getElementById("edit-balance").value) || 0;
    loan.rate = Number(document.getElementById("edit-rate").value) || 0;
    loan.dossierFeeRate = Number(document.getElementById("edit-dossierFeeRate").value) || 0;
    loan.referredBy = document.getElementById("edit-referredBy").value.trim();
    loan.collateral = editingCollateral.map(c => ({ ...c }));

    buildIndexes();
    saveLoanOverride(loan);

    state.editing = false;
    renderPanel();
    refreshMap();
    if (typeof renderPortfolio === "function") renderPortfolio();
    if (typeof renderDashboard === "function") renderDashboard();
  };
}

/* =====================================================================
   Mode 3 : PANNEAU RÉSULTAT DE RECHERCHE (adresse pas encore enregistrée)
   ===================================================================== */
function renderSearchPanel(p) {
  const s = CONFIG.statusMap.new;

  return `
    <button class="gt-panel-close" id="close-panel"><i class="ti ti-x"></i></button>
    ${statusBadgeHtml("new")}
    <h3>${p.addr}</h3>
    <div class="gt-panel-addr">${p.fullAddress}${p.postalCode ? ", " + p.postalCode : ""}</div>

    ${streetViewBlock(p)}

    <div class="gt-section-title">Cet immeuble n'est pas encore dans ton portfolio</div>
    <div style="font-size:12px;color:var(--color-text-tertiary);padding:0 0 12px">
      Complète les champs ci-dessous pour l'ajouter à tes immeubles. Tu pourras ensuite lui associer un prêt.
      ${p.lotNumber ? `<br/>Numéro de lot (cadastre) : <strong>${p.lotNumber}</strong>` : ""}
      ${p.matricule ? `<br/>Matricule : <strong>${p.matricule}</strong>` : ""}
      ${p.lotAreaSqM ? `<br/>Superficie du terrain : <strong>${p.lotAreaSqM.toLocaleString("fr-CA")} m²</strong> (${Math.round(p.lotAreaSqM * 10.7639).toLocaleString("fr-CA")} pi²)` : ""}
      ${p.yearBuilt ? `<br/>Année de construction : <strong>${p.yearBuilt}</strong>` : ""}
      ${p.constructionCode ? `<br/>Genre de construction : <strong>${p.constructionCode}</strong>` : ""}
      ${p.valuesFromOfficialRoll ? `<br/><span style="color:#0F6E56;"><i class="ti ti-circle-check-filled" style="font-size:13px;vertical-align:-2px;"></i> Valeurs terrain/bâtiment trouvées sur le rôle d'évaluation officiel</span>` : ""}
    </div>

    <div class="gt-new-prop-form" id="new-prop-form">
      <label>Type
        <select id="np-type">
          <option value="">—</option>
          ${CONFIG.options.propertyTypes.map(t => `<option value="${t}">${t}</option>`).join("")}
          <option value="__add_option__">+ Ajouter un type...</option>
        </select>
      </label>
      <label>Ville
        <input id="np-city" type="text" value="${p.city || ""}" />
      </label>
      <label>Quartier
        <input id="np-neighborhood" type="text" value="${p.neighborhood || ""}" placeholder="Optionnel" />
      </label>
      <label><span>Année de construction${p.yearBuilt ? ' <i class="ti ti-circle-check-filled" style="color:#0F6E56;font-size:13px;"></i>' : ""}</span>
        <input id="np-yearBuilt" type="text" inputmode="numeric" value="${p.yearBuilt || ""}" placeholder="Ex. 1985" />
      </label>
      <label><span>Genre de construction${p.constructionCode ? ' <i class="ti ti-circle-check-filled" style="color:#0F6E56;font-size:13px;"></i>' : ""}</span>
        <select id="np-constructionCode">
          <option value="">—</option>
          ${CONFIG.options.constructionTypes.map(t => `<option value="${t}" ${t === p.constructionCode ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label>Propriétaire
        <input id="np-owner" type="text" placeholder="Nom" />
      </label>
      <label><span>Terrain ($)${p.valuesFromOfficialRoll ? ' <i class="ti ti-circle-check-filled" style="color:#0F6E56;font-size:13px;"></i>' : ""}</span>
        <input id="np-landvalue" type="text" inputmode="numeric" placeholder="0" value="${p.landValue ? formatNumberWithCommas(p.landValue) : ""}" />
      </label>
      <label><span>Bâtiment ($)${p.valuesFromOfficialRoll ? ' <i class="ti ti-circle-check-filled" style="color:#0F6E56;font-size:13px;"></i>' : ""}</span>
        <input id="np-buildingvalue" type="text" inputmode="numeric" placeholder="0" value="${p.buildingValue ? formatNumberWithCommas(p.buildingValue) : ""}" />
      </label>
      <label>Valeur municipale (Terrain + Bâtiment)
        <input id="np-assessment" type="text" inputmode="numeric"
               value="${((p.landValue || 0) + (p.buildingValue || 0)) ? formatNumberWithCommas((p.landValue || 0) + (p.buildingValue || 0)) : ""}" placeholder="0" />
      </label>
      <label>Valeur estimée ($)
        <input id="np-value" type="text" inputmode="numeric" placeholder="0" />
      </label>
    </div>

    <div class="gt-section-title">Associer à un prêt (optionnel)</div>
    <div class="gt-new-prop-form">
      <label style="grid-column: 1 / -1;">Prêt
        <select id="np-loan-link">
          <option value="">— Aucun pour l'instant —</option>
          <option value="__new__">+ Créer un nouveau prêt</option>
          ${state.loans.map(l => `<option value="${l.id}">${l.borrower || "(sans nom)"} — ${l.lender || "—"}</option>`).join("")}
        </select>
      </label>
      <label id="np-loan-amount-wrap" style="display:none;">Montant garanti sur cet immeuble ($)
        <input id="np-loan-amount" type="text" inputmode="numeric" placeholder="0" />
      </label>
      <label id="np-loan-rank-wrap" style="display:none;">Rang
        <select id="np-loan-rank">
          ${CONFIG.options.ranks.map(r => `<option value="${r}">${r}</option>`).join("")}
          <option value="__add_option__">+ Ajouter...</option>
        </select>
      </label>
    </div>

    ${mapActionsBlock(p)}

    <button class="gt-save-btn" id="save-new-property">
      <i class="ti ti-plus"></i> Ajouter cet immeuble à mon portfolio
    </button>
  `;
}

function attachSearchPanelHandlers(p) {
  document.getElementById("close-panel").onclick = closePanel;

  ["np-landvalue", "np-buildingvalue", "np-assessment", "np-value"].forEach(id => {
    attachNumberFormatting(document.getElementById(id));
  });

  ["np-landvalue", "np-buildingvalue"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      const land = parseFormattedNumber(document.getElementById("np-landvalue").value);
      const building = parseFormattedNumber(document.getElementById("np-buildingvalue").value);
      document.getElementById("np-assessment").value = formatNumberWithCommas(land + building);
    });
  });

  attachNumberFormatting(document.getElementById("np-loan-amount"));
  wireExtensibleSelect(document.getElementById("np-type"), CONFIG.options.propertyTypes, "Type d'immeuble");
  wireExtensibleSelect(document.getElementById("np-loan-rank"), CONFIG.options.ranks, "Rang");
  const loanLinkSelect = document.getElementById("np-loan-link");
  if (loanLinkSelect) {
    loanLinkSelect.addEventListener("change", () => {
      const show = loanLinkSelect.value !== "";
      document.getElementById("np-loan-amount-wrap").style.display = show ? "" : "none";
      document.getElementById("np-loan-rank-wrap").style.display = show ? "" : "none";
    });
  }

  document.getElementById("save-new-property").onclick = () => {
    const newProperty = {
      id: nextPropertyId(),
      addr: p.addr,
      city: document.getElementById("np-city").value.trim() || p.city || "",
      neighborhood: document.getElementById("np-neighborhood").value.trim(),
      yearBuilt: parseInt(document.getElementById("np-yearBuilt").value, 10) || p.yearBuilt || null,
      constructionCode: document.getElementById("np-constructionCode").value.trim() || p.constructionCode || null,
      type: document.getElementById("np-type").value,
      owner: document.getElementById("np-owner").value.trim(),
      value: parseFormattedNumber(document.getElementById("np-value").value),
      landValue: parseFormattedNumber(document.getElementById("np-landvalue").value),
      buildingValue: parseFormattedNumber(document.getElementById("np-buildingvalue").value),
      assessment: parseFormattedNumber(document.getElementById("np-assessment").value),
      lng: p.lng,
      lat: p.lat,
      lotAreaSqM: p.lotAreaSqM || null,
      lotNumber: p.lotNumber || "",
      matricule: p.matricule || "",
      postalCode: p.postalCode || "",
      notes: ""
    };

    state.properties.push(newProperty);
    buildIndexes();
    savePropertyOverride(newProperty);

    // Si le lot vient d'un clic sur le tileset, on a déjà le vrai polygone — pas besoin
    // de repasser par extract_parcels.py pour cet immeuble.
    if (p.parcelGeometry) {
      state.parcels.push({ propertyId: newProperty.id, geometry: p.parcelGeometry });
      saveExtraParcel(newProperty.id, p.parcelGeometry);
    }

    if (typeof populatePortfolioFilters === "function") populatePortfolioFilters();
    if (typeof setupParcelLayer === "function") setupParcelLayer();
    refreshMap();
    if (typeof renderPortfolio === "function") renderPortfolio();

    // Associer à un prêt (existant ou nouveau), si demandé
    const loanLinkVal = document.getElementById("np-loan-link").value;
    const linkAmount = parseFormattedNumber(document.getElementById("np-loan-amount").value);
    const linkRank = document.getElementById("np-loan-rank").value;

    if (loanLinkVal === "__new__") {
      // Nouveau prêt, avec cet immeuble déjà en garantie — ouvre directement son édition
      createNewLoan([{ propertyId: newProperty.id, amount: linkAmount, rank: linkRank }]);
      return;
    }

    if (loanLinkVal) {
      const existingLoan = state.loanMap[loanLinkVal];
      if (existingLoan) {
        existingLoan.collateral = existingLoan.collateral || [];
        existingLoan.collateral.push({ propertyId: newProperty.id, amount: linkAmount, rank: linkRank });
        buildIndexes();
        if (typeof saveLoanOverride === "function") saveLoanOverride(existingLoan);
        refreshMap();
        if (typeof renderPortfolio === "function") renderPortfolio();
        if (typeof renderDashboard === "function") renderDashboard();
      }
    }

    state.searchResult = null;
    selectProperty(newProperty.id);
  };
}

/* =====================================================================
   Renderer principal
   ===================================================================== */
function renderPanel() {
  const wrap = document.getElementById("map-wrap");
  const panel = document.getElementById("panel-content");

  if (!state.selectedId && state.selectedType !== "search") {
    wrap.classList.remove("panel-open");
    panel.innerHTML = "";
    currentLoanSvPropertyId = null;
    setTimeout(() => map && map.resize(), 220);
    return;
  }

  wrap.classList.add("panel-open");
  setTimeout(() => map && map.resize(), 220);

  if (state.selectedType === "property") {
    const p = state.propertyMap[state.selectedId];
    if (!p) return;
    if (state.editing) {
      panel.innerHTML = renderPropertyEditForm(p);
      attachPropertyEditHandlers(p);
    } else {
      panel.innerHTML = renderPropertyPanel(p);
      attachPropertyPanelHandlers(p);
    }
    return;
  }

  if (state.selectedType === "loan") {
    const loan = state.loanMap[state.selectedId];
    if (!loan) return;
    if (state.editing) {
      panel.innerHTML = renderLoanEditForm(loan);
      attachLoanEditHandlers(loan);
    } else {
      panel.innerHTML = renderLoanPanel(loan);
      attachLoanPanelHandlers(loan);
    }
    return;
  }

  if (state.selectedType === "search") {
    const p = state.searchResult;
    if (!p) return;
    panel.innerHTML = renderSearchPanel(p);
    attachSearchPanelHandlers(p);
    return;
  }
}

function attachPropertyPanelHandlers(p) {
  document.getElementById("close-panel").onclick = closePanel;

  // Recherche automatique des infos officielles manquantes (matricule, valeurs,
  // superficie, zone inondable) — sans bouton, une seule fois par immeuble tant qu'on
  // n'a pas essayé.
  const needsLookup = (!p.matricule || (!p.landValue && !p.buildingValue) || (!p.lotAreaSqM && !p.lotAreaSqFt) || p.floodZoneChecked === undefined || p.landslideZoneChecked === undefined || p.contaminatedSiteChecked === undefined || p.agriculturalZoneChecked === undefined || p.coastalErosionChecked === undefined);
  if (needsLookup && !p._lookupAttempted) {
    p._lookupAttempted = true;
    (async () => {
      let foundSomething = false;

      const vals = typeof fetchRealEstateValues === "function"
        ? await fetchRealEstateValues(p.lng, p.lat)
        : null;
      if (vals) {
        foundSomething = true;
        if (vals.matricule && !p.matricule) p.matricule = vals.matricule;
        p.codeMun = vals.codeMun; p.secteur = vals.secteur; p.typePropriete = vals.typePropriete;
        if (vals.yearBuilt && !p.yearBuilt) p.yearBuilt = vals.yearBuilt;
        if (vals.constructionCode && !p.constructionCode) p.constructionCode = vals.constructionCode;
        if (!p.landValue && !p.buildingValue) {
          p.landValue = vals.landValue;
          p.buildingValue = vals.buildingValue;
          p.assessment = vals.totalValue;
        }
      }

      // Zone inondable officielle (BDZI)
      if (p.floodZoneChecked === undefined && typeof fetchFloodZoneStatus === "function") {
        const flood = await fetchFloodZoneStatus(p.lng, p.lat);
        p.floodZoneChecked = true;
        p.floodZone = flood ? flood.description : null;
        p.floodZoneReport = flood ? flood.report : null;
        foundSomething = true;
      }

      // Zone de glissement de terrain (ZPEGT)
      if (p.landslideZoneChecked === undefined && typeof fetchLandslideZoneStatus === "function") {
        const landslide = await fetchLandslideZoneStatus(p.lng, p.lat);
        p.landslideZoneChecked = true;
        p.landslideZone = landslide ? landslide.label : null;
        foundSomething = true;
      }

      // Terrain contaminé (GTC)
      if (p.contaminatedSiteChecked === undefined && typeof fetchContaminatedSiteStatus === "function") {
        const contam = await fetchContaminatedSiteStatus(p.lng, p.lat);
        p.contaminatedSiteChecked = true;
        p.contaminatedSite = contam ? contam.reference : null;
        p.contaminatedSiteMilieu = contam ? contam.milieu : null;
        foundSomething = true;
      }

      // Zone agricole protégée (CPTAQ)
      if (p.agriculturalZoneChecked === undefined && typeof fetchAgriculturalZoneStatus === "function") {
        const agri = await fetchAgriculturalZoneStatus(p.lng, p.lat);
        p.agriculturalZoneChecked = true;
        p.inAgriculturalZone = agri ? true : false;
        foundSomething = true;
      }

      // Zone de contrainte érosion côtière / mouvements de terrain (ZEMT)
      if (p.coastalErosionChecked === undefined && typeof fetchCoastalErosionStatus === "function") {
        const erosion = await fetchCoastalErosionStatus(p.lng, p.lat);
        p.coastalErosionChecked = true;
        p.coastalErosionZone = erosion ? true : false;
        foundSomething = true;
      }

      // Vrai polygone du lot (superficie) — la caméra a déjà volé ici via selectProperty(),
      // donc queryParcelAfterFlyTo attend juste que ce déplacement se termine, sans en
      // redemander un nouveau.
      if (!p.lotAreaSqM && !p.lotAreaSqFt && typeof queryParcelAfterFlyTo === "function" && map) {
        const feature = await queryParcelAfterFlyTo(p.lng, p.lat);
        if (feature && typeof polygonAreaSqMeters === "function") {
          foundSomething = true;
          p.lotAreaSqM = polygonAreaSqMeters(feature.geometry);
          p.parcelGeometry = feature.geometry;
          if (feature.properties && feature.properties.NO_LOT) {
            if (!p.lotNumber) p.lotNumber = feature.properties.NO_LOT;
          } else if (!p.lotNumber && CONFIG.parcelTileset && CONFIG.parcelTileset.id) {
            // Filet de sécurité : ce champ a parfois été laissé de côté lors de la
            // compression du tileset des valeurs — on va le chercher directement dans
            // le tileset cadastre d'origine, qui l'a toujours.
            const cadastreProps = await tilequeryLookup(CONFIG.parcelTileset.id, p.lng, p.lat);
            if (cadastreProps && cadastreProps.NO_LOT) p.lotNumber = cadastreProps.NO_LOT;
          }
          if (typeof saveExtraParcel === "function") saveExtraParcel(p.id, feature.geometry);
          if (!state.parcels.some(pc => pc.propertyId === p.id)) {
            state.parcels.push({ propertyId: p.id, geometry: feature.geometry });
          }
        }
      }

      if (foundSomething) savePropertyOverride(p);

      // Ne rafraîchit que si ce même immeuble est toujours affiché (l'utilisateur n'a
      // pas navigué ailleurs entre-temps)
      if (state.selectedType === "property" && state.selectedId === p.id) {
        renderPanel();
      }
    })();
  }

  // Cliquer sur un prêt lié → ouvrir le panneau prêt
  document.querySelectorAll(".gt-linked-loan").forEach(el => {
    el.addEventListener("click", () => {
      const loanId = el.dataset.loanId;
      selectLoan(loanId);
    });
  });

  // Passer en mode édition
  document.getElementById("edit-property-btn").onclick = () => {
    state.editing = true;
    renderPanel();
  };

  // Supprimer l'immeuble
  document.getElementById("delete-property-btn").onclick = () => {
    const loans = loansForProperty(p.id);
    const warning = loans.length > 0
      ? `\n\nAttention : ${loans.length} prêt(s) référencent cet immeuble en garantie — ce lien sera retiré de ces prêts (le prêt lui-même n'est pas supprimé).`
      : "";
    const confirmed = confirm(`Supprimer définitivement "${p.addr}" de ton portfolio ?${warning}\n\nCette action est irréversible.`);
    if (!confirmed) return;

    // Retire l'immeuble
    state.properties = state.properties.filter(x => x.id !== p.id);
    state.parcels = state.parcels.filter(pc => pc.propertyId !== p.id);

    // Retire les références à cet immeuble dans les garanties de tous les prêts
    state.loans.forEach(l => {
      if (l.collateral && l.collateral.some(c => c.propertyId === p.id)) {
        l.collateral = l.collateral.filter(c => c.propertyId !== p.id);
        if (typeof saveLoanOverride === "function") saveLoanOverride(l);
      }
    });

    buildIndexes();
    markPropertyDeleted(p.id);

    closePanel();
    refreshMap();
    if (typeof populatePortfolioFilters === "function") populatePortfolioFilters();
    if (typeof renderPortfolio === "function") renderPortfolio();
    if (typeof renderDashboard === "function") renderDashboard();
  };
}

function attachLoanPanelHandlers(loan) {
  document.getElementById("close-panel").onclick = closePanel;

  // Notes éditables directement, sauvegarde automatique en quittant le champ
  const notesEl = document.getElementById("inline-loan-notes");
  if (notesEl) {
    notesEl.addEventListener("blur", () => {
      const newVal = notesEl.value.trim();
      if (newVal === (loan.notes || "")) return;
      loan.notes = newVal;
      if (typeof saveLoanOverride === "function") saveLoanOverride(loan);
    });
  }

  // Cliquer sur un immeuble en garantie → ouvrir le panneau immeuble
  document.querySelectorAll(".gt-linked-prop").forEach(el => {
    el.addEventListener("click", () => {
      const propId = el.dataset.propertyId;
      selectProperty(propId);
    });
  });

  // Toggle suivi du prêt
  document.getElementById("toggle-save-loan").onclick = () => {
    if (state.savedLoans.has(loan.id)) state.savedLoans.delete(loan.id);
    else state.savedLoans.add(loan.id);
    if (typeof persistSavedLoanIds === "function") persistSavedLoanIds();
    renderPanel();
    refreshMap();
    renderPortfolio();
    renderDashboard();
  };

  // Cadrer tous les immeubles du prêt sur la carte
  document.getElementById("frame-collateral").onclick = () => {
    frameLoanCollateral(loan.id);
  };

  document.getElementById("delete-loan-btn").onclick = () => {
    const confirmed = confirm(`Supprimer définitivement le prêt "${loan.borrower || loan.id}" ?\n\nLes immeubles en garantie ne sont pas supprimés, seul le lien avec ce prêt disparaît.\n\nCette action est irréversible.`);
    if (!confirmed) return;

    state.loans = state.loans.filter(l => l.id !== loan.id);
    state.savedLoans.delete(loan.id);
    buildIndexes();
    markLoanDeleted(loan.id);
    if (typeof persistSavedLoanIds === "function") persistSavedLoanIds();

    closePanel();
    refreshMap();
    if (typeof renderPortfolio === "function") renderPortfolio();
    if (typeof renderDashboard === "function") renderDashboard();
  };

  // Passer en mode édition
  document.getElementById("edit-loan-btn").onclick = () => {
    state.editing = true;
    renderPanel();
  };

  // Changer l'immeuble affiché en Street View (si prêt multi-immeubles)
  const picker = document.getElementById("sv-property-picker");
  if (picker) {
    picker.addEventListener("change", (e) => {
      currentLoanSvPropertyId = e.target.value;
      renderPanel();
    });
  }
}

function closePanel() {
  state.selectedId = null;
  state.selectedType = null;
  currentLoanSvPropertyId = null;
  state.searchResult = null;
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();
  if (typeof clearSelectedParcelHighlight === "function") clearSelectedParcelHighlight();
  renderPanel();
  refreshMap();
}