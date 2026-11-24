# ThyHorizon

Jeu 3D contemplatif et personnel : un monde procédural infini, entre océan et montagnes, à explorer à pied. Aucune pression, la lumière au centre.

## Mise en route (Windows, PowerShell)
```powershell
git pull        # récupérer la dernière version
npm install     # une seule fois (et après chaque changement de dépendances)
npm run dev     # lance le jeu ; ouvre l'adresse affichée (http://localhost:5173) dans Chrome ou Edge
```
Clique sur « Entrer dans le monde ». Commandes (clavier) : ZQSD (déplacement), flèches (regard, comme la souris), souris, Maj = courir, V = vol, H = aide, Échap = pause.

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
- (Étape 3 livrée en 1.7.0 : le relief et les côtes sont maintenant ceux de la vraie Terre ; ce qui suit est l'ancien état) la mer de Lannion est au nord). La lune est simplement à l'opposé du soleil, sans phases.

### 1.3.0 — Un vrai ciel étoilé
- **5 044 vraies étoiles** (catalogue Hipparcos, magnitude ≤ 6, fichier `src/data/stars.json`) avec leur vraie position, leur éclat et leur couleur (bleutées, blanches, jaunes, orangées).
- Le ciel tourne comme le vrai : autour de l'étoile Polaire, inclinée selon la latitude, et il avance d'environ 1° par jour avec les saisons (la Polaire reste à ~48,7° de hauteur à Lannion).
- Les étoiles sont dessinées derrière le relief et l'eau (elles ne s'affichent plus sur le terrain) et s'éteignent près de l'horizon.
- Régénérer le fichier : `node scripts/build-stars.mjs chemin/vers/stars.6.json` (source : paquet npm `d3-celestial`, licence BSD-3 dans `src/data/STARS-LICENSE.txt`).
- Pas encore : Voie lactée, planètes, phases et vraie position de la lune, scintillement.

### 1.3.1 — Origine flottante (voyager loin sans défaut d'image)
- Le rendu n'utilise plus de grandes coordonnées : tout ce qui est envoyé à la carte graphique (tuiles, caméra, ciel, ombres, grain du sol, vagues) est exprimé par rapport à une **origine** qui saute sous le joueur par pas de 1 024 m dès qu'il s'en éloigne de plus de 1 536 m (`src/core/origin.ts`).
- Les positions du monde, le terrain et la sauvegarde restent inchangés (double précision).
- Constaté avant correction à 3 000 km de l'origine : grain du sol en bandes pixélisées, ombres du soleil cassées (sol sombre), vagues rayées. Après : identique à ce qu'on voit près de l'origine.
- Le saut d'origine est invisible (comparaison image par image : 0 % de pixels différents).
- Vérifié par tests jusqu'à 22 000 km (raccord exact du grain et des vagues) et en images à 3 000 km. Pas testé : un voyage réel d'une heure, ni une carte graphique réelle.

### 1.4.0 — Application installable (PWA) : mise à jour et installation
- **Bandeau « Nouvelle version disponible »** (`src/pwa/updates.ts`, `src/pwa/pwa.ts`) : le jeu cherche une nouvelle version à l'ouverture, au retour sur l'onglet et toutes les 30 min. Rien ne se recharge tout seul : bouton **Mettre à jour** (ou ✕ pour plus tard). Pendant qu'on joue, le bandeau est caché et un message discret prévient.
- **Invitation à installer** sur l'écran d'accueil (`src/pwa/install.ts`, règles pures dans `src/core/install.ts`) : « Plus tard » la reporte d'une semaine, trois fois au plus ; elle disparaît une fois installé. Bouton « Installer l'application » dans le menu, guide par appareil (ordinateur Chrome/Edge, Android, iPhone/iPad, Safari Mac, Firefox).
- Bouton **À jour ? Recharger** dans le menu (cherche la dernière version puis recharge).
- `public/sw.js` : service worker « réseau d'abord » (dernière version si en ligne, copie en cache hors ligne). Sa version est mise à jour par `npm run bump`. Il n'est pas actif avec `npm run dev`, seulement sur la version construite/en ligne.
- Icônes PNG + ICO + SVG (`public/icons/`), `public/manifest.webmanifest`.
- Pas testé : l'invite d'installation réelle de ton navigateur, l'installation sur ton Android, et l'arrivée réelle d'une mise à jour (elle se verra à la publication de la version suivante).

