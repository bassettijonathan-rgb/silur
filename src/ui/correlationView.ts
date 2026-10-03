/**
 * Correlation panel: every core side by side on one depth scale, with an optional proxy curve beside each log.
 * Click a column to mark a depth, click a second column to join the two marks with a tie line.
 * Ties are drawn in a colour per kind; derived ages are not shown here (see the Age tab).
 */
import { Tie, TieKind } from '../game/correlation';
import { LITH_COLORS } from '../shared/lithology';
import { AssaySample, CoreResult } from '../shared/protocol';
import { PROXIES, ProxyId } from '../shared/proxies';
import { CURVE_COLORS } from './coreView';

export const TIE_COLORS: Record<TieKind, string> = { ash: '#ffd24d', excursion: '#7aa8ff', fossil: '#7fe08c', manual: '#c58be5' };

const TOP = 26, PAD = 8, COL_W = 150, LOG_W = 38, GAP = 62;

export interface CorrelationState {
  cores: CoreResult[];
  assays: Map<string, Map<ProxyId, AssaySample[]>>;
  ties: Tie[];
  proxy: ProxyId | null;
  pending: { coreId: string; depthM: number } | null;
}

interface Layout { x0: number; x: Map<string, number>; scale: number }

function layout(canvas: HTMLCanvasElement, cores: CoreResult[]): Layout {
  const maxLen = Math.max(1, ...cores.map((c) => c.lengthM));
  const x = new Map<string, number>();
  cores.forEach((c, i) => x.set(c.coreId, PAD + 24 + i * (COL_W + GAP)));
  return { x0: PAD, x, scale: (canvas.height - TOP - PAD) / maxLen };
}

export function canvasWidthFor(n: number): number { return Math.max(520, PAD + 24 + n * (COL_W + GAP)); }

export function drawCorrelation(canvas: HTMLCanvasElement, st: CorrelationState): void {
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!st.cores.length) { g.fillStyle = '#789'; g.fillText('drill or survey at least two sites to correlate them', 20, 30); return; }
  const L = layout(canvas, st.cores);
  const yOf = (z: number) => TOP + z * L.scale;
  g.font = '11px system-ui'; g.textBaseline = 'middle';

  // tie lines first, under the columns
  for (const t of st.ties) {
    const xa = L.x.get(t.a.coreId), xb = L.x.get(t.b.coreId);
    if (xa === undefined || xb === undefined) continue;
    const [left, right] = xa < xb ? [t.a, t.b] : [t.b, t.a];
    const xl = Math.min(xa, xb) + COL_W, xr = Math.max(xa, xb);
    g.strokeStyle = TIE_COLORS[t.kind]; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(xl, yOf(left.depthM)); g.lineTo(xr, yOf(right.depthM)); g.stroke();
  }
  g.lineWidth = 1;

  st.cores.forEach((c) => {
    const x = L.x.get(c.coreId)!;
    g.fillStyle = '#9ab';
    g.fillText(`${c.cell}${c.source === 'outcrop' ? ' ▫' : ''}`, x, 12);
    // depth ticks
    for (let z = 0; z <= c.lengthM; z += tick(c.lengthM)) { g.fillText(`${z}`, x - 24, yOf(z)); }
    for (const b of c.beds) {
      g.fillStyle = LITH_COLORS[b.lith];
      g.fillRect(x, yOf(b.topM), LOG_W, Math.max(0.8, (b.baseM - b.topM) * L.scale));
      if (b.notes.some((n) => n.includes('ash'))) { g.fillStyle = '#ff0'; g.fillRect(x + LOG_W - 5, yOf(b.topM), 5, Math.max(2, (b.baseM - b.topM) * L.scale)); }
    }
    g.fillStyle = 'rgba(0,0,0,0.55)';
    for (const gap of c.gaps) g.fillRect(x, yOf(gap.topM), LOG_W, Math.max(1, (gap.baseM - gap.topM) * L.scale));
    g.strokeStyle = '#667'; g.strokeRect(x, TOP, LOG_W, c.lengthM * L.scale);

    // proxy curve
    const samples = st.proxy ? st.assays.get(c.coreId)?.get(st.proxy)?.filter((s) => s.value !== null) : undefined;
    if (st.proxy && samples && samples.length) {
      const info = PROXIES[st.proxy];
      const tf = (v: number) => (info.log ? Math.log10(Math.max(v, 1e-9)) : v);
      let lo = Infinity, hi = -Infinity;
      for (const s of samples) { lo = Math.min(lo, tf(s.value!)); hi = Math.max(hi, tf(s.value!)); }
      if (!(hi > lo)) { lo -= 1; hi += 1; }
      const cx0 = x + LOG_W + 6, cw = COL_W - LOG_W - 8;
      g.strokeStyle = '#445'; g.strokeRect(cx0, TOP, cw, c.lengthM * L.scale);
      g.strokeStyle = CURVE_COLORS[0]; g.beginPath();
      samples.forEach((s, i) => { const px = cx0 + ((tf(s.value!) - lo) / (hi - lo)) * cw, py = yOf(s.depthM); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
      g.stroke();
    }
  });

  if (st.pending) {
    const x = L.x.get(st.pending.coreId);
    if (x !== undefined) { g.strokeStyle = '#ffec4d'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x - 4, yOf(st.pending.depthM)); g.lineTo(x + COL_W, yOf(st.pending.depthM)); g.stroke(); g.setLineDash([]); }
  }
  g.fillStyle = '#9ab'; g.textBaseline = 'alphabetic';
  g.fillText(st.proxy ? `curve: ${PROXIES[st.proxy].label}` : 'curve: none', canvas.width - 190, 12);
}

/** Which core and depth were clicked, if any. */
export function correlationHit(canvas: HTMLCanvasElement, cores: CoreResult[], ev: MouseEvent): { coreId: string; depthM: number } | null {
  const r = canvas.getBoundingClientRect();
  const px = ((ev.clientX - r.left) / r.width) * canvas.width, py = ((ev.clientY - r.top) / r.height) * canvas.height;
  const L = layout(canvas, cores);
  for (const c of cores) {
    const x = L.x.get(c.coreId)!;
    if (px >= x - 4 && px <= x + COL_W) {
      const depthM = (py - TOP) / L.scale;
      if (depthM >= 0 && depthM <= c.lengthM) return { coreId: c.coreId, depthM: +depthM.toFixed(2) };
    }
  }
  return null;
}

function tick(len: number): number { return len > 400 ? 100 : len > 150 ? 50 : len > 60 ? 20 : 10; }
