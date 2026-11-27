// Assemble le rendu : moteur 3D, caméra, lumières (soleil, lune, ciel), brume, ciel et océan.
// Ne contient aucune règle de jeu : il reçoit des états (heure, position) et les dessine.

import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/chunk';
import { lerpRgb } from '../core/math';
import { SURFACE_TEXTURE } from './surfaceTexture';
import { GRAIN_FREQUENCIES, GRAIN_PERIOD, Origin, grainShift } from '../core/origin';
import type { Settings } from '../core/settings';
import type { SunState } from '../core/sun';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WeatherState, CLEAR_WEATHER, fogFactor } from '../core/weather';
import type { SeaState } from '../core/sea';
import { FreshWater } from './freshWater';
import type { SeasonState } from '../core/season';
import { applySeason, createSeasonDepthMaterial, createSeasonUniforms, patchSeasonShader } from './seasonShader';
import { Ocean } from './ocean';
import { Rain } from './rain';
import { Snow } from './snow';
import { SkyDome, toColor } from './sky';

const SHADOW_EXTENT = 90; // demi-largeur de la zone ombrée autour du joueur, en mètres
const FOG_DENSITY_FACTOR = 2; // densité de brume ≈ 2 / distance d'affichage (le bord du monde disparaît dans la brume)
const BLOOM_STRENGTH = 0.8; // force du halo
const BLOOM_RADIUS = 1.0; // étendue du halo
const BLOOM_THRESHOLD = 1.0; // seules les zones plus lumineuses que ça brillent
const SUN_CAP = 1.2; // plafond de lumière du ciel avec bloom (sinon le disque du soleil, très lumineux, noie l'écran)
const STAR_BOOST = 5; // le cœur des étoiles dépasse ce seuil quand le bloom est actif
const LIGHT_SCALE = Math.PI; // Three.js divise l'éclairage diffus par π : on le compense pour que les valeurs de sun.ts restent lisibles
const NIGHT_FILL: [number, number, number] = [0.3, 0.4, 0.7]; // teinte bleutée de la lumière ambiante la nuit

// Écrit un nombre pour le GLSL (toujours avec un point décimal).
const glsl = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// Bruit de valeur à trois échelles (≈ 1 m, 20 cm, 6 cm). Les échelles fines s'estompent avec la distance pour ne pas grésiller.
// Les positions reçues sont relatives à l'origine flottante : chaque échelle ajoute son décalage (uShiftA/B/C) pour retrouver le motif du monde.
const GROUND_NOISE = /* glsl */ `
uniform vec2 uShiftA; // décalage du bruit pour la grande échelle
uniform vec2 uShiftB; // décalage pour l'échelle moyenne
uniform vec2 uShiftC; // décalage pour l'échelle fine
float gHash(vec2 p) { // nombre pseudo-aléatoire stable pour une case entière
  p = mod(p, ${glsl(GRAIN_PERIOD)}); // on boucle pour garder de la précision loin de l'origine
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
  float coarse = gNoise(wp.xz * ${glsl(GRAIN_FREQUENCIES[0])} + uShiftA); // grandes taches
  float mid = gNoise(wp.xz * ${glsl(GRAIN_FREQUENCIES[1])} + uShiftB) * (1.0 - smoothstep(60.0, 220.0, dist)); // brins groupés, visibles de près
  float fine = gNoise(wp.xz * ${glsl(GRAIN_FREQUENCIES[2])} + uShiftC) * (1.0 - smoothstep(20.0, 90.0, dist)); // grain fin, tout près
  return 0.80 + 0.40 * (coarse * 0.5 + mid * 0.3 + fine * 0.2);
}
`;


