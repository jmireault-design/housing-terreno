"""
join_cadastre_values.py — Associe chaque polygone de lot (quebec_cadastre.geojson) aux
vraies valeurs Terrain/Bâtiment/Total (matricule_values.geojson) via une jointure
spatiale (point-dans-polygone), puisque ces deux sources n'ont pas de clé commune
(le cadastre officiel n'a pas de numéro de matricule).

Utilise un index en grille (pas de dépendance externe type shapely/rtree) pour rester
raisonnablement rapide même avec ~1M polygones et ~1M points.

USAGE :
    .venv/bin/python join_cadastre_values.py

Produit : quebec_cadastre_with_values.geojson (à la racine du projet)
"""

import json
import time

CADASTRE_PATH = "quebec_cadastre.geojson"
VALUES_PATH = "matricule_values.geojson"
OUTPUT_PATH = "quebec_cadastre_with_values.geojson"

GRID_SIZE = 0.003  # ~250-300m à cette latitude — assez fin pour limiter les faux candidats


def grid_key(lng, lat):
    return (round(lng / GRID_SIZE), round(lat / GRID_SIZE))


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersect = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def point_in_geometry(x, y, geometry):
    coords = geometry["coordinates"]
    polys = coords if geometry["type"] == "MultiPolygon" else [coords]
    for poly in polys:
        if point_in_ring(x, y, poly[0]):
            if not any(point_in_ring(x, y, hole) for hole in poly[1:]):
                return True
    return False


def polygon_bbox(geometry):
    coords = geometry["coordinates"]
    polys = coords if geometry["type"] == "MultiPolygon" else [coords]
    xs, ys = [], []
    for poly in polys:
        for ring in poly:
            for x, y in ring:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def main():
    print(f"Chargement de {VALUES_PATH} ...")
    with open(VALUES_PATH, encoding="utf-8") as f:
        values_geojson = json.load(f)
    value_points = values_geojson["features"]
    print(f"  {len(value_points)} points de valeur chargés.")

    print("Indexation des points en grille...")
    grid = {}
    for feat in value_points:
        geom = feat.get("geometry")
        props = feat.get("properties") or {}
        if not geom or geom["type"] not in ("Point", "MultiPoint"):
            continue
        terrain = props.get("terrain") or 0
        batiment = props.get("batiment") or 0
        if not terrain and not batiment:
            continue
        # Point: coordinates = [lng, lat] ; MultiPoint: coordinates = [[lng, lat], ...]
        coord = geom["coordinates"][0] if geom["type"] == "MultiPoint" else geom["coordinates"]
        lng, lat = coord[0], coord[1]
        key = grid_key(lng, lat)
        grid.setdefault(key, []).append((lng, lat, terrain, batiment))
    print(f"  {sum(len(v) for v in grid.values())} points indexés (avec valeur non nulle).")

    print(f"\nChargement de {CADASTRE_PATH} (peut prendre un moment)...")
    with open(CADASTRE_PATH, encoding="utf-8") as f:
        cadastre_geojson = json.load(f)
    polygons = cadastre_geojson["features"]
    print(f"  {len(polygons)} polygones chargés.")

    print("\nJointure spatiale en cours...")
    start = time.time()
    matched = 0

    for i, feat in enumerate(polygons):
        if i % 100000 == 0 and i > 0:
            elapsed = time.time() - start
            print(f"  ... {i}/{len(polygons)} traités ({elapsed:.0f}s écoulées)")

        geom = feat.get("geometry")
        if not geom:
            continue

        minx, miny, maxx, maxy = polygon_bbox(geom)
        gx0, gy0 = grid_key(minx, miny)
        gx1, gy1 = grid_key(maxx, maxy)

        total_terrain, total_batiment, n_found = 0, 0, 0
        for gx in range(gx0 - 1, gx1 + 2):
            for gy in range(gy0 - 1, gy1 + 2):
                for lng, lat, terrain, batiment in grid.get((gx, gy), []):
                    if point_in_geometry(lng, lat, geom):
                        total_terrain += terrain
                        total_batiment += batiment
                        n_found += 1

        if n_found > 0:
            matched += 1
            feat["properties"]["terrain"] = total_terrain
            feat["properties"]["batiment"] = total_batiment
            feat["properties"]["valeur_totale"] = total_terrain + total_batiment
        else:
            feat["properties"]["terrain"] = 0
            feat["properties"]["batiment"] = 0
            feat["properties"]["valeur_totale"] = 0

    elapsed = time.time() - start
    print(f"\nTerminé en {elapsed:.0f}s : {matched}/{len(polygons)} polygones avec une valeur associée.")

    print(f"Écriture de {OUTPUT_PATH} ...")
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cadastre_geojson, f, ensure_ascii=False)

    print("Terminé.")


if __name__ == "__main__":
    main()