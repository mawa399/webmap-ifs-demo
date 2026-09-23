#!/usr/bin/env python3
"""Contrôle qualité de data/projets.csv (export Kobo) avant publication.

Applique les mêmes règles que la webmap (assets/app.js) :
- erreurs  : la ligne est écartée de la carte (code inconnu, champ obligatoire vide, dates incohérentes…)
- avertissements : la ligne est publiée mais signalée (état incohérent, bailleur manquant…)

Usage : python scripts/valider_donnees.py [--rapport rapport_validation.md]
Code de sortie : 0 si le fichier est lisible (même avec des lignes écartées),
                 1 si la structure du fichier empêche toute lecture (colonnes manquantes).
Aucune dépendance externe : bibliothèque standard Python 3.9+.
"""
import argparse
import csv
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DATA = RACINE / "data"
ANNEE_REF = 2026
COLONNES = ["id_projet", "intitule", "organisation", "co_porteurs", "thematiques", "odd", "etat",
            "annee_debut", "annee_fin", "zones", "beneficiaires_par_zone", "partenaires", "bailleurs",
            "budget_eur", "resume"]


def lire(nom):
    with open(DATA / nom, encoding="utf-8-sig", newline="") as f:
        lecteur = csv.DictReader(f, delimiter=";")
        return lecteur.fieldnames or [], list(lecteur)


def entier(v):
    try:
        return int(str(v).strip())
    except ValueError:
        return None


def valider():
    _, unites = lire("unites_admin.csv")
    _, orgs = lire("organisations.csv")
    _, themes = lire("thematiques.csv")
    codes_u = {u["code"] for u in unites}
    codes_o = {o["code"] for o in orgs}
    codes_t = {t["code"] for t in themes}

    colonnes, lignes = lire("projets.csv")
    erreurs, avertissements = [], []
    manquantes = [c for c in COLONNES if c not in colonnes]
    if manquantes:
        erreurs.append(("–", "–", ", ".join(manquantes), "Colonnes absentes du fichier. Aucun projet n'a pu être lu."))
        return len(lignes), 0, erreurs, avertissements, True

    vus, publies = set(), 0
    for i, r in enumerate(lignes, start=2):
        pid = (r["id_projet"] or "").strip()
        e, a = [], []
        if not pid:
            e.append(("id_projet", "Identifiant manquant."))
        elif pid in vus:
            e.append(("id_projet", f"Identifiant {pid} en double."))
        vus.add(pid)
        if not (r["intitule"] or "").strip():
            e.append(("intitule", "Intitulé manquant."))
        if r["organisation"] not in codes_o:
            e.append(("organisation", f"Organisation « {r['organisation']} » inconnue (voir organisations.csv)."))
        for c in (r["co_porteurs"] or "").split():
            if c not in codes_o:
                e.append(("co_porteurs", f"Co-porteur « {c} » inconnu."))
        th = (r["thematiques"] or "").split()
        if not th:
            e.append(("thematiques", "Aucune thématique renseignée."))
        for t in th:
            if t not in codes_t:
                e.append(("thematiques", f"Thématique « {t} » inconnue (voir thematiques.csv)."))
        zones = (r["zones"] or "").split()
        if not zones:
            e.append(("zones", "Aucune zone d'intervention renseignée."))
        for z in zones:
            if z not in codes_u:
                e.append(("zones", f"Code d'unité « {z} » inconnu (voir unites_admin.csv)."))
        d, f = entier(r["annee_debut"]), entier(r["annee_fin"])
        if d is None or not 2000 <= d <= 2035:
            e.append(("annee_debut", "Année de début manquante ou invalide."))
        if f is None or not 2000 <= f <= 2035:
            e.append(("annee_fin", "Année de fin manquante ou invalide."))
        if d and f and d > f:
            e.append(("annee_fin", "L'année de fin précède l'année de début."))
        etat = r["etat"]
        if etat not in ("en_cours", "termine"):
            e.append(("etat", f"État « {etat} » invalide (en_cours ou termine)."))
        elif etat == "termine" and f and f > ANNEE_REF:
            a.append(("etat", f"Projet déclaré terminé mais se terminant en {f}."))
        elif etat == "en_cours" and f and f < ANNEE_REF:
            a.append(("etat", f"Projet déclaré en cours mais terminé en {f}."))
        budget = (r["budget_eur"] or "").replace(" ", "").replace(",", ".")
        if budget:
            try:
                float(budget)
            except ValueError:
                a.append(("budget_eur", "Budget non numérique, ignoré."))
        for item in (r["beneficiaires_par_zone"] or "").split():
            z = item.split(":")[0]
            if z not in zones:
                a.append(("beneficiaires_par_zone", f"Bénéficiaires affectés à {z}, absent des zones."))
        if not [b for b in (r["bailleurs"] or "").split("|") if b.strip()]:
            a.append(("bailleurs", "Aucun bailleur renseigné."))
        erreurs += [(i, pid, c, m) for c, m in e]
        avertissements += [(i, pid, c, m) for c, m in a]
        if not e:
            publies += 1
    return len(lignes), publies, erreurs, avertissements, False


def rapport(total, publies, erreurs, avertissements):
    out = ["# Rapport de contrôle de data/projets.csv", "",
           "| Lignes lues | Projets publiés | Lignes écartées | Avertissements |", "|---|---|---|---|",
           f"| {total} | {publies} | {total - publies} | {len(avertissements)} |", ""]
    if erreurs:
        out += ["## Lignes écartées (à corriger)", "", "| Ligne | Projet | Champ | Problème |", "|---|---|---|---|"]
        out += [f"| {l} | {p} | {c} | {m} |" for l, p, c, m in erreurs] + [""]
    if avertissements:
        out += ["## Avertissements (projets publiés)", "", "| Ligne | Projet | Champ | Remarque |", "|---|---|---|---|"]
        out += [f"| {l} | {p} | {c} | {m} |" for l, p, c, m in avertissements] + [""]
    if not erreurs and not avertissements:
        out.append("Aucune anomalie détectée. ✅")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rapport", help="chemin du rapport Markdown à écrire")
    args = ap.parse_args()
    total, publies, erreurs, avertissements, bloquant = valider()
    texte = rapport(total, publies, erreurs, avertissements)
    print(texte)
    if args.rapport:
        Path(args.rapport).write_text(texte + "\n", encoding="utf-8")
    sys.exit(1 if bloquant else 0)


if __name__ == "__main__":
    main()
