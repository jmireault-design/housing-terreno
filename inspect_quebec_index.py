"""
inspect_quebec_index.py — Vérifie le contenu de l'index provincial des rôles d'évaluation
foncière AVANT de télécharger le gros fichier (500 Mo - 1 Go). Cherche s'il existe des liens
individuels pour Laval et Longueuil (ce qui éviterait le gros téléchargement complet).

USAGE :
    .venv/bin/python inspect_quebec_index.py

Ne produit aucun fichier de données — affiche juste l'info dans le terminal.
"""

import csv
import io
import urllib.request

INDEX_URL = "https://donneesouvertes.affmunqc.net/role/indexRole2026.csv"

TARGET_CITIES = ["Laval", "Longueuil"]


def main():
    print(f"Téléchargement de l'index : {INDEX_URL} ...")
    with urllib.request.urlopen(INDEX_URL) as resp:
        raw = resp.read()

    print(f"  {len(raw) / 1000:.0f} Ko téléchargés.\n")

    # Essaye plusieurs encodages courants pour les fichiers gouvernementaux québécois
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            print(f"Décodé avec l'encodage: {enc}")
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise SystemExit("Impossible de décoder le fichier avec les encodages courants.")

    # Détecte le délimiteur (souvent ';' pour les fichiers gouvernementaux QC, parfois ',')
    sample = text[:2000]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    print(f"Délimiteur détecté: '{delimiter}'\n")

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    print(f"Colonnes trouvées ({len(fieldnames)}):")
    for f in fieldnames:
        print(f"  - {f}")
    print()

    rows = list(reader)
    print(f"{len(rows)} lignes au total.\n")

    print("=" * 70)
    print("Recherche des lignes pour Laval / Longueuil...")
    print("=" * 70)

    matches = []
    for row in rows:
        row_text = " ".join(str(v) for v in row.values()).lower()
        for city in TARGET_CITIES:
            if city.lower() in row_text:
                matches.append((city, row))
                break

    if not matches:
        print("Aucune ligne ne mentionne 'Laval' ou 'Longueuil' — vérifie les noms de colonnes ci-dessus,")
        print("le nom de la ville est peut-être orthographié différemment ou dans une colonne inattendue.")
    else:
        for city, row in matches[:10]:  # limite l'affichage aux 10 premiers résultats
            print(f"\n--- Correspondance pour '{city}' ---")
            for k, v in row.items():
                print(f"  {k}: {v}")
        if len(matches) > 10:
            print(f"\n... et {len(matches) - 10} autres lignes correspondantes.")

    print("\nTerminé. Copie-colle toute cette sortie dans le chat.")


if __name__ == "__main__":
    main()