// Neige au sol (1.40) : les faces tournées vers le ciel blanchissent par plaques puis tout à fait ; les pentes raides gardent leur couleur.
// Appliquée après le calcul de la normale (on a besoin de savoir si la face regarde vers le haut). Rien n'est fait sans neige (uSnow = 0).
const SNOW = /* glsl */ `
uniform float uSnow; // épaisseur de neige au sol, 0 à 1
`;
const SNOW_BODY = /* glsl */ `
if (uSnow > 0.001 && vGroundPos.y > 0.4) {
  vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); // le haut du monde, vu depuis la caméra
  float upness = dot(normalize(normal), upView); // 1 = face horizontale tournée vers le ciel
  float breakup = gNoise(vGroundPos.xz * 0.35 + uShiftB) * 0.6 + gNoise(vGroundPos.xz * 0.07 + uShiftA) * 0.4; // plaques
  float amount = smoothstep(0.0, 0.3, uSnow * 1.25 - breakup * 0.5); // peu de neige : des plaques ; beaucoup : tout est blanc
  float facing = smoothstep(mix(0.95, 0.35, uSnow), mix(1.1, 0.6, uSnow), upness); // plus il y a de neige, plus les pentes en gardent
  float plant = vSCls > 1.5 ? 0.6 : (vSCls > 0.5 ? 0.85 : 1.0); // fleurs, herbe, fougères : un peu moins couverts que le sol
  float snowAmt = amount * facing * plant;
  float shade = 0.92 + 0.08 * gNoise(vGroundPos.xz * 2.5 + uShiftC); // léger grain dans le blanc
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9) * shade, snowAmt);
}
`;

