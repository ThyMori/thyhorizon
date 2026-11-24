# ThyHorizon — règles du dépôt

Jeu 3D contemplatif personnel (PC d'abord) : monde infini guidé par le vrai relief de la Terre (détail inventé), départ au bord de la Manche près de Lannion, première personne, rendu « pictural ». Plus tard : bateau, maison, JDR solo.

## Pile technique
TypeScript + Vite + Vitest + Three.js. Tout est local (localStorage, IndexedDB plus tard), SAUF l'option « météo et houle réelles » (désactivée par défaut) qui interroge Open-Meteo. Pas de Supabase.

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
- `src/data/cities.bin` : villes du monde ≥ 5 000 habitants (GeoNames, CC BY 4.0, généré par `scripts/build-cities.mjs`, licence dans `src/data/CITIES-LICENSE.txt`). Ne pas modifier à la main. Les tests le lisent via `src/core/cities.testutil.ts` (jamais importé par le jeu). ATTENTION : `core/places.ts` est une AUTRE chose (la liste des lieux de téléportation) ; les villes sont dans `core/cities.ts`.
- `src/data/stars.json` : catalogue d'étoiles réel (généré par `scripts/build-stars.mjs`, licence dans `src/data/STARS-LICENSE.txt`). Ne pas modifier à la main.

## Voilier (src/core/sailing.ts, wind.ts, waves.ts, hull.ts, boarding.ts)
- Repère du bateau : avant (f) et tribord (r). `omega` > 0 = le bateau tourne à tribord, donc son `yaw` DIMINUE. `heel` > 0 = penché à tribord. Angle de vent `angle` > 0 = vient de tribord. Vent : `from` = direction d'OÙ il vient (0 = nord, sens horaire).
- Le calcul de la houle `waveHeight` (core/waves.ts) est la même formule que le shader de l'océan : si on change une vague, ça change les deux (un seul tableau `WAVE_DEFS`).
- Le bateau n'est simulé que quand le joueur est à bord ET que la souris est capturée. Quand on débarque, il reste amarré (vitesse 0).
- Voilure (1.15) : `mainUp`/`reef`/`jibOut` dans `BoatState` ; `sailPlan` donne surface, centre de voilure avant/arrière et hauteur. Les ordres Y/U/X/C sont des impulsions dans `BoatInput` (`toggleMain`, `toggleJib`, `reef`).
- Marche à bord (1.16) : `core/deck.ts`, repère du bateau (u avant, v tribord). Le joueur n'a pas de corps physique : la caméra suit `eyeWorld(u, h, v)`. Pilote : `autopilotHelm` + `autoTrim` (core/sailing.ts), état `pilotInt` dans `BoatState`.
- Vent simulé : local (1.13). Météo réelle (1.19, option `realWeather`, OFF par défaut) : seul `src/net/openMeteo.ts` touche Internet ; `src/core/realWeather.ts` (pur, testé avec un faux serveur) arrondit les coordonnées à 0,5°, lit les réponses et convertit. Jamais de vrai réseau dans les tests. Toute erreur → météo simulée, sans exception. Ne jamais envoyer la position exacte. Courant (1.20) : `Vec2` en m/s dans le repère du monde, passé à `stepBoat`/`readout` (n'affecte que la position et la vitesse sur le fond) ; la houle réelle tourne toute la mer via `turn` (`waveDir`, `waveHeight(...,turn)`, uniform `uDir` de l'océan : même formule rendu/physique). Direction des vagues = D'OÙ elles viennent ; direction du courant = VERS où il coule. Mention de licence CC BY 4.0 à garder dans les Réglages et le README.

## Son (1.22)
Tout est synthétisé (Web Audio), aucun fichier son. `core/soundMix.ts` (pur, testé) calcule les niveaux ; `audio/ambient.ts` les suit ; `audio/audioSystem.ts` crée le contexte au premier geste. Pas d'effet brusque : tous les changements sont lissés. Bruits du bateau (1.26) : `core/boatSound.ts` (pur, testé : claquements, craquements, pas), joués par `audio/ambient.ts` ; `BoatDriver.walkSpeed` donne la cadence des pas. Musique (1.25) : `core/music.ts` (pur, testé : humeur, gammes, accords, déroulement) ; `audio/music.ts` joue les nappes ; réglage `musicVolume`. `__thy.musicTest()` rend de la musique hors ligne. `__thy.audioTest({...})` (?debug) rend du son hors ligne et mesure niveau/crête/valeurs invalides (on ne peut pas écouter depuis le serveur de contrôle).

## Arbres (1.27)
Maillage à couleurs de sommets, dans la tuile (`core/trees.ts`, `addTree(..., detail)` : 0 de près, 1 de loin). Collision : `core/treeCollide.ts` utilise le placement de niveau 0 (cases de 8 m, identique aux niveaux 0 et 1) ; `trunkRadius` sert au dessin ET à la collision. Si on change le placement ou la taille des arbres, la collision suit toute seule ; si on change le rayon du tronc, les deux suivent. Budget : `TREE_VERTEX_BUDGET` (indices 16 bits). `PLAYER_RADIUS` (collision) doit rester plus grand que le plan de coupe `near` de la caméra (`render/scene.ts`), sinon on voit l'intérieur des troncs. Accroupi : touche C à pied (`CROUCH_*` dans `core/movement.ts`).

## Joueur : mains, boussole, vue (1.28)
`render/avatar.ts` assemble bras (IK : `core/arm.ts`), mains (`render/hand.ts`, poses dans `core/handPose.ts`), boussole (`render/compassModel.ts` ; cap et inertie dans `core/compass.ts`) et corps provisoire. Il vit dans la scène principale, en coordonnées du rendu (jamais de coordonnée du monde). La main gauche est le miroir de la droite DANS `Hand.geo` : tout ce qu'on accroche à `Hand.root` n'est pas inversé. Cap compas = `bearingFromYaw(yaw)` (sens horaire depuis le nord ; yaw du jeu = sens inverse). Vue : `core/cameraRig.ts` (T), la caméra n'est reculée qu'après `updateAvatar`. G lève la boussole. Réglage `showHands`.

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

## Constructions et version du monde (1.29)
Le monde est déterministe ; ce que le joueur change est une liste à part, posée par-dessus. `core/worldEdits.ts` (pur, testé : `WorldEdit`, `sanitizeEdit`, `EditStore`, plafond 20000), `storage/editsDb.ts` (IndexedDB `thyhorizon`/`edits`, repli mémoire avec `persistent=false`, testé avec fake-indexeddb ; passer `null` et non `undefined` pour « pas d'IndexedDB »), `render/editObjects.ts` (dessine dans 250 m, repère du rendu, y lu sur le terrain). `core/worldVersion.ts` : `WORLD_VERSION` ne monte QUE si le générateur déplace/transforme des choses déjà visitées ; `SaveData.worldVersion` garde celui de la sauvegarde ; sauvegarde d'un jeu plus récent = lecture seule (`editsReadOnly`, `saveNow` n'écrit pas). Ajouter un type de construction = l'ajouter à `EDIT_TYPES` + son dessin dans `editObjects.ts`. Touche K / Maj+K, debug `__thy.edits()`.

## Villages (1.30)
`core/cities.ts` (lecture du fichier, position monde, index `nearby`) → `core/villageSystem.ts` (à la demande : `anchor` recalé sur la terre, `village` = plan complet, `clearings`/`blockerForChunk` pour écarter les arbres, `resolve` pour les collisions, `setReserved` pour éviter les constructions du joueur) → `core/village.ts` (plan pur et déterministe : `villageSize`, `findAnchor`, `layoutVillage`, `pointInHouse`, `pushOutOfHouses`) + `core/villageStyle.ts` (style par classe de Köppen) + `core/villageMesh.ts` (maillage relatif au centre du village) → `render/villageObjects.ts` (dessin dans 1,8 km, un village construit par passage, panneaux = canevas). Le worker (`chunkWorker.ts`) reçoit les villes et exclut les arbres des villages ; `TreeObstacles` et `Controls` utilisent le même `VillageSystem`, donc dessin et collision restent d'accord. Si on change la taille, le rayon (`villageSize`, `CLEAR_MARGIN`) ou le recalage, les arbres suivent seuls ; si on change le plan (`layoutVillage`), les villages déjà visités changent : c'est un cas pour monter `WORLD_VERSION`. Terrain : `Terrain.climateClassAt(x, z)`. Carte : `ui/worldMap.ts` dessine les villes (`cityMinPop` dans `core/worldmap.ts`). Debug : `__thy.villages()`.
