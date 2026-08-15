"""
inspect_role_fields.py — Liste tous les champs disponibles dans la table des valeurs
du rôle d'évaluation (b05v_unite_evaln_2026), pour confirmer les noms exacts avant de
construire la requête de calcul des valeurs sectorielles moyennes.

USAGE :
    .venv/bin/python inspect_role_fields.py
"""

import subprocess
import glob

GPKG_CANDIDATES = glob.glob("role2026_gpkg/**/*.gpkg", recursive=True)


def main():
    if not GPKG_CANDIDATES:
        print("! Aucun fichier .gpkg trouvé sous role2026_gpkg/ — vérifie que le dossier existe.")
        return

    gpkg_path = GPKG_CANDIDATES[0]
    print(f"Fichier : {gpkg_path}\n")

    print("Table b05v_unite_evaln_2026 — tous les champs :\n")
    result = subprocess.run(
        ["ogrinfo", "-so", gpkg_path, "b05v_unite_evaln_2026"],
        capture_output=True, text=True
    )
    print(result.stdout)
    if result.returncode != 0:
        print("! Erreur :", result.stderr)


if __name__ == "__main__":
    main()
