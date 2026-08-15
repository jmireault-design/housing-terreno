"""
import_real_portfolio.py — Remplace complètement properties.json et loans.json par tes
vraies données (19 prêts, ~24 immeubles), avec géocodage automatique de chaque adresse.

USAGE :
    .venv/bin/python import_real_portfolio.py

Produit :
    data/properties.json  (écrasé)
    data/loans.json        (écrasé)

Les anciens fichiers sont sauvegardés en data/properties.json.bak et data/loans.json.bak
avant d'être écrasés, par précaution.

IMPORTANT : pense à vider le localStorage de ton navigateur après avoir lancé ce script
(F12 → Console → tape: localStorage.clear() → Entrée), pour repartir sur une base propre
sans résidus des tests précédents.
"""

import json
import os
import shutil
import time
import urllib.request
import urllib.parse

MAPBOX_TOKEN = "pk.eyJ1Ijoiam1pcmVhdWx0IiwiYSI6ImNtcG5icWltdzJkaDMycm9idnZmdW5xam8ifQ.TVUnjlPLBHPvPr8tw0nkZw"

TYPE_MAP = {
    "Prêt hypothécaire": "Mortgage-backed",
    "Marge de crédit": "Collateral",
}

RANK_MAP = {
    "1er rang": "First rank",
    "2e rang": "Second rank",
}

STATUS_MAP = {
    "Prêt actif": "active",
    "Prêt inactif (remboursé)": "released",
    "Dossier refusé": "refused",
    "En attente de la signataire chez le notaire": "pending",
}

