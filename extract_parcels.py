"""
extract_parcels.py — Extrait les polygones de lot (unités d'évaluation foncière)
correspondant à tes immeubles Montréal, à partir des données ouvertes de la Ville.

USAGE :
    pip install requests
    python3 extract_parcels.py

Doit être lancé depuis la racine du projet Terreno (là où se trouve data/properties.json).
Produit : data/parcels.json

NOTE : Ne couvre que les immeubles situés à Montréal. Laval et Longueuil ont leurs
propres portails géomatiques (ex. geomatique.longueuil.quebec) mais pas de
téléchargement en bloc équivalent trouvé — à investiguer séparément si besoin.
"""

import json
import os
import zipfile
import io
import urllib.request

MONTREAL_GEOJSON_ZIP_URL = (
    "https://donnees.montreal.ca/dataset/4ad6baea-4d2c-460f-a8bf-5d000db498f7/"
    "resource/866a3dbc-8b59-48ff-866d-f2f9d3bbee9d/download/uniteevaluationfonciere.geojson.zip"
)

PROPERTIES_PATH = "data/properties.json"
OUTPUT_PATH = "data/parcels.json"
NEAREST_FALLBACK_METERS = 60  # si aucun polygone ne contient le point, prendre le plus proche dans ce rayon


def download_and_extract_geojson(url):
    print(f"Téléchargement de {url} ...")
    with urllib.request.urlopen(url) as resp:
        data = resp.read()
    print(f"  {len(data) / 1_000_000:.1f} Mo téléchargés. Extraction du zip...")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        geojson_names = [n for n in zf.namelist() if n.lower().endswith(".geojson") or n.lower().endswith(".json")]
        if not geojson_names:
            raise RuntimeError("Aucun fichier .geojson trouvé dans le zip téléchargé.")
        with zf.open(geojson_names[0]) as f:
            print(f"  Lecture de {geojson_names[0]} ...")
            return json.load(f)


def polygon_bbox(geometry):
    """Retourne (minx, miny, maxx, maxy) pour un Polygon ou MultiPolygon GeoJSON."""
    coords = geometry["coordinates"]
    rings = coords if geometry["type"] == "MultiPolygon" else [coords]
    xs, ys = [], []
    for poly in rings:
        for ring in poly:
            for x, y in ring:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def point_in_ring(x, y, ring):
    """Ray casting standard pour un seul anneau (liste de [lng, lat])."""
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
        # poly[0] = anneau extérieur, poly[1:] = trous
        if point_in_ring(x, y, poly[0]):
            hole_hit = any(point_in_ring(x, y, hole) for hole in poly[1:])
            if not hole_hit:
                return True
    return False


def centroid(geometry):
    coords = geometry["coordinates"]
    polys = coords if geometry["type"] == "MultiPolygon" else [coords]
    xs, ys, n = 0.0, 0.0, 0
    for poly in polys:
        for x, y in poly[0]:
            xs += x
            ys += y
            n += 1
    return (xs / n, ys / n) if n else (None, None)


def meters_between(lng1, lat1, lng2, lat2):
    import math
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def main():
    if not os.path.exists(PROPERTIES_PATH):
        raise SystemExit(f"Introuvable: {PROPERTIES_PATH}. Lance ce script depuis la racine du projet Terreno.")

    with open(PROPERTIES_PATH, encoding="utf-8") as f:
        properties = json.load(f)

    montreal_props = [p for p in properties if p.get("city") == "Montréal"]
    skipped = [p for p in properties if p.get("city") != "Montréal"]
    if skipped:
        print(f"Ignorés (hors Montréal, non couverts par ce script) : "
              f"{', '.join(p['id'] + ' - ' + p['city'] for p in skipped)}")

    geojson = download_and_extract_geojson(MONTREAL_GEOJSON_ZIP_URL)
    features = geojson["features"]
    print(f"{len(features)} unités d'évaluation chargées. Recherche des correspondances...")

    # Pré-calcul des bbox pour accélérer le filtrage
    indexed = []
    for feat in features:
        geom = feat.get("geometry")
        if not geom or geom["type"] not in ("Polygon", "MultiPolygon"):
            continue
        try:
            bbox = polygon_bbox(geom)
        except Exception:
            continue
        indexed.append((bbox, geom))

    results = []
    for p in montreal_props:
        lng, lat = p["lng"], p["lat"]
        match_geom = None

        # Passe 1 : containment strict (avec bbox comme filtre rapide)
        for (minx, miny, maxx, maxy), geom in indexed:
            if not (minx - 0.001 <= lng <= maxx + 0.001 and miny - 0.001 <= lat <= maxy + 0.001):
                continue
            if point_in_geometry(lng, lat, geom):
                match_geom = geom
                break

        # Passe 2 : repli sur le centroïde le plus proche si rien trouvé
        if not match_geom:
            best_dist = None
            for (minx, miny, maxx, maxy), geom in indexed:
                if not (minx - 0.002 <= lng <= maxx + 0.002 and miny - 0.002 <= lat <= maxy + 0.002):
                    continue
                cx, cy = centroid(geom)
                if cx is None:
                    continue
                d = meters_between(lng, lat, cx, cy)
                if d <= NEAREST_FALLBACK_METERS and (best_dist is None or d < best_dist):
                    best_dist = d
                    match_geom = geom

        if match_geom:
            results.append({"propertyId": p["id"], "geometry": match_geom})
            print(f"  ✓ {p['id']} — {p['addr']} : lot trouvé")
        else:
            print(f"  ✗ {p['id']} — {p['addr']} : aucun lot trouvé (à vérifier manuellement)")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)

    print(f"\n{len(results)}/{len(montreal_props)} immeubles montréalais associés à un lot.")
    print(f"Écrit dans {OUTPUT_PATH}")


if __name__ == "__main__":
    main()