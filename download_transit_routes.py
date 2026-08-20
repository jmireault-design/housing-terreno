"""
download_transit_routes.py — Télécharge des données GTFS (métro STM, trains exo) et
en extrait les tracés de lignes (une géométrie par ligne), filtrés par type de
transport (route_type GTFS standard : 0=tram, 1=métro, 2=train, 3=autobus).

USAGE :
    .venv/bin/python download_transit_routes.py

Produit :
    metro_stm.geojson       (lignes de métro STM)
    trains_exo.geojson      (lignes de trains de banlieue exo)
"""

import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict, Counter

SOURCES = [
    {
        "name": "Métro STM",
        "url": "https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip",
        "route_types": {"1"},  # 1 = métro/subway
        "output": "metro_stm.geojson",
    },
    {
        "name": "Trains exo",
        "url": "https://exo.quebec/xdata/trains/google_transit.zip",
        "route_types": {"2"},  # 2 = train/rail
        "output": "trains_exo.geojson",
    },
]


def read_csv_from_zip(z, filename):
    with z.open(filename) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def process_source(source):
    print(f"\n=== {source['name']} ===")
    print(f"Téléchargement : {source['url']}")

    req = urllib.request.Request(source["url"], headers={"User-Agent": "Mozilla/5.0 (Terreno data pipeline)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()

    z = zipfile.ZipFile(io.BytesIO(data))
    print(f"Fichiers dans l'archive : {z.namelist()}")

    routes = read_csv_from_zip(z, "routes.txt")
    trips = read_csv_from_zip(z, "trips.txt")
    shapes_rows = read_csv_from_zip(z, "shapes.txt")

    # Filtre les lignes selon le type demandé (métro, train, etc.)
    wanted_routes = {r["route_id"]: r for r in routes if r.get("route_type") in source["route_types"]}
    print(f"{len(wanted_routes)} ligne(s) trouvée(s) du type demandé (sur {len(routes)} au total).")

    # Pour chaque ligne, trouve le shape_id le plus utilisé (représentatif du tracé)
    route_shape_counts = defaultdict(Counter)
    for t in trips:
        rid = t.get("route_id")
        sid = t.get("shape_id")
        if rid in wanted_routes and sid:
            route_shape_counts[rid][sid] += 1

    # Regroupe les points de shapes.txt par shape_id, triés par séquence
    shape_points = defaultdict(list)
    for row in shapes_rows:
        shape_points[row["shape_id"]].append(row)
    for sid in shape_points:
        shape_points[sid].sort(key=lambda r: int(r["shape_pt_sequence"]))

    features = []
    for rid, route in wanted_routes.items():
        if not route_shape_counts[rid]:
            continue
        best_shape_id = route_shape_counts[rid].most_common(1)[0][0]
        points = shape_points.get(best_shape_id, [])
        if len(points) < 2:
            continue

        coords = [[float(p["shape_pt_lon"]), float(p["shape_pt_lat"])] for p in points]
        features.append({
            "type": "Feature",
            "properties": {
                "route_id": rid,
                "route_short_name": route.get("route_short_name", ""),
                "route_long_name": route.get("route_long_name", ""),
                "route_color": route.get("route_color", "") or "888888",
            },
            "geometry": {"type": "LineString", "coordinates": coords}
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(source["output"], "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"{len(features)} tracé(s) écrit(s) dans {source['output']}")
    for feat in features:
        p = feat["properties"]
        print(f"  - {p['route_short_name']} : {p['route_long_name']}")


def main():
    for source in SOURCES:
        try:
            process_source(source)
        except Exception as e:
            print(f"! Erreur pour {source['name']} : {e}")


if __name__ == "__main__":
    main()
