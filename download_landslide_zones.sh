#!/bin/bash
# download_landslide_zones.sh
# Télécharge les zones potentiellement exposées aux glissements de terrain (ZPEGT),
# limité à la grande région autour de Montréal / Laurentides / Lanaudière / Montérégie.
#
# USAGE :
#   chmod +x download_landslide_zones.sh
#   ./download_landslide_zones.sh

set -e

WFS_URL="WFS:https://ws.mapserver.transports.gouv.qc.ca/swtq"
LAYER="ms:zpegt_cgt_s"
OUTPUT="landslide_zones.geojson"

# Boîte englobante généreuse : Montréal, Laurentides, Lanaudière, Montérégie
# (xmin ymin xmax ymax, en WGS84) — on précise -spat_srs explicitement cette fois,
# sinon GDAL peut mal interpréter dans quel système sont ces nombres.
BBOX="-76.5 44.8 -72.0 46.5"

echo "Téléchargement des zones de glissements de terrain (région élargie autour de Montréal)..."

ogr2ogr -f GeoJSON "$OUTPUT" "$WFS_URL" "$LAYER" \
  -spat $BBOX \
  -spat_srs EPSG:4326 \
  -t_srs EPSG:4326

echo ""
echo "Terminé : $OUTPUT"
ls -lh "$OUTPUT"
