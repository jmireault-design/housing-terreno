/* =====================================================================
   loan-profile.js — page de profil plein écran pour un prêt (pas juste
   le panneau latéral) : détails complets + Street View pour chaque
   immeuble en garantie
   ===================================================================== */

function openLoanProfilePage(loanId) {
  const loan = state.loanMap[loanId];
  if (!loan) return;

  const overlay = document.getElementById("loan-profile-overlay");
  const content = document.getElementById("loan-profile-content");
  if (!overlay || !content) return;

  content.innerHTML = renderLoanProfilePage(loan);
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  window.scrollTo(0, 0);

  wireLoanProfilePage(loan);
}

function closeLoanProfilePage() {
  const overlay = document.getElementById("loan-profile-overlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

function renderLoanProfilePage(loan) {
  const s = CONFIG.statusMap[loan.status] || CONFIG.statusMap.active;
  const collateral = (loan.collateral || [])
    .map(c => ({ c, p: state.propertyMap[c.propertyId] }))
    .filter(entry => entry.p);

  const totalGuaranteed = collateral.reduce((sum, { c }) => sum + (c.amount || 0), 0);
  const totalValue = collateral.reduce((sum, { p }) => sum + (p.value || 0), 0);
  const avgLtv = totalValue > 0 ? Math.round((totalGuaranteed / totalValue) * 100) : 0;

  return `
    <div class="gt-lp-header">
      <button class="gt-lp-back-btn" id="lp-back-btn">
        <i class="ti ti-arrow-left"></i> Retour
      </button>
      <div class="gt-lp-title-block" style="flex:1; text-align:center;">
        <h1>${loan.borrower || "(sans nom)"}</h1>
        <div class="gt-lp-subtitle">${loan.notes || ""}${loan.notes && loan.lender ? " · " : ""}${loan.lender || ""}</div>
      </div>
      <div class="gt-lp-header-actions">
        <span class="gt-status-badge" style="background:${s.color}18;color:${s.color};border:1px solid ${s.color}55;padding:6px 14px;border-radius:999px;font-weight:700;font-size:12px;">
          <i class="ti ${s.icon}"></i> ${s.label}
        </span>
        <button class="gt-edit-btn-accent" id="lp-edit-btn"><i class="ti ti-edit"></i> Modifier</button>
      </div>
    </div>

    <div class="gt-lp-body">
      <div class="gt-lp-stats-row">
        <div class="gt-lp-stat-card">
          <div class="gt-lp-stat-label">Montant financé</div>
          <div class="gt-lp-stat-value">${fmtK(totalGuaranteed || loan.principal || 0)}</div>
        </div>
        <div class="gt-lp-stat-card">
          <div class="gt-lp-stat-label">Valeur totale des garanties</div>
          <div class="gt-lp-stat-value">${fmtK(totalValue)}</div>
        </div>
        <div class="gt-lp-stat-card">
          <div class="gt-lp-stat-label">LTV moyen</div>
          <div class="gt-lp-stat-value" style="color:${ltvColor(avgLtv)}">${avgLtv}%</div>
        </div>
        <div class="gt-lp-stat-card">
          <div class="gt-lp-stat-label">Immeubles en garantie</div>
          <div class="gt-lp-stat-value">${collateral.length}</div>
        </div>
      </div>

      <div class="gt-lp-section-title">Détails du prêt</div>
      <div class="gt-lp-info-grid">
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Type de prêt</div>
          <div class="gt-lp-info-value">${loan.type || "—"}</div>
        </div>
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Prêteur</div>
          <div class="gt-lp-info-value">${loan.lender || "—"}</div>
        </div>
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Apporteur d'affaires</div>
          <div class="gt-lp-info-value">${loan.referredBy || "—"}</div>
        </div>
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Date de début</div>
          <div class="gt-lp-info-value">${loan.startDate || "—"}</div>
        </div>
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Date d'échéance</div>
          <div class="gt-lp-info-value">${loan.endDate || "—"}</div>
        </div>
        <div class="gt-lp-info-item">
          <div class="gt-lp-info-label">Niveau de risque</div>
          <div class="gt-lp-info-value">${loan.risk || "—"}</div>
        </div>
      </div>

      <div class="gt-lp-section-title">Immeubles en garantie</div>
      <div class="gt-lp-collateral-grid">
        ${collateral.map(({ c, p }) => {
          const lv = propertyLtv(p, c.amount);
          return `
            <div class="gt-lp-collateral-card" data-property-id="${p.id}">
              ${typeof streetViewBlock === "function" ? streetViewBlock(p) : ""}
              <div class="gt-lp-collateral-body">
                <div class="gt-lp-collateral-addr">${p.addr}</div>
                <div class="gt-lp-collateral-meta">${p.city}${p.neighborhood ? " · " + p.neighborhood : ""} · Rang : ${c.rank || "—"}</div>
                <div class="gt-lp-collateral-stats">
                  <div><span style="color:var(--color-text-tertiary)">Garanti</span><strong>${fmtK(c.amount || 0)}</strong></div>
                  <div><span style="color:var(--color-text-tertiary)">Valeur</span><strong>${fmtK(p.value || 0)}</strong></div>
                  <div><span style="color:var(--color-text-tertiary)">LTV</span><strong style="color:${ltvColor(lv)}">${lv}%</strong></div>
                </div>
              </div>
            </div>
          `;
        }).join("") || `<div style="color:var(--color-text-tertiary);font-size:13px;">Aucun immeuble en garantie associé à ce prêt.</div>`}
      </div>

      ${loan.notes ? `
        <div class="gt-lp-section-title">Notes</div>
        <div class="gt-lp-notes-box">${loan.notes}</div>
      ` : ""}
    </div>
  `;
}

function wireLoanProfilePage(loan) {
  const backBtn = document.getElementById("lp-back-btn");
  if (backBtn) backBtn.onclick = closeLoanProfilePage;

  const editBtn = document.getElementById("lp-edit-btn");
  if (editBtn) {
    editBtn.onclick = () => {
      closeLoanProfilePage();
      // On ne passe PAS par selectLoan() ici — elle ouvre maintenant cette page
      // de profil, pas le panneau latéral. On reproduit directement ce qu'il
      // faut pour ouvrir le formulaire d'édition dans le panneau latéral.
      clearSearchHighlight();
      clearSelectedParcelHighlight();
      state.selectedType = "loan";
      state.selectedId = loan.id;
      state.searchResult = null;
      if (typeof frameLoanCollateral === "function") frameLoanCollateral(loan.id);
      state.editing = true;
      // Le formulaire d'édition vit dans le panneau de la vue Carte — si on est
      // arrivé ici depuis Portfolio (ou une autre vue), il faut y basculer,
      // sinon le formulaire se dessine correctement mais reste invisible.
      if (typeof switchView === "function") switchView("map");
      renderPanel();
    };
  }

  document.querySelectorAll(".gt-lp-collateral-card").forEach(card => {
    card.addEventListener("click", () => {
      const propertyId = card.dataset.propertyId;
      closeLoanProfilePage();
      selectProperty(propertyId);
    });
  });

  // Ferme avec la touche Échap
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") {
      closeLoanProfilePage();
      document.removeEventListener("keydown", escHandler);
    }
  });
}