#!/bin/bash
# extract_matricule_values.sh
# Enrichit les points matricule avec les vraies valeurs Terrain / Bâtiment / Total
# (codes officiels RL0402A / RL0403A / RL0404A), ET le secteur / type de propriété
# (RL0107A / RL0105A) pour permettre la comparaison à la moyenne du secteur.
#
# USAGE :
#   chmod +x extract_matricule_values.sh
#   ./extract_matricule_values.sh
#
# Prérequis : le dossier role2026_gpkg (déjà présent si tu as lancé
# download_and_inspect_quebec_gpkg.sh plus tôt). Rien n'est retéléchargé.

set -e

GPKG_FILE=$(find role2026_gpkg -iname "*.gpkg" | head -n 1)

if [ -z "$GPKG_FILE" ]; then
  echo "ERREUR : role2026_gpkg/*.gpkg introuvable."
  echo "Relance d'abord download_and_inspect_quebec_gpkg.sh si tu as supprimé ce dossier."
  exit 1
fi

echo "Fichier source : $GPKG_FILE"
echo "Jointure locale (points + valeurs + secteur/type) sur la zone Montréal + Laval + Longueuil..."

ogr2ogr -f GeoJSON matricule_values.geojson "$GPKG_FILE" \
  -dialect SQLite \
  -sql "SELECT p.mat18 AS mat18, p.code_mun AS code_mun, v.rl0402a AS terrain, v.rl0403a AS batiment, v.rl0404a AS valeur_totale, v.rl0107a AS secteur, v.rl0105a AS type_propriete, p.geom AS geom FROM rol_unite_p_2026 p LEFT JOIN b05v_unite_evaln_2026 v ON p.mat18 = v.mat18 WHERE p.geom IS NOT NULL" \
  -spat -74.3 45.3 -73.3 45.8 \
  -t_srs EPSG:4326

echo ""
echo "Terminé : matricule_values.geojson créé (avec secteur/type_propriete)."
ls -lh matricule_values.geojson