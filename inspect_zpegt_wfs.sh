#!/bin/bash
# inspect_zpegt_wfs.sh
# Liste les couches disponibles dans le service WFS du MTMD pour les zones
# potentiellement exposées aux glissements de terrain (ZPEGT), pour trouver le nom
# exact de la couche "surfacique" (polygones) avant de télécharger quoi que ce soit.
#
# USAGE :
#   chmod +x inspect_zpegt_wfs.sh
#   ./inspect_zpegt_wfs.sh

WFS_URL="WFS:https://ws.mapserver.transports.gouv.qc.ca/swtq"

echo "Interrogation du service WFS..."
echo ""
ogrinfo "$WFS_URL" | grep -i "zpegt\|glissement"

echo ""
echo "Cherche la couche dont le nom contient 'zpegt_cgt_s' (surfacique/polygones) ci-dessus."
