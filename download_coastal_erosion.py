"""
download_coastal_erosion.py — Télécharge les zones de contraintes relatives à
l'érosion côtière et aux mouvements de terrain, depuis le même service que les
glissements de terrain (ZPEGT), au format GeoJSON déjà en WGS84.

USAGE :
    .venv/bin/python download_coastal_erosion.py

Produit : coastal_erosion.geojson (à la racine du projet)
"""

import json
import urllib.request

URL = (
    "https://geoegl.msp.gouv.qc.ca/apis/wss/aleas.fcgi"
    "?service=wfs&version=1.1.0&request=getfeature"
    "&typename=dpp_zemt_zones_contraintes_s&outputformat=geojson&srsName=epsg:4326"
)
OUTPUT_PATH = "coastal_erosion.geojson"


def main():
    print("Téléchargement des zones d'érosion côtière...")
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (Terreno data pipeline)"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"! Erreur HTTP {e.code} : {body[:1000]}")
        return

    features = data.get("features", [])
    print(f"{len(features)} zones téléchargées.")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"Écrit : {OUTPUT_PATH}")

    if features:
        print("\nChamps disponibles (première zone) :")
        for k, v in features[0]["properties"].items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
