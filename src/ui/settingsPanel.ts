// Panneau de réglages : relie les champs de la fenêtre aux réglages du jeu.
// Chaque changement s'applique tout de suite (on voit le résultat derrière le panneau).

import { CHUNK_SIZE } from '../core/chunk';
import { formatCoords, formatDistance, formatHours } from '../core/format';
import { DAYS_IN_YEAR, START_LAT, START_LON, START_PLACE, formatDay } from '../core/geo';
import { Quality, Settings, applyPreset, detectQuality } from '../core/settings';
import { byId } from './dom';

// Ce que le panneau a besoin de savoir faire avec le jeu.
export interface SettingsBridge {
  getSettings(): Settings; // réglages actuels
  setSettings(next: Settings): void; // applique et enregistre de nouveaux réglages
  getHours(): number; // heure du jeu
  setHours(hours: number): void; // change l'heure du jeu
  getDay(): number; // jour de l'année du jeu
  setDay(day: number): void; // change le jour de l'année
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
  private readonly realWeather = byId<HTMLInputElement>('set-realweather'); // météo réelle
  private readonly hours = byId<HTMLInputElement>('set-hours');
  private readonly day = byId<HTMLInputElement>('set-day');
  private readonly realTime = byId<HTMLInputElement>('set-realtime');
  private readonly daysPass = byId<HTMLInputElement>('set-dayspass');
  private readonly dayLength = byId<HTMLSelectElement>('set-daylength');
  private readonly sensitivity = byId<HTMLInputElement>('set-sensitivity');
  private readonly volume = byId<HTMLInputElement>('set-volume'); // volume du son

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
    this.instruments.addEventListener('change', () => this.apply({ ...bridge.getSettings(), showInstruments: this.instruments.checked }));
    this.sensitivity.addEventListener('input', () => this.apply({ ...bridge.getSettings(), mouseSensitivity: Number(this.sensitivity.value) / 100 }));
    this.volume.addEventListener('input', () => this.apply({ ...bridge.getSettings(), soundVolume: Number(this.volume.value) / 100 }));
    this.dayLength.addEventListener('change', () => this.apply({ ...bridge.getSettings(), dayLengthMinutes: Number(this.dayLength.value) }));
    this.day.addEventListener('input', () => {
      bridge.setDay(Number(this.day.value)); // la date change tout de suite (saison, hauteur du soleil)
      this.sync();
    });
    this.realTime.addEventListener('change', () => {
      this.apply({ ...bridge.getSettings(), realTime: this.realTime.checked }); // le jeu se cale tout de suite sur l'horloge
      this.sync();
    });
    this.daysPass.addEventListener('change', () => this.apply({ ...bridge.getSettings(), daysPass: this.daysPass.checked }));
    this.hours.addEventListener('input', () => {
      bridge.setHours(Number(this.hours.value)); // l'heure change tout de suite
      this.sync();
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
    this.realWeather.checked = s.realWeather;
    this.dayLength.value = String(s.dayLengthMinutes);
    this.volume.value = String(Math.round(s.soundVolume * 100));
    byId('out-volume').textContent = s.soundVolume === 0 ? 'coupé' : `${Math.round(s.soundVolume * 100)} %`;
    this.sensitivity.value = String(Math.round(s.mouseSensitivity * 100));
    byId('out-sensitivity').textContent = `${Math.round(s.mouseSensitivity * 100)} %`;
    const h = this.bridge.getHours();
    this.hours.value = String(h);
    this.day.max = String(DAYS_IN_YEAR); // le curseur couvre l'année entière
    this.day.value = String(this.bridge.getDay());
    byId('out-day').textContent = formatDay(this.bridge.getDay());
    this.daysPass.checked = s.daysPass;
    this.realTime.checked = s.realTime;
    for (const el of [this.hours, this.day, this.daysPass, this.dayLength]) el.disabled = s.realTime; // l'horloge réelle décide : ces réglages ne servent plus
    byId('out-place').textContent = `${START_PLACE} — ${formatCoords(START_LAT, START_LON)}`; // le lieu du monde
    byId('out-hours').textContent = formatHours(h);
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
