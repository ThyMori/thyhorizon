// La pluie : des milliers de traînées qui tombent autour de la caméra. Tout se calcule dans le vertex shader (aucun
// calcul par goutte en JavaScript). Les gouttes sont ancrées dans le monde (on avance À TRAVERS elles) et reviennent
// en haut de la boîte quand elles touchent le bas. Les positions restent petites (origine flottante) : pas de grande coordonnée.

import * as THREE from 'three';

const DROPS = 5200; // nombre maximal de gouttes (la pluie légère n'en dessine qu'une partie)
const BOX = 36; // côté de la boîte de pluie autour de la caméra (m)
const HEIGHT = 22; // hauteur de la boîte (m)

const VERTEX = /* glsl */ `
attribute vec4 aSeed; // xyz = place dans la boîte (0 à 1), w = 0 pour la tête, 1 pour la queue de la traînée
uniform vec3 uCam; // position de la caméra
uniform float uTime; // temps (s)
uniform vec2 uSlant; // inclinaison due au vent (m/s vers x et z)
uniform float uLen; // longueur de traînée (m)
varying float vFade;
void main() {
  float fall = 8.5 + aSeed.x * 3.0; // vitesse de chute (m/s), un peu variable d'une goutte à l'autre
  float tint = 0.45 + 0.55 * fract(aSeed.x * 91.7 + aSeed.z * 37.3); // chaque goutte a sa propre intensité (pluie plus naturelle)
  vec3 p = aSeed.xyz * vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
  p.y = mod(p.y - uTime * fall, ${HEIGHT.toFixed(1)}); // la goutte descend et se réinjecte en haut
  p.xz += uSlant * (${HEIGHT.toFixed(1)} - p.y) / fall; // plus elle est basse, plus le vent l'a poussée
  vec2 c = uCam.xz - ${(BOX / 2).toFixed(1)};
  p.xz = mod(p.xz - c, ${BOX.toFixed(1)}) + c; // boîte centrée sur la caméra, motif ancré dans le monde
  p.y += uCam.y - ${(HEIGHT * 0.45).toFixed(1)}; // la boîte suit la hauteur de la caméra
  vec3 dir = normalize(vec3(uSlant.x, -fall, uSlant.y)); // sens de la chute
  p -= dir * uLen * (0.6 + 0.8 * fract(aSeed.z * 53.1)) * aSeed.w; // longueurs variées ; la queue est au-dessus de la tête
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = tint * (1.0 - aSeed.w) * (1.0 - smoothstep(${(BOX * 0.25).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(mv.xyz))); // effacée au loin
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vFade);
}
`;

export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const seeds = new Float32Array(DROPS * 2 * 4);
    let r = 12345; // petit générateur déterministe (la pluie a toujours la même disposition)
    const rnd = (): number => {
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      return r / 4294967296;
    };
    for (let i = 0; i < DROPS; i++) {
      const x = rnd();
      const y = rnd();
      const z = rnd();
      for (let e = 0; e < 2; e++) seeds.set([x, y, z, e], (i * 2 + e) * 4); // deux sommets : tête et queue
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3)); // requis par three, inutilisé
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSlant: { value: new THREE.Vector2() },
        uLen: { value: 0.5 },
        uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
        uAlpha: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false, // les gouttes ne cachent rien
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10; // après le décor opaque
  }

  // intensity 0 à 1 ; color = couleur du ciel (les gouttes la reprennent) ; wind = vent vers où il souffle (m/s).
  update(camera: THREE.Camera, timeSeconds: number, intensity: number, daylight: number, color: THREE.Color, windX: number, windZ: number): void {
    const on = intensity > 0.03;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    (u.uCam!.value as THREE.Vector3).copy(camera.position);
    u.uTime!.value = timeSeconds;
    (u.uSlant!.value as THREE.Vector2).set(windX * 0.35, windZ * 0.35); // les gouttes suivent le vent, en partie
    u.uLen!.value = 0.45 + 0.6 * intensity;
    (u.uColor!.value as THREE.Color).copy(color).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.25 + 0.75 * daylight);
    u.uAlpha!.value = 0.35 + 0.5 * intensity; // plus de gouttes, chacune plus discrète et fondue vers la queue
    this.mesh.geometry.setDrawRange(0, Math.max(2, Math.floor(DROPS * Math.min(1, 0.12 + 0.88 * intensity)) * 2)); // pluie fine : moins de gouttes
  }
}
