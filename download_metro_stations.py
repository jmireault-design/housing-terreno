"""
download_metro_stations.py — Extrait les stations de métro STM depuis le même
fichier GTFS que les lignes et les arrêts d'autobus (gtfs_stm.zip), en ne gardant
que les arrêts desservis par le métro (route_type=1).

USAGE :
    .venv/bin/python download_metro_stations.py

Produit : metro_stations_stm.geojson (à la racine du projet)
"""

import csv
import io
import json
import urllib.request
import zipfile

URL = "https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip"
OUTPUT_PATH = "metro_stations_stm.geojson"


def read_csv_from_zip(z, filename):
    with z.open(filename) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def main():
    print(f"Téléchargement : {URL}")
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (Terreno data pipeline)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()

    z = zipfile.ZipFile(io.BytesIO(data))

    print("Lecture des fichiers GTFS...")
    routes = read_csv_from_zip(z, "routes.txt")
    trips = read_csv_from_zip(z, "trips.txt")
    stop_times = read_csv_from_zip(z, "stop_times.txt")
    stops = read_csv_from_zip(z, "stops.txt")

    # Même logique que pour les arrêts d'autobus, mais filtrée sur route_type=1 (métro)
    metro_route_ids = {r["route_id"] for r in routes if r.get("route_type") == "1"}
    print(f"{len(metro_route_ids)} lignes de métro trouvées.")

    metro_trip_ids = {t["trip_id"] for t in trips if t.get("route_id") in metro_route_ids}
    print(f"{len(metro_trip_ids)} voyages de métro trouvés.")

    metro_stop_ids = set()
    for st in stop_times:
        if st.get("trip_id") in metro_trip_ids:
            metro_stop_ids.add(st.get("stop_id"))
    print(f"{len(metro_stop_ids)} stations de métro uniques trouvées.")

    features = []
    for s in stops:
        if s.get("stop_id") not in metro_stop_ids:
            continue
        try:
            lat = float(s["stop_lat"])
            lon = float(s["stop_lon"])
        except (ValueError, KeyError):
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "stop_name": s.get("stop_name", ""),
                "stop_code": s.get("stop_code", ""),
            },
            "geometry": {"type": "Point", "coordinates": [lon, lat]}
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"\nÉcrit : {OUTPUT_PATH} ({len(features)} stations)")


if __name__ == "__main__":
    main()
