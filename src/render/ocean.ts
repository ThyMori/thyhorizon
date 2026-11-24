// L'océan : un disque centré sur le joueur, animé par des vagues douces.
// Couleur = mélange entre l'eau profonde et le reflet du ciel (effet de Fresnel), plus le scintillement du soleil.
// L'eau est légèrement transparente : le fond marin, teinté de bleu dans ses couleurs, donne la profondeur.

import * as THREE from 'three';
import { Origin, NO_ORIGIN, wavePhase } from '../core/origin';
import { buildPolarGrid } from '../core/polar';
import { SeaState, waveScales } from '../core/sea';
import { LOW_WAVES, MAIN_WAVE_ANGLE, WAVE_DEFS, waveDir } from '../core/waves'; // les vagues sont définies dans la logique pure (partagées avec le bateau)
import type { SunState } from '../core/sun';
import { toColor } from './sky';

// Texte GLSL d'une somme de vagues. Les positions sont relatives à l'origine flottante : uPh[i] rend à chaque vague sa phase dans le monde.
const waveSum = (count: number): string =>
  WAVE_DEFS.slice(0, count)
    .map((d, i) => `  h += ${d.amp} * uAmpScale[${i}] * sin(dot(p, uDir[${i}]) * ${d.k} + t * ${d.w} + uPh[${i}]);`)
    .join('\n');

const WAVES = /* glsl */ `
uniform vec2 uDir[${WAVE_DEFS.length}]; // direction de chaque vague (tournée selon la houle réelle)
uniform float uPh[${WAVE_DEFS.length}]; // déphasage de chaque vague (origine flottante)
uniform float uAmpScale[${WAVE_DEFS.length}]; // facteur d'amplitude de chaque vague (état de mer)
float waveLow(vec2 p, float t) { // vagues larges, utilisées pour déformer la surface
  float h = 0.0;
${waveSum(LOW_WAVES)}
  return h;
}
float waveFull(vec2 p, float t) { // toutes les vagues, utilisées pour calculer les reflets
  float h = 0.0;
${waveSum(WAVE_DEFS.length)}
  return h;
}
`;

