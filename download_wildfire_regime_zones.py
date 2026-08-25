"""
download_wildfire_regime_zones.py — Zonage des régimes de feux du Québec méridional (MRNF)

Télécharge le FGDB officiel, extrait la couche de zonage, reprojette en WGS84
et exporte un GeoJSON prêt pour tippecanoe → upload Mapbox (même pipeline que
download_flooded_zones.py / download_coastal_erosion.py).

Dépendances : geopandas, fiona  (pip install geopandas fiona)

Usage :
    python download_wildfire_regime_zones.py
    tippecanoe -o wildfire_regime.mbtiles -l wildfire_regime -Z4 -z12 --drop-densest-as-needed wildfire_regime.geojson
    # puis upload du .mbtiles sur ton compte Mapbox (mapbox.com/studio/tilesets)
    # et colle l'id résultant dans CONFIG.wildfireRegimeTileset.id (config.js)

Note : ce zonage couvre le Québec forestier sous aménagement — il ne couvre PAS
la grande région de Montréal/Laval/Longueuil (zone urbaine/agricole, hors du
domaine forestier commercial). Il apparaîtra donc probablement vide pour la
plupart de ton portefeuille — normal, pas une erreur de la couche.
"""

import io
import os
import zipfile

import geopandas as gpd
import requests

SOURCE_URL = "https://diffusion.mffp.gouv.qc.ca/Diffusion/DonneeGratuite/Foret/PERTURBATIONS_NATURELLES/Feux_foret/02-Donnees/PROV/REGIME_FEUX.zip"
OUTPUT_GEOJSON = "wildfire_regime.geojson"
WORK_DIR = "wildfire_regime_src"


def download_and_extract():
    print(f"Téléchargement de {SOURCE_URL} ...")
    resp = requests.get(SOURCE_URL, timeout=180)
    resp.raise_for_status()

    os.makedirs(WORK_DIR, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        z.extractall(WORK_DIR)
    print(f"Extrait dans {WORK_DIR}/")


def find_gdb_path():
    for root, dirs, _ in os.walk(WORK_DIR):
        for d in dirs:
            if d.lower().endswith(".gdb"):
                return os.path.join(root, d)
    raise FileNotFoundError("Aucun dossier .gdb trouvé après extraction — vérifie le contenu du zip.")


def convert_to_geojson():
    gdb_path = find_gdb_path()
    print(f"Géodatabase trouvée : {gdb_path}")

    layers = gpd.list_layers(gdb_path)
    print("Couches disponibles :")
    print(layers)

    # La couche de zonage porte généralement un nom contenant "REGIME" ou "ZONE" —
    # ajuste ce filtre selon ce qu'affiche la liste ci-dessus si besoin.
    layer_name = next(
        (name for name in layers["name"] if "regime" in name.lower() or "zone" in name.lower()),
        layers["name"].iloc[0]
    )
    print(f"Lecture de la couche : {layer_name}")

    gdf = gpd.read_file(gdb_path, layer=layer_name)
    gdf = gdf.to_crs(epsg=4326)  # reprojection vers WGS84 (lng/lat), requis pour tippecanoe/Mapbox

    # Simplifie légèrement la géométrie — ces polygones régionaux sont très détaillés
    # et n'ont pas besoin de cette précision pour un usage web.
    gdf["geometry"] = gdf["geometry"].simplify(0.0005, preserve_topology=True)

    gdf.to_file(OUTPUT_GEOJSON, driver="GeoJSON")
    print(f"Écrit : {OUTPUT_GEOJSON} ({len(gdf)} zones)")


if __name__ == "__main__":
    download_and_extract()
    convert_to_geojson()