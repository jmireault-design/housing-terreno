"""
download_montreal_geojson.py — Télécharge et sauvegarde sur disque le GeoJSON complet
des unités d'évaluation foncière de Montréal (pour conversion en tuiles vectorielles
avec tippecanoe).

USAGE :
    .venv/bin/python download_montreal_geojson.py

Produit : montreal_parcels_raw.geojson (à la racine du projet)
"""

import io
import zipfile
import urllib.request

MONTREAL_GEOJSON_ZIP_URL = (
    "https://donnees.montreal.ca/dataset/4ad6baea-4d2c-460f-a8bf-5d000db498f7/"
    "resource/866a3dbc-8b59-48ff-866d-f2f9d3bbee9d/download/uniteevaluationfonciere.geojson.zip"
)

OUTPUT_PATH = "montreal_parcels_raw.geojson"


def main():
    print(f"Téléchargement de {MONTREAL_GEOJSON_ZIP_URL} ...")
    with urllib.request.urlopen(MONTREAL_GEOJSON_ZIP_URL) as resp:
        data = resp.read()
    print(f"  {len(data) / 1_000_000:.1f} Mo téléchargés. Extraction du zip...")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        geojson_names = [n for n in zf.namelist() if n.lower().endswith((".geojson", ".json"))]
        if not geojson_names:
            raise RuntimeError("Aucun fichier .geojson trouvé dans le zip téléchargé.")
        name = geojson_names[0]
        print(f"  Écriture de {name} → {OUTPUT_PATH} ...")
        with zf.open(name) as src, open(OUTPUT_PATH, "wb") as dst:
            # Copie par blocs pour éviter de tout charger en mémoire d'un coup
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)

    print(f"\nTerminé : {OUTPUT_PATH}")
    print("Tu peux maintenant lancer tippecanoe dessus.")


if __name__ == "__main__":
    main()