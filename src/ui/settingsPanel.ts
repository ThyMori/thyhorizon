// Panneau de réglages : relie les champs de la fenêtre aux réglages du jeu.
// Chaque changement s'applique tout de suite (on voit le résultat derrière le panneau).

import { CHUNK_SIZE } from '../core/chunk';
import { formatCoords, formatDistance, formatHours } from '../core/format';
import { START_LAT, START_LON, START_PLACE, formatDay } from '../core/geo';
import { Quality, Settings, applyPreset, detectQuality } from '../core/settings';
import { byId } from './dom';

// Ce que le panneau a besoin de savoir faire avec le jeu.
export interface SettingsBridge {
  getSettings(): Settings; // réglages actuels
  setSettings(next: Settings): void; // applique et enregistre de nouveaux réglages
  getClock(): { hours: number; day: number }; // heure solaire et jour de l'année, lus sur l'horloge du monde (lecture seule)
  exportSave(): void; // télécharge un fichier de sauvegarde
  importSave(file: File): void; // remplace la partie par celle d'un fichier
  getMoonText(): string; // phase de la Lune à la date et au lieu courants
}

export class SettingsPanel {
  private readonly quality = byId<HTMLSelectElement>('set-quality');
  private readonly distance = byId<HTMLInputElement>('set-distance');
  private readonly shadows = byId<HTMLInputElement>('set-shadows');
  private readonly constellations = byId<HTMLInputElement>('set-constellations');
  private readonly bloom = byId<HTMLInputElement>('set-bloom');
  private readonly shadowSize = byId<HTMLSelectElement>('set-shadow-size');
  private readonly resolution = byId<HTMLInputElement>('set-resolution');
  private readonly fps = byId<HTMLInputElement>('set-fps');
  private readonly instruments = byId<HTMLInputElement>('set-instruments');
  private readonly hands = byId<HTMLInputElement>('set-hands'); // mains et boussole
  private readonly realWeather = byId<HTMLInputElement>('set-realweather'); // météo réelle
  private readonly exportBtn = byId<HTMLButtonElement>('btn-export'); // « Exporter ma partie »
  private readonly importBtn = byId<HTMLButtonElement>('btn-import'); // « Importer une partie »
  private readonly importFile = byId<HTMLInputElement>('file-import'); // le sélecteur de fichier (caché)
  private readonly sensitivity = byId<HTMLInputElement>('set-sensitivity');
  private readonly volume = byId<HTMLInputElement>('set-volume'); // volume du son
  private readonly music = byId<HTMLInputElement>('set-music'); // volume de la musique

  constructor(private readonly bridge: SettingsBridge) {
    // Un changement de qualité remplace d'un coup distance, ombres et netteté.
    this.quality.addEventListener('change', () => this.apply(applyPreset(bridge.getSettings(), this.quality.value as Quality)));
    // Les autres champs modifient un réglage ; si le résultat ne correspond plus à un préréglage, la qualité devient « Personnalisée ».
    this.distance.addEventListener('input', () => this.change({ viewDistance: Number(this.distance.value) }));
    this.shadows.addEventListener('change', () => this.change({ shadows: this.shadows.checked }));
    this.constellations.addEventListener('change', () => this.apply({ ...bridge.getSettings(), constellations: this.constellations.checked })); // hors préréglages
    this.bloom.addEventListener('change', () => this.change({ bloom: this.bloom.checked }));
    this.shadowSize.addEventListener('change', () => this.change({ shadowSize: Number(this.shadowSize.value) }));
    this.resolution.addEventListener('input', () => this.change({ resolution: Number(this.resolution.value) / 100 }));
    this.fps.addEventListener('change', () => this.apply({ ...bridge.getSettings(), showFps: this.fps.checked }));
    this.realWeather.addEventListener('change', () => this.apply({ ...bridge.getSettings(), realWeather: this.realWeather.checked }));
    this.hands.addEventListener('change', () => this.apply({ ...bridge.getSettings(), showHands: this.hands.checked }));
    this.instruments.addEventListener('change', () => this.apply({ ...bridge.getSettings(), showInstruments: this.instruments.checked }));
    this.sensitivity.addEventListener('input', () => this.apply({ ...bridge.getSettings(), mouseSensitivity: Number(this.sensitivity.value) / 100 }));
    this.volume.addEventListener('input', () => this.apply({ ...bridge.getSettings(), soundVolume: Number(this.volume.value) / 100 }));
    this.music.addEventListener('input', () => this.apply({ ...bridge.getSettings(), musicVolume: Number(this.music.value) / 100 }));
    this.exportBtn.addEventListener('click', () => bridge.exportSave());
    this.importBtn.addEventListener('click', () => this.importFile.click()); // ouvre le sélecteur de fichier
    this.importFile.addEventListener('change', () => {
      const file = this.importFile.files?.[0]; // le fichier choisi
      this.importFile.value = ''; // permet de choisir deux fois le même fichier
      if (file) bridge.importSave(file);
    });
  }

  // Remplit les champs avec les valeurs actuelles (à appeler à l'ouverture).
  sync(): void {
    const s = this.bridge.getSettings();
    this.quality.value = s.quality;
    this.distance.value = String(s.viewDistance);
    byId('out-distance').textContent = formatDistance(s.viewDistance, CHUNK_SIZE);
    this.shadows.checked = s.shadows;
    this.bloom.checked = s.bloom;
    this.constellations.checked = s.constellations;
    this.shadowSize.value = String(s.shadowSize);
    this.shadowSize.disabled = !s.shadows; // inutile sans ombres
    this.resolution.value = String(Math.round(s.resolution * 100));
    byId('out-resolution').textContent = `${Math.round(s.resolution * 100)} %`;
    this.fps.checked = s.showFps;
    this.instruments.checked = s.showInstruments;
    this.hands.checked = s.showHands;
    this.realWeather.checked = s.realWeather;
    this.volume.value = String(Math.round(s.soundVolume * 100));
    byId('out-volume').textContent = s.soundVolume === 0 ? 'coupé' : `${Math.round(s.soundVolume * 100)} %`;
    this.music.value = String(Math.round(s.musicVolume * 100));
    byId('out-music').textContent = s.musicVolume === 0 ? 'coupée' : `${Math.round(s.musicVolume * 100)} %`;
    this.sensitivity.value = String(Math.round(s.mouseSensitivity * 100));
    byId('out-sensitivity').textContent = `${Math.round(s.mouseSensitivity * 100)} %`;
    const clock = this.bridge.getClock(); // la vraie heure solaire du lieu
    byId('out-place').textContent = `${START_PLACE} — ${formatCoords(START_LAT, START_LON)}`; // le lieu du monde
    byId('out-clock').textContent = `${formatDay(clock.day)}, ${formatHours(clock.hours)}`;
    byId('out-moon').textContent = `Lune : ${this.bridge.getMoonText()}`; // la vraie phase de la Lune à cette date
  }

  // Modifie un réglage de qualité et recalcule le préréglage correspondant.
  private change(patch: Partial<Settings>): void {
    const next = { ...this.bridge.getSettings(), ...patch };
    this.apply({ ...next, quality: detectQuality(next) });
  }

  private apply(next: Settings): void {
    this.bridge.setSettings(next);
    this.sync();
  }
}