LOANS_RAW = [
    {"num": 1, "name": "Prêt St-Denis", "type": "Prêt hypothécaire", "amount": 600000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Sandy & Stéphane Filion",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "4266, 4268 et 4272 rue Saint-Denis", "city": "Montréal", "postal": "H2J 2K8",
          "lot": "1 203 189", "rank": "1er rang", "value": 2000000, "debt1": 0},
     ]},
    {"num": 2, "name": "Prêt Rosanna Antennucci", "type": "Prêt hypothécaire", "amount": 250000,
     "lender": "Jonathan Mireault", "contact": "Rosanna Antennucci",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "4505 rue de la Rivière", "city": "Sainte-Catherine", "postal": "J5C 0J2",
          "lot": "2 372 254", "rank": "1er rang", "value": 750000, "debt1": 0},
     ]},
    {"num": 3, "name": "Prêt Martigny Ouest", "type": "Prêt hypothécaire", "amount": 325000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Sandy & Stéphane Filion",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "12-18 de Martigny Ouest", "city": "Saint-Jérôme", "postal": "J7Y 2E9",
          "lot": "2 140 972", "rank": "1er rang", "value": 1750000, "debt1": 0},
     ]},
    {"num": 4, "name": "Prêt Avenue Victoria", "type": "Prêt hypothécaire", "amount": 400000,
     "lender": "Marc Beaudoin & Jonathan Mireault",
     "contact": "Louis-Philippe Giguère, Éric Emery, Immobillier ELP Inc.",
     "status": "Prêt inactif (remboursé)", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "4998 et 5000 avenue Victoria", "city": "Montréal", "postal": "H3W 1Y7",
          "lot": "2 650 977", "rank": "1er rang", "value": 1000000, "debt1": 0},
         {"addr": "4994 et 4996 avenue Victoria", "city": "Montréal", "postal": "H3W 1Y7",
          "lot": "2 650 978", "rank": "1er rang", "value": 1000000, "debt1": 0},
     ]},
    {"num": 5, "name": "Prêt Stéphane Tommassini", "type": "Prêt hypothécaire", "amount": 779000,
     "lender": "Marc Beaudoin", "contact": "Stéphane Tassoni",
     "status": "Prêt actif", "referredBy": "Nicolas Larivière",
     "props": [
         {"addr": "1755 Petite Allée", "city": "Mont-Tremblant", "postal": "J8E 0J2",
          "lot": "5 140 375", "rank": "1er rang", "value": 1200000, "debt1": 0},
         {"addr": "361-367 rue du Square-Saint-Louis", "city": "Montréal", "postal": "H2X 1A8",
          "lot": "1 201 965", "rank": "2e rang", "value": 2500000, "debt1": 750000},
     ]},
    {"num": 6, "name": "Prêt Centre SIDA Valérie Parisé", "type": "Prêt hypothécaire", "amount": 325000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Valérie Parisé",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "50 rue St-Faustin", "city": "Saint-Jérôme", "postal": "J7Z 2P3",
          "lot": "2 351 800 et 3 726 305", "rank": "1er rang", "value": 2000000, "debt1": 0},
         {"addr": "516 rue Saint-Georges", "city": "Saint-Jérôme", "postal": "J7Z 5B2",
          "lot": "2 141 600", "rank": "1er rang", "value": 2000000, "debt1": 0},
         {"addr": "527-529 rue Saint-Georges", "city": "Saint-Jérôme", "postal": "J7Z 5B2",
          "lot": "2 141 699", "rank": "1er rang", "value": 2000000, "debt1": 0},
     ]},
    {"num": 7, "name": "Prêt Motel Le Marigôt", "type": "Prêt hypothécaire", "amount": 250000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Asim Sheik",
     "status": "Prêt actif", "referredBy": "Nicolas Larivière",
     "props": [
         {"addr": "522 route Lotbinière", "city": "Vaudreuil-Dorion", "postal": "J7V 0H4",
          "lot": "1 546 623", "rank": "1er rang", "value": 1200000, "debt1": 0},
     ]},
    {"num": 8, "name": "Prêt Bridge David Hauptman", "type": "Marge de crédit", "amount": 100000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "David Hauptman",
     "status": "Prêt actif", "referredBy": "Jonathan Mireault",
     "props": [
         {"addr": "17385 rue du Titane", "city": "Mirabel", "postal": "J7N 3R2",
          "lot": "6 181 667", "rank": "2e rang", "value": 2300000, "debt1": 725000},
     ]},
    {"num": 9, "name": "Prêt Dany Gougeon", "type": "Prêt hypothécaire", "amount": 0,
     "lender": "", "contact": "Dany Gougeon",
     "status": "Dossier refusé", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "992 route 309 Sud", "city": "Notre-Dame-de-Pontmain", "postal": "J0W 1S0",
          "lot": "5 237 500", "rank": "1er rang", "value": 2000000, "debt1": 0},
         {"addr": "1514 Route 309 Nord", "city": "Notre-Dame-de-Pontmain", "postal": "J0W 1S0",
          "lot": "5 237 802, 6 422 736, 6 422 739, 6 422 740", "rank": "1er rang", "value": 2000000, "debt1": 0},
     ]},
    {"num": 10, "name": "Prêt Ferme & Maison neuve - Maxime Langlois", "type": "Marge de crédit", "amount": 300000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Maxime Langlois",
     "status": "Prêt actif", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "4981 route Sir Wilfried Laurier", "city": "Mirabel", "postal": "J7N 2Z8",
          "lot": "1 847 183 et 2 521 153", "rank": "1er rang", "value": 1250000, "debt1": 0},
         {"addr": "133 rue d'Artagnan", "city": "Saint-Colomban", "postal": "J5K 2K9",
          "lot": "2 078 911", "rank": "1er rang", "value": 650000, "debt1": 0},
     ]},
    {"num": 11, "name": "Prêt Julie Maisonneuve", "type": "Prêt hypothécaire", "amount": 300000,
     "lender": "Marc Beaudoin", "contact": "Julie Maisonneuve",
     "status": "Prêt actif", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "62-64 rue Annick", "city": "Saint-Hippolyte", "postal": "J8A 0E3",
          "lot": "5 336 026", "rank": "1er rang", "value": 500000, "debt1": 0},
     ]},
    {"num": 12, "name": "Dossier Jonathan Bastien (Record d'hypothèque légale)", "type": "Prêt hypothécaire",
     "amount": 0, "lender": "", "contact": "Dossier Jonathan Bastien",
     "status": "Dossier refusé", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "3817-3819 rue Chantal", "city": "Rawdon", "postal": "J0K 1S0",
          "lot": "5 529 276", "rank": "", "value": 2000000, "debt1": 0},
     ]},
    {"num": 13, "name": "Prêt Maison Val-David", "type": "Prêt hypothécaire", "amount": 289250,
     "lender": "Marc Beaudoin", "contact": "Manuel Coutu, Xenia Ulok",
     "status": "En attente de la signataire chez le notaire", "referredBy": "Nicolas Larivière",
     "props": [
         {"addr": "2650 rue Tamarac", "city": "Val-David", "postal": "J0T 2N0",
          "lot": "6 154 648 et 2 990 169", "rank": "1er rang", "value": 445000, "debt1": 0},
     ]},
    {"num": 14, "name": "Dossier Valérie Beauregard", "type": "Prêt hypothécaire", "amount": 0,
     "lender": "", "contact": "Valérie Beauregard",
     "status": "Dossier refusé", "referredBy": "Nicolas Larivière",
     "props": [
         {"addr": "497 rue des Falaises", "city": "Mont-Saint-Hilaire", "postal": "J3H 5R7",
          "lot": "2 348 656", "rank": "2e rang", "value": 1100000, "debt1": 0},
     ]},
    {"num": 15, "name": "Dossier Achat Philippe Lambert", "type": "Prêt hypothécaire", "amount": 500000,
     "lender": "Marc Beaudoin & Jonathan Mireault", "contact": "Philippe Lambert",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "3767 avenue Wilson", "city": "Montréal", "postal": "H4A 2T7",
          "lot": "2 606 753", "rank": "1er rang", "value": 1500000, "debt1": 0},
     ]},
    {"num": 16, "name": "Prêt Joseph Bowe & Eric Peterson", "type": "Prêt hypothécaire", "amount": 331500,
     "lender": "Jonathan Mireault", "contact": "Joseph Bowe & Eric Peterson",
     "status": "Prêt actif", "referredBy": "Nicolas Larivière",
     "props": [
         {"addr": "390 rue du Docteur-Thauvette", "city": "Vaudreuil-Dorion", "postal": "J7V 6Z6",
          "lot": "1 678 058", "rank": "1er rang", "value": 510000, "debt1": 0},
     ]},
    {"num": 17, "name": "Prêt Nouveau Chalet Pascal Boivin", "type": "Prêt hypothécaire", "amount": 0,
     "lender": "Marc Beaudoin", "contact": "Pascal Boivin, Sylvie Fournier",
     "status": "Prêt inactif (remboursé)", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "7 rue St-François", "city": "St-Stanislas de Kostka", "postal": "J0S 1W0",
          "lot": "5 125 749", "rank": "1er rang", "value": 625000, "debt1": 0},
         {"addr": "175 rue Champêtre", "city": "Rivière-Beaudette", "postal": "J0P 1R0",
          "lot": "6 472 138", "rank": "2e rang", "value": 2000000, "debt1": 800000},
     ]},
    {"num": 18, "name": "Marge Mike Daoui", "type": "Marge de crédit", "amount": 200000,
     "lender": "Marc Beaudoin", "contact": "Mohamed Daoui",
     "status": "Prêt actif", "referredBy": "Mike Daoui",
     "props": [
         {"addr": "686 rue de la Mistassini", "city": "Terrebonne", "postal": "J6W 5H2",
          "lot": "3 264 486", "rank": "2e rang", "value": 1150000, "debt1": 0},
     ]},
    {"num": 19, "name": "Prêt Marc Beaudoin", "type": "Prêt hypothécaire", "amount": 300000,
     "lender": "Jonathan Mireault", "contact": "Marc Beaudoin",
     "status": "Prêt actif", "referredBy": "Marc Beaudoin",
     "props": [
         {"addr": "474 Montée du Val-de-Loire", "city": "Saint-Adolphe-d'Howard", "postal": "J0T 2B0",
          "lot": "4 126 006", "rank": "1er rang", "value": 3000000, "debt1": 0},
     ]},
]