const VERTEX = /* glsl */ `
uniform float uTime; // temps en secondes
varying vec3 vWorld; // position dans le monde
#include <fog_pars_vertex>
${WAVES}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0); // position dans le monde
  wp.y += waveLow(wp.xz, uTime); // la surface ondule
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp; // position dans le repère de la caméra
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uTop; // zénith (pour le reflet du ciel)
uniform vec3 uHorizon; // horizon (idem)
uniform vec3 uSunDir; // direction du soleil
uniform vec3 uSunColor; // couleur du soleil
uniform float uSunVis; // visibilité du soleil
uniform float uDaylight; // 0 nuit, 1 jour
uniform vec3 uWater; // couleur de l'eau profonde
uniform float uFoam; // part de crêtes qui moutonnent (0 à 1)
uniform float uCrest; // hauteur maximale possible des vagues (m) : sert à repérer les crêtes
uniform vec2 uWaveDir; // sens de déplacement des vagues (pour faire avancer l'écume avec elles)
varying vec3 vWorld;
#include <fog_pars_fragment>
${WAVES}
float oHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float oNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(oHash(i), oHash(i + vec2(1.0, 0.0)), f.x), mix(oHash(i + vec2(0.0, 1.0)), oHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 toCam = cameraPosition - vWorld; // du point vers la caméra
  float dist = length(toCam); // distance à la caméra
  vec3 V = toCam / dist; // direction de la vue
  float e = 0.12 + dist * 0.003; // pas de dérivation, plus grand au loin pour éviter le grésillement
  float h0 = waveFull(vWorld.xz, uTime);
  float hx = waveFull(vWorld.xz + vec2(e, 0.0), uTime);
  float hz = waveFull(vWorld.xz + vec2(0.0, e), uTime);
  vec3 N = normalize(vec3(-(hx - h0) / e * 1.6, 1.0, -(hz - h0) / e * 1.6)); // normale de la surface
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 500.0, 0.0, 0.85))); // lisse l'eau au loin
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0); // Fresnel : plus on regarde rasant, plus l'eau reflète
  vec3 R = reflect(-V, N); // direction du reflet
  vec3 sky = mix(uHorizon, uTop, pow(max(R.y, 0.0), 0.5)); // couleur du ciel reflété
  float rs = max(dot(R, uSunDir), 0.0); // alignement du reflet avec le soleil
  vec3 glint = uSunColor * (pow(rs, 700.0) * 20.0 + pow(rs, 90.0) * 0.8 + pow(rs, 8.0) * 0.1) * uSunVis; // scintillement du soleil
  vec3 deep = uWater * mix(0.12, 1.0, uDaylight); // l'eau est plus sombre la nuit
  vec3 col = mix(deep, sky, fres) + glint * (0.35 + 0.65 * fres);
  float alpha = mix(0.34, 1.0, fres); // transparente quand on regarde vers le bas (on voit le fond), opaque en rasant
  alpha = max(alpha, smoothstep(250.0, 800.0, dist)); // au loin, l'eau est opaque (pas de ciel visible à travers)
  // Moutons : l'écume apparaît sur les crêtes, plus nombreuse quand la mer est forte. Elle avance avec les vagues.
  if (uFoam > 0.01) {
    float crest = clamp(h0 / max(uCrest, 0.05), -1.0, 1.0);
    float breakup = oNoise(vWorld.xz * 0.9 - uWaveDir * uTime * 7.0) * 0.6 + oNoise(vWorld.xz * 2.7 - uWaveDir * uTime * 6.0) * 0.4;
    float thr = 0.78 - 0.55 * uFoam;
    float foam = smoothstep(thr, thr + 0.22, crest + 0.45 * (breakup - 0.5));
    foam *= 1.0 - smoothstep(500.0, 1500.0, dist) * 0.7; // l'écume lointaine s'estompe (sinon elle grésille)
    vec3 foamCol = vec3(0.82, 0.86, 0.9) * mix(0.12, 1.0, uDaylight) * (0.55 + 0.45 * uSunVis);
    col = mix(col, foamCol, foam * 0.9);
    alpha = max(alpha, foam * 0.95);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private origin: Origin = NO_ORIGIN; // dernière origine flottante (pour recalculer les déphasages quand la mer tourne)
  private turn = 0; // rotation actuelle de la mer (rad)

  constructor() {
    const grid = buildPolarGrid(110, 160, 0.0015); // anneaux denses près du centre, larges au loin
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog, // variables de la brume (couleur, densité)
        {
          uTime: { value: 0 },
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uSunVis: { value: 1 },
          uDaylight: { value: 1 },
          uWater: { value: toColor([0.05, 0.27, 0.3]) }, // vert-bleu de l'Atlantique
          uDir: { value: WAVE_DEFS.map((d) => new THREE.Vector2(d.dx, d.dz)) }, // directions des vagues (mises à jour par setWaveTurn)
          uPh: { value: WAVE_DEFS.map(() => 0) }, // déphasages des vagues (mis à jour par setOrigin)
          uAmpScale: { value: WAVE_DEFS.map(() => 1) }, // amplitude de chaque vague (état de mer)
          uFoam: { value: 0 },
          uCrest: { value: 1 },
          uWaveDir: { value: new THREE.Vector2(-Math.cos(MAIN_WAVE_ANGLE), -Math.sin(MAIN_WAVE_ANGLE)) },
        },
      ]),
      fog: true, // l'eau se fond dans la brume
      transparent: true,
      depthWrite: false, // l'eau transparente n'écrit pas dans la profondeur
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false; // toujours dessiné (il suit la caméra)
    this.mesh.renderOrder = 10; // dessiné après le terrain opaque
  }

  // Recalcule le déphasage des vagues quand l'origine flottante change : la mer garde sa forme dans le monde.
  setOrigin(origin: Origin = NO_ORIGIN): void {
    this.origin = origin;
    this.material.uniforms.uPh!.value = WAVE_DEFS.map((d, i) => {
      const dir = waveDir(i, this.turn); // direction tournée
      return wavePhase(origin, dir.dx, dir.dz, d.k);
    });
  }

  // Tourne toute la mer (houle réelle) : les directions et les déphasages sont recalculés, le bateau utilise la même rotation.
  setWaveTurn(turn: number): void {
    if (turn === this.turn) return;
    this.turn = turn;
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    u.uDir!.value = WAVE_DEFS.map((_, i) => {
      const d = waveDir(i, turn);
      return new THREE.Vector2(d.dx, d.dz);
    });
    const main = waveDir(0, turn);
    (u.uWaveDir!.value as THREE.Vector2).set(-main.dx, -main.dz); // sens de déplacement des vagues = opposé au vecteur « d'où elles viennent »
    this.setOrigin(this.origin); // déphasages recalculés pour les nouvelles directions
  }

  // État de mer : amplitude des vagues et part de moutons.
  setSea(sea: SeaState): void {
    const scales = waveScales(sea);
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    u.uAmpScale!.value = scales;
    u.uFoam!.value = sea.foam;
    u.uCrest!.value = WAVE_DEFS.reduce((sum, d, i) => sum + d.amp * scales[i]!, 0);
  }

  // Rayon du disque d'eau en mètres (au moins la distance d'affichage).
  setRadius(radius: number): void {
    this.mesh.scale.set(radius, 1, radius);
  }

  // Met à jour les vagues et les couleurs, et recentre l'océan sur la caméra.
  update(timeSeconds: number, state: SunState, camera: THREE.Camera): void {
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    u.uTime!.value = timeSeconds;
    toColor(state.skyTop, u.uTop!.value as THREE.Color);
    toColor(state.skyHorizon, u.uHorizon!.value as THREE.Color);
    toColor(state.sunColor, u.uSunColor!.value as THREE.Color);
    (u.uSunDir!.value as THREE.Vector3).set(...state.sunDirection);
    u.uSunVis!.value = state.sunVisibility;
    u.uDaylight!.value = state.daylight;
    this.mesh.position.set(camera.position.x, 0, camera.position.z); // niveau de la mer = 0, centré sur le joueur
  }
}
