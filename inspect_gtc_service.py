"""
inspect_gtc_service.py — Liste les sous-couches du groupe "GTC - Répertoire des
terrains contaminés" (ID 4), pour trouver la bonne (probablement des points),
avant de télécharger quoi que ce soit.

USAGE :
    .venv/bin/python inspect_gtc_service.py
"""

import json
import urllib.request

SERVICE_URL = "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/4"


def main():
    print(f"Interrogation de {SERVICE_URL} ...\n")
    url = f"{SERVICE_URL}?f=json"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)

    print(f"Couche parent : {data.get('name')}\n")
    print("Sous-couches :\n")
    for sub in data.get("subLayers", []):
        print(f"  ID {sub['id']:3d} — {sub['name']}")

    print("\nCherche celle dont le nom contient 'point' ci-dessus, et note son ID.")


if __name__ == "__main__":
    main()
