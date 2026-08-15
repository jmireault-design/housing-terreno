"""
build_sector_values_lookup.py — Convertit sector_values.csv (211k lignes) en un fichier
JSON compact, indexé par "code_mun|secteur|type_propriete", pour que l'app puisse le
charger et comparer rapidement un immeuble à la moyenne de son secteur.

Ne garde que les groupes avec au moins MIN_SAMPLES immeubles ET une valeur moyenne
calculable (les autres champs comme superficie/terrain peuvent être vides si cette
donnée manque pour ce secteur — dans ce cas, ils sont simplement omis).

USAGE :
    .venv/bin/python build_sector_values_lookup.py

Produit : data/sector_values.json (à la racine du projet, dossier data/)
"""

import csv
import json
import os

INPUT_PATH = "sector_values.csv"
OUTPUT_PATH = "data/sector_values.json"
MIN_SAMPLES = 3


def safe_num(value, round_func=round):
    if value is None or value == "":
        return None
    try:
        return round_func(float(value))
    except (ValueError, TypeError):
        return None


def main():
    if not os.path.exists(INPUT_PATH):
        print(f"! {INPUT_PATH} introuvable — lance d'abord compute_sector_values.py")
        return

    lookup = {}
    skipped_small = 0
    skipped_no_value = 0

    with open(INPUT_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            n = safe_num(row.get("nombre_proprietes"), int)
            if n is None or n < MIN_SAMPLES:
                skipped_small += 1
                continue

            v = safe_num(row.get("valeur_moyenne"))
            if v is None:
                skipped_no_value += 1
                continue

            key = f"{row['code_mun']}|{row['secteur']}|{row['type_propriete']}"
            entry = {"v": v, "n": n}

            s = safe_num(row.get("superficie_habitable_moyenne_pi2"))
            if s is not None:
                entry["s"] = s
            t = safe_num(row.get("terrain_moyen_pi2"))
            if t is not None:
                entry["t"] = t
            a = safe_num(row.get("annee_construction_moyenne"), int)
            if a is not None:
                entry["a"] = a

            lookup[key] = entry

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(lookup, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"Terminé : {len(lookup)} groupes retenus.")
    print(f"  {skipped_small} écartés (moins de {MIN_SAMPLES} propriétés)")
    print(f"  {skipped_no_value} écartés (valeur moyenne non calculable)")
    print(f"Écrit : {OUTPUT_PATH} ({size_mb:.1f} Mo)")


if __name__ == "__main__":
    main()