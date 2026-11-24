// Les instruments du voilier : une petite « rose » dessinée (bateau, voile, vent) et quelques chiffres.
// Les textes viennent de nos propres calculs : textContent seulement, jamais de HTML.

import type { Readout } from '../core/sailing';
import { msToKnots } from '../core/wind';
import { byId } from './dom';

const REFRESH_MS = 100; // les chiffres sont rafraîchis 10 fois par seconde (inutile et coûteux de faire plus)

const fmt1 = (n: number): string => n.toFixed(1).replace('.', ','); // un chiffre après la virgule, à la française
const side = (deg: number): string => (Math.abs(deg) < 0.5 ? '0°' : `${Math.abs(Math.round(deg))}° ${deg > 0 ? 'tribord' : 'bâbord'}`);

export class BoatHud {
  private readonly root = byId('boat-hud');
  private readonly canvas = byId<HTMLCanvasElement>('boat-rose');
  private readonly ctx = this.canvas.getContext('2d');
  private readonly cap = byId('bh-cap');
  private readonly speed = byId('bh-speed');
  private readonly tw = byId('bh-tw');
  private readonly aw = byId('bh-aw');
  private readonly heel = byId('bh-heel');
  private readonly sheet = byId('bh-sheet');
  private readonly sails = byId('bh-sails');
  private readonly weather = byId('bh-weather');
  private readonly point = byId('bh-point');
  private readonly hint = byId('bh-hint');
  private readonly colors = { accent: '#e8a24a', text: '#ecebe6', muted: '#9aa3ad', line: '#2b343e', ok: '#4cb782', danger: '#e5484d' };
  private last = 0;

  constructor() {
    const css = getComputedStyle(document.documentElement); // les couleurs viennent des variables CSS
    for (const key of Object.keys(this.colors) as Array<keyof typeof this.colors>) {
      const v = css.getPropertyValue(`--${key}`).trim();
      if (v) this.colors[key] = v;
    }
  }

  // Montre ou cache le tableau de bord.
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  // Le temps qu'il fait (texte court, déjà en français).
  setWeather(text: string): void {
    if (this.weather.textContent !== text) this.weather.textContent = text;
  }

  // Met à jour l'affichage (appelé à chaque image ; ne travaille qu'à la cadence voulue). boom = angle visible de la bôme (rad).
  update(r: Readout | null, boom: number, rudder: number, nowMs: number): void {
    if (!r) return;
    this.draw(r, boom, rudder); // la rose est fluide : redessinée à chaque image (petit canevas)
    if (nowMs - this.last < REFRESH_MS) return;
    this.last = nowMs;
    const deg = (rad: number): number => (rad * 180) / Math.PI;
    this.cap.textContent = `${Math.round(r.bearing).toString().padStart(3, '0')}°`;
    this.speed.textContent = `${fmt1(msToKnots(r.speed))} nd`;
    this.tw.textContent = `${Math.round(msToKnots(r.tws))} nd · ${side(deg(r.twa))}`;
    this.aw.textContent = `${Math.round(msToKnots(r.aws))} nd · ${side(deg(r.awa))}`;
    this.heel.textContent = side(r.heelDeg);
    this.sheet.textContent = `${Math.round((1 - r.sheet) * 100)} % bordée`;
    this.sails.textContent = r.mainPct === 0 ? 'GV affalée' : `GV ${r.mainPct < 100 ? `${r.mainPct} %` : r.reef > 0 ? `${r.reef} ris` : 'pleine'}`;
    this.sails.textContent += r.jibPct === 0 ? ' · foc roulé' : r.jibPct < 100 ? ` · foc ${r.jibPct} %` : ' · foc plein';
    this.point.textContent = r.pilot ? `${r.point} · pilote auto` : r.point;
    this.hint.textContent = r.hint;
    this.hint.hidden = r.hint === '';
  }

  // Dessine : le bateau vu de dessus (cap en haut), la voile, la barre, le vent vrai (fin) et le vent apparent (épais).
  private draw(r: Readout, boom: number, rudder: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const c = w / 2;
    const k = w / 132; // échelle (le dessin est conçu pour 132 px)
    ctx.clearRect(0, 0, w, w);
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.colors.line;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc(c, c, 60 * k, 0, 2 * Math.PI);
    ctx.stroke();
    // coque
    ctx.fillStyle = this.colors.text;
    ctx.beginPath();
    ctx.moveTo(c, c - 30 * k);
    ctx.quadraticCurveTo(c + 14 * k, c - 6 * k, c + 10 * k, c + 26 * k);
    ctx.lineTo(c - 10 * k, c + 26 * k);
    ctx.quadraticCurveTo(c - 14 * k, c - 6 * k, c, c - 30 * k);
    ctx.fill();
    // voile : part du mât, tourne avec la bôme (positif = à tribord, donc vers la droite à l'écran)
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.moveTo(c, c - 4 * k);
    ctx.lineTo(c + Math.sin(boom) * 34 * k, c - 4 * k + Math.cos(boom) * 34 * k);
    ctx.stroke();
    // barre : petit trait à l'arrière
    ctx.strokeStyle = this.colors.muted;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(c, c + 26 * k);
    ctx.lineTo(c - Math.sin(rudder) * 14 * k, c + 26 * k + Math.cos(rudder) * 14 * k);
    ctx.stroke();
    // vents : des flèches qui viennent de l'angle indiqué vers le bateau
    this.arrow(ctx, c, k, r.twa, 56, 38, this.colors.muted, 2);
    this.arrow(ctx, c, k, r.awa, 56, 30, r.speed < 0.2 ? this.colors.muted : this.colors.ok, 4);
  }

  // Flèche venant de l'angle a (rad, 0 = de l'avant, + = de tribord) : de la distance from vers la distance to.
  private arrow(ctx: CanvasRenderingContext2D, c: number, k: number, a: number, from: number, to: number, color: string, width: number): void {
    const sx = Math.sin(a);
    const sy = -Math.cos(a);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width * k;
    ctx.beginPath();
    ctx.moveTo(c + sx * from * k, c + sy * from * k);
    ctx.lineTo(c + sx * to * k, c + sy * to * k);
    ctx.stroke();
    ctx.beginPath(); // pointe de la flèche
    const hx = c + sx * to * k;
    const hy = c + sy * to * k;
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + (-sx * 8 + sy * 5) * k, hy + (-sy * 8 - sx * 5) * k);
    ctx.lineTo(hx + (-sx * 8 - sy * 5) * k, hy + (-sy * 8 + sx * 5) * k);
    ctx.closePath();
    ctx.fill();
  }
}
