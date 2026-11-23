// Assemble le rendu : moteur 3D, caméra, lumières (soleil, lune, ciel), brume, ciel et océan.
// Ne contient aucune règle de jeu : il reçoit des états (heure, position) et les dessine.

import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/chunk';
import { lerpRgb } from '../core/math';
import type { Settings } from '../core/settings';
import type { SunState } from '../core/sun';
import { Ocean } from './ocean';
import { SkyDome, toColor } from './sky';

const SHADOW_EXTENT = 90; // demi-largeur de la zone ombrée autour du joueur, en mètres
const FOG_DENSITY_FACTOR = 2; // densité de brume ≈ 2 / distance d'affichage (le bord du monde disparaît dans la brume)
const LIGHT_SCALE = Math.PI; // Three.js divise l'éclairage diffus par π : on le compense pour que les valeurs de sun.ts restent lisibles
const NIGHT_FILL: [number, number, number] = [0.3, 0.4, 0.7]; // teinte bleutée de la lumière ambiante la nuit

// Bruit de valeur à trois échelles (≈ 1 m, 20 cm, 6 cm). Les échelles fines s'estompent avec la distance pour ne pas grésiller.
const GROUND_NOISE = /* glsl */ `
float gHash(vec2 p) { // nombre pseudo-aléatoire stable pour une case entière
  p = mod(p, 512.0); // on boucle pour garder de la précision loin de l'origine
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float gNoise(vec2 p) { // bruit de valeur lissé
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float groundGrain(vec3 wp, float dist) { // facteur de luminosité du sol (autour de 1)
  float coarse = gNoise(wp.xz * 1.1); // grandes taches
  float mid = gNoise(wp.xz * 4.3) * (1.0 - smoothstep(60.0, 220.0, dist)); // brins groupés, visibles de près
  float fine = gNoise(wp.xz * 15.0) * (1.0 - smoothstep(20.0, 90.0, dist)); // grain fin, tout près
  return 0.80 + 0.40 * (coarse * 0.5 + mid * 0.3 + fine * 0.2);
}
`;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer; // moteur de rendu
  readonly scene = new THREE.Scene(); // la scène 3D
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 6000); // caméra à la première personne
  readonly terrainMaterial: THREE.MeshStandardMaterial; // matériau commun du terrain
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1); // soleil (projette des ombres)
  private readonly moon = new THREE.DirectionalLight(0x8fa6ff, 0); // lune (lumière douce, sans ombre)
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 0.5); // lumière du ciel et du sol
  private readonly sky = new SkyDome();
  private readonly ocean = new Ocean();
  private readonly fog = new THREE.FogExp2(0xffffff, 0.001); // brume atmosphérique
  private readonly tmpColor = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private shadowSize = 0; // taille actuelle de la carte d'ombres
  private radiusMeters = 800; // distance d'affichage en mètres

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // peut échouer si WebGL est indisponible
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // rendu « cinéma » : hautes lumières douces
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement); // le canvas entre dans la page

    this.scene.fog = this.fog;
    this.scene.add(this.sky.dome, this.sky.stars, this.ocean.mesh);
    this.scene.add(this.hemi, this.moon, this.moon.target, this.sun, this.sun.target);

    this.sun.castShadow = true; // le soleil ombre le terrain proche
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.bias = -0.0004; // évite les ombres parasites
    this.sun.shadow.normalBias = 0.8;
    const s = this.sun.shadow.camera;
    s.left = -SHADOW_EXTENT; s.right = SHADOW_EXTENT; s.top = SHADOW_EXTENT; s.bottom = -SHADOW_EXTENT; // zone ombrée carrée

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, // couleurs portées par les sommets
      roughness: 0.96, // sol mat
      metalness: 0,
      side: THREE.DoubleSide, // les jupes entre niveaux de détail sont visibles des deux côtés
    });
    // Grain du sol : un bruit calculé dans le shader module la couleur (herbe, sable) sans aucune texture à charger.
    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;') // position monde transmise au fragment
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGroundPos;\n${GROUND_NOISE}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= groundGrain(vGroundPos, length(vViewPosition));');
    };
  }

  // Applique les réglages de qualité.
  applySettings(settings: Settings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * settings.resolution); // netteté
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const wantShadows = settings.shadows;
    if (this.renderer.shadowMap.enabled !== wantShadows) {
      this.renderer.shadowMap.enabled = wantShadows;
      this.terrainMaterial.needsUpdate = true; // le matériau doit être recompilé pour inclure/exclure les ombres
    }
    this.sun.castShadow = wantShadows;
    if (wantShadows && this.shadowSize !== settings.shadowSize) {
      this.shadowSize = settings.shadowSize;
      this.sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
      this.sun.shadow.map?.dispose(); // la carte d'ombres sera recréée à la bonne taille
      this.sun.shadow.map = null;
    }
    this.radiusMeters = settings.viewDistance * CHUNK_SIZE; // distance d'affichage
    this.ocean.setRadius(this.radiusMeters * 1.05); // l'eau déborde un peu pour que l'horizon soit propre
    this.fog.density = FOG_DENSITY_FACTOR / this.radiusMeters;
  }

  // À appeler quand la fenêtre change de taille.
  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Met à jour lumières, ciel, brume et océan pour l'état du soleil donné.
  updateEnvironment(state: SunState, timeSeconds: number): void {
    // Lumière du soleil : couleur et intensité selon la hauteur ; position suivie sur le joueur.
    toColor(state.sunColor, this.sun.color);
    this.sun.intensity = state.sunIntensity * LIGHT_SCALE;
    this.tmpDir.set(...state.sunDirection); // direction vers le soleil
    const dir = this.tmpDir;
    // Pour éviter le scintillement des ombres, la cible de l'ombre avance par pas d'un texel de la carte d'ombres.
    const texel = (2 * SHADOW_EXTENT) / (this.shadowSize || 1024);
    const up = Math.abs(dir.y) > 0.99 ? this.tmpUp.set(0, 0, 1) : this.tmpUp.set(0, 1, 0);
    const right = this.tmpRight.crossVectors(up, dir).normalize(); // axe « droite » vu depuis le soleil
    const trueUp = up.crossVectors(dir, right).normalize(); // axe « haut » vu depuis le soleil
    const p = this.camera.position;
    const px = p.dot(right); // position du joueur dans le repère du soleil
    const py = p.dot(trueUp);
    const target = this.tmpTarget.copy(p);
    target.addScaledVector(right, Math.round(px / texel) * texel - px); // alignée sur la grille de texels
    target.addScaledVector(trueUp, Math.round(py / texel) * texel - py);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(dir, 600); // le soleil est loin dans sa direction
    this.sun.target.updateMatrixWorld();

    // Lune : lumière bleutée, faible, sans ombre.
    this.moon.intensity = state.moonIntensity * LIGHT_SCALE;
    this.moon.position.copy(p).addScaledVector(this.tmpDir.set(...state.moonDirection), 600);
    this.moon.target.position.copy(p);
    this.moon.target.updateMatrixWorld();

    // Lumière ambiante : ciel au-dessus, sol (brun) en dessous.
    toColor(lerpRgb(NIGHT_FILL, lerpRgb(state.skyHorizon, state.skyTop, 0.5), state.daylight), this.hemi.color); // bleu la nuit, couleur du ciel le jour
    this.hemi.groundColor.setRGB(0.35, 0.3, 0.22, THREE.SRGBColorSpace).multiplyScalar(0.4 + 0.6 * state.daylight);
    this.hemi.intensity = state.ambientIntensity * LIGHT_SCALE;

    // Brume = couleur de l'horizon du ciel.
    toColor(state.skyHorizon, this.tmpColor);
    this.fog.color.copy(this.tmpColor);

    this.sky.update(state, this.camera);
    this.ocean.update(timeSeconds, state, this.camera);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
