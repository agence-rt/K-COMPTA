# AGOA COMPTA

Comptabilité et déclarations de TVA (CA3) de **THOMAS KOCHANSKI ARCHITECTE** (mensuel, Crédit Mutuel + Société Générale) et de la **SCI FAURIEL49** (trimestriel, Société Générale). Application Windows (Electron).

## Fonctionnement
1. Déposer les relevés PDF dans `003-COMPTABILITE/AGOA-COMPTA/A-TRAITER/` (Dropbox synchronisée) ou les importer depuis le PC.
2. Le logiciel lit les lignes, reconnaît la banque, le compte et la période (d'après les dates des lignes ; un relevé à cheval sur deux périodes est découpé), contrôle les totaux et les soldes, puis range le relevé dans `AGOA-COMPTA/<société>/<année>/<période>/releves/`.
3. Ligne par ligne : corriger les montants, classer en dépense / recette (10 % ou 20 %) / hors TVA, ventiler le HT par taux, joindre le PDF justificatif.
4. Onglet **Synthèse TVA** : lignes de la CA3 (A1, 08, 9B, 16, 19, 20, 22, 23, TD, 32/25) et contrôles.
5. Onglet **Export** : Excel (un onglet par compte, dépenses / recettes / hors TVA, résumé TVA) et PDF des justificatifs classés dans l'ordre (page de garde, index, tampons).

Les données sont enregistrées automatiquement dans `periode.json` (dossier de la période), donc partagées via Dropbox.

## Connexion Google
Réglages → Connexion Google : identifiant et secret client OAuth « application de bureau » (Google Cloud Console), domaine autorisé `remithollet.fr`. Tant que ce n'est pas configuré, un mode local est proposé.

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
