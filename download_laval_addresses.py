"""
download_laval_addresses.py — Adresses civiques de Laval (open data municipal)

Télécharge le CSV officiel de la Ville de Laval (colonnes NO_CIVIQUE, RUE,
EX_VILLE, CIVIQUE, ALPHA, GENERIQUE, LIEN, TOPONYME, NOM_ADRESSE, WKT),
reprojette les points (NAD83 MTM zone 8, EPSG:32188) vers WGS84, et exporte
un GeoJSON prêt pour tippecanoe → upload Mapbox — même pipeline que tes
autres couches (ex: download_wildfire_regime_zones.py).

Dépendances : pyproj, requests  (pip install pyproj requests)

Usage :
    python download_laval_addresses.py
    tippecanoe -o laval_addresses.mbtiles -l laval_addresses -Z14 -z18 \
        --drop-densest-as-needed laval_addresses.geojson
    # puis upload sur Mapbox Studio, et colle l'id dans
    # CONFIG.addressLabelsTileset.id (config.js)
"""

import csv
import io
import re

import requests
from pyproj import Transformer

SOURCE_URL = "https://www.donneesquebec.ca/recherche/dataset/8cd81673-5b0b-4050-b4a6-aed80975158a/resource/d46d4a9e-aa71-45e2-b3ac-af701ab58582/download/adresse-civique.csv"
OUTPUT_GEOJSON = "laval_addresses.geojson"

# NAD83 MTM zone 8 (EPSG:32188) → WGS84 (EPSG:4326)
transformer = Transformer.from_crs("EPSG:32188", "EPSG:4326", always_xy=True)

WKT_POINT_RE = re.compile(r"POINT\s*\(\s*([\-\d.]+)\s+([\-\d.]+)\s*\)")


def download_csv():
    print(f"Téléchargement de {SOURCE_URL} ...")
    resp = requests.get(SOURCE_URL, timeout=180)
    resp.raise_for_status()
    # Le fichier commence par un BOM UTF-8 (﻿) — utf-8-sig le gère proprement
    return resp.content.decode("utf-8-sig")


def convert_to_geojson(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    features = []
    skipped = 0

    for row in reader:
        m = WKT_POINT_RE.search(row.get("WKT", ""))
        if not m:
            skipped += 1
            continue

        mtm_x, mtm_y = float(m.group(1)), float(m.group(2))
        lng, lat = transformer.transform(mtm_x, mtm_y)

        civique = (row.get("CIVIQUE") or "").strip()
        alpha = (row.get("ALPHA") or "").strip()
        civic_label = civique + alpha  # ex: "4056A"

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": {
                "civique": civic_label,
                "rue": row.get("RUE", ""),
                "secteur": row.get("EX_VILLE", ""),
                "nom_adresse": row.get("NOM_ADRESSE", "")
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}

    with open(OUTPUT_GEOJSON, "w", encoding="utf-8") as f:
        import json
        json.dump(geojson, f, ensure_ascii=False)

    print(f"Écrit : {OUTPUT_GEOJSON} ({len(features)} adresses, {skipped} lignes ignorées sans coordonnées)")


if __name__ == "__main__":
    csv_text = download_csv()
    convert_to_geojson(csv_text)
