# Terreno

Suivi cartographique de prêts garantis par immeubles. Chaque prêt peut être garanti par **plusieurs immeubles**, et chaque immeuble peut garantir **plusieurs prêts** (relation N:N). Le tout visible sur une carte, avec un portfolio à deux onglets (Prêts / Immeubles) et un tableau de bord de risque.

## Structure du projet

```
terreno/
├── index.html              Balisage
├── README.md
│
├── css/
│   └── styles.css
│
├── data/
│   ├── properties.json     Immeubles physiques
│   └── loans.json          Prêts + collatéral (liaison prêt↔immeuble)
│
└── js/
    ├── config.js           Clés API, statuts, options
    ├── format.js           fmtK, ltv, calculs
    ├── state.js            État central + index dérivés
    ├── data.js             Chargement JSON + construction des index
    ├── panel.js            Panneau : immeuble (montre prêts) / prêt (montre immeubles)
    ├── map.js              Mapbox, clustering, cadrage multi-immeubles
    ├── portfolio.js        Deux sous-onglets Prêts / Immeubles
    ├── dashboard.js        Métriques basées sur les prêts (pas de double-comptage)
    └── app.js              Initialisation
```

## Modèle de données

### `data/properties.json` — les immeubles physiques
Un immeuble n'a pas de statut ni de garantie propre. Il porte seulement ses caractéristiques physiques et de valeur.

```json
{
  "id": "P001",
  "addr": "4521 Rue Saint-Denis",
  "city": "Montréal",
  "type": "Duplex",
  "owner": "Marc Tremblay",
  "value": 1240000,
  "lng": -73.5772,
  "lat": 45.5310
}
```

### `data/loans.json` — les prêts + leur collatéral
Chaque prêt contient sa propre liste d'immeubles qui le garantissent (`collateral`), avec le montant garanti sur chaque immeuble et le rang de la garantie.

```json
{
  "id": "L001",
  "borrower": "Valérie Parisé",
  "lender": "Prêt privé — Jonathan Mireault",
  "principal": 325000,
  "balance": 318000,
  "rate": 8.50,
  "maturity": "2027-06-15",
  "status": "active",
  "risk": "Medium",
  "docs": { ... },
  "collateral": [
    { "propertyId": "P008", "amount": 150000, "rank": "First rank" },
    { "propertyId": "P013", "amount": 100000, "rank": "Second rank" },
    { "propertyId": "P003", "amount": 75000,  "rank": "Second rank" }
  ]
}
```

### Comment ça se traduit dans l'UI

- **Carte** : chaque pin = un immeuble. La couleur du pin reflète le statut du prêt le plus "chaud" qui le grève. Cliquer un pin ouvre le panneau qui liste **tous les prêts** sur cet immeuble.
- **Panneau prêt** : montre les 1-N immeubles en garantie. Un bouton « Cadrer les X immeubles sur la carte » ajuste automatiquement le zoom pour tous les afficher ensemble.
- **Portfolio → Prêts** : liste des prêts (celui de Valérie Parisé avec 3 immeubles apparaît avec « 3 » dans la colonne Immeubles).
- **Portfolio → Immeubles** : liste des immeubles, avec le total garanti et le nombre de prêts sur chacun. L'immeuble de Carlos Mendes (P008) apparaît avec 2 prêts (L001 + L013).
- **Dashboard** : les métriques sont basées sur les prêts pour éviter le double-comptage. Un immeuble qui garantit 2 prêts n'est compté qu'une fois dans « immeubles impliqués ».

## Lancer localement

Il faut un serveur local (fetch ne fonctionne pas en `file://`).

**Option A — Live Server** (VS Code) :
1. Installe l'extension "Live Server" (Ritwick Dey)
2. Clic droit sur `index.html` → **Open with Live Server**

**Option B — ligne de commande** :
```bash
python3 -m http.server 5500
# ou
npx serve
```
Puis ouvrir `http://localhost:5500/`.

## Clés API

Dans `js/config.js` :
```js
mapboxToken: "pk.YOUR_MAPBOX_TOKEN",
googleKey:   "YOUR_GOOGLE_API_KEY",
```

Pense à restreindre les deux clés dans leur console respective avant de mettre en production.

## Ajouter des données

**Nouvel immeuble** : ajoute une entrée dans `data/properties.json` avec un `id` unique (ex: `P014`), les coordonnées et la valeur.

**Nouveau prêt** : ajoute une entrée dans `data/loans.json` avec un `id` unique (ex: `L014`). Dans `collateral`, mets une ligne par immeuble en garantie, avec le montant et le rang. Assure-toi que chaque `propertyId` référencé existe bien dans `properties.json`.

Reload la page : les index se reconstruisent automatiquement.

## Exemple : le prêt de Valérie Parisé (déjà dans les données)

L001 — Valérie Parisé, 325 000 $, garanti par 3 immeubles :
- Maison de Carlos Mendes (P008) — 1re hypothèque de 150 000 $
- Triplex de Valérie Parisé (P013) — 2e hypothèque de 100 000 $
- Condo de Sophie Lavoie (P003) — 2e hypothèque de 75 000 $

Va dans **Portfolio → Prêts**, clique sur la ligne « Valérie Parisé » — le panneau ouvre à droite et cadre les 3 immeubles sur la carte, avec un halo violet autour de chacun.

## Sécurité

Les données de prêt contiennent des informations financières et personnelles (noms d'emprunteurs, montants, taux). Ne pas commiter les fichiers `data/*.json` dans un repo public. Utiliser un `.gitignore` :

```
data/*.json
!data/properties.example.json
```

Pour un usage réel multi-utilisateur avec authentification, il faudra migrer vers un backend (Supabase, Firebase, ou un serveur propre).
