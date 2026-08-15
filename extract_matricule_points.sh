#!/bin/bash
# extract_matricule_points.sh
# Extrait les points matricule (mat18 + code_mun) du GPKG provincial déjà téléchargé,
# filtré à la même zone que le cadastre (Montréal + Laval + Longueuil), en gardant
# seulement les champs nécessaires. Rapide : tout se fait localement avec GDAL,
# pas de retéléchargement.
#
# USAGE :
#   chmod +x extract_matricule_points.sh
#   ./extract_matricule_points.sh
#
# Prérequis : le dossier role2026_gpkg (déjà présent si tu as lancé
# download_and_inspect_quebec_gpkg.sh plus tôt)

set -e

GPKG_FILE=$(find role2026_gpkg -iname "*.gpkg" | head -n 1)

if [ -z "$GPKG_FILE" ]; then
  echo "ERREUR : role2026_gpkg/*.gpkg introuvable."
  echo "Relance d'abord download_and_inspect_quebec_gpkg.sh si tu as supprimé ce dossier."
  exit 1
fi

echo "Fichier source : $GPKG_FILE"
echo "Extraction des points matricule (zone Montréal + Laval + Longueuil)..."

ogr2ogr -f GeoJSON matricule_points.geojson "$GPKG_FILE" rol_unite_p_2026 \
  -spat -74.3 45.3 -73.3 45.8 -spat_srs EPSG:4326 \
  -select mat18,code_mun \
  -t_srs EPSG:4326

echo ""
echo "Terminé : matricule_points.geojson créé."
ls -lh matricule_points.geojson
