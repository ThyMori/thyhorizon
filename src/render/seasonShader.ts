// Le côté « carte graphique » des saisons : chaque sommet du terrain porte un code (aSeason : classe + tirage, voir core/season.ts).
// Le shader du terrain cache les feuilles tombées et les fleurs fanées, et colore le feuillage (automne), l'herbe (paille) et les fougères.
// Les mêmes règles s'appliquent au matériau d'ombre : une feuille tombée ne fait plus d'ombre.

import * as THREE from 'three';
import type { SeasonState } from '../core/season';

// Les nombres de la saison, partagés par le matériau du terrain et celui des ombres.
export type SeasonUniforms = {
  uLeaf: THREE.IUniform<number>;
  uAutumn: THREE.IUniform<number>;
  uSpring: THREE.IUniform<number>;
  uBloom: THREE.IUniform<number>;
  uDry: THREE.IUniform<number>;
  uFern: THREE.IUniform<number>;
};

// Au départ : plein été.
export function createSeasonUniforms(): SeasonUniforms {
  return { uLeaf: { value: 1 }, uAutumn: { value: 0 }, uSpring: { value: 0 }, uBloom: { value: 1 }, uDry: { value: 0 }, uFern: { value: 1 } };
}

// Met à jour les nombres depuis l'état des saisons.
export function applySeason(u: SeasonUniforms, s: SeasonState): void {
  u.uLeaf.value = s.leaf;
  u.uAutumn.value = s.autumn;
  u.uSpring.value = s.spring;
  u.uBloom.value = s.bloom;
  u.uDry.value = s.dry;
  u.uFern.value = s.fern;
}

const DECL_VERTEX = /* glsl */ `
attribute float aSeason; // classe de saison (partie entière) et tirage de la touffe (partie décimale)
uniform float uLeaf; // part du feuillage présente
uniform float uBloom; // part des fleurs écloses
uniform float uFern; // part des fougères dressées
varying float vSCls;
varying float vSRnd;
`;

// Cache les sommets dont la saison est passée : ils sont ramenés à l'origine de la tuile (triangles sans surface, donc invisibles).
const BODY_VERTEX = /* glsl */ `
float sCls = floor(aSeason + 0.001);
float sRnd = (aSeason - sCls) / 0.95; // tirage de la touffe, 0 à 1
vSCls = sCls;
vSRnd = sRnd;
float sGone = 0.0;
if (sCls == 1.0) sGone = step(uLeaf, sRnd); // feuillage : tombé quand le tirage dépasse la part de feuilles restantes
else if (sCls == 2.0) sGone = step(uBloom, sRnd); // fleurs : pas encore écloses ou fanées
else if (sCls == 4.0) sGone = step(uFern, sRnd); // fougères : couchées
transformed *= 1.0 - sGone;
`;

const DECL_FRAGMENT = /* glsl */ `
uniform float uAutumn;
uniform float uSpring;
uniform float uDry;
varying float vSCls;
varying float vSRnd;
`;

// Couleurs de saison (lumière linéaire) appliquées après la couleur des sommets.
const BODY_FRAGMENT = /* glsl */ `
if (vSCls > 0.5) {
  float sLum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)); // la nuance d'ombre et de lumière du sommet est gardée
  float sShade = clamp(sLum * 9.0, 0.4, 1.4);
  if (vSCls < 1.5) {
    // Feuillage : jeunes feuilles vives au printemps, puis roux, rouge ou jaune selon la touffe à l'automne.
    vec3 au = mix(vec3(0.75, 0.45, 0.03), vec3(0.6, 0.2, 0.02), smoothstep(0.2, 0.5, vSRnd));
    au = mix(au, vec3(0.4, 0.05, 0.02), smoothstep(0.55, 0.9, vSRnd));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.25, 1.3, 0.7), uSpring);
    diffuseColor.rgb = mix(diffuseColor.rgb, au * sShade, uAutumn);
  } else if (vSCls > 2.5 && vSCls < 3.5) {
    // Herbe et bruyère : paille en été, brune en hiver.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.2, 0.06) * sShade, uDry);
  } else if (vSCls > 3.5 && vSCls < 4.5) {
    // Fougères : rousses à l'automne.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.2, 0.04) * sShade, uAutumn * 0.85);
  } else if (vSCls > 4.5) {
    // Roseaux : dorés, puis secs.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.33, 0.1) * sShade, clamp(uDry * 1.3 + uAutumn * 0.4, 0.0, 1.0));
  }
}
`;

// Ajoute les saisons au shader du terrain (appelé depuis onBeforeCompile, après les autres modifications).
export function patchSeasonShader(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }, u: SeasonUniforms): void {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + DECL_VERTEX).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BODY_VERTEX);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + DECL_FRAGMENT).replace('#include <color_fragment>', '#include <color_fragment>\n' + BODY_FRAGMENT);
}

// Le matériau d'ombre qui suit les saisons (les feuilles tombées ne projettent plus d'ombre).
export function createSeasonDepthMaterial(u: SeasonUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + DECL_VERTEX).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BODY_VERTEX);
  };
  return m;
}