def geocode(address, city, postal):
    query = f"{address}, {city}, Québec {postal}, Canada"
    url = (
        f"https://api.mapbox.com/geocoding/v5/mapbox.places/{urllib.parse.quote(query)}.json"
        f"?access_token={MAPBOX_TOKEN}&country=ca&limit=1"
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.load(resp)
        if data.get("features"):
            lng, lat = data["features"][0]["center"]
            return lng, lat
    except Exception as e:
        print(f"    ! Géocodage échoué pour '{query}': {e}")
    return None, None


def main():
    properties = []
    loans = []
    property_counter = 1

    for loan_def in LOANS_RAW:
        loan_id = f"L{loan_def['num']:03d}"
        print(f"\nPrêt {loan_id} — {loan_def['name']}")

        collateral = []
        for prop in loan_def["props"]:
            city_clean = prop["city"].replace("- ", "-").replace(" -", "-")
            print(f"  Géocodage: {prop['addr']}, {city_clean}...")
            lng, lat = geocode(prop["addr"], city_clean, prop["postal"])
            time.sleep(0.2)

            if lng is None:
                print(f"    ! Coordonnées introuvables — immeuble ignoré, à ajouter manuellement.")
                continue

            prop_id = f"P{property_counter:03d}"
            property_counter += 1

            properties.append({
                "id": prop_id,
                "addr": prop["addr"],
                "city": city_clean,
                "neighborhood": "",
                "type": "",
                "owner": loan_def["contact"],
                "value": prop["value"],
                "assessment": 0,
                "lng": lng,
                "lat": lat,
                "notes": f"Code postal: {prop['postal']} · Lot cadastral: {prop['lot']}"
            })

            collateral.append({
                "propertyId": prop_id,
                "amount": loan_def["amount"],
                "rank": RANK_MAP.get(prop["rank"], "Unsecured")
            })
            print(f"    ✓ {prop_id} — [{lat:.5f}, {lng:.5f}]")

        status = STATUS_MAP.get(loan_def["status"], "pending")
        balance = 0 if status == "released" else loan_def["amount"]

        loans.append({
            "id": loan_id,
            "borrower": loan_def["contact"],
            "guarantor": loan_def["contact"],
            "lender": loan_def["lender"] or "—",
            "type": TYPE_MAP.get(loan_def["type"], "Other"),
            "principal": loan_def["amount"],
            "balance": balance,
            "rate": 0,
            "startDate": "",
            "maturity": "",
            "review": "",
            "status": status,
            "risk": "Medium",
            "referredBy": loan_def["referredBy"],
            "notes": loan_def["name"],
            "docs": {"loan": False, "guarantee": False, "mortgage": False, "appraisal": False,
                     "insurance": False, "tax": False, "title": False},
            "collateral": collateral
        })

    for fname in ("data/properties.json", "data/loans.json"):
        if os.path.exists(fname):
            shutil.copy(fname, fname + ".bak")

    os.makedirs("data", exist_ok=True)
    with open("data/properties.json", "w", encoding="utf-8") as f:
        json.dump(properties, f, ensure_ascii=False, indent=2)
    with open("data/loans.json", "w", encoding="utf-8") as f:
        json.dump(loans, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print(f"Terminé : {len(properties)} immeubles, {len(loans)} prêts écrits.")
    print("Anciens fichiers sauvegardés en data/*.json.bak")
    print("\nIMPORTANT : vide le localStorage de ton navigateur pour repartir propre :")
    print("  F12 → Console → localStorage.clear() → Entrée, puis recharge la page.")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
