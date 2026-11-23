// L'océan : un disque centré sur le joueur, animé par des vagues douces.
// Couleur = mélange entre l'eau profonde et le reflet du ciel (effet de Fresnel), plus le scintillement du soleil.
// L'eau est légèrement transparente : le fond marin, teinté de bleu dans ses couleurs, donne la profondeur.

import * as THREE from 'three';
import { buildPolarGrid } from '../core/polar';
import type { SunState } from '../core/sun';
import { toColor } from './sky';

// Vagues : somme de sinusoïdes dans des directions différentes (houle large + petites rides).
const WAVES = /* glsl */ `
float waveLow(vec2 p, float t) { // vagues larges, utilisées pour déformer la surface
  float h = 0.0;
  h += 0.35 * sin(dot(p, vec2( 0.80, 0.60)) * 0.090 + t * 0.90); // houle principale (~70 m)
  h += 0.22 * sin(dot(p, vec2(-0.55, 0.83)) * 0.140 + t * 1.20);
  h += 0.12 * sin(dot(p, vec2( 0.95, -0.31)) * 0.260 + t * 1.60);
  return h;
}
float waveFull(vec2 p, float t) { // toutes les vagues, utilisées pour calculer les reflets
  float h = waveLow(p, t);
  h += 0.07  * sin(dot(p, vec2(-0.20, -0.98)) * 0.470 + t * 2.10);
  h += 0.035 * sin(dot(p, vec2( 0.60, -0.80)) * 0.900 + t * 2.90);
  h += 0.018 * sin(dot(p, vec2( 0.30,  0.95)) * 1.700 + t * 3.70); // petites rides
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
varying vec3 vWorld;
#include <fog_pars_fragment>
${WAVES}
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
  float alpha = clamp(0.74 + 0.26 * fres, 0.0, 1.0); // plus transparente quand on regarde vers le bas
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

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
