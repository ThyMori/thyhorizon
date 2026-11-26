// L'eau douce (rivières, lacs) : un matériau animé et transparent, commun à toutes les tuiles qui ont de l'eau.
// Les rides suivent le courant de la rivière (nul dans un lac, où une légère brise les pousse), la surface reflète le ciel (effet de Fresnel)
// et le soleil scintille sur les rides. La rive est douce : l'eau devient transparente là où elle est peu profonde.
// Les rides sont une somme d'ondes dont les directions sont des multiples entiers de la période du monde (WATER_PERIOD) :
// elles se raccordent donc d'une tuile à l'autre sans coupure, même loin de l'origine.

import * as THREE from 'three';
import { WATER_PERIOD } from '../core/chunk';
import { waterColor } from '../core/palette';
import type { SunState } from '../core/sun';
import { toColor } from './sky';

// Les ondes : vecteur (a, b) en périodes du monde (longueur d'onde = WATER_PERIOD / |(a, b)|, de 2 à 4 m), et pente maximale de chacune.
const RIPPLES: readonly { a: number; b: number; slope: number; layer: number }[] = [
  { a: 700, b: 700, slope: 0.05, layer: 0 },
  { a: 1000, b: -300, slope: 0.045, layer: 0 },
  { a: -450, b: 1200, slope: 0.04, layer: 0 },
  { a: 1500, b: 200, slope: 0.035, layer: 1 },
  { a: 300, b: -1800, slope: 0.03, layer: 1 },
  { a: -2000, b: -900, slope: 0.025, layer: 1 },
];

// Texte GLSL de la somme des ondes : renvoie la pente (dérivée) de la surface en (x, z).
const rippleSum = (): string =>
  RIPPLES.map((r, i) => {
    const len = Math.hypot(r.a, r.b);
    const layerFlow = r.layer === 0 ? 'p0' : 'p1'; // deux couches avancent à des vitesses un peu différentes
    return `  { float ph = TAU * fract(dot(vec2(${r.a.toFixed(1)}, ${r.b.toFixed(1)}), ${layerFlow}) / ${WATER_PERIOD.toFixed(1)}) + ${(i * 1.7).toFixed(2)}; g += vec2(${(r.a / len).toFixed(4)}, ${(r.b / len).toFixed(4)}) * (cos(ph) * ${r.slope.toFixed(3)}); }`;
  }).join('\n');

const VERTEX = /* glsl */ `
attribute float aDepth; // profondeur de l'eau à ce sommet
attribute vec2 aFlow; // courant (m/s)
attribute vec2 aWorld; // position dans le monde modulo la période des rides
varying float vDepth;
varying vec2 vFlow;
varying vec2 vWorld2;
varying vec3 vPos;
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vFlow = aFlow;
  vWorld2 = aWorld;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uTop; // zénith (reflet du ciel)
uniform vec3 uHorizon; // horizon (idem)
uniform vec3 uSunDir; // direction du soleil
uniform vec3 uSunColor; // couleur du soleil
uniform float uSunVis; // visibilité du soleil
uniform float uDaylight; // 0 nuit, 1 jour
uniform vec3 uShallow; // couleur de l'eau peu profonde
uniform vec3 uDeep; // couleur de l'eau profonde
varying float vDepth;
varying vec2 vFlow;
varying vec2 vWorld2;
varying vec3 vPos;
#include <fog_pars_fragment>
const float TAU = 6.28318530718;
void main() {
  vec3 toCam = cameraPosition - vPos; // du point vers la caméra
  float dist = length(toCam);
  vec3 V = toCam / dist; // direction de la vue
  // Courant : une brise légère pousse les rides d'un lac ; dans une rivière elles suivent l'eau.
  vec2 flow = dot(vFlow, vFlow) > 1e-6 ? vFlow : vec2(0.12, 0.07);
  vec2 p0 = vWorld2 - flow * uTime; // première couche de rides
  vec2 p1 = vWorld2 - flow * uTime * 1.45 + vec2(0.37, -0.21) * sin(uTime * 0.3); // deuxième couche, un peu plus rapide
  vec2 g = vec2(0.0); // pente de la surface
${rippleSum()}
  g *= 1.0 - smoothstep(60.0, 350.0, dist); // les rides s'estompent au loin (sinon elles grésillent)
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y)); // normale de la surface
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0); // Fresnel : plus on regarde rasant, plus l'eau reflète
  vec3 R = reflect(-V, N); // direction du reflet
  vec3 sky = mix(uHorizon, uTop, pow(max(R.y, 0.0), 0.5)); // ciel reflété
  float rs = max(dot(R, uSunDir), 0.0);
  vec3 glint = uSunColor * (pow(rs, 600.0) * 18.0 + pow(rs, 80.0) * 0.7 + pow(rs, 8.0) * 0.08) * uSunVis; // le soleil scintille sur les rides
  vec3 body = mix(uShallow, uDeep, smoothstep(0.1, 5.0, vDepth)) * mix(0.12, 1.0, uDaylight); // couleur de l'eau selon la profondeur (plus sombre la nuit)
  vec3 col = mix(body, sky, fres) + glint * (0.3 + 0.7 * fres);
  float edge = 1.0 - smoothstep(0.02, 0.22, vDepth); // bande de rive
  col = mix(col, vec3(0.78, 0.82, 0.8) * mix(0.15, 1.0, uDaylight), edge * 0.28 * (0.6 + 0.4 * sin(dot(g, vec2(40.0, 40.0)) + uTime))); // un peu d'écume claire le long de la rive
  float alpha = mix(0.5, 1.0, fres); // transparente vue d'en haut (on voit le fond), opaque en rasant
  alpha = max(alpha, smoothstep(0.4, 3.0, vDepth) * 0.9); // l'eau profonde est opaque
  alpha *= smoothstep(0.0, 0.2, vDepth); // la rive se fond dans le sol
  alpha = max(alpha, smoothstep(250.0, 800.0, dist) * step(0.05, vDepth)); // au loin, pas de transparence (on ne voit pas de ciel à travers)
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class FreshWater {
  readonly material: THREE.ShaderMaterial; // matériau commun à toutes les tuiles d'eau

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog, // variables de la brume
        {
          uTime: { value: 0 },
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uSunVis: { value: 1 },
          uDaylight: { value: 1 },
          uShallow: { value: toColor(waterColor(0.1)) },
          uDeep: { value: toColor(waterColor(5)) },
        },
      ]),
      fog: true, // l'eau se fond dans la brume
      transparent: true,
      depthWrite: false, // l'eau transparente n'écrit pas dans la profondeur
    });
  }

  // Met à jour le temps et les couleurs du ciel (reflets).
  update(timeSeconds: number, state: SunState): void {
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    u.uTime!.value = timeSeconds % 100000; // le temps reste petit (précision)
    toColor(state.skyTop, u.uTop!.value as THREE.Color);
    toColor(state.skyHorizon, u.uHorizon!.value as THREE.Color);
    toColor(state.sunColor, u.uSunColor!.value as THREE.Color);
    (u.uSunDir!.value as THREE.Vector3).set(...state.sunDirection);
    u.uSunVis!.value = state.sunVisibility;
    u.uDaylight!.value = state.daylight;
  }
}
