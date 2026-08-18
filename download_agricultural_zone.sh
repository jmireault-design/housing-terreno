#!/bin/bash
# download_agricultural_zone.sh
# Télécharge les limites de la zone agricole protégée du Québec (CPTAQ), transposée
# au cadastre. Fichier SHP direct (34,5 Mo), avec sa propre projection intégrée.
#
# USAGE :
#   chmod +x download_agricultural_zone.sh
#   ./download_agricultural_zone.sh

set -e

ZIP_URL="https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip"
OUTPUT="agricultural_zone.geojson"

echo "Téléchargement de la zone agricole (CPTAQ)..."
curl -L -o za_transposee.zip "$ZIP_URL"

echo "Décompression..."
rm -rf za_transposee_extracted
mkdir za_transposee_extracted
unzip -q za_transposee.zip -d za_transposee_extracted

SHP_FILE=$(find za_transposee_extracted -iname "*.shp" | head -n 1)
if [ -z "$SHP_FILE" ]; then
  echo "ERREUR : aucun fichier .shp trouvé dans l'archive."
  exit 1
fi

echo "Fichier trouvé : $SHP_FILE"
echo "Conversion en GeoJSON (WGS84)..."

ogr2ogr -f GeoJSON "$OUTPUT" "$SHP_FILE" -t_srs EPSG:4326

echo ""
echo "Terminé : $OUTPUT"
ls -lh "$OUTPUT"
