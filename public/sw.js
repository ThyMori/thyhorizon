// Service worker de ThyHorizon : coquille d'application hors ligne.
// Stratégie « réseau d'abord » : les mises à jour publiées sur GitHub Pages apparaissent tout de suite ;
// si le réseau manque, on retombe sur la copie gardée. Les fichiers du jeu (noms à empreinte, générés par Vite)
// sont gardés au fur et à mesure qu'ils sont chargés. Les appels à d'autres sites (ex. la météo réelle Open-Meteo, option) ne passent jamais par ici : ils ne sont pas mis en cache.

const VERSION = "1.44.0"; // géré par scripts/bump-version.mjs : ne jamais modifier à la main
const CACHE = `thyhorizon-shell-${VERSION}`; // nom du cache de cette version
const SHELL = ["./", "index.html", "manifest.webmanifest", "favicon.ico", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"]; // fichiers de base à garder dès l'installation

// Installation : on garde la coquille, fichier par fichier (un fichier manquant ne bloque pas les autres), puis on prend la main tout de suite.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))));
  self.skipWaiting();
});

// Activation : on supprime les caches des anciennes versions, puis on contrôle les pages ouvertes.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Chaque requête : réseau d'abord (en revalidant toujours auprès du serveur), copie gardée en secours.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // on ne touche qu'aux lectures
  if (new URL(request.url).origin !== self.location.origin) return; // ni aux autres sites

  event.respondWith(
    // « no-cache » : on revalide toujours (GitHub Pages garde les fichiers en cache ~10 min), pour ne jamais mélanger d'anciens et de nouveaux fichiers.
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)); // on garde la copie pour le hors ligne
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("index.html") : Response.error())),
      ),
  );
});
