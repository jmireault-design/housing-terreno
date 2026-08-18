"""
download_contaminated_sites.py — Télécharge le répertoire des terrains contaminés
(GTC), couche "point" (ID 12), depuis le même service que les zones inondables.

Même méthode que download_flooded_zones.py : format Esri JSON natif (f=geojson
échoue sur ce service), conversion + reprojection avec GDAL, par petits lots au cas
où.

USAGE :
    .venv/bin/python download_contaminated_sites.py

Produit : contaminated_sites.geojson (à la racine du projet, en EPSG:4326)
"""

import json
import subprocess
import time
import urllib.request
import urllib.parse

SERVICE_URL = "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/12/query"
ESRI_JSON_PATH = "contaminated_sites_esri.json"
OUTPUT_PATH = "contaminated_sites.geojson"
PAGE_SIZE = 200


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
    print("Téléchargement du répertoire des terrains contaminés (Esri JSON, par petits lots)...")
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
            print(f"  Terminé — {len(all_features)} terrains au total.")
            break

        if template is None:
            template = {k: v for k, v in page.items() if k != "features"}

        all_features.extend(features)
        offset += len(features)
        print(f"  ... {len(all_features)} terrains récupérés jusqu'ici")
        time.sleep(0.15)

    if not all_features:
        print("Aucune donnée récupérée — abandon.")
        return

    combined = dict(template or {})
    combined["features"] = all_features

    with open(ESRI_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False)
    print(f"\nÉcrit : {ESRI_JSON_PATH}")

    print("Conversion + reprojection avec ogr2ogr...")
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
    print(f"\n{len(geojson.get('features', []))} terrains contaminés dans le fichier final.")
    if geojson.get("features"):
        print("\nChamps disponibles :")
        for k, v in geojson["features"][0]["properties"].items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
