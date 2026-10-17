# Visite de chantier

Application web pour iPhone qui transforme une visite de chantier (déménagement de machines industrielles) en :

1. **Soumission pour le client** : machines, ressources, prix calculés, taxes, conditions.
2. **Bon de travail pour l'équipe** : même dossier sans les prix, avec les photos des enjeux, les consignes et les procédures (PDF) à suivre.

## Fonctionnement

| Onglet | Contenu |
|---|---|
| Infos | Client, lieux de départ et d'arrivée, dates, description, statut |
| Machines | Nom, modèle, poids, dimensions, remarques |
| Photos | Photos des enjeux (accès, plancher, obstacles, ancrages…) avec une note |
| Prix | Ressources choisies dans les tarifs, durée, calcul automatique ; options : taxes, minimum d'heures, photos, conditions |
| Procédures | Procédures PDF à joindre au bon de travail et consignes à l'équipe |
| Documents | Soumission et bon de travail, à enregistrer en PDF ou à envoyer |

Les tarifs, les taxes, le minimum d'heures, les conditions types et les procédures PDF se modifient dans « Tarifs, conditions et procédures ». Un prix à 0 signifie « à définir ».

Les données restent sur le téléphone (IndexedDB). L'écran Réglages permet d'exporter et de restaurer une sauvegarde.

## Installer sur l'iPhone

Ouvrir l'adresse de l'application dans Safari, toucher **Partager** puis **« Sur l'écran d'accueil »**.

## Tester

Servir le dossier avec un petit serveur web (par exemple `python3 -m http.server`) et ouvrir la page dans le navigateur.
