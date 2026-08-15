"""
inspect_municipality_service.py — Trouve l'identifiant exact de la couche "Municipalité"
dans le service REST des découpages administratifs du Québec.

USAGE :
    .venv/bin/python inspect_municipality_service.py
"""

import json
import urllib.request

SERVICE_URL = "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer"


def main():
    print(f"Interrogation de {SERVICE_URL} ...\n")
    url = f"{SERVICE_URL}?f=json"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)

    print("Couches disponibles dans ce service :\n")
    for layer in data.get("layers", []):
        print(f"  ID {layer['id']:3d} — {layer['name']}")

    print("\nCherche la couche dont le nom contient 'Municipalit' ci-dessus, et note son ID.")


if __name__ == "__main__":
    main()
