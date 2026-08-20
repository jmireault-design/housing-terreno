"""
download_bus_stops.py — Extrait les arrêts d'autobus STM depuis le même fichier GTFS
que le métro (gtfs_stm.zip), en ne gardant que les arrêts réellement desservis par
au moins une ligne d'autobus (route_type=3), pas les stations de métro.

USAGE :
    .venv/bin/python download_bus_stops.py

Produit : bus_stops_stm.geojson (à la racine du projet)
"""

import csv
import io
import json
import urllib.request
import zipfile

URL = "https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip"
OUTPUT_PATH = "bus_stops_stm.geojson"


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

    # Trouve les route_id des lignes d'autobus (type 3), puis les trip_id qui leur
    # appartiennent, puis les stop_id desservis par ces trips.
    bus_route_ids = {r["route_id"] for r in routes if r.get("route_type") == "3"}
    print(f"{len(bus_route_ids)} lignes d'autobus trouvées.")

    bus_trip_ids = {t["trip_id"] for t in trips if t.get("route_id") in bus_route_ids}
    print(f"{len(bus_trip_ids)} voyages d'autobus trouvés.")

    bus_stop_ids = set()
    for st in stop_times:
        if st.get("trip_id") in bus_trip_ids:
            bus_stop_ids.add(st.get("stop_id"))
    print(f"{len(bus_stop_ids)} arrêts d'autobus uniques trouvés.")

    features = []
    for s in stops:
        if s.get("stop_id") not in bus_stop_ids:
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

    print(f"\nÉcrit : {OUTPUT_PATH} ({len(features)} arrêts)")


if __name__ == "__main__":
    main()
