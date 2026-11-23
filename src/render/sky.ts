// Le ciel : un dôme dégradé (zénith → horizon), le disque du soleil et son halo, la lune et les étoiles.
// Les couleurs viennent de core/sun.ts ; la couleur d'horizon sert aussi pour la brume, donc le raccord est parfait.

import * as THREE from 'three';
import { Segment, buildLineBuffers } from '../core/constellations';
import { smoothstep } from '../core/math';
import { MAX_STAR_MAGNITUDE, StarRow, buildStarBuffers } from '../core/stars';
import type { SunState } from '../core/sun';
import constellationData from '../data/constellations.json';
import catalog from '../data/stars.json';

// Dôme de ciel : la direction vers chaque pixel suffit à calculer sa couleur.
const VERTEX = /* glsl */ `
varying vec3 vDir; // direction du pixel dans le monde
void main() {
  vDir = position; // la sphère est centrée sur la caméra : la position EST la direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); // projection habituelle
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTop; // couleur du zénith
uniform vec3 uHorizon; // couleur de l'horizon
uniform vec3 uSunDir; // direction du soleil
uniform vec3 uSunColor; // couleur du soleil
uniform vec3 uGlow; // couleur du halo autour du soleil
uniform float uSunVis; // visibilité du disque solaire
uniform vec3 uMoonDir; // direction de la lune
uniform float uMoonVis; // visibilité de la lune
uniform float uMaxLight; // plafond de lumière (le soleil est plafonné quand le bloom est actif, sinon son halo noie l'écran)
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); // direction du regard
  float y = d.y; // hauteur de la direction (-1 sol, 1 zénith)
  vec3 col = mix(uHorizon, uTop, pow(max(y, 0.0), 0.5)); // dégradé horizon → zénith
  float sd = max(dot(d, uSunDir), 0.0); // alignement avec le soleil
  col += uGlow * (pow(sd, 6.0) * 0.25 + pow(sd, 40.0) * 0.45 + pow(sd, 400.0) * 1.4); // halo en trois couches
  vec3 bright = uSunColor * smoothstep(0.99965, 0.99985, sd) * 6.0 * uSunVis; // disque solaire
  float md = max(dot(d, uMoonDir), 0.0); // alignement avec la lune
  bright += vec3(0.75, 0.82, 1.0) * smoothstep(0.9996, 0.9998, md) * 1.6 * uMoonVis; // disque lunaire
  if (uMaxLight < 100.0) { // bloom actif : le ciel lui-même ne dépasse jamais 0,95 (il ne « brille » pas en entier), seuls les disques du soleil et de la lune dépassent
    col = min(col, vec3(0.95));
    bright = min(bright, vec3(uMaxLight));
  }
  gl_FragColor = vec4(col + bright, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Étoiles : chaque point est un petit disque doux. Taille, éclat et couleur viennent du catalogue.
const STAR_VERTEX = /* glsl */ `
attribute float aSize; // taille en pixels
attribute float aBright; // éclat 0 à 1
attribute vec3 aColor; // couleur (linéaire)
attribute float aSeed; // graine propre à l'étoile (0 à 1)
uniform float uTime; // temps en secondes (pour le scintillement)
uniform float uPixelRatio; // densité de pixels de l'écran
uniform float uOpacity; // visibilité globale (selon la nuit)
varying vec3 vColor;
void main() {
  vec3 dir = normalize(mat3(modelMatrix) * position); // direction de l'étoile dans le monde
  float horizon = smoothstep(-0.02, 0.14, dir.y); // les étoiles s'éteignent près de l'horizon (brume) et sous lui
  // Scintillement : deux ondes de vitesses propres à l'étoile ; plus fort près de l'horizon (plus d'air traversé), très doux au zénith.
  float amp = mix(0.28, 0.07, smoothstep(0.05, 0.6, dir.y));
  float tw = 1.0 - amp * (0.5 + 0.25 * sin(uTime * (1.7 + aSeed * 2.3) + aSeed * 40.0) + 0.25 * sin(uTime * (3.1 + aSeed * 3.7) + aSeed * 90.0));
  vColor = aColor * aBright * uOpacity * horizon * tw; // couleur finale (sera ajoutée au ciel)
  gl_PointSize = aSize * uPixelRatio; // taille à l'écran
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
// Traits des constellations : fins, bleu pâle, avec une pulsation lente propre à chaque trait.
const LINE_VERTEX = /* glsl */ `
attribute float aSeed; // graine propre au trait
uniform float uTime; // temps en secondes
uniform float uOpacity; // visibilité globale (nuit × demande du joueur)
varying vec3 vColor;
void main() {
  vec3 dir = normalize(mat3(modelMatrix) * position); // direction dans le monde
  float horizon = smoothstep(0.0, 0.16, dir.y); // les traits s'éteignent vers l'horizon
  float pulse = 0.65 + 0.35 * sin(uTime * (0.8 + aSeed * 1.2) + aSeed * 30.0); // pulsation douce
  vColor = vec3(0.55, 0.72, 1.0) * 0.2 * uOpacity * horizon * pulse; // pâle, sans éblouir
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LINE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uBoost; // surbrillance du cœur quand le bloom est actif (1 sinon)
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0; // distance au centre du point (0 centre, 1 bord)
  float core = exp(-d * d * 30.0); // cœur très fin et lumineux
  float halo = exp(-d * d * 4.5) * 0.5; // halo doux autour
  float a = (core * uBoost + halo) * smoothstep(1.0, 0.8, d); // la bordure s'éteint (pas de carré visible)
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Convertit une couleur sRGB du module de logique en couleur Three.js (linéaire).
export const toColor = (rgb: readonly [number, number, number], target = new THREE.Color()): THREE.Color =>
  target.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

const STAR_RADIUS = 2500; // rayon de la sphère des étoiles, en mètres (plus petit que le dôme)

export class SkyDome {
  readonly dome: THREE.Mesh; // le dôme
  readonly stars: THREE.Points; // les étoiles
  readonly lines: THREE.LineSegments; // les traits des constellations
  private readonly lineMaterial: THREE.ShaderMaterial;
  private lineLevel = 0; // 0 (cachés) à 1 (visibles), pour un fondu
  private lineWanted = false; // le joueur veut-il les voir ?
  private lastTime = 0; // dernier instant, pour le fondu
  private readonly starMaterial: THREE.ShaderMaterial; // leur matériau
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Color(); // couleur de travail réutilisée

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunVis: { value: 1 },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uMoonVis: { value: 0 },
        uMaxLight: { value: 1000 }, // sans bloom : pas de plafond
      },
      toneMapped: false, // pas de « rendu cinéma » sur le ciel : sa couleur d'horizon doit être EXACTEMENT celle de la brume (qui, elle, n'est pas retouchée)
      side: THREE.BackSide, // on voit l'intérieur de la sphère
      depthWrite: false, // le ciel ne cache jamais rien
      depthTest: false, // et ne se fait jamais cacher
      fog: false, // il définit lui-même la couleur de la brume
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.dome.scale.setScalar(3000); // rayon 3000 m, plus petit que le plan lointain de la caméra (6000)
    this.dome.renderOrder = -1000; // dessiné en premier
    this.dome.frustumCulled = false; // toujours dessiné

    // Les vraies étoiles du catalogue Hipparcos (magnitude ≤ 6), placées dans le repère équatorial :
    // la rotation du ciel (latitude, saison, heure) est appliquée à tout le nuage par une matrice.
    const buffers = buildStarBuffers(catalog.stars as unknown as StarRow[], STAR_RADIUS, MAX_STAR_MAGNITUDE);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(buffers.sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(buffers.brightness, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(buffers.colors, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(buffers.seeds, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 }, uBoost: { value: 1 }, uTime: { value: 0 } },
      blending: THREE.AdditiveBlending, // la lumière des étoiles s'ajoute à celle du ciel
      transparent: false, // dessiné AVANT le terrain (file des objets opaques) : le sol et l'eau les cachent
      depthTest: false, // pas de test de profondeur : l'ordre de dessin suffit
      depthWrite: false, // les étoiles ne cachent rien
      toneMapped: false, // même traitement que le dôme du ciel
      fog: false,
    });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.stars.renderOrder = -999; // juste après le dôme, avant tout le reste
    this.stars.frustumCulled = false; // toujours dessiné
    this.stars.matrixAutoUpdate = false; // sa matrice (rotation du ciel + position de la caméra) est posée à la main

    // Les traits des constellations, dans le même repère que les étoiles.
    const lineBuffers = buildLineBuffers(constellationData.segments as unknown as Segment[], STAR_RADIUS);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(lineBuffers.positions, 3));
    lineGeometry.setAttribute('aSeed', new THREE.BufferAttribute(lineBuffers.seeds, 1));
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      blending: THREE.AdditiveBlending, // la lumière des traits s'ajoute
      transparent: false, // dessinés avant le terrain, comme les étoiles
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(lineGeometry, this.lineMaterial);
    this.lines.renderOrder = -998; // juste après les étoiles
    this.lines.frustumCulled = false;
    this.lines.matrixAutoUpdate = false; // même matrice que les étoiles
    this.lines.visible = false; // caché tant qu'on ne les demande pas
  }

  // Met à jour le ciel pour l'état donné et le recentre sur la caméra.
  update(state: SunState, camera: THREE.Camera, timeSeconds = 0): void {
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    toColor(state.skyTop, u.uTop!.value as THREE.Color);
    toColor(state.skyHorizon, u.uHorizon!.value as THREE.Color);
    toColor(state.sunColor, u.uSunColor!.value as THREE.Color);
    // Le halo est plus fort quand le soleil est bas (lumière rasante) et plus discret au zénith.
    const glowStrength = (1 - 0.65 * smoothstep(5, 40, state.elevationDeg)) * state.sunVisibility;
    toColor(state.sunColor, this.tmp).multiplyScalar(glowStrength);
    (u.uGlow!.value as THREE.Color).copy(this.tmp);
    (u.uSunDir!.value as THREE.Vector3).set(...state.sunDirection);
    (u.uMoonDir!.value as THREE.Vector3).set(...state.moonDirection);
    u.uSunVis!.value = state.sunVisibility;
    u.uMoonVis!.value = state.starsOpacity; // la lune se montre quand les étoiles se montrent
    this.starMaterial.uniforms.uOpacity!.value = state.starsOpacity; // les étoiles apparaissent après le crépuscule
    const r = state.starRotation; // rotation du ciel : latitude, jour de l'année, heure
    this.stars.matrix.set(r[0]!, r[1]!, r[2]!, camera.position.x, r[3]!, r[4]!, r[5]!, camera.position.y, r[6]!, r[7]!, r[8]!, camera.position.z, 0, 0, 0, 1); // rotation + suit la caméra
    this.stars.matrixWorldNeedsUpdate = true; // la matrice a changé
    this.starMaterial.uniforms.uTime!.value = timeSeconds % 3600; // scintillement (borné : garde la précision)
    // Traits : fondu d'environ 1 s vers l'état voulu ; invisibles de jour (starsOpacity = 0).
    const dt = Math.min(0.25, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;
    this.lineLevel = Math.min(1, Math.max(0, this.lineLevel + (this.lineWanted ? dt : -dt)));
    this.lineMaterial.uniforms.uOpacity!.value = this.lineLevel * state.starsOpacity;
    this.lineMaterial.uniforms.uTime!.value = timeSeconds % 3600;
    this.lines.visible = this.lineLevel > 0 && state.starsOpacity > 0;
    this.lines.matrix.copy(this.stars.matrix);
    this.lines.matrixWorldNeedsUpdate = true;
    this.dome.position.copy(camera.position); // le ciel suit la caméra : on ne s'en approche jamais
  }

  // Affiche ou cache les traits des constellations (avec un fondu).
  setConstellations(on: boolean): void {
    this.lineWanted = on;
  }

  // Surbrillance du cœur des étoiles : 1 normalement, plus quand le bloom est actif (il en fait un vrai halo).
  setGlowBoost(boost: number, sunCap = 1000): void {
    this.starMaterial.uniforms.uBoost!.value = boost;
    this.material.uniforms.uMaxLight!.value = sunCap; // plafond du ciel (soleil compris)
  }

  // Densité de pixels de l'écran (pour que les étoiles gardent la même taille sur un écran très fin).
  setPixelRatio(ratio: number): void {
    this.starMaterial.uniforms.uPixelRatio!.value = ratio;
  }
}
