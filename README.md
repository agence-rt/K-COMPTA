# AGOA COMPTA

Comptabilité et déclarations de TVA (CA3) de **THOMAS KOCHANSKI ARCHITECTE** (mensuel, Crédit Mutuel + Société Générale) et de la **SCI FAURIEL49** (trimestriel, Société Générale). Application Windows (Electron).

## Fonctionnement
1. Déposer les relevés PDF dans `003-COMPTABILITE/AGOA-COMPTA/A-TRAITER/` (Dropbox synchronisée) ou les importer depuis le PC.
2. Le logiciel lit les lignes, reconnaît la banque, le compte et la période (d'après les dates des lignes ; un relevé à cheval sur deux périodes est découpé), contrôle les totaux et les soldes, puis range le relevé dans `AGOA-COMPTA/<société>/<année>/<période>/releves/`.
3. Ligne par ligne : corriger les montants, classer en dépense / recette (10 % ou 20 %) / hors TVA, ventiler le HT par taux, joindre le PDF justificatif.
4. Onglet **Synthèse TVA** : lignes de la CA3 (A1, 08, 9B, 16, 19, 20, 22, 23, TD, 32/25) et contrôles.
5. Onglet **Export** : Excel (un onglet par compte, dépenses / recettes / hors TVA, résumé TVA) et PDF des justificatifs classés dans l'ordre (page de garde, index, tampons).

Les données de chaque période sont enregistrées automatiquement dans un fichier `periode.compta` (dossier de la période), donc partagées via Dropbox. Le format `.compta` est lié à l'application : un double-clic sur un fichier `.compta` ouvre AGOA COMPTA directement sur cette période (association créée par l'installateur).

## Codes de ligne et justificatifs
Chaque ligne reçoit un code unique `ANNEE-MOIS-BANQUE-N` (ex. `2026-09-CM-12`), numéroté ligne par ligne dans l'ordre des dates. Les justificatifs sont rangés sous ce code (`justificatifs/2026-09-CM-12.pdf`).
Les factures et reçus déposés dans `A-TRAITER` sont lus (émetteur, date, HT, TVA, TTC) puis rapprochés des lignes sans justificatif : montant identique + émetteur retrouvé dans le libellé. Le PDF est renommé, rangé et lié à la ligne (la nature et la TVA sont renseignées si le PDF les donne). Sans rapprochement possible (PDF absent, montant différent, plusieurs lignes possibles), l'état de la ligne passe à **À vérifier** en rouge, et le PDF reste dans `A-TRAITER`.

## Connexion Google
La connexion Google est obligatoire à chaque lancement et seul le compte `agence@remithollet.fr` donne accès au logiciel (pas de mode local). Les identifiants OAuth (client « application de bureau » Google Cloud) sont intégrés au build à partir des secrets GitHub `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` ; le build échoue s'ils manquent. Aucune saisie dans l'application.

## Installation et mises à jour
L'installateur place l'application dans `C:\AGOA\COMPTA`. À chaque lancement, elle cherche la dernière version publiée sur GitHub (releases de agence-rt/K-COMPTA), la télécharge, l'installe et se relance ; hors ligne, elle démarre normalement. Chaque push sur `main` publie une nouvelle version (0.1.N) via GitHub Actions.

## Développement
```
npm install
npm test        # lecture des relevés, import, exports, connexion
npm run e2e     # interface complète dans Chromium (Playwright requis)
npm start       # lancer l'application
npm run dist    # installateur Windows (dist/)
```
Le workflow GitHub Actions `Build Windows` produit l'installateur à chaque push sur `main` (artefact) et l'attache à la release pour les tags `v*`.

## Structure
`src/core` calculs, lecture des relevés (pdfjs), exports · `src/main` Electron (config, dossier, connexion, IPC) · `src/renderer` interface.

## Limites de la v1
- La lecture des relevés est validée sur des PDF reconstitués d'après les relevés de septembre 2026 ; à confirmer sur les vrais fichiers (les contrôles de totaux et de soldes signalent tout écart).
- L'accès à Dropbox passe par le dossier synchronisé sur le poste (pas par l'API Dropbox).
