/** Map canvas: topography with simple relief shading, or the (noisy) remote-sensed surface rock. */
import { LITH_COLORS } from '../shared/lithology';
import { PublicInfo } from '../shared/protocol';

export type MapLayer = 'topography' | 'rock' | 'exposure';

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export function drawMap(canvas: HTMLCanvasElement, info: PublicInfo, layer: MapLayer, selected: number, cored: Set<number>): void {
  const g = canvas.getContext('2d')!;
  const { nx, ny } = info;
  const cw = canvas.width / nx, ch = canvas.height / ny;
  let hi = 1;
  for (const e of info.elevationM) hi = Math.max(hi, e);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const e = info.elevationM[i];
      // shade by the slope towards the north-west light source
      const w = x > 0 ? info.elevationM[i - 1] : e, n = y > 0 ? info.elevationM[i - nx] : e;
      const shade = Math.max(-0.25, Math.min(0.25, ((w - e) + (n - e)) / 400));
      let rgb: [number, number, number];
      if (layer === 'rock') rgb = hex(LITH_COLORS[info.surfaceClass[i]]);
      else if (layer === 'exposure') { const v = info.exposure[i] / 100; rgb = [60 + 160 * v, 60 + 120 * v, 70]; }
      else if (e < 0) { const d = Math.min(1, -e / 3000); rgb = [30 - 20 * d, 90 - 50 * d, 190 - 80 * d]; }
      else { const t = Math.min(1, e / hi); rgb = [70 + 120 * t, 150 - 50 * t, 60 + 30 * t]; }
      const k = layer === 'topography' ? 1 + shade : 1;
      g.fillStyle = `rgb(${Math.min(255, rgb[0] * k) | 0},${Math.min(255, rgb[1] * k) | 0},${Math.min(255, rgb[2] * k) | 0})`;
      g.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
      if (layer === 'rock' && e < 0) { g.fillStyle = 'rgba(20,60,160,0.45)'; g.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5); }
    }
  }
  for (const c of cored) {
    g.fillStyle = '#fff'; g.beginPath();
    g.arc(((c % nx) + 0.5) * cw, (Math.floor(c / nx) + 0.5) * ch, Math.max(2, cw * 0.18), 0, 7); g.fill();
  }
  if (selected >= 0) {
    g.strokeStyle = '#ffec4d'; g.lineWidth = 2;
    g.strokeRect((selected % nx) * cw, Math.floor(selected / nx) * ch, cw, ch);
  }
}

export function cellAt(canvas: HTMLCanvasElement, info: PublicInfo, ev: MouseEvent): number {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * info.nx);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * info.ny);
  return Math.min(info.ny - 1, Math.max(0, y)) * info.nx + Math.min(info.nx - 1, Math.max(0, x));
}
