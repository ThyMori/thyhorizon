// Configuration de Vite (l'outil qui assemble et sert le jeu).
import { defineConfig } from 'vite'; // fonction d'aide qui donne l'autocomplétion

export default defineConfig({
  // Chemins relatifs : le jeu marche à la racine d'un sous-domaine comme dans un dossier.
  base: './',
  // Les "workers" (calculs en arrière-plan) sont emballés au format module moderne.
  worker: { format: 'es' },
  build: {
    // Dossier de sortie du build (ignoré par Git).
    outDir: 'dist',
    // Three.js est volumineux : on relève simplement le seuil d'avertissement.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Les tests ne touchent que la logique pure : pas besoin de navigateur simulé.
    environment: 'node',
    // Où chercher les fichiers de test.
    include: ['src/**/*.test.ts'],
  },
});
