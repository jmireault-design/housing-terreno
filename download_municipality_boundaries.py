"""
download_municipality_boundaries.py — Télécharge les limites de toutes les municipalités
du Québec (polygones), depuis le service REST officiel du gouvernement (couche ID 2).

Certaines municipalités (ex. Shannon, Port-Daniel–Gascons) ont des frontières tellement
détaillées que même de petits lots peuvent dépasser la limite de taille du serveur —
on avance donc par lots de 25, et on incrémente l'offset selon ce qui a vraiment été
reçu (pas un nombre fixe), pour ne jamais sauter ou dupliquer de municipalité.

USAGE :
    .venv/bin/python download_municipality_boundaries.py

Produit : municipality_boundaries.geojson (à la racine du projet)
"""

import json
import subprocess
import time
import urllib.request
import urllib.parse

SERVICE_URL = "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer/2/query"
ESRI_JSON_PATH = "municipality_boundaries_esri.json"
OUTPUT_PATH = "municipality_boundaries.geojson"
PAGE_SIZE = 25


def fetch_page(offset, page_size):
    params = {
        "where": "1=1",
        "outFields": "MUS_NM_MUN,MUS_NM_MRC,MUS_NM_REG,MUS_CO_GEO",
        "f": "json",
        "outSR": "4326",
        "resultOffset": str(offset),
        "resultRecordCount": str(page_size),
        "orderByFields": "OBJECTID",
    }
    url = f"{SERVICE_URL}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"    ! Erreur HTTP {e.code} à l'offset {offset} : {body[:200]}")
        return None


def main():
    print("Téléchargement des limites municipales du Québec (par petits lots)...")
    all_features = []
    template = None
    offset = 0
    page_size = PAGE_SIZE
    consecutive_failures = 0

    while True:
        page = fetch_page(offset, page_size)

        if page is None:
            consecutive_failures += 1
            if page_size > 5:
                page_size = max(5, page_size // 2)
                print(f"    ... réduction du lot à {page_size} et nouvel essai")
                continue
            if consecutive_failures >= 3:
                print(f"    ! Trop d'échecs à l'offset {offset}, arrêt.")
                break
            time.sleep(2)
            continue

        consecutive_failures = 0
        features = page.get("features", [])
        if not features:
            print(f"  Terminé — {len(all_features)} municipalités au total.")
            break

        if template is None:
            template = {k: v for k, v in page.items() if k != "features"}

        all_features.extend(features)
        offset += len(features)
        print(f"  ... {len(all_features)} municipalités récupérées jusqu'ici")
        time.sleep(0.15)

    if not all_features:
        print("Aucune donnée récupérée — abandon.")
        return

    combined = dict(template or {})
    combined["features"] = all_features

    with open(ESRI_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False)
    print(f"\nÉcrit : {ESRI_JSON_PATH}")

    print("Conversion en GeoJSON avec ogr2ogr...")
    result = subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", OUTPUT_PATH, f"ESRIJSON:{ESRI_JSON_PATH}"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("  ! ogr2ogr a échoué :")
        print(result.stderr)
        return

    print(f"Écrit : {OUTPUT_PATH}")

    with open(OUTPUT_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    print(f"\n{len(geojson.get('features', []))} municipalités dans le fichier final.")
    if geojson.get("features"):
        print("\nChamps disponibles :")
        for k, v in geojson["features"][0]["properties"].items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()