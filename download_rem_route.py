"""
download_rem_route.py — Télécharge le tracé du REM (Réseau express métropolitain)
depuis OpenStreetMap (via l'API Overpass), puisqu'aucun lien de téléchargement GTFS
direct et fiable n'a été trouvé pour cet opérateur (CDPQ Infra, distinct de STM/exo).

USAGE :
    .venv/bin/python download_rem_route.py

Produit : rem_route.geojson (à la racine du projet)
"""

import json
import urllib.request
import urllib.parse

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Cherche toutes les relations de type "route" (train léger) appartenant au réseau REM
# Cherche toutes les relations de type "route" (train léger) appartenant au réseau REM,
# dans une boîte englobante autour du grand Montréal (plus fiable qu'une recherche par
# nom de région, qui est capricieuse avec les accents).
QUERY = """
[out:json][timeout:60];
(
  relation["route"="light_rail"]["network"~"REM|Réseau express métropolitain", i](45.2,-74.3,45.7,-73.2);
  relation["route"="light_rail"]["operator"~"REM|CDPQ", i](45.2,-74.3,45.7,-73.2);
);
out geom;
"""


def main():
    print("Interrogation de l'API Overpass (OpenStreetMap) pour le tracé du REM...")
    query_string = urllib.parse.urlencode({"data": QUERY})
    full_url = f"{OVERPASS_URL}?{query_string}"
    req = urllib.request.Request(
        full_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"! Erreur HTTP {e.code} : {body[:1000]}")
        return
    elements = result.get("elements", [])
    print(f"{len(elements)} relation(s) trouvée(s).")

    features = []
    for el in elements:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags", {})
        name = tags.get("name", "REM")
        colour = tags.get("colour", "").lstrip("#") or "6B2C91"

        for member in el.get("members", []):
            if member.get("type") != "way" or "geometry" not in member:
                continue
            coords = [[pt["lon"], pt["lat"]] for pt in member["geometry"]]
            if len(coords) < 2:
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "route_long_name": name,
                    "route_color": colour,
                },
                "geometry": {"type": "LineString", "coordinates": coords}
            })

    geojson = {"type": "FeatureCollection", "features": features}
    with open("rem_route.geojson", "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"{len(features)} segment(s) écrit(s) dans rem_route.geojson")

    if not features:
        print("\n! Aucun segment trouvé — la requête Overpass n'a peut-être pas matché.")
        print("  Réponse brute (premiers 500 caractères) :")
        print(json.dumps(result, ensure_ascii=False)[:500])


if __name__ == "__main__":
    main()