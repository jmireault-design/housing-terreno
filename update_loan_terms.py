"""
update_loan_terms.py — Met à jour data/loans.json avec les dates, taux et durées
provenant du chiffrier Google Sheets de Jonathan, en faisant correspondre chaque
dossier directement par ID (L001 = dossier 1, L002 = dossier 2, etc.)

USAGE (à la racine du projet, là où se trouve data/loans.json) :
    python3 update_loan_terms.py
"""

import json

# id -> {startDate (ISO), termMonths, maturity (ISO), minInterestMonths, rate, rateAfterMaturity}
# Valeurs vides dans le chiffrier laissées à None (non touchées).
UPDATES = {
    "L001": {"startDate": "2024-08-01", "termMonths": 3,  "maturity": "2024-11-01", "minInterestMonths": 3, "rate": 6,  "rateAfterMaturity": 18},
    "L002": {"startDate": "2024-11-28", "termMonths": 6,  "maturity": "2025-05-28", "minInterestMonths": 3, "rate": 12, "rateAfterMaturity": 24},
    "L003": {"startDate": "2025-07-15", "termMonths": 3,  "maturity": "2025-10-15", "minInterestMonths": 3, "rate": 3,  "rateAfterMaturity": 18},
    "L004": {"startDate": "2025-06-04", "termMonths": 6,  "maturity": "2025-11-28", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L005": {"startDate": "2025-12-16", "termMonths": 12, "maturity": "2026-12-16", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L006": {"startDate": "2025-06-17", "termMonths": 12, "maturity": "2026-06-17", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L007": {"startDate": "2025-04-01", "termMonths": 12, "maturity": "2026-04-01", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L008": {"startDate": "2026-06-23", "termMonths": 6,  "maturity": "2026-12-23", "minInterestMonths": 6, "rate": 6,  "rateAfterMaturity": 24},
    "L009": {},  # dossier refusé, aucune donnée dans le chiffrier
    "L010": {"startDate": "2026-07-20", "termMonths": 12, "maturity": "2027-07-20", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L011": {"startDate": "2026-06-29", "termMonths": 12, "maturity": "2027-06-29", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L012": {},  # dossier refusé, aucune donnée dans le chiffrier
    "L013": {"startDate": "2026-08-13", "termMonths": 6,  "maturity": "2026-08-13", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L014": {"rate": 15, "rateAfterMaturity": 24},  # seules les 2 taux sont renseignés
    "L015": {"startDate": "2026-04-01", "termMonths": 12, "maturity": "2027-04-01", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 18},
    "L016": {"startDate": "2026-01-19", "termMonths": 6,  "maturity": "2026-07-19", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 24},
    "L017": {"startDate": "2025-10-30", "termMonths": 3,  "maturity": "2026-01-30", "minInterestMonths": 3, "rate": 12, "rateAfterMaturity": 24},
    "L018": {"startDate": "2024-09-01", "termMonths": 6,  "maturity": "2025-03-01", "minInterestMonths": 6, "rate": 12, "rateAfterMaturity": 24},
    "L019": {"startDate": "2024-01-01", "termMonths": 6,  "maturity": "2024-06-01", "minInterestMonths": 6, "rate": 3,  "rateAfterMaturity": 18},
}


def main():
    path = "data/loans.json"
    with open(path, encoding="utf-8") as f:
        loans = json.load(f)

    updated_count = 0
    not_found = []

    for loan in loans:
        loan_id = loan.get("id")
        if loan_id not in UPDATES:
            continue
        fields = UPDATES[loan_id]
        if not fields:
            continue
        for key, value in fields.items():
            loan[key] = value
        updated_count += 1
        print(f"  {loan_id} ({loan.get('notes', '')}) mis à jour : {fields}")

    found_ids = {loan.get("id") for loan in loans}
    for expected_id in UPDATES:
        if expected_id not in found_ids:
            not_found.append(expected_id)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(loans, f, ensure_ascii=False, indent=2)

    print(f"\n{updated_count} prêt(s) mis à jour dans {path}")
    if not_found:
        print(f"! Attention, ID(s) non trouvé(s) dans loans.json : {not_found}")


if __name__ == "__main__":
    main()
