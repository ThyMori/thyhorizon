# ThyHorizon — règles du dépôt

Jeu 3D contemplatif personnel (PC d'abord) : monde infini guidé par le vrai relief de la Terre (détail inventé), départ au bord de la Manche près de Lannion, première personne, rendu « pictural ». Plus tard : bateau, maison, JDR solo.

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
+x = est, −x = ouest, +z = sud (donc le NORD est vers −z), y = haut, niveau de la mer y = 0. Yaw 0 = nord. Soleil : vrai soleil astronomique (`src/core/geo.ts`) pour la latitude du lieu et le jour de l'année ; l'heure du jeu est l'heure SOLAIRE locale (midi = plein sud).
Lieu de départ : Lannion, 48,73° N, 3,46° O. Ambition : une planète « cousine de la Terre » (relief et biomes guidés par la vraie Terre, détail inventé) — voir la feuille de route du README.

## Données
- `src/data/relief.bin` : relief réel mondial basse résolution (ETOPO, généré par `scripts/build-relief.mjs`, voir `RELIEF-LICENSE.txt`). Ne pas modifier à la main. Les tests le lisent via `src/core/relief.testutil.ts` (jamais importé par le jeu).
- `src/data/constellations.json` : traits des constellations (généré par `scripts/build-constellations.mjs`, même licence que les étoiles). Ne pas modifier à la main.
- `src/data/climate.json` : classification climatique réelle (Köppen-Geiger, grille 0,5°), générée par `scripts/build-climate.mjs`. Ne pas modifier à la main. Importée par `src/world/climateData.ts` (worker et jeu), lue par `src/core/climate.ts`.
- `src/data/stars.json` : catalogue d'étoiles réel (généré par `scripts/build-stars.mjs`, licence dans `src/data/STARS-LICENSE.txt`). Ne pas modifier à la main.

## Voilier (src/core/sailing.ts, wind.ts, waves.ts, hull.ts, boarding.ts)
- Repère du bateau : avant (f) et tribord (r). `omega` > 0 = le bateau tourne à tribord, donc son `yaw` DIMINUE. `heel` > 0 = penché à tribord. Angle de vent `angle` > 0 = vient de tribord. Vent : `from` = direction d'OÙ il vient (0 = nord, sens horaire).
- Le calcul de la houle `waveHeight` (core/waves.ts) est la même formule que le shader de l'océan : si on change une vague, ça change les deux (un seul tableau `WAVE_DEFS`).
- Le bateau n'est simulé que quand le joueur est à bord ET que la souris est capturée. Quand on débarque, il reste amarré (vitesse 0).
- Vent simulé : tout local (1.13). Le vent réel (Open-Meteo) arrive en 1.15 : il faudra alors adapter la règle « tout est local » ci-dessus.

## Rendu et grandes coordonnées
Ne jamais envoyer une coordonnée du monde à la carte graphique (shader, position d'objet, caméra) : tout est relatif à l'origine flottante (`Game.origin`, `core/origin.ts`). Un shader qui a besoin de la position dans le monde (bruit, vagues) reçoit un décalage calculé en JavaScript (`grainShift`, `wavePhase`).

## Vocabulaire
- **Tuile (chunk)** : carré de terrain de 64 m. **LOD** : niveau de détail d'une tuile selon sa distance.
- **Refuge** : l'ambiance visée (calme, aucune pression).

## Versions
Format x.y.z (z = correction, y = fonction, x = majeur). Ne JAMAIS éditer à la main : `npm run bump -- patch|minor|major "description"`, puis `npm run version:check`. Une livraison = une version. Le numéro s'affiche en bas à gauche du jeu.

## Avant chaque livraison
`npm test`, `npm run build` (inclut tsc), bump, commit, push sur main. Fin de livraison : version, Supabase (non), testé / non testé, choix à corriger, comment tester.

## PWA
- `public/sw.js` (réseau d'abord, repli cache) : sa constante `VERSION` est gérée par `npm run bump`, ne pas l'éditer. Une nouvelle icône ou un fichier à garder hors ligne s'ajoute à la liste `SHELL` du service worker (le reste est mis en cache à l'usage).
- Logique pure : `src/core/install.ts` (invitation, report 7 jours, 3 fois) ; `src/pwa/` : service worker, bandeau, invitation. Inactif avec `npm run dev`.

## Qualité visuelle
- Le bloom (`render/scene.ts`) utilise EffectComposer avec des cibles marquées `isXRRenderTarget` pour garder le rendu identique à l'écran direct (astuce dépendante de la version de Three.js : revérifier après une mise à jour). Le ciel (`render/sky.ts`) est plafonné quand le bloom est actif.

## Particularités
- Le contrôle visuel se fait avec Chrome sans GPU (SwiftShader, ~10 i/s) : non représentatif des performances.
- `?debug` dans l'URL expose `window.__thy` (téléportation, heure, stats).
- Drapeau `UPDATE_PENDING` dans `src/flags.ts` : toujours `false` ici (pas de service externe).
