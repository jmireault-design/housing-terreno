"""
generate_lot_index.py — Génère un index compact (numéro de lot → coordonnées) à partir de
quebec_cadastre.geojson, pour permettre la recherche par numéro de lot dans l'app.

USAGE :
    .venv/bin/python generate_lot_index.py

Produit : data/lot_index.csv (à copier dans le dossier data/ du projet)

Note : ce script charge tout le GeoJSON en mémoire (1M+ polygones) — ça peut prendre
quelques minutes et utiliser plusieurs Go de RAM. C'est normal, laisse-le travailler.
"""

import json
import os

INPUT_PATH = "quebec_cadastre.geojson"
OUTPUT_PATH = "data/lot_index.csv"


def centroid(geometry):
    """Centroïde approximatif (moyenne des sommets de l'anneau extérieur)."""
    coords = geometry["coordinates"]
    polys = coords if geometry["type"] == "MultiPolygon" else [coords]
    xs, ys, n = 0.0, 0.0, 0
    for poly in polys:
        for x, y in poly[0]:
            xs += x
            ys += y
            n += 1
    return (xs / n, ys / n) if n else (None, None)


def normalize_lot_number(raw):
    """Retire les espaces (ex: '6 582 823' → '6582823') pour faciliter la recherche."""
    return "".join(str(raw).split())


def main():
    if not os.path.exists(INPUT_PATH):
        raise SystemExit(f"Introuvable: {INPUT_PATH}. Lance ce script depuis la racine du projet.")

    print(f"Chargement de {INPUT_PATH} (peut prendre quelques minutes)...")
    with open(INPUT_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson["features"]
    print(f"{len(features)} polygones chargés. Calcul des centroïdes...")

    entries = {}  # normalized_lot_number -> (lng, lat) ; garde la première occurrence
    skipped = 0

    for i, feat in enumerate(features):
        if i % 100000 == 0 and i > 0:
            print(f"  ... {i}/{len(features)} traités")

        props = feat.get("properties") or {}
        no_lot = props.get("NO_LOT")
        geom = feat.get("geometry")
        if not no_lot or not geom:
            skipped += 1
            continue

        key = normalize_lot_number(no_lot)
        if not key or key in entries:
            continue

        lng, lat = centroid(geom)
        if lng is None:
            skipped += 1
            continue

        entries[key] = (round(lng, 6), round(lat, 6))

    print(f"\n{len(entries)} numéros de lot uniques indexés ({skipped} ignorés).")
    print("Tri et écriture du fichier...")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        for key in sorted(entries.keys()):
            lng, lat = entries[key]
            f.write(f"{key},{lng},{lat}\n")

    size_mb = os.path.getsize(OUTPUT_PATH) / 1_000_000
    print(f"\nTerminé : {OUTPUT_PATH} ({size_mb:.1f} Mo)")


if __name__ == "__main__":
    main()
