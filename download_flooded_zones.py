"""
download_flooded_zones.py — Télécharge les polygones de zones inondables officielles du
Québec (BDZI), depuis le service REST du gouvernement (couche 22).

Ce service ne supporte pas f=geojson, ni la reprojection à la volée (outSR) — les
coordonnées sont dans le système Lambert du Québec (EPSG:32198), en mètres. On
télécharge donc le format natif Esri JSON, puis on reprojette avec GDAL/ogr2ogr.

USAGE :
    .venv/bin/python download_flooded_zones.py

Produit : flood_zones.geojson (à la racine du projet, en EPSG:4326)
"""

import json
import subprocess
import time
import urllib.request
import urllib.parse

SERVICE_URL = "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query"
ESRI_JSON_PATH = "flood_zones_esri.json"
OUTPUT_PATH = "flood_zones.geojson"
PAGE_SIZE = 100


def fetch_page(offset, page_size):
    params = {
        "where": "1=1",
        "outFields": "*",
        "f": "json",
        "resultOffset": str(offset),
        "resultRecordCount": str(page_size),
    }
    url = f"{SERVICE_URL}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"    ! Erreur HTTP {e.code} à l'offset {offset} : {body[:200]}")
        return None
    except Exception as e:
        print(f"    ! Erreur à l'offset {offset} : {e}")
        return None


def main():
    print("Téléchargement des zones inondables officielles du Québec (Esri JSON, par petits lots)...")
    all_features = []
    template = None
    offset = 0
    page_size = PAGE_SIZE
    consecutive_failures = 0

    while True:
        page = fetch_page(offset, page_size)

        if page is None or "error" in page:
            consecutive_failures += 1
            if page_size > 10:
                page_size = max(10, page_size // 2)
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
            print(f"  Terminé — {len(all_features)} zones au total.")
            break

        if template is None:
            template = {k: v for k, v in page.items() if k != "features"}

        all_features.extend(features)
        offset += len(features)
        print(f"  ... {len(all_features)} zones récupérées jusqu'ici")
        time.sleep(0.15)

    if not all_features:
        print("Aucune donnée récupérée — abandon.")
        return

    combined = dict(template or {})
    combined["features"] = all_features

    with open(ESRI_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False)
    print(f"\nÉcrit : {ESRI_JSON_PATH}")

    print("Conversion + reprojection (Lambert Québec → WGS84) avec ogr2ogr...")
    result = subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", OUTPUT_PATH, f"ESRIJSON:{ESRI_JSON_PATH}",
         "-s_srs", "EPSG:32198", "-t_srs", "EPSG:4326"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("  ! ogr2ogr a échoué :")
        print(result.stderr)
        return

    print(f"Écrit : {OUTPUT_PATH}")

    with open(OUTPUT_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    print(f"\n{len(geojson.get('features', []))} zones inondables dans le fichier final.")
    if geojson.get("features"):
        print("\nChamps disponibles :")
        for k, v in geojson["features"][0]["properties"].items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()