### 1.4.1 — Regard aux flèches et souris plus directe
- Les flèches font maintenant tourner la tête (≈ 92°/s, suit la sensibilité) et ne servent plus à marcher : on peut regarder et avancer en même temps au clavier.
- Capture de souris « brute » (`unadjustedMovement`) : pas d'accélération Windows ; repli automatique si le navigateur ne la gère pas. Les sauts de souris aberrants (> 600 px d'un coup) sont ignorés.
- Pas testé : le ressenti réel (pas de souris dans mon navigateur de test).

### 1.4.2 — Plus de message d'erreur de souris, plein écran permanent
- Quand le navigateur refuse la capture de la souris (typiquement juste après Échap ou pendant le passage en plein écran), le jeu réessaie sans bruit (2 fois) ; s'il échoue encore, seul le bouton « Clique pour reprendre » s'affiche, plus de message rouge.
- Plein écran : il est repris au premier clic ou à la première touche (sauf Échap) dès qu'il a été perdu, même sur les menus. Un navigateur interdit le plein écran sans geste de l'utilisateur : le tout premier clic suffit.
- Application installée : `display: fullscreen` dans le manifeste, donc ThyHorizon s'ouvre directement en plein écran, sans geste (à vérifier après réinstallation).
- Pas testé : le plein écran réel (mon navigateur de test ne l'accorde pas).

### 1.4.3 — Un seul clic pour entrer dans le monde
- Le plein écran et la capture de la souris étaient demandés en même temps : le navigateur refusait la souris et il fallait cliquer une deuxième fois. Maintenant le plein écran est établi d'abord, puis la souris est capturée, avec un seul clic.
- Pas testé : le comportement réel (mon navigateur de test n'accorde pas le plein écran).

### 1.5.0 — Commandes tactiles (téléphone, tablette)
- **Moitié gauche** de l'écran : un joystick flottant apparaît sous le pouce (zone morte, vitesse proportionnelle, à fond = course). **Moitié droite** : glisser pour regarder. Les deux se font en même temps (multi-doigts).
- Boutons à droite : **Courir** (bascule), **Vol** (bascule) ; en vol, ▲ et ▼ (maintenir) montent et descendent. **☰** (haut droite) ouvre le menu ; le bouton **Retour** du téléphone aussi.
- Détection automatique : écran tactile principal au démarrage, puis le dernier type de pointeur utilisé (doigt ou souris) décide quand on est dans un menu.
- Logique pure et testée : `src/core/touch.ts` ; interface : `src/player/touchUi.ts`. Plein écran demandé à l'entrée dans le monde ; pas de capture de souris au doigt.
- Vérifié en simulation de téléphone 360 px (doigts simulés) : marche, regard, les deux ensemble, Vol, ▲▼, menu, Retour. Pas testé : un vrai téléphone (confort du pouce, tailles, Firefox Android), un vrai iPhone.
- Pas encore : gyroscope (option B, à ajouter plus tard), réglage de sensibilité tactile distincte de la souris.

### 1.6.0 — Étoiles lumineuses et halo lumineux (bloom)
- **Étoiles** : on ne garde que les plus brillantes (magnitude ≤ 4, soit ≈ 520 sur 5 044), mais chacune a un cœur lumineux et un halo doux, d'autant plus grand qu'elle est brillante. Le catalogue complet reste dans `stars.json` (réglage `MAX_STAR_MAGNITUDE` dans `src/core/stars.ts`).
- **Réglage « Halo lumineux (soleil, étoiles) »** (bloom) : actif seulement dans le préréglage **Beau** (case modifiable à part dans Réglages, qui passe alors la qualité en « Personnalisée »). Il passe par une chaîne d'effets (`render/scene.ts`) : image en haute dynamique, 4 échantillons d'anticrénelage, halo autour des zones plus lumineuses que le seuil, recopie à l'écran.
- L'image avec bloom est volontairement **identique** à celle sans bloom (couleurs du ciel, brume, rendu cinéma) : seul le halo s'ajoute. Pour cela, les deux cibles de rendu sont déclarées « XR » (astuce Three.js ; à revérifier si on change de version de Three.js). Le ciel y est plafonné à 0,95 (hors disques du soleil et de la lune) pour que seuls le soleil, la lune et les étoiles brillent.
- **Anticrénelage** : déjà actif partout (MSAA natif du navigateur) ; avec bloom il est conservé (4 échantillons).
- Pas testé : le coût réel sur ta carte graphique et sur téléphone (mon navigateur de test n'a pas de GPU : ~10 i/s dans tous les cas), la compatibilité de la chaîne d'effets sur Firefox Android.

### 1.7.0 — Le vrai relief de la Terre (étape 3)
- Chaque point du monde a une vraie latitude et longitude (`src/core/geo.ts`, 1 m du jeu = 1 m réel, nord = −z). Le relief général (océans, côtes, plaines, massifs) vient de la grille réelle **ETOPO** (NOAA, domaine public, cases de 10 minutes d'arc ≈ 18 km) : `src/data/relief.bin` (0,9 Mo), fabriqué par `scripts/build-relief.mjs` (licence et origine dans `src/data/RELIEF-LICENSE.txt`). **Ne pas le modifier à la main.**
- Le terrain (`src/core/terrain.ts`) lit cette grille (interpolation cubique) puis ajoute un détail inventé (collines, bosses, crêtes) dont l'amplitude suit la **rugosité réelle** du lieu : la Bretagne a des collines douces, les Alpes de vraies montagnes. Les côtes sont redressées (plages, falaises) et ondulées (caps, baies).
- **Départ** : on part du bord de la Manche, ≈ 11 km au nord de Lannion (la ville est dans les terres), face à la mer (cap nord). Les anciennes sauvegardes (version 1) sont ignorées : leurs positions n'ont plus de sens.
- Couleurs adaptées aux vraies altitudes : herbe jusqu'à ~450 m, lande, roche vers 1 000–1 500 m, **neige** au-dessus de ~2 200 m (en attendant les biomes, étape 4).
- Chargement : `src/world/reliefLoader.ts` télécharge et décompresse le fichier (`DecompressionStream`, navigateurs de 2023 et après), puis le passe aux calculs de terrain en arrière-plan.
- Vérifié par tests (147) : mer au nord de Lannion et terre au sud, Atlantique, Alpes > 2 000 m, Himalaya, fond marin plafonné, pôles et ligne de changement de date sans erreur, départ à terre au bord de l'eau. Vérifié en captures : côte nord de Lannion, plaine bretonne, neige des Alpes.
- Pas testé : un long voyage à pied ou en vol à travers les continents ; les performances sur ta carte graphique (relief plus riche = tuiles un peu plus coûteuses à calculer) ; Firefox Android (`DecompressionStream`).
- Limites connues : résolution de ~18 km (une côte peut se décaler de quelques km par rapport à la réalité), pas de fleuves ni de lacs, un monde plus plat en Bretagne que l'ancien monde inventé, la vue est limitée à la distance d'affichage (en vol haut on ne voit plus le sol).

### 1.8.0 — Vue plus lointaine, étoiles plus naturelles, constellations
- **Distance d'affichage** : Éco 10, Normal 20, Beau 28 tuiles (le curseur va jusqu'à 36 ≈ 2,3 km).
- **Étoiles** : couleurs plus nuancées (proches du blanc, un léger bleu ou orangé), et **scintillement** discret propre à chaque étoile, plus marqué près de l'horizon.
- **Constellations** : traits des 89 constellations (d3-celestial, BSD-3 ; `src/data/constellations.json` fabriqué par `scripts/build-constellations.mjs`, **ne pas modifier à la main**). Touche **L**, bouton **✦** sur téléphone, ou case « Constellations » dans Réglages (réglage mémorisé, hors préréglages de qualité). Les traits pulsent doucement, apparaissent en fondu et ne se voient que la nuit.
- Vérifié : tests (155), build, captures de nuit (traits alignés sur les étoiles : Orion, Grande Ourse…) et de jour (invisibles). Pas testé : GPU réel, téléphone, coût en images/s de la distance 28 en mode Beau.
- Limite : la vue lointaine est limitée par la distance d'affichage (on voit encore le bord du monde en vol haut).

### 1.8.1 — Temps réel
- Réglages → Temps : case **Temps réel (vraie heure, journées de 24 h)**. L'heure et la date du jeu suivent alors la vraie horloge UTC, **à l'endroit où tu te trouves** (nuit à Paris = jour à Sydney ; depuis 1.12.1 l'heure et la latitude du soleil suivent ta position). `realSolarClock` (`src/core/geo.ts`) : heure solaire = heure UTC + longitude / 15 (midi solaire ≈ 11 h 46 UTC, soit 12 h 46 en heure d'hiver de Paris et 13 h 46 en heure d'été). L'équation du temps est ignorée (± 15 min).
- Tant que la case est cochée, les réglages date, heure, « les jours passent » et durée de journée sont grisés. En la décochant, le jeu repart de l'heure courante.
- Vérifié : tests (159), capture : un midi forcé est bien remplacé par la vraie heure (nuit). Pas testé : sur ton téléphone, ni le lever/coucher en vrai.

### 1.8.2 — Constellations plus discrètes
- Traits deux fois plus transparents (intensité 0,4 → 0,2 dans `LINE_VERTEX`, `src/render/sky.ts`). Se règle en une ligne si c'est encore trop ou pas assez.

### 1.9.0 — Les biomes : le vrai climat de la Terre (étape 4a)
- Le sol prend les couleurs du **vrai climat** du lieu : classification de **Köppen-Geiger** (grille de 0,5° ≈ 55 km, Kottek et al. 2006), fichier `src/data/climate.json` (78 Ko, inclus dans le code, fabriqué par `scripts/build-climate.mjs` — **ne pas le modifier à la main** ; origine et citation dans `src/data/STARS-LICENSE.txt`).
- `src/core/climate.ts` : un biome par classe (couleurs de la végétation basse, altitude de la neige), **mélangé en douceur** entre les 4 cases voisines (pas de frontière nette). La mer est remplie avec la terre la plus proche (les côtes ont un climat).
- Effets : désert ocre (Sahara), savane dorée, forêt équatoriale vert profond, taïga sombre, toundra brune, glace blanche aux pôles. La **limite des neiges** et les seuils lande/roche suivent le climat : 5 000 m sous les tropiques, 2 450 m en Bretagne et dans les Alpes, 700 m en toundra, glace partout en Antarctique. La Bretagne garde exactement ses couleurs d'avant.
- Pas encore : arbres et végétation (étape 4b, version suivante), saisons qui changent les couleurs.
- Limites : le climat est moyen sur 55 km (une vallée alpine et son sommet partagent la même classe ; seule l'altitude les distingue), pas de lacs ni de fleuves.

### 1.9.1 — Menu « Lieux du monde »
- Menu pause → **Lieux du monde** : 17 lieux (un par grand climat : Lannion, Provence, Alpes, Sahara, Sahel, Gobi, Atacama, Outback, Congo, Amazonie, Mékong, Pampa, Kazakhstan, Sibérie, Tibet, Groenland, Antarctique). Un appui = voyage au sol, face au nord. Liste dans `src/core/places.ts` (testée : sur la terre ferme, bon climat), fenêtre dans `src/ui/placesPanel.ts`.
- Vérifié : 176 tests, clic réel sur « Sahara » (position et fermeture), pas de débordement à 360 px. Pas vérifié visuellement : le rendu de la fenêtre (les captures du navigateur sans GPU n'affichent pas les fenêtres).

### 1.10.0 — Carte du monde (touche M) (étape 5)
- **M** (en jeu ou depuis le menu) ouvre une carte plein écran du monde : relief réel ombré, couleurs du climat (comme dans le jeu), quadrillage tous les 30°. Rond ambre = toi. **Glisser** pour se déplacer (le monde se referme sur lui-même), **molette** ou boutons +/− pour zoomer (jusqu'à ≈ 2,8 km par pixel), **clic** pour choisir un lieu, **Y aller** ou Entrée pour s'y rendre ; **M** referme. Bouton « Moi » pour recentrer.
- Voyage : on se pose au sol, face au nord. Un clic **en mer** envoie sur la côte la plus proche (recherche jusqu'à 6°) ; s'il n'y a aucune terre à moins de 6° (milieu du Pacifique), un message le dit et rien ne bouge.
- Technique : `src/core/worldmap.ts` (projection, zoom, couleurs, recherche de terre ; testé), `src/ui/worldMap.ts` (dessin). L'image du monde (1080 × 540) est calculée à la première ouverture, par morceaux (≈ 1 s), puis gardée.
- Vérifié : 189 tests, carte dessinée et vérifiée sur capture (continents, déserts, forêts, calottes), clic en mer au large du Sénégal → posé sur la côte, fermeture de la carte. Pas testé : au doigt, sur ta carte graphique, l'atterrissage dans des endroits très escarpés.
- Limites : pas de noms de pays ni de villes, pas de zoom au doigt (pincer), la mer ne montre pas la profondeur (relief marin plafonné à −200 m).

### 1.11.0 — Jour et nuit sur la carte
- La carte (M) assombrit la **nuit** d'après l'heure et la date du jeu (crépuscule en dégradé), avec un point jaune là où le soleil est au zénith. Bouton **Nuit** pour l'afficher ou le cacher. `subsolarPoint`, `sunElevationAt`, `nightAlpha` dans `src/core/worldmap.ts` : testés contre le vrai ciel du jeu (même hauteur de soleil à Lannion et ailleurs).
- L'ombre est calculée à chaque ouverture de la carte (le temps est figé tant qu'elle est ouverte). Elle ne montre pas la lune ni les saisons autrement que par la position du soleil.
- Vérifié : 195 tests, capture à 23 h 30 solaire en novembre (nuit sur l'Europe et l'Afrique, soleil dans le Pacifique sud). Pas testé : en « Temps réel » avec ton horloge.

### 1.12.0 — Arbres et forêts par climat (étape 4b)
- Des arbres bas-polygones, placés selon le **climat réel** (`src/core/trees.ts`) : forêt dense en Amazonie et au Congo, feuillus en Bretagne et en Europe, conifères en taïga et en altitude, **acacias à cime plate** en savane et au Sahel, presque rien dans les déserts, rien sur la glace. Les forêts forment de grandes taches avec des clairières ; en savane, des arbres isolés.
- Règles : pas sur la plage ni dans l'eau, pas sur les pentes de plus de ~29°, pas au-dessus de 60 % de la limite des neiges. Arbres plus petits près des pôles. Même graine = mêmes arbres.
- Rendu : les arbres sont ajoutés au maillage de chaque tuile (un seul objet 3D par tuile, 1 case de 8 m = au plus 1 arbre, ≈ 64 arbres par tuile au maximum). Tuiles proches : arbres détaillés ; tuiles moyennes (6 à 11 tuiles) : moitié moins nombreux et un peu plus gros ; au-delà : pas d'arbres. Ils projettent des ombres sur les tuiles proches.
- Vérifié : 204 tests (placement par climat, règles de terrain, forme, indices 16 bits), captures en forêt bretonne, au Congo (forêt dense avec ombres) et au Sahel (acacias). Pas testé : les performances sur ta carte graphique (jusqu'à ~12 000 arbres à l'écran en forêt dense), la taïga en capture, les montagnes boisées.
- Limites : pas de buissons ni d'herbes, pas de saisons (feuilles toujours vertes), les arbres lointains disparaissent d'un coup au-delà de ~11 tuiles (la couleur du sol reste verte).

### 1.13.0 — Le voilier jouable (simulation maritime, étape 1)
- **B** près de l'eau : met un voilier de croisière de 9,5 m à l'eau (l'eau profonde la plus proche, côté regard) et te fait monter à bord. **B** à moins de 18 m d'une côte : tu débarques, le bateau reste amarré (remonte avec **B** à moins de 45 m). Aussi : bouton « Voilier » du menu.
- Première personne sur le pont, au poste de barre. **A/D** : barre (elle revient au milieu quand on lâche ; **Espace** la recentre). **W** borde l'écoute, **S** la choque. Flèches et souris : regarder autour. Le pont tourne avec le bateau, la caméra gîte avec lui.
- **Le vent** (`src/core/wind.ts`) est simulé d'après les grandes ceintures de la Terre (alizés, vents d'ouest, vents d'est polaires) + météo lente (variation avec le lieu et l'heure) + rafales. Même lieu + même instant = même vent. Au large de Lannion on obtient typiquement 10 à 20 nœuds d'ouest-sud-ouest.
- **La physique** (`src/core/sailing.ts`, tests dans `sailing.test.ts`) : vent apparent = vent vrai − vitesse du bateau ; voile = aile (portance, traînée, décrochage à ~18°) ; l'angle de la bôme est min(écoute, angle du vent) donc une écoute trop choquée fait faseyer la voile ; quille = aile verticale (dérive 1 à 9°) ; résistance de coque avec vagues qui explosent vers 7 nœuds (vitesse de coque) ; gîte (couple de la voile contre redressement) qui crée de la barre au vent ; safran qui ne dirige que si le bateau avance ; échouage quand la coque touche le fond (profondeur < 1,6 m). Réglages mesurés par tests (12 nœuds de vent) : ≈ 5,3 nœuds au travers, ≈ 4,2 nœuds à 45° du vent vrai, ≈ 4,8 nœuds vent arrière, gîte ≈ 15° au près, impossible d'avancer face au vent.
- **Instruments** (en bas à droite) : rose (bateau, voile, vent vrai fin, vent apparent épais), cap compas, vitesse en nœuds, vent vrai et apparent (force + angle + bord), gîte, écoute, allure (au près, au travers, au largue…) et un conseil quand ça ne va pas (voile qui faseye, décrochée, trop de gîte, face au vent, échoué).
- Le bateau monte et descend avec les vagues visibles (`src/core/waves.ts`, partagé avec le shader de l'océan). Voiles recalculées à chaque image : creux côté sous le vent, battement quand elles faseyent.
- Limites connues (étapes suivantes) : pas de tangage ni de roulis dû à la houle ni de sillage (1.14), pas de vent réel (1.15), le bateau n'apparaît pas sur la carte (1.16), pas de sauvegarde du bateau (au rechargement, tu repars à l'endroit où tu as embarqué), la carte (M) ou un voyage te fait quitter le bateau (il reste en mer).
- Sauvegarde : à bord, c'est le point d'embarquement qui est enregistré (sinon on rechargerait en pleine mer).

### 1.13.1 — Un bien plus beau voilier
- Nouveau modèle 3D construit par le code (aucun fichier externe, donc aucun souci de droits) : coque galbée à étrave inclinée, carène antifouling rouge, liseré bleu et ligne de flottaison, tableau arrière, pont avec liston de teck, rambardes et balcons, cockpit creusé avec plancher et banquettes en teck, rouf aminci vers l'avant avec trois hublots par bord, entrée de descente (sombre pour l'instant), écoutille, aérateur, mât effilé avec barres de flèche, haubans, étai et pataras, bôme et écoute de grand-voile qui suit la bôme, grand-voile à lattes et rond de chute, foc sur enrouleur, quille à bulbe, safran, feux de navigation, treuils.
- Poste de barre à roue (la roue tourne avec le safran) ; tes yeux sont dans le cockpit derrière elle.
- Le plan du bateau est dans `LAYOUT` (`src/core/hull.ts`, testé) : il servira aux collisions pour marcher sur le pont (prochaine étape) et à la cabine intérieure ensuite.

### 1.13.2 — Rouf arrondi
- Le rouf n'est plus une boîte : flancs inclinés, toit bombé, nez arrondi vers l'avant (`buildCabin`, `src/render/boatParts.ts`).

### 1.14.0 — Penons et instruments cachables
- Trois paires de **penons** (rubans rouge côté tribord, vert côté bâbord) cousus sur la grand-voile. Droits vers l'arrière : voile bien réglée. Ruban du côté du vent qui se soulève : trop choqué (borde). Ruban sous le vent qui flotte : trop bordé, la voile décroche (choque). Sans vent, ils pendent.
- Touche **I** (et case dans Réglages) : cache ou montre les instruments, pour naviguer comme sur un vrai bateau. Logique pure : `penonFlow` dans `src/core/sailing.ts` (testée) ; dessin : `src/render/penons.ts`.

### 1.15.0 — Manœuvres de voiles : affaler, ris, foc roulé
- **Y** hisse (≈ 18 s) ou affale (≈ 7 s) la grand-voile ; **U** déroule ou roule le foc ; **X** prend un ris (jusqu'à 3), **C** en largue un. Les manœuvres sont progressives, la voile se déforme et descend sous tes yeux (paquet de toile sur la bôme, foc enroulé sur l'étai).
- Physique : surface et centre de voilure changent (`sailPlan` dans `src/core/sailing.ts`, testé). Moins de voile = moins de gîte ; sans grand-voile le bateau abat, sans foc il lofe. Nouvelle ligne « Voilure » dans les instruments (GV = grand-voile) et conseils (« prends un ris »).

### 1.16.0 — Marcher sur le pont et pilote automatique
- **E** : quitte la barre et te laisse marcher sur le pont (WASD ; **R** borde, **F** choque l'écoute). **E** près de la roue la reprend. Le rouf, la roue et les filières bloquent le passage (`src/core/deck.ts`, testé) ; le sol est plus bas dans le cockpit.
- **Pilote automatique (P)** : tient le cap du moment (régulateur PID, `autopilotHelm`) et règle l'écoute (`autoTrim`). Il s'allume tout seul quand tu quittes la barre ; A/D à la barre le coupe. Toucher R/F (ou W/S à la barre) reprend l'écoute à la main.
- Pas encore : l'intérieur de la cabine (la porte reste fermée), marcher sur le rouf.

### 1.17.0 — Météo hors ligne évolutive (nuages, pluie, brume)
- Le temps change tout seul, de façon cohérente avec le **lieu** (climat de Köppen : désert sec, tropiques avec saison des pluies, étés secs méditerranéens, hivers de dépressions…), la **saison** (hémisphère compris) et le **temps qui passe** (des perturbations traversent le monde en quelques jours). Logique pure : `src/core/weather.ts` (testée).
- Visible : **nuages** qui dérivent avec le vent et se grisent (ciel couvert = pas de soleil direct, pas d'étoiles), **pluie** (traînées devant la caméra), **brume** et brouillard (visibilité réduite, surtout au petit matin par temps calme).
- Le **vent** simulé est renforcé dans une perturbation et calmé sous un anticyclone. Le temps du lieu s'affiche dans les instruments du voilier.
- En ligne, la vraie météo la remplacera (1.19). Essai : `?debug` puis `__thy.weather({cloud:0.9, rain:0.6})`.

### 1.18.0 — Mer cohérente avec la météo
- La **houle** et le **clapot** dépendent du vent (loi de Pierson–Moskowitz) et des perturbations : une dépression lève une houle longue qui arrive et retombe lentement (environ 2 min 30 pour monter, 1 min 30 pour baisser). Logique pure : `src/core/sea.ts` (testée).
- Visible : **moutons** sur les crêtes quand la mer est forte, **eau translucide** (on devine le fond près du bord), **écume de rivage** où les vagues viennent mourir, **tangage et roulis** du bateau avec la houle (caméra comprise).
- Les instruments affichent l'état de mer (calme, belle, agitée, forte…). Essai : `?debug` puis `__thy.sea(3)` (hauteur significative en mètres).
- Pas encore : la mer ne freine pas encore la coque.

## Droits / migrations
Sans objet : jeu local, sans compte ni serveur.

## Dépannage
- Écran de secours après 8 s : « Réinitialiser et recharger » (garde tes sauvegardes).
- Saccades : choisis le préréglage « Éco » dans Réglages.
- Le jeu ne se met pas à jour : menu → « À jour ? Recharger ». Si ça bloque, « Réinitialiser et recharger ».
- La souris ne se capture pas : clique dans la fenêtre du jeu ; Échap libère la souris.

## Feuille de route
**Planète cousine de la Terre** (monde inventé, relief et climats guidés par la vraie Terre, départ à Lannion) :
1. ✅ Coordonnées lat/long + vrai soleil et saisons (1.2.0)
2. ✅ Déplacement de l'origine du rendu (voyager loin sans défaut d'image) (1.3.1)
3. ✅ Carte réelle de relief et d'océans à basse résolution, détail inventé par-dessus (1.7.0)
4. Biomes : a) ✅ climat réel → couleurs du sol, neige, désert, glace (1.9.0) ; b) ✅ arbres par biome (1.12.0)
5. ✅ Carte du monde et voyage (1.10.0) ; reste : saisie de coordonnées, noms de lieux

**Simulation maritime** : 1. ✅ voilier jouable, vent simulé, instruments (1.13.0) ; 2. ✅ beau modèle de bateau (1.13.1) → marcher sur le pont → cabine (refuge) → houle (tangage, roulis, sillage, mer qui se forme avec le vent) ; 3. vent réel Open-Meteo avec repli sur le vent simulé ; 4. navigation (bateau et route sur la carte, mouillage, polaires) ; puis cabine habitable, autres bateaux, sauvegarde du bateau.

**Ensuite** : Construction de maison · Couche JDR solo (journal, oracle, dés) · Sauvegardes IndexedDB (modifications du monde) · Son.

En ligne : https://horizon.thierry-morin.com (depuis 1.0.2).
