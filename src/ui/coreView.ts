/**
 * Core viewer: depth runs down the page. Left: the lithology log (lost core hatched, notes marked).
 * Right: one curve per assayed proxy against the same depth axis, with 1σ bars.
 */
import { LITHOLOGIES, LITH_COLORS } from '../shared/lithology';
import { AssaySample, CoreResult, DateResult, FossilResult } from '../shared/protocol';
import { PROXIES, ProxyId } from '../shared/proxies';

export const CURVE_COLORS = ['#e8a33d', '#8bd17c', '#e5584f', '#7aa8ff', '#c58be5', '#7ce0d1'];

/** Sample markers drawn beside the log. */
export interface CoreMarks { dates: DateResult[]; fossils: FossilResult[]; pickedM?: number | null }

const TOP = 22, BOT_PAD = 6;
/** Depth (m) under a mouse event on the core canvas. */
export function coreDepthAt(canvas: HTMLCanvasElement, ev: MouseEvent, z0: number, z1: number): number {
  const r = canvas.getBoundingClientRect();
  const py = ((ev.clientY - r.top) / r.height) * canvas.height;
  return z0 + ((py - TOP) / (canvas.height - BOT_PAD - TOP)) * (z1 - z0);
}

export function drawCore(
  canvas: HTMLCanvasElement, core: CoreResult, assays: Map<ProxyId, AssaySample[]> | undefined, z0: number, z1: number,
  marks: CoreMarks = { dates: [], fossils: [] },
): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const top = TOP, bot = H - BOT_PAD, axisW = 46, logW = 96, markW = 84;
  const y = (z: number) => top + ((z - z0) / (z1 - z0)) * (bot - top);
  g.font = '11px system-ui'; g.textBaseline = 'middle';

  // depth axis
  g.fillStyle = '#9ab'; g.strokeStyle = '#445';
  const step = niceStep((z1 - z0) / 8);
  for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) {
    g.fillText(`${+z.toFixed(2)}`, 4, y(z));
    g.beginPath(); g.moveTo(axisW - 6, y(z)); g.lineTo(axisW, y(z)); g.stroke();
  }
  g.fillText('m', 4, 10);

  // lithology
  for (const b of core.beds) {
    if (b.baseM < z0 || b.topM > z1) continue;
    const a = y(Math.max(b.topM, z0)), c = y(Math.min(b.baseM, z1));
    g.fillStyle = LITH_COLORS[b.lith];
    g.fillRect(axisW, a, logW, Math.max(c - a, 0.8));
    if (b.notes.length && c - a >= 0) {
      g.fillStyle = b.notes.some((n) => n.includes('ash')) ? '#ff0' : '#fff';
      g.fillRect(axisW + logW - 7, a, 7, Math.max(2, Math.min(c - a, 4)));
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.55)';
  for (const gap of core.gaps) {
    if (gap.baseM < z0 || gap.topM > z1) continue;
    const a = y(Math.max(gap.topM, z0)), c = y(Math.min(gap.baseM, z1));
    g.fillRect(axisW, a, logW, Math.max(c - a, 1));
  }
  g.strokeStyle = '#667'; g.strokeRect(axisW, top, logW, bot - top);

  // sample markers: radiometric dates (diamonds) and fossil samples (triangles)
  const mx = axisW + logW + 10;
  g.font = '10px system-ui';
  for (const d of marks.dates) {
    if (d.depthM < z0 || d.depthM > z1) continue;
    const py = y(d.depthM);
    g.fillStyle = d.ageMa === null ? '#778' : '#ffd24d';
    g.beginPath(); g.moveTo(mx, py - 4); g.lineTo(mx + 4, py); g.lineTo(mx, py + 4); g.lineTo(mx - 4, py); g.closePath(); g.fill();
    g.fillText(d.ageMa === null ? 'no ash' : `${d.ageMa.toFixed(2)}±${d.sigmaMa.toFixed(2)}`, mx + 7, py);
  }
  for (const f of marks.fossils) {
    if (f.depthM < z0 || f.depthM > z1) continue;
    const py = y(f.depthM);
    g.fillStyle = '#7fe08c';
    g.beginPath(); g.moveTo(mx + 56, py + 4); g.lineTo(mx + 60, py - 4); g.lineTo(mx + 64, py + 4); g.closePath(); g.fill();
    g.fillText(`${f.found.length}`, mx + 67, py);
  }
  if (marks.pickedM != null && marks.pickedM >= z0 && marks.pickedM <= z1) {
    g.strokeStyle = '#ffec4d'; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(axisW, y(marks.pickedM)); g.lineTo(W - 4, y(marks.pickedM)); g.stroke(); g.setLineDash([]);
  }
  g.font = '11px system-ui';

  // proxy curves
  const list = assays ? [...assays.entries()] : [];
  const left = axisW + logW + 14 + markW;
  const cw = list.length ? Math.max(70, (W - left - 6) / list.length - 8) : 0;
  list.forEach(([proxy, samples], k) => {
    const info = PROXIES[proxy];
    const x0 = left + k * (cw + 8);
    const vals = samples.filter((s) => s.value !== null && s.depthM >= z0 && s.depthM <= z1);
    g.strokeStyle = '#445'; g.strokeRect(x0, top, cw, bot - top);
    g.fillStyle = CURVE_COLORS[k % CURVE_COLORS.length]; g.fillText(info.label, x0, 10);
    if (!vals.length) return;
    const tf = (v: number) => (info.log ? Math.log10(Math.max(v, 1e-9)) : v);
    let lo = Infinity, hi = -Infinity;
    for (const s of vals) { lo = Math.min(lo, tf(s.value! - s.sigma)); hi = Math.max(hi, tf(s.value! + s.sigma)); }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const xv = (v: number) => x0 + ((tf(v) - lo) / (hi - lo)) * cw;
    g.strokeStyle = CURVE_COLORS[k % CURVE_COLORS.length]; g.fillStyle = g.strokeStyle; g.lineWidth = 1;
    g.beginPath();
    vals.forEach((s, i) => { const px = xv(Math.max(s.value!, 1e-9)), py = y(s.depthM); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
    g.stroke();
    for (const s of vals) {
      const px = xv(Math.max(s.value!, 1e-9)), py = y(s.depthM);
      g.fillRect(px - 2, py - 2, 4, 4);
      if (s.sigma > 0) { g.beginPath(); g.moveTo(xv(Math.max(s.value! - s.sigma, 1e-9)), py); g.lineTo(xv(s.value! + s.sigma), py); g.stroke(); }
    }
    g.fillStyle = '#9ab'; g.textBaseline = 'alphabetic';
    g.fillText(fmt(info.log ? 10 ** lo : lo), x0 + 1, bot - 2);
    g.textAlign = 'right'; g.fillText(fmt(info.log ? 10 ** hi : hi), x0 + cw - 1, top + 11); g.textAlign = 'left'; g.textBaseline = 'middle';
  });
}

export function legend(): string {
  return LITHOLOGIES.map((n, i) => `<span><i style="background:${LITH_COLORS[i]}"></i>${n}</span>`).join('');
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const fmt = (v: number): string => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : `${+v.toPrecision(3)}`);
