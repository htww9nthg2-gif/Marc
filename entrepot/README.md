# Entreposage

Application web (iPhone et ordinateur) pour gérer un entrepôt facturé au pied carré :

- **Réception** : photos du lot, nombre de morceaux, superficie (pi²) et zone de rangement.
- **Sortie** complète ou partielle (le reste garde le même numéro de lot).
- **Occupation** de chaque zone et de chaque entrepôt, en temps réel.
- **Facturation mensuelle** au prorata des jours, avec TPS/TVQ, facture numérotée et export CSV.

Plusieurs personnes l'utilisent en même temps : les données sont partagées dans Supabase.
Rôles : **administrateur** (tout, dont prix et facturation) et **employé** (réceptions, sorties, stock, occupation).

## Règle de facturation

Montant d'un lot = superficie × prix au pi² par mois × jours présents ÷ jours du mois.
Le jour d'entrée et le jour de sortie sont facturés. Après une sortie partielle, le reste est facturé à sa nouvelle superficie dès le lendemain.

## Mise en place (une seule fois)

1. Créer un compte gratuit sur [supabase.com](https://supabase.com) puis un projet (région : Canada).
2. **SQL Editor** › *New query* : coller tout le contenu de `supabase.sql`, puis *Run*.
3. **Authentication** › *Sign In / Providers* : désactiver *Allow new users to sign up* (seul l'administrateur crée les comptes).
4. **Authentication** › *Users* › *Add user* : créer le compte de l'administrateur (cocher *Auto Confirm User*). Tout nouveau compte est employé, puis l'administrateur se désigne une seule fois dans **SQL Editor** :
   `update public.profils set role = 'admin' where courriel = 'adresse@exemple.ca';`
   Les comptes des employés se créent ensuite de la même façon (*Add user*).
5. **Project Settings** › *API* : copier *Project URL* et la clé *anon public* dans `config.js`.

Ensuite, l'administrateur se connecte : l'application ouvre les réglages pour saisir le prix au pied carré, les entrepôts et leurs zones.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase.sql` | Tables, règles de sécurité, sortie partielle, numérotation des factures |
| `migrations/` | Mises à jour à exécuter sur un projet déjà installé (voir ci-dessous) |
| `config.js` | Adresse et clé publique du projet Supabase |
| `calculs.js` | Calculs d'occupation et de facturation |
| `donnees.js` | Échanges avec Supabase |
| `app.js` | Écrans |
| `vendor/supabase.js` | Bibliothèque Supabase (supabase-js 2.45.4, licence MIT) |

## Mises à jour de sécurité

Un projet déjà installé avant le 18 octobre 2026 doit exécuter une fois `migrations/2026-10-18-securite.sql` dans **SQL Editor**. Elle impose l'auteur réel de chaque réception, limite les modifications d'un lot à la zone, la description et la remarque, retire l'administrateur automatique et limite les photos au JPEG de 10 Mo. La dernière ligne affiche les administrateurs : vérifier que ce sont les bonnes personnes.

À vérifier aussi dans Supabase : *Allow new users to sign up* doit rester **désactivé**.
