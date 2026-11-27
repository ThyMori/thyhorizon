// Texture procédurale des surfaces (1.44), dessinée dans le shader du terrain : aucune image à charger.
// Dépend de `gNoise` (défini dans GROUND_NOISE de scene.ts) et des réglages de core/surfaceTexture.ts.
// Les fréquences sont entières : le motif ne change pas quand l'origine flottante se déplace (voir core/surfaceTexture.ts).

import { TEXTURE_FADE, TEXTURE_FREQ, TEXTURE_SLOPE } from '../core/surfaceTexture';

// Écrit un nombre pour GLSL (toujours avec un point décimal).
const glsl = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const SURFACE_TEXTURE = /* glsl */ `
// Facteur de couleur (autour de 1) pour une surface. cls = classe de saison du sommet : les plantes gardent leur couleur.
vec3 surfaceTexture(vec3 wp, float dist, float cls) {
  if (cls > 0.5) return vec3(1.0); // feuillage, herbe, fleurs : pas de texture de sol dessus
  vec3 gn = normalize(cross(dFdx(wp), dFdy(wp))); // normale de la face, d'après la position (le shader n'a pas encore la normale)
  float onGround = smoothstep(${glsl(TEXTURE_SLOPE.wall)}, ${glsl(TEXTURE_SLOPE.ground)}, abs(gn.y)); // 1 = sol, 0 = paroi
  // --- Sol : plaques de teinte, moucheture, cailloux tout près ---
  float tint = gNoise(wp.xz * ${glsl(TEXTURE_FREQ.patch)}) - 0.5; // teinte chaude / froide par grandes plaques
  float mottle = gNoise(wp.xz * ${glsl(TEXTURE_FREQ.mottle)}) - 0.5; // petites taches claires et sombres
  float closeUp = 1.0 - smoothstep(${glsl(TEXTURE_FADE.pebblesNear)}, ${glsl(TEXTURE_FADE.pebblesFar)}, dist); // les cailloux n'existent que de près
  float dark = smoothstep(0.72, 0.80, gNoise(wp.xz * ${glsl(TEXTURE_FREQ.pebbleA)})) * closeUp; // cailloux sombres
  float pale = smoothstep(0.78, 0.86, gNoise(wp.xz * ${glsl(TEXTURE_FREQ.pebbleB)} + 17.0)) * closeUp; // cailloux clairs
  vec3 ground = vec3(1.0 + 0.10 * tint, 1.0, 1.0 - 0.10 * tint) * (1.0 + 0.16 * mottle) * (1.0 - 0.20 * dark + 0.14 * pale);
  // --- Paroi (tronc, rocher, falaise) : sillons d'écorce et strates ---
  float h = wp.x + wp.z; // abscisse le long de la paroi (la paroi est verticale, ce suffit pour une texture)
  float ridge = 1.0 - abs(2.0 * gNoise(vec2(h * ${glsl(TEXTURE_FREQ.furrowAcross)}, wp.y * ${glsl(TEXTURE_FREQ.furrowUp)})) - 1.0); // crêtes fines
  float strata = gNoise(vec2(h * ${glsl(TEXTURE_FREQ.strataAcross)}, wp.y * ${glsl(TEXTURE_FREQ.strataUp)})) - 0.5; // bandes horizontales
  float closeWall = 1.0 - smoothstep(${glsl(TEXTURE_FADE.furrowNear)}, ${glsl(TEXTURE_FADE.furrowFar)}, dist); // de loin, tout se lisse
  vec3 wall = vec3(mix(1.0, 0.62 + 0.55 * ridge, closeWall) * (1.0 + 0.22 * strata * closeWall));
  return mix(wall, ground, onGround);
}
`;
