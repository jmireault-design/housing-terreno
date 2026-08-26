"""
download_rqa_addresses.py — Référentiel québécois des adresses (RQA), filtré
sur la région de Montréal (rive-nord + rive-sud + Laval + Longueuil, etc.)

Le fichier source couvre tout le Québec (3,6M adresses, 596 Mo compressé) —
ce script télécharge en streaming, lit le CSV ligne par ligne (jamais tout
en mémoire), et ne garde que les adresses dans la zone d'intérêt (même bbox
que CONFIG.map.bbox dans config.js). Résultat attendu : quelques centaines
de milliers d'adresses, largement gérable pour tippecanoe.

Ce fichier remplace laval_addresses.geojson — une fois généré et uploadé,
CONFIG.addressLabelsTileset peut pointer directement dessus (plus besoin
de la couche Laval séparée, sauf si tu préfères les garder distinctes).

Dépendances : requests  (pip install requests)

Usage :
    python download_rqa_addresses.py
    tippecanoe -o rqa_addresses.mbtiles -l addresses -Z14 -z16 \
        --drop-densest-as-needed --force rqa_addresses.geojson
    # puis upload sur Mapbox Studio, colle l'id dans
    # CONFIG.addressLabelsTileset.id (config.js)
"""

import csv
import io
import json
import os
import zipfile

import requests

SOURCE_URL = "https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Local/RQA/CSV/RQA_CSV.zip"
ZIP_PATH = "RQA_CSV.zip"
OUTPUT_GEOJSON = "rqa_addresses.geojson"

# Même zone que CONFIG.map.bbox (config.js) : Montréal + Laval + Longueuil +
# rive-nord/rive-sud environnantes. Ajuste si tu veux élargir/rétrécir.
BBOX = {"min_lng": -74.3, "min_lat": 45.3, "max_lng": -73.3, "max_lat": 45.8}

# Colonnes réelles du RQA (confirmées à partir d'un vrai fichier téléchargé —
# voir la liste complète en commentaire ci-dessous si jamais elles changent) :
#   identifiant_unique_adresse, date_diffusion_version, date_creation, date_modification,
#   date_fin, numero_municipal, numero_municipal_suffixe, numero_unite, type_unite,
#   code_postal, seqodo, generique_odonyme, particule_odonyme, specifique_odonyme,
#   point_cardinal_odonyme, odonyme_recompose_normal, odonyme_recompose_court,
#   odonyme_recompose_long, odonyme_recompose_tri, discriminant_odonyme,
#   odonyme_officiel_ctop, renvoi_seqodo, renvoi_specifique_odonyme, adresse_formatee,
#   qualite_positionnement_geometrique, etat, code_utilisation, categorie, nombre_unite,
#   numero_lot, matricule_unite_evaluation, nosqnocivq, caracteristique_adresse,
#   code_region_administrative, nom_region_administrative, code_mrc, nom_mrc,
#   code_municipalite, nom_municipalite, nom_municipalite_complet, code_arrondissement,
#   nom_arrondissement, code_communaute_metropolitaine, nom_communaute_metropolitaine,
#   identifiant_reseau_routier, cote_route, longitude, latitude
#
# Attention : "odonyme_recompose_long" contient le mot "long" mais n'a rien à voir
# avec la longitude géographique — d'où le passage à des noms fixes plutôt qu'à
# une détection floue par mots-clés.
COLUMNS = {
    "civique": "numero_municipal",
    "suffixe": "numero_municipal_suffixe",
    "rue": "odonyme_recompose_court",
    "municipalite": "nom_municipalite",
    "lat": "latitude",
    "lng": "longitude"
}


def download_zip():
    if os.path.exists(ZIP_PATH):
        print(f"{ZIP_PATH} déjà présent, téléchargement sauté (supprime le fichier pour forcer).")
        return
    print(f"Téléchargement de {SOURCE_URL} (596 Mo — patience) ...")
    with requests.get(SOURCE_URL, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        with open(ZIP_PATH, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                if total:
                    pct = written / total * 100
                    print(f"\r  {written // (1024*1024)} Mo / {total // (1024*1024)} Mo ({pct:.1f}%)", end="")
        print()
    print("Téléchargement terminé.")


def find_csv_name(zf):
    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if not csv_names:
        raise FileNotFoundError("Aucun fichier .csv trouvé dans l'archive.")
    return csv_names[0]


def convert():
    with zipfile.ZipFile(ZIP_PATH) as zf:
        csv_name = find_csv_name(zf)
        print(f"Fichier CSV dans l'archive : {csv_name}")

        with zf.open(csv_name) as raw:
            text_stream = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace")
            reader = csv.DictReader(text_stream)

            missing = [f for f, col in COLUMNS.items() if col not in reader.fieldnames]
            if missing:
                raise RuntimeError(
                    f"Colonnes attendues introuvables dans le fichier : {missing}. "
                    f"Colonnes disponibles : {reader.fieldnames}"
                )
            print("Colonnes utilisées :", COLUMNS)

            features = []
            total_rows = 0
            kept = 0

            for row in reader:
                total_rows += 1
                if total_rows % 500000 == 0:
                    print(f"  ... {total_rows} lignes lues, {kept} retenues")

                try:
                    lat = float(row[COLUMNS["lat"]])
                    lng = float(row[COLUMNS["lng"]])
                except (ValueError, TypeError, KeyError):
                    continue

                if not (BBOX["min_lat"] <= lat <= BBOX["max_lat"] and BBOX["min_lng"] <= lng <= BBOX["max_lng"]):
                    continue

                civique = (row.get(COLUMNS["civique"], "") or "").strip()
                suffixe = (row.get(COLUMNS["suffixe"], "") or "").strip()

                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "properties": {
                        "civique": civique + suffixe,
                        "rue": row.get(COLUMNS["rue"], "") or "",
                        "municipalite": row.get(COLUMNS["municipalite"], "") or ""
                    }
                })
                kept += 1

            print(f"\nTerminé : {total_rows} lignes lues au total, {kept} adresses dans la zone d'intérêt.")

    geojson = {"type": "FeatureCollection", "features": features}
    with open(OUTPUT_GEOJSON, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    print(f"Écrit : {OUTPUT_GEOJSON}")


if __name__ == "__main__":
    download_zip()
    convert()