// Rivage : sous l'eau, le fond s'assombrit et prend la teinte de la mer avec la profondeur (on voit le sable clair dans les petits fonds,
// du bleu sombre plus loin) ; au bord, l'écume de la houle monte et redescend en bandes.
const SHORE = /* glsl */ `
{
  float wy = vGroundPos.y;
  float dep = max(-wy, 0.0);
  float absorb = 1.0 - exp(-dep * 0.45);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.2, 0.23), absorb * 0.92);
  if (wy > -1.4 && wy < 0.9) {
    float swash = 0.06 + 0.3 * sin(uSurfTime * 0.8 + gNoise(vGroundPos.xz * 0.04 + uShiftA) * 6.28);
    float band = 1.0 - smoothstep(0.0, 0.26, abs(wy - swash));
    float band2 = 1.0 - smoothstep(0.0, 0.2, abs(wy + 0.6 + 0.3 * sin(uSurfTime * 0.8 + 2.3 + gNoise(vGroundPos.xz * 0.05 + uShiftA) * 6.28)));
    float lacy = gNoise(vGroundPos.xz * ${glsl(GRAIN_FREQUENCIES[1])} + uShiftB);
    float foamT = clamp(band + 0.7 * band2, 0.0, 1.0) * smoothstep(0.2, 0.6, lacy + 0.2) * uSurf;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.95), foamT * 0.9);
  }
}
`;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer; // moteur de rendu
  readonly scene = new THREE.Scene(); // la scène 3D
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.3, 6000); // caméra à la première personne
  readonly terrainMaterial: THREE.MeshStandardMaterial; // matériau commun du terrain
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1); // soleil (projette des ombres)
  private readonly moon = new THREE.DirectionalLight(0x8fa6ff, 0); // lune (lumière douce, sans ombre)
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 0.5); // lumière du ciel et du sol
  private readonly sky = new SkyDome();
  private readonly ocean = new Ocean();
  readonly freshWater = new FreshWater(); // matériau animé des rivières et des lacs
  private readonly rain = new Rain(); // pluie autour de la caméra
  private readonly snow = new Snow(); // flocons autour de la caméra
  private snowFall = 0; // part des précipitations qui tombe en neige (0 pluie, 1 neige)
  private readonly snowUniform = new THREE.Uniform(0); // épaisseur de neige au sol (0 à 1), lue par le shader du terrain
  private readonly seasonUniforms = createSeasonUniforms(); // l'état des saisons (feuilles, fleurs, herbe), partagé par le terrain et ses ombres
  private readonly surfTime = new THREE.Uniform(0); // temps de l'écume de rivage
  private readonly surfStrength = new THREE.Uniform(0.4); // force de l'écume de rivage (dépend de l'état de mer)
  private weather: WeatherState = CLEAR_WEATHER; // temps actuel (nuages, pluie, brume)
  private windX = 0; // vent vers où il souffle (m/s), pour la dérive des nuages et l'inclinaison de la pluie
  private windZ = 0;
  private cloudX = 0; // décalage de dérive des nuages (unités du plan de nuages)
  private cloudZ = 0;
  private lastEnvTime = 0;
  private readonly fog = new THREE.FogExp2(0xffffff, 0.001); // brume atmosphérique
  private readonly tmpColor = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly grainUniforms = [new THREE.Uniform(new THREE.Vector2()), new THREE.Uniform(new THREE.Vector2()), new THREE.Uniform(new THREE.Vector2())]; // décalages du grain (uShiftA/B/C)
  private composer: EffectComposer | null = null; // chaîne d'effets (bloom), créée seulement si le réglage l'exige
  private bloomPass: UnrealBloomPass | null = null;
  private shadowSize = 0; // taille actuelle de la carte d'ombres
  private radiusMeters = 800; // distance d'affichage en mètres

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // peut échouer si WebGL est indisponible
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // rendu « cinéma » : hautes lumières douces
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement); // le canvas entre dans la page

    this.scene.fog = this.fog;
    this.scene.add(this.sky.dome, this.sky.stars, this.sky.lines, this.ocean.mesh, this.rain.mesh, this.snow.mesh);
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
      shader.uniforms.uShiftA = this.grainUniforms[0]!; // les décalages sont partagés avec le jeu (mis à jour à chaque déplacement de l'origine)
      shader.uniforms.uShiftB = this.grainUniforms[1]!;
      shader.uniforms.uShiftC = this.grainUniforms[2]!;
      shader.uniforms.uSurfTime = this.surfTime;
      shader.uniforms.uSurf = this.surfStrength;
      shader.uniforms.uSnow = this.snowUniform; // neige au sol
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;') // position monde transmise au fragment
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGroundPos;\nuniform float uSurfTime;\nuniform float uSurf;\n${GROUND_NOISE}${SURFACE_TEXTURE}${SNOW}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= groundGrain(vGroundPos, length(vViewPosition)) * surfaceTexture(vGroundPos, length(vViewPosition), vSCls);\n' + SHORE)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SNOW_BODY); // la neige a besoin de la normale
      patchSeasonShader(shader, this.seasonUniforms); // saisons : feuilles qui tombent, fleurs, herbe sèche
    };
    this.terrainMaterial.userData.seasonDepth = createSeasonDepthMaterial(this.seasonUniforms); // même chose pour les ombres
  }

  // La neige (1.40) : part des précipitations qui tombe en neige, et épaisseur de neige au sol (0 à 1).
  setSnow(fall: number, cover: number): void {
    this.snowFall = fall;
    this.snowUniform.value = cover;
  }

  // Applique l'état des saisons (cheap : quelques nombres envoyés au shader).
  setSeason(state: SeasonState): void {
    applySeason(this.seasonUniforms, state);
  }

  // Applique les réglages de qualité.
  applySettings(settings: Settings): void {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) * settings.resolution; // netteté
    this.renderer.setPixelRatio(pixelRatio);
    this.sky.setPixelRatio(pixelRatio); // les étoiles gardent leur taille apparente
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.setBloom(settings.bloom, pixelRatio);
    this.sky.setConstellations(settings.constellations); // traits des constellations (fondu)
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
    this.fog.density = (FOG_DENSITY_FACTOR / this.radiusMeters) * fogFactor(this.weather);
  }

  // Tourne la mer pour que la houle vienne de la bonne direction (rad).
  setWaveTurn(turn: number): void {
    this.ocean.setWaveTurn(turn);
  }

  // État de mer : amplitude des vagues, moutons, force de l'écume de rivage.
  setSea(sea: SeaState): void {
    this.ocean.setSea(sea);
    this.surfStrength.value = Math.min(1, Math.max(0.3, 0.3 + 0.3 * sea.swell));
  }

  // Le temps qu'il fait (nuages, pluie, brume) et le vent (m/s, vers où il souffle) qui pousse nuages et gouttes.
  setWeather(weather: WeatherState, windX: number, windZ: number): void {
    this.weather = weather;
    this.windX = windX;
    this.windZ = windZ;
  }

  // Active ou coupe le bloom (halo lumineux). Il passe par une chaîne d'effets : image calculée en haute dynamique et anticrénelée (4 échantillons),
  // halo autour des zones très lumineuses, puis « rendu cinéma » et conversion de couleur en dernier.
  private setBloom(on: boolean, pixelRatio: number): void {
    if (on && !this.composer) {
      const w = window.innerWidth * pixelRatio;
      const h = window.innerHeight * pixelRatio;
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 }); // 4 échantillons : bords lissés comme sans bloom
      this.composer = new EffectComposer(this.renderer, target);
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new ShaderPass(CopyShader)); // recopie finale à l'écran (couleurs déjà prêtes, voir plus haut)
      // Astuce : Three.js ne retouche les couleurs (rendu cinéma, sRGB) que sur l'écran, ou sur une cible « XR ».
      // En déclarant nos deux cibles ainsi, chaque matériau fait son propre rendu cinéma et sa conversion sRGB comme à l'écran :
      // l'image avec bloom reste donc IDENTIQUE à l'image sans bloom (ciel et brume compris), le halo s'ajoute simplement.
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
        rt.texture.colorSpace = THREE.SRGBColorSpace;
      }
    }
    if (!on && this.composer) {
      this.composer.dispose(); // on libère la mémoire graphique
      this.bloomPass?.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    this.sky.setGlowBoost(on ? STAR_BOOST : 1, on ? SUN_CAP : 1000); // le cœur des étoiles est plus lumineux pour déclencher le halo
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  // Indique au rendu où est l'origine flottante : le grain du sol et les vagues retrouvent ainsi leur place dans le monde.
  setOrigin(origin: Origin): void {
    this.grainUniforms.forEach((u, i) => (u.value as THREE.Vector2).set(...grainShift(origin, GRAIN_FREQUENCIES[i]!))); // un décalage par échelle de bruit
    this.ocean.setOrigin(origin); // et déphasage des vagues
  }

  // À appeler quand la fenêtre change de taille.
  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight); // la chaîne d'effets suit la taille de la fenêtre
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

    // Nuages : ils dérivent avec le vent (décalage calculé ici, en petit nombre ; le shader ne voit jamais de grande coordonnée).
    const dtEnv = Math.min(0.2, Math.max(0, timeSeconds - this.lastEnvTime));
    this.lastEnvTime = timeSeconds;
    this.surfTime.value = timeSeconds;
    this.cloudX = (this.cloudX - this.windX * 0.0009 * dtEnv) % 1000;
    this.cloudZ = (this.cloudZ - this.windZ * 0.0009 * dtEnv) % 1000;
    this.sky.setClouds(this.weather.cloud, this.cloudX, this.cloudZ);
    this.fog.density = (FOG_DENSITY_FACTOR / this.radiusMeters) * fogFactor(this.weather); // brume et pluie réduisent la visibilité
    toColor(state.skyHorizon, this.tmpColor);
    this.rain.update(this.camera, timeSeconds, this.weather.rain * (1 - this.snowFall), state.daylight, this.tmpColor, this.windX, this.windZ); // la pluie devient neige quand il gèle
    this.snow.update(this.camera, timeSeconds, this.weather.rain * this.snowFall, state.daylight, this.tmpColor, this.windX, this.windZ, this.renderer.domElement.height);
    this.sky.update(state, this.camera, timeSeconds);
    this.ocean.update(timeSeconds, state, this.camera);
    this.freshWater.update(timeSeconds, state); // rides et reflets des rivières et des lacs
  }

  render(): void {
    if (this.composer) this.composer.render(); // avec bloom
    else this.renderer.render(this.scene, this.camera); // sans
  }
}
