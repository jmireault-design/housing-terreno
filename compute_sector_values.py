"""
compute_sector_values.py — Calcule la valeur moyenne, la superficie habitable moyenne,
le terrain moyen et l'année de construction moyenne, regroupés par municipalité +
secteur (unité de voisinage) + type de propriété — à partir du rôle d'évaluation
déjà téléchargé (role2026_gpkg).

Traite 3,7M de lignes directement en SQL (via GDAL/SQLite), pas en Python — beaucoup
plus rapide qu'un chargement ligne par ligne.

USAGE :
    .venv/bin/python compute_sector_values.py

Produit : sector_values.csv (à la racine du projet)
"""

import subprocess
import glob
import csv

GPKG_CANDIDATES = glob.glob("role2026_gpkg/**/*.gpkg", recursive=True)
OUTPUT_PATH = "sector_values.csv"

SQL_QUERY = """
SELECT
    code_mun,
    rl0107a AS secteur,
    rl0105a AS type_propriete,
    AVG(rl0404a) AS valeur_moyenne,
    AVG(rl0308a) * 10.7639 AS superficie_habitable_moyenne_pi2,
    AVG(rl0302a) * 10.7639 AS terrain_moyen_pi2,
    ROUND(AVG(CAST(rl0307a AS INTEGER))) AS annee_construction_moyenne,
    COUNT(*) AS nombre_proprietes
FROM b05v_unite_evaln_2026
WHERE rl0404a > 0
  AND rl0307a IS NOT NULL AND rl0307a != ''
GROUP BY code_mun, rl0107a, rl0105a
""".strip()


def main():
    if not GPKG_CANDIDATES:
        print("! Aucun fichier .gpkg trouvé sous role2026_gpkg/ — vérifie que le dossier existe.")
        return

    gpkg_path = GPKG_CANDIDATES[0]
    print(f"Fichier source : {gpkg_path}")
    print("Calcul des valeurs sectorielles moyennes (peut prendre quelques minutes sur 3,7M lignes)...\n")

    result = subprocess.run(
        ["ogr2ogr", "-f", "CSV", OUTPUT_PATH, gpkg_path,
         "-dialect", "SQLite", "-sql", SQL_QUERY],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        print("! ogr2ogr a échoué :")
        print(result.stderr)
        return

    with open(OUTPUT_PATH, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Terminé : {len(rows)} combinaisons municipalité/secteur/type calculées.")
    print(f"Écrit : {OUTPUT_PATH}\n")

    if rows:
        print("Aperçu des 5 premières lignes :")
        for r in rows[:5]:
            print(f"  {r}")


if __name__ == "__main__":
    main()
