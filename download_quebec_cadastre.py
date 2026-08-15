"""
download_quebec_cadastre.py — Télécharge les VRAIS polygones du cadastre officiel du Québec
(ministère des Ressources naturelles) pour une zone donnée, via le service ArcGIS REST public.

Contrairement aux jeux de données municipaux (Montréal, Laval, etc. pris un par un), cette
source couvre TOUTE LA PROVINCE — il suffit de changer la zone (BBOX) ci-dessous pour
récupérer les polygones de n'importe quel coin du Québec, pas seulement Laval/Longueuil.

USAGE :
    .venv/bin/python download_quebec_cadastre.py

Produit : quebec_cadastre.geojson (à la racine du projet)

Pour changer la zone couverte, modifie BBOX ci-dessous :
    (min_longitude, min_latitude, max_longitude, max_latitude)
"""

import json
import time
import urllib.request
import urllib.parse

# Zone couverte : Montréal + Laval + Longueuil (même zone que le geocoder dans config.js).
# Change ces 4 valeurs pour couvrir une autre région du Québec.
BBOX = (-74.3, 45.3, -73.3, 45.8)  # (min_lng, min_lat, max_lng, max_lat)

SERVICE_URL = "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query"
PAGE_SIZE = 2000  # limite du service (MaxRecordCount)
OUTPUT_PATH = "quebec_cadastre.geojson"


def fetch_page(offset):
    params = {
        "where": "1=1",
        "outFields": "*",
        "f": "geojson",
        "geometry": ",".join(str(v) for v in BBOX),
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "outSR": "4326",
        "resultOffset": str(offset),
        "resultRecordCount": str(PAGE_SIZE),
    }
    url = f"{SERVICE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read())


def main():
    print(f"Zone interrogée (lng/lat) : {BBOX}")
    print(f"Service : {SERVICE_URL}\n")

    all_features = []
    offset = 0
    page = 1

    while True:
        print(f"Page {page} (offset {offset})...")
        data = fetch_page(offset)

        if "error" in data:
            raise SystemExit(f"Erreur du service ArcGIS : {data['error']}")

        features = data.get("features", [])
        all_features.extend(features)
        print(f"  {len(features)} polygones reçus (total cumulé : {len(all_features)})")

        if len(features) < PAGE_SIZE:
            break  # dernière page

        offset += PAGE_SIZE
        page += 1
        time.sleep(0.3)  # petite pause pour ne pas surcharger le service public

    geojson = {"type": "FeatureCollection", "features": all_features}

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"\nTerminé : {len(all_features)} polygones écrits dans {OUTPUT_PATH}")
    print("Tu peux maintenant lancer tippecanoe dessus, comme pour Montréal.")


if __name__ == "__main__":
    main()
