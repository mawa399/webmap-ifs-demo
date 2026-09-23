# Dictionnaire des données

Tous les fichiers CSV utilisent le séparateur `;` et l’encodage UTF-8.

## `data/projets.csv` — un projet par ligne (export du formulaire Kobo)

| Colonne | Obligatoire | Format | Exemple | Règle de contrôle |
|---|---|---|---|---|
| `id_projet` | oui | `P` + 3 chiffres | `P012` | Unique dans le fichier |
| `intitule` | oui | texte | `Accès à l’eau potable – Podor` | Non vide |
| `organisation` | oui | code membre | `grdr` | Présent dans `organisations.csv` |
| `co_porteurs` | non | codes séparés par un espace | `gret avsf` | Présents dans `organisations.csv` |
| `thematiques` | oui | codes séparés par un espace | `eau_assainissement risques_naturels` | Présents dans `thematiques.csv` |
| `odd` | non | numéros séparés par un espace | `6 13` | 1 à 17 |
| `etat` | oui | `en_cours` ou `termine` | `en_cours` | Cohérent avec `annee_fin` (avertissement sinon) |
| `annee_debut` | oui | année | `2022` | Entre 2000 et 2035 |
| `annee_fin` | oui | année | `2025` | Postérieure ou égale à `annee_debut` |
| `zones` | oui | codes d’unités séparés par un espace | `SN-PODOR MR-BOGHE` | Présents dans `unites_admin.csv` |
| `beneficiaires_par_zone` | non | `CODE:nombre` séparés par un espace | `SN-PODOR:1200 MR-BOGHE:800` | Les codes doivent figurer dans `zones` |
| `partenaires` | non | noms séparés par ` \| ` | `Commune de Podor \| ARD Saint-Louis` | — |
| `bailleurs` | oui | noms séparés par ` \| ` | `Fondation B` | Au moins un (avertissement sinon) |
| `budget_eur` | non | nombre entier | `250000` | Numérique |
| `resume` | oui | texte | — | 1 200 caractères maximum (formulaire) |

Dans Kobo, les champs à choix multiples sont exportés avec des codes séparés par un espace, ce qui correspond directement à ce format. Le groupe répété « Bénéficiaires par unité » est converti en `beneficiaires_par_zone`.

## Référentiels

| Fichier | Contenu | Colonnes |
|---|---|---|
| `data/unites_admin.csv` | Unités administratives de niveau 2 du périmètre | `code`, `nom`, `code_region`, `region`, `pays` |
| `data/organisations.csv` | Membres de l’IFS | `code`, `nom_court`, `nom_complet`, `couleur` |
| `data/thematiques.csv` | 8 thématiques sectorielles et 2 entrées transversales | `code`, `libelle`, `type` |
| `data/historique_traverses50.csv` | Couche historique 2010-2020, non actualisée | `code_unite`, `nb_projets_2010_2020` |
| `data/contexte.json` | Textes de présentation affichés dans « À propos » | — |

## Couches géographiques (`data/geo/`)

| Fichier | Contenu | Source |
|---|---|---|
| `pays.geojson` | Limites des 4 pays (admin 0) | geoBoundaries, CC BY 4.0 |
| `regions.geojson` | 15 régions (admin 1), champ `code` | geoBoundaries, CC BY 4.0 |
| `unites_admin2.geojson` | Unités de niveau 2, champ `code` identique à `unites_admin.csv` | geoBoundaries, CC BY 4.0 |
| `cours_eau.geojson` | Fleuve Sénégal et affluents | Natural Earth, domaine public |
| `ouvrages_omvs.geojson` | Barrages et centrales de l’OMVS (positions approximatives) | Saisie manuelle |

Les géométries sont simplifiées (mapshaper) pour un affichage rapide sur connexion mobile.
