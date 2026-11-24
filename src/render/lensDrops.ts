// Dessin des gouttes sur l'écran : une couche 2D transparente posée au-dessus de la 3D (comme des gouttes sur des lunettes).
// Chaque goutte = petite lentille (bord sombre, reflet clair en bas, point brillant en haut) avec un « ploc » à l'arrivée.

import { LensDrop, dropAlpha, dropScale, stepDrops, IMPACT } from '../core/lensDrops';
import { mulberry32 } from '../core/noise';

export class LensDrops {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly drops: LensDrop[] = [];
  private readonly rnd = mulberry32(2024);
  private carry = 0; // reste fractionnaire d'apparition
  private w = 0;
  private h = 0;
  private readonly calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; // animations coupées si l'appareil le demande

  constructor(parent: HTMLElement) {
    this.canvas.className = 'lens-drops';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    parent.appendChild(this.canvas);
  }

  // rain 0 à 1 ; daylight 0 à 1 (les gouttes sont plus sombres la nuit) ; visible = faut-il dessiner (en jeu).
  update(dt: number, rain: number, daylight: number, visible: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const active = visible && !this.calm;
    if (!active && this.drops.length === 0) return; // rien à faire, rien à effacer
    if (!active) this.drops.length = 0;
    else this.carry = stepDrops(this.drops, dt, rain, this.carry, this.rnd);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w !== this.w || h !== this.h) {
      this.w = this.canvas.width = w;
      this.h = this.canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const light = 0.3 + 0.7 * daylight; // luminosité des reflets
    for (const d of this.drops) this.draw(ctx, d, w, h, light);
  }

  // Dessine une goutte et, pendant le ploc, ses petites éclaboussures.
  private draw(ctx: CanvasRenderingContext2D, d: LensDrop, w: number, h: number, light: number): void {
    const a = dropAlpha(d.age, d.life);
    if (a <= 0.01) return;
    const r = d.r * h * dropScale(d.age); // rayon en pixels
    const x = d.x * w;
    const y = d.y * h;
    const stretch = 1 + Math.min(0.5, d.slide * 8); // une goutte qui coule s'allonge un peu
    const c = Math.round(255 * light); // gris-blanc, plus sombre la nuit
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    // Corps : bord un peu sombre, centre presque transparent (on voit à travers).
    const body = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
    body.addColorStop(0, `rgba(${c},${c},${c},0.05)`);
    body.addColorStop(0.75, `rgba(${c},${c},${c},0.16)`);
    body.addColorStop(1, 'rgba(20,28,36,0.45)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * stretch, 0, 0, Math.PI * 2);
    ctx.fill();
    // Reflet clair en bas (la lumière traverse la goutte), comme sur une vraie lentille d'eau.
    ctx.strokeStyle = `rgba(${c},${c},${c},0.5)`;
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.78, r * stretch * 0.78, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    // Point brillant en haut à gauche.
    ctx.fillStyle = `rgba(${c},${c},${c},0.85)`;
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4 * stretch, Math.max(0.8, r * 0.16), 0, Math.PI * 2);
    ctx.fill();
    // Éclaboussures du ploc : 3 gouttelettes qui s'écartent et s'effacent dans les premiers instants.
    if (d.age < IMPACT * 2) {
      const t = d.age / (IMPACT * 2);
      ctx.fillStyle = `rgba(${c},${c},${c},${0.5 * (1 - t)})`;
      for (let i = 0; i < 3; i++) {
        const ang = (d.seed + i / 3) * Math.PI * 2;
        const dist = r * (1.2 + 1.6 * t);
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * dist, Math.sin(ang) * dist, Math.max(0.6, r * 0.12 * (1 - t)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
