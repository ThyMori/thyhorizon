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
Adresse : https://thymori.github.io/ThyHorizon/ (mise à jour automatiquement à chaque livraison, environ 1 à 2 minutes).
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

## Droits / migrations
Sans objet : jeu local, sans compte ni serveur.

## Dépannage
- Écran de secours après 8 s : « Réinitialiser et recharger » (garde tes sauvegardes).
- Saccades : choisis le préréglage « Éco » dans Réglages.
- La souris ne se capture pas : clique dans la fenêtre du jeu ; Échap libère la souris.

## Feuille de route
1. Bateau à voile · 2. Construction de maison · 3. Couche JDR solo (journal, oracle, dés) · 4. Sauvegardes IndexedDB (modifications du monde) · 5. Son · 6. Mise en ligne possible sur horizon.thierry-morin.com (adresse provisoire ; GitHub Pages + fichier CNAME).
