# Terreno — carte des garanties + Finances

Ce dossier est le dépôt **housing-terreno** (commit « 13th Commit ») auquel on a greffé **Terreno Finances** (version du 25 oct. 2026). Les deux outils vivent dans la même page : la carte Terreno à gauche, les finances à droite, et des liens dans les deux sens.

## Déployer

Même procédure qu'avant : pousser sur GitHub → Vercel (`middleware.js` garde la protection par mot de passe), ou Live Server sur `index.html`. Une connexion Internet est nécessaire (tuiles Mapbox, Google Street View, polices).

Pour fusionner dans ton dépôt : copie tout le dossier par-dessus. Tes fichiers d'origine sont intacts sauf `index.html` (remplacé). Fichiers ajoutés : `css/finances.css`, `css/app.css`, `js/finances.js`, `js/bridge.js`, `js/layout.js`, `data/seed.js`.

**Important** : les données de la carte (immeubles et prêts ajoutés depuis l'app) sont dans le `localStorage` de ton navigateur, par origine (`housing-terreno.vercel.app`). En déployant sur le même projet Vercel, tu les retrouves. Les données Finances se chargent une première fois depuis `data/seed.js` (le classeur) : ouvre ensuite ton `finances.json` / `terreno.json` dans **Configuration → Ouvrir un fichier** pour reprendre tes transactions.

## Disposition

- Boutons **Carte / Divisé / Finances** en haut à droite; poignée entre les deux colonnes pour ajuster la largeur (sur téléphone : Carte ou Finances, bouton flottant ⌖).
- À gauche, tout Terreno tel quel : Carte (filtres, lots, municipalités, risques, transport, Street View, recherche d'adresse ou de lot), Portfolio, Tableau de bord, Taux, Paramètres.
- À droite, tout Terreno Finances : Tableau de bord, Opérations, Prêts, Dossiers et immeubles, États financiers, Prévisions, Outils, Configuration.
- Un seul bouton de thème (Auto / Clair / Sombre) pilote les deux côtés.

## Une seule source pour les dossiers et les immeubles

Les **dossiers** et les **immeubles** sont ceux de la carte (`data/loans.json`, `data/properties.json` + modifications locales). L'onglet **Dossiers et immeubles** de Finances les affiche directement; pour les modifier, on passe par la carte (bouton *Modifier* → panneau Terreno). L'ancien import/export JSON entre les deux outils n'a plus de raison d'être.

Le lien avec un prêt Finances se fait par le **n° de dossier** : le prêt `L016` de la carte est le dossier n° 16, relié au prêt Finances dont le champ « N° de dossier » vaut 16.

## Liens carte ↔ finances

| Depuis | Action | Résultat |
| --- | --- | --- |
| Carte | clic sur un immeuble | panneau Terreno + bloc **Finances** (capital garanti, LTV, intérêt mensuel, arriérés, prêt relié et statut du dernier mois dû) |
| Carte | ouverture d'un prêt (panneau ou page de profil) | bloc **Finances** : solde au grand livre, dernier mois dû, arriérés, intérêts de l'année, bande des 12 derniers mois; boutons *Ouvrir dans Finances*, *Paiement reçu*, *État de compte* |
| Carte | pins et filtre « Paiement en retard » | un immeuble dont un prêt Finances a un mois en retard passe en rouge foncé, quel que soit son statut sur la carte |
| Finances › Prêts | ouverture d'un prêt | la carte cadre ses immeubles en garantie et ouvre le panneau du dossier; encadré « Dossier Terreno » dans le prêt (contact, prêteurs, taux, terme, immeubles, lots, matricules) |
| Finances › Dossiers et immeubles | tables | colonne *Prêt Finances* avec le statut du dernier mois dû; boutons ⌖ Carte et *Modifier* (ouvre le panneau Terreno) |
| Finances | dossier immeuble | valeur, capital garanti, LTV, dossiers et prêts reliés, arriérés, intérêts de l'année, cadastre, Street View |
| Finances › Tableau de bord | « Répartition géographique » | capital garanti, arriérés et retards par ville; clic = centrer la carte |
| Finances › Outils › Lettre d'approbation | « Remplir à partir d'un dossier » | lit les dossiers de la carte |

## Fichiers ajoutés

```
index.html        les deux apps dans une page (balisage Terreno + barre et colonne Finances)
css/finances.css  styles de Terreno Finances, limités à la colonne finances et aux fenêtres
css/app.css       disposition deux colonnes, blocs Finances dans les panneaux Terreno
js/bridge.js      pont : dossiers/immeubles dérivés de state.loans/state.properties (window.TFDossiers),
                  actions carte pour Finances (window.TMap), blocs Finances dans les panneaux, pins « en retard », thème
js/finances.js    Terreno Finances (quelques crochets vers window.TMap)
js/layout.js      modes Carte / Divisé / Finances, poignée de redimensionnement
data/seed.js      données Finances initiales (classeur)
```
