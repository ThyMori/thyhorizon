// Les textures du bateau, dessinées par le code (aucun fichier image à charger).

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

// Lames de teck : des bandes plus ou moins sombres séparées par de fins joints, avec un léger veinage.
// Les lames courent dans le sens vertical de l'image (donc le long du bateau une fois posée).
export function teakTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(777); // même texture à chaque lancement
  if (ctx) {
    const plank = 32; // largeur d'une lame (px)
    for (let x = 0; x < size; x += plank) {
      const tone = 150 + Math.floor(rand() * 30); // chaque lame a sa teinte
      ctx.fillStyle = `rgb(${tone + 30}, ${tone - 10}, ${tone - 60})`;
      ctx.fillRect(x, 0, plank, size);
      for (let i = 0; i < 40; i++) { // veinage : traits fins presque verticaux
        ctx.strokeStyle = `rgba(80, 45, 15, ${0.05 + rand() * 0.1})`;
        ctx.lineWidth = 1;
        const gx = x + rand() * plank;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx + (rand() - 0.5) * 4, size);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40, 28, 16, 0.85)'; // joint noir (calfatage) entre les lames
      ctx.fillRect(x, 0, 2, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Gelcoat antidérapant du pont : un blanc cassé avec un très fin grain.
export function deckTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(4242);
  if (ctx) {
    ctx.fillStyle = '#ece8dc';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      const g = 205 + Math.floor(rand() * 40);
      ctx.fillStyle = `rgba(${g}, ${g}, ${g - 8}, 0.5)`;
      ctx.fillRect(rand() * size, rand() * size, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
