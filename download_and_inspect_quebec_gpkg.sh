#!/bin/bash
# download_and_inspect_quebec_gpkg.sh
# Télécharge le rôle d'évaluation foncière géoréférencé du Québec (GPKG, ~573 Mo),
# puis affiche la structure du fichier (couches + champs) pour qu'on puisse ensuite
# filtrer précisément Laval (65005) et Longueuil (58227) sans deviner les noms de colonnes.
#
# USAGE :
#   chmod +x download_and_inspect_quebec_gpkg.sh
#   ./download_and_inspect_quebec_gpkg.sh
#
# Prérequis : gdal (brew install gdal), curl, unzip (déjà sur macOS)

set -e

URL="https://donneesouvertes.affmunqc.net/role/ROLE2026_GEOPACKAGE.zip"
ZIP_FILE="ROLE2026_GEOPACKAGE.zip"
EXTRACT_DIR="role2026_gpkg"

echo "Téléchargement de $URL ..."
echo "(573 Mo — ça peut prendre plusieurs minutes selon ta connexion)"
curl -L -o "$ZIP_FILE" "$URL" --progress-bar

echo ""
echo "Décompression..."
mkdir -p "$EXTRACT_DIR"
unzip -o "$ZIP_FILE" -d "$EXTRACT_DIR" > /dev/null

GPKG_FILE=$(find "$EXTRACT_DIR" -iname "*.gpkg" | head -n 1)

if [ -z "$GPKG_FILE" ]; then
  echo "ERREUR : aucun fichier .gpkg trouvé dans l'archive extraite."
  echo "Contenu du dossier extrait :"
  find "$EXTRACT_DIR" -type f
  exit 1
fi

echo ""
echo "Fichier GeoPackage trouvé : $GPKG_FILE"
echo ""
echo "======================================================================"
echo "Structure du fichier (couches + champs) :"
echo "======================================================================"
ogrinfo -so -al "$GPKG_FILE" | head -n 100

echo ""
echo "======================================================================"
echo "Terminé. Copie-colle toute cette sortie (surtout la liste des champs) dans le chat."
echo "======================================================================"
