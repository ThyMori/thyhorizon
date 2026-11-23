# ThyHorizon — règles du dépôt

Jeu 3D contemplatif personnel (PC d'abord) : monde procédural infini type Pays basque (océan à l'ouest, montagnes à l'est), première personne, rendu « pictural ». Plus tard : bateau, maison, JDR solo.

## Pile technique
TypeScript + Vite + Vitest + Three.js. Aucune donnée en ligne : tout est local (localStorage, IndexedDB plus tard). Pas de Supabase.

## Conventions
- Chaque ligne de code est commentée en français (ce qu'elle fait).
- Textes de l'interface en français, tutoiement.
- Logique pure (terrain, soleil, mouvement, réglages) dans `src/core/`, sans DOM ni réseau, testée par `*.test.ts`.
- Pas de `innerHTML` avec du texte venant de l'utilisateur.
- Couleurs de l'interface en variables CSS.
- Tout nouveau fichier de logique = un test.

## Repères du monde
+x = est, −x = ouest (océan), +z = sud, y = haut, niveau de la mer y = 0. Yaw 0 = nord. Soleil : vrai soleil astronomique (`src/core/geo.ts`) pour la latitude du lieu et le jour de l'année ; l'heure du jeu est l'heure SOLAIRE locale (midi = plein sud).
Lieu de départ : Lannion, 48,73° N, 3,46° O. Ambition : une planète « cousine de la Terre » (relief et biomes guidés par la vraie Terre, détail inventé) — voir la feuille de route du README.

## Vocabulaire
- **Tuile (chunk)** : carré de terrain de 64 m. **LOD** : niveau de détail d'une tuile selon sa distance.
- **Refuge** : l'ambiance visée (calme, aucune pression).

## Versions
Format x.y.z (z = correction, y = fonction, x = majeur). Ne JAMAIS éditer à la main : `npm run bump -- patch|minor|major "description"`, puis `npm run version:check`. Une livraison = une version. Le numéro s'affiche en bas à gauche du jeu.

## Avant chaque livraison
`npm test`, `npm run build` (inclut tsc), bump, commit, push sur main. Fin de livraison : version, Supabase (non), testé / non testé, choix à corriger, comment tester.

## Particularités
- Le contrôle visuel se fait avec Chrome sans GPU (SwiftShader, ~10 i/s) : non représentatif des performances.
- `?debug` dans l'URL expose `window.__thy` (téléportation, heure, stats).
- Drapeau `UPDATE_PENDING` dans `src/flags.ts` : toujours `false` ici (pas de service externe).
