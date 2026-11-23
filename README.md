# ThyHorizon

Jeu 3D contemplatif et personnel : un monde procédural infini, entre océan et montagnes, à explorer à pied. Aucune pression, la lumière au centre.

## Mise en route (Windows, PowerShell)
```powershell
git pull        # récupérer la dernière version
npm install     # une seule fois (et après chaque changement de dépendances)
npm run dev     # lance le jeu ; ouvre l'adresse affichée (http://localhost:5173) dans Chrome ou Edge
```
Clique sur « Entrer dans le monde ». Commandes : ZQSD / flèches, souris, Maj = courir, V = vol, H = aide, Échap = pause.

## Jouer en ligne (sans rien installer)
Adresse : https://horizon.thierry-morin.com (CNAME chez Squarespace vers thymori.github.io, fichier public/CNAME, HTTPS forcé) ; ancienne adresse https://thymori.github.io/ThyHorizon/ (mise à jour automatiquement à chaque livraison, environ 1 à 2 minutes).
Réglage unique, à faire par toi : dépôt GitHub → Settings → Pages → « Build and deployment » → Source : **GitHub Actions**. Le suivi se voit dans l'onglet Actions. Les sauvegardes restent dans ton navigateur (propres à chaque adresse).

## Commandes utiles
| Commande | Rôle |
|---|---|
| `npm test` | tests de la logique |
| `npm run build` | contrôle de types + construction dans `dist/` |
| `npm run bump -- patch\|minor\|major "texte"` | nouvelle version |
| `npm run version:check` | cohérence des numéros |

## Architecture
- `src/core/` : logique pure testée (bruit, terrain, tuiles, soleil, mouvement, réglages, sauvegarde).
- `src/world/` : tuiles calculées dans des Web Workers (`chunkWorker.ts`) et gérées par `chunkManager.ts`.
- `src/render/` : scène, ciel, océan.
- `src/player/` : contrôles. `src/ui/` : HUD, panneaux, messages. `src/game.ts` : boucle principale.

## Fonctions livrées
### 1.0.0 — Étape 1 : le monde et la marche
- Terrain infini : côte, plage, collines, montagnes arrondies (graine fixe « horizon »).
- Marche à la première personne, course, mode vol (V). Interdit de marcher en eau profonde (il faudra un bateau).
- Soleil, lune, étoiles, brume ; cycle jour/nuit (durée réglable, départ 17 h 24 face à l'océan).
- Océan animé (vagues, reflet du soleil).
- Réglages de qualité (éco / équilibré / beau, distance, ombres, résolution), compteur d'images par seconde.
- Sauvegarde automatique locale (position, heure), écran de secours « Réinitialiser et recharger ».

### 1.1.0 — Plein écran à l'entrée
- « Entrer dans le monde » et « Reprendre » passent le jeu en plein écran et capturent la souris. Échap quitte les deux ; « Reprendre » les remet.

### 1.2.0 — Planète cousine de la Terre, étape 1 : coordonnées et vrai soleil
- Le monde a un lieu : **Lannion, 48,73° N, 3,46° O** (là où Thierry est né). Affiché dans Réglages → Temps.
- Le soleil suit la vraie astronomie : sa hauteur et son point de lever/coucher dépendent de la latitude, du jour de l'année et de l'heure. À Lannion : soleil à ~18° à midi le 21 décembre, ~65° le 21 juin ; jour de ~8 h en hiver, ~16 h en été.
- L'heure du jeu est l'**heure solaire locale** (midi = soleil plein sud), pas l'heure d'horloge : pas de décalage lié au fuseau ni à l'heure d'été.
- Nouveau : une **date** (curseur sur l'année, sauvegardée) et un réglage « Les jours passent » (actif par défaut : un jour de plus à chaque minuit du jeu).
- Une partie neuve commence à la date réelle du jour, une heure avant le coucher du soleil.
- Les anciennes sauvegardes sont reprises (date du jour, heure conservée).
- Pas encore reprises du réel : la forme de la côte et du relief (le terrain reste inventé, océan à l'ouest) ; l'étape 3 apportera la vraie côte nord de Lannion (la mer y est au nord). La lune est simplement à l'opposé du soleil, sans phases.

### 1.3.0 — Un vrai ciel étoilé
- **5 044 vraies étoiles** (catalogue Hipparcos, magnitude ≤ 6, fichier `src/data/stars.json`) avec leur vraie position, leur éclat et leur couleur (bleutées, blanches, jaunes, orangées).
- Le ciel tourne comme le vrai : autour de l'étoile Polaire, inclinée selon la latitude, et il avance d'environ 1° par jour avec les saisons (la Polaire reste à ~48,7° de hauteur à Lannion).
- Les étoiles sont dessinées derrière le relief et l'eau (elles ne s'affichent plus sur le terrain) et s'éteignent près de l'horizon.
- Régénérer le fichier : `node scripts/build-stars.mjs chemin/vers/stars.6.json` (source : paquet npm `d3-celestial`, licence BSD-3 dans `src/data/STARS-LICENSE.txt`).
- Pas encore : Voie lactée, planètes, phases et vraie position de la lune, scintillement.

## Droits / migrations
Sans objet : jeu local, sans compte ni serveur.

## Dépannage
- Écran de secours après 8 s : « Réinitialiser et recharger » (garde tes sauvegardes).
- Saccades : choisis le préréglage « Éco » dans Réglages.
- La souris ne se capture pas : clique dans la fenêtre du jeu ; Échap libère la souris.

## Feuille de route
**Planète cousine de la Terre** (monde inventé, relief et climats guidés par la vraie Terre, départ à Lannion) :
1. ✅ Coordonnées lat/long + vrai soleil et saisons (1.2.0)
2. Déplacement de l'origine du rendu (voyager loin sans tremblement)
3. Carte réelle de relief et d'océans à basse résolution, détail inventé par-dessus
4. Biomes (climat → couleurs, végétation, neige, désert, glace)
5. Voyage par coordonnées (téléportation) et carte du monde

**Ensuite** : Bateau à voile · Construction de maison · Couche JDR solo (journal, oracle, dés) · Sauvegardes IndexedDB (modifications du monde) · Son.

En ligne : https://horizon.thierry-morin.com (depuis 1.0.2).
