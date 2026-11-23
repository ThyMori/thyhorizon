// Le ciel : un dôme dégradé (zénith → horizon), le disque du soleil et son halo, la lune et les étoiles.
// Les couleurs viennent de core/sun.ts ; la couleur d'horizon sert aussi pour la brume, donc le raccord est parfait.

import * as THREE from 'three';
import { smoothstep } from '../core/math';
import { mulberry32 } from '../core/noise';
import type { SunState } from '../core/sun';

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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); // direction du regard
  float y = d.y; // hauteur de la direction (-1 sol, 1 zénith)
  vec3 col = mix(uHorizon, uTop, pow(max(y, 0.0), 0.5)); // dégradé horizon → zénith
  float sd = max(dot(d, uSunDir), 0.0); // alignement avec le soleil
  col += uGlow * (pow(sd, 6.0) * 0.25 + pow(sd, 40.0) * 0.45 + pow(sd, 400.0) * 1.4); // halo en trois couches
  col += uSunColor * smoothstep(0.99965, 0.99985, sd) * 6.0 * uSunVis; // disque solaire
  float md = max(dot(d, uMoonDir), 0.0); // alignement avec la lune
  col += vec3(0.75, 0.82, 1.0) * smoothstep(0.9996, 0.9998, md) * 1.6 * uMoonVis; // disque lunaire
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Convertit une couleur sRGB du module de logique en couleur Three.js (linéaire).
export const toColor = (rgb: readonly [number, number, number], target = new THREE.Color()): THREE.Color =>
  target.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

export class SkyDome {
  readonly dome: THREE.Mesh; // le dôme
  readonly stars: THREE.Points; // les étoiles
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

    // 1500 étoiles réparties au hasard sur une sphère (graine fixe : toujours le même ciel).
    const rand = mulberry32(2024);
    const positions = new Float32Array(1500 * 3);
    const colors = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const u = rand() * 2 - 1; // hauteur uniforme
      const a = rand() * Math.PI * 2; // angle
      const r = Math.sqrt(1 - u * u); // rayon du cercle à cette hauteur
      positions.set([Math.cos(a) * r * 2500, u * 2500, Math.sin(a) * r * 2500], i * 3);
      const b = 0.25 + 0.75 * Math.pow(rand(), 3); // la plupart des étoiles sont faibles, quelques-unes brillent
      colors.set([b * (0.85 + 0.15 * rand()), b * 0.92, b], i * 3); // légère teinte
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ vertexColors: true, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }),
    );
    this.stars.renderOrder = -999; // juste après le dôme
    this.stars.frustumCulled = false;
  }

  // Met à jour le ciel pour l'état donné et le recentre sur la caméra.
  update(state: SunState, camera: THREE.Camera): void {
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
    (this.stars.material as THREE.PointsMaterial).opacity = state.starsOpacity * 0.9;
    this.stars.rotation.y = (state.hours / 24) * Math.PI * 2; // le ciel étoilé tourne avec les heures
    this.dome.position.copy(camera.position); // le ciel suit la caméra : on ne s'en approche jamais
    this.stars.position.copy(camera.position);
  }
}
