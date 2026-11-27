// La neige qui tombe : des flocons ronds et doux qui descendent lentement autour de la caméra en se balançant.
// Comme la pluie, tout se calcule dans le vertex shader et la boîte de flocons est ancrée dans le monde (on avance À TRAVERS elle).
// Les positions restent petites (origine flottante) : jamais de grande coordonnée envoyée à la carte graphique.

import * as THREE from 'three';

const FLAKES = 4500; // nombre maximal de flocons (une neige fine n'en dessine qu'une partie)
const BOX = 32; // côté de la boîte (m)
const HEIGHT = 20; // hauteur de la boîte (m)

const VERTEX = /* glsl */ `
attribute vec4 aSeed; // xyz = place dans la boîte (0 à 1), w = tirage propre au flocon
uniform vec3 uCam; // position de la caméra
uniform float uTime; // temps (s)
uniform vec2 uSlant; // dérive due au vent (m/s vers x et z)
uniform float uScale; // pixels par mètre à un mètre de distance (taille à l'écran)
varying float vFade;
void main() {
  float fall = 0.9 + aSeed.w * 1.1; // vitesse de chute (m/s) : les gros flocons tombent un peu plus vite
  vec3 p = aSeed.xyz * vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
  p.y = mod(p.y - uTime * fall, ${HEIGHT.toFixed(1)}); // le flocon descend et se réinjecte en haut
  float ph = aSeed.w * 40.0 + aSeed.x * 20.0; // phase propre à chaque flocon
  p.x += sin(uTime * 0.7 + ph) * 0.6; // il se balance
  p.z += cos(uTime * 0.55 + ph * 1.3) * 0.6;
  p.xz += uSlant * (${HEIGHT.toFixed(1)} - p.y) / fall; // plus il est bas, plus le vent l'a poussé
  vec2 c = uCam.xz - ${(BOX / 2).toFixed(1)};
  p.xz = mod(p.xz - c, ${BOX.toFixed(1)}) + c; // boîte centrée sur la caméra, motif ancré dans le monde
  p.y += uCam.y - ${(HEIGHT * 0.45).toFixed(1)}; // la boîte suit la hauteur de la caméra
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = max(0.5, -mv.z);
  gl_PointSize = clamp((0.05 + 0.05 * aSeed.w) * uScale / d, 1.5, 14.0); // taille selon la distance, bornée
  vFade = 1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(mv.xyz)); // effacé au loin
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0; // 0 au centre, 1 au bord du carré
  float disc = 1.0 - smoothstep(0.35, 1.0, r); // disque au bord doux
  gl_FragColor = vec4(uColor, uAlpha * vFade * disc);
}
`;

export class Snow {
  readonly mesh: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const seeds = new Float32Array(FLAKES * 4);
    let r = 777; // petit générateur déterministe (la neige a toujours la même disposition)
    const rnd = (): number => {
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      return r / 4294967296;
    };
    for (let i = 0; i < FLAKES; i++) seeds.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLAKES * 3), 3)); // requis par three, inutilisé
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSlant: { value: new THREE.Vector2() },
        uScale: { value: 600 },
        uColor: { value: new THREE.Color(0.9, 0.93, 1) },
        uAlpha: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false, // les flocons ne cachent rien
      fog: false,
    });
    this.mesh = new THREE.Points(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10; // après le décor opaque
  }

  // intensity 0 à 1 ; color = couleur du ciel (légère teinte) ; wind = vent vers où il souffle (m/s) ; viewHeightPx = hauteur de l'image en pixels.
  update(camera: THREE.PerspectiveCamera, timeSeconds: number, intensity: number, daylight: number, color: THREE.Color, windX: number, windZ: number, viewHeightPx: number): void {
    const on = intensity > 0.03;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    (u.uCam!.value as THREE.Vector3).copy(camera.position);
    u.uTime!.value = timeSeconds;
    (u.uSlant!.value as THREE.Vector2).set(windX * 0.5, windZ * 0.5); // les flocons suivent bien le vent
    u.uScale!.value = viewHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360)); // pixels par mètre à 1 m de distance
    (u.uColor!.value as THREE.Color).copy(color).lerp(new THREE.Color(1, 1, 1), 0.75).multiplyScalar(0.3 + 0.7 * daylight); // blanc, plus sombre la nuit
    u.uAlpha!.value = 0.55 + 0.4 * intensity;
    this.mesh.geometry.setDrawRange(0, Math.max(1, Math.floor(FLAKES * Math.min(1, 0.1 + 0.9 * intensity)))); // neige fine : moins de flocons
  }
}
