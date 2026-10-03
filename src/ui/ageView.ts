/** Age tab: the age–depth plot of one core, its sedimentation-rate table and a biostratigraphic range chart. */
import { AgeModel } from '../game/agemodel';
import { FossilResult } from '../shared/protocol';
import { el } from './dom';

const L = 56, R = 14, T = 16, B = 34;

export function drawAgeDepth(canvas: HTMLCanvasElement, model: AgeModel | undefined, lengthM: number): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.font = '11px system-ui'; g.textBaseline = 'middle';
  if (!model || !model.points.length) { g.fillStyle = '#789'; g.fillText('no dates yet: buy radiometric dates on ash beds, or tie this core to a dated one', 20, 30); return; }
  let a0 = Infinity, a1 = -Infinity;
  for (const p of model.points) { a0 = Math.min(a0, p.ageMa - 2 * p.sigmaMa); a1 = Math.max(a1, p.ageMa + 2 * p.sigmaMa); }
  if (!(a1 > a0)) { a0 -= 0.5; a1 += 0.5; }
  const pad = (a1 - a0) * 0.06; a0 -= pad; a1 += pad;
  const x = (a: number) => L + ((a - a0) / (a1 - a0)) * (W - L - R);
  const y = (z: number) => T + (z / Math.max(lengthM, 1)) * (H - T - B);

  g.strokeStyle = '#445'; g.strokeRect(L, T, W - L - R, H - T - B);
  g.fillStyle = '#9ab';
  for (let i = 0; i <= 5; i++) {
    const z = (lengthM * i) / 5; g.fillText(z.toFixed(0), 6, y(z));
    const a = a0 + ((a1 - a0) * i) / 5; g.textAlign = 'center'; g.fillText(a.toFixed(2), x(a), H - B + 12); g.textAlign = 'left';
  }
  g.fillText('age (Ma)  →  older', W / 2 - 40, H - 8);
  g.fillText('m', 6, 8);

  // 1σ band
  const steps = 80, lo = model.knots[0].depthM, hi = model.knots[model.knots.length - 1].depthM;
  if (hi > lo) {
    g.fillStyle = 'rgba(122,168,255,0.18)'; g.beginPath();
    for (let i = 0; i <= steps; i++) { const z = lo + ((hi - lo) * i) / steps, m = model.at(z)!; g[i ? 'lineTo' : 'moveTo'](x(m.ageMa - m.sigmaMa), y(z)); }
    for (let i = steps; i >= 0; i--) { const z = lo + ((hi - lo) * i) / steps, m = model.at(z)!; g.lineTo(x(m.ageMa + m.sigmaMa), y(z)); }
    g.closePath(); g.fill();
  }
  g.lineWidth = 1.5;
  for (const s of model.segments) {
    g.strokeStyle = s.flat ? '#e5584f' : '#7aa8ff';
    g.beginPath(); g.moveTo(x(s.topAgeMa), y(s.topM)); g.lineTo(x(s.baseAgeMa), y(s.baseM)); g.stroke();
  }
  g.lineWidth = 1;
  for (const p of model.points) {
    g.strokeStyle = g.fillStyle = p.origin === 'date' ? '#ffd24d' : '#7fe08c';
    g.beginPath(); g.moveTo(x(p.ageMa - p.sigmaMa), y(p.depthM)); g.lineTo(x(p.ageMa + p.sigmaMa), y(p.depthM)); g.stroke();
    g.fillRect(x(p.ageMa) - 3, y(p.depthM) - 3, 6, 6);
  }
  g.strokeStyle = '#ff5a5a';
  for (const p of model.suspect) { g.beginPath(); g.arc(x(p.ageMa), y(p.depthM), 8, 0, 7); g.stroke(); }
}

export function segmentTable(model: AgeModel | undefined): HTMLElement {
  const box = el('div', { class: 'dim' });
  if (!model || !model.segments.length) { box.textContent = model ? 'one date only: no rate can be computed.' : ''; return box; }
  const rows = model.segments.map((s) => {
    const rate = s.flat ? 'flat — hiatus or a bad date' : `${(s.rateMPerMyr / 1000).toFixed(2)} m/kyr`;
    return el('tr', s.flat ? { class: 'bad' } : {}, el('td', {}, `${s.topM.toFixed(0)}–${s.baseM.toFixed(0)} m`), el('td', {}, `${s.topAgeMa.toFixed(2)} → ${s.baseAgeMa.toFixed(2)} Ma`), el('td', {}, rate));
  });
  box.append(el('table', {}, el('tr', {}, el('th', {}, 'interval'), el('th', {}, 'age'), el('th', {}, 'rate')), ...rows));
  if (model.suspect.length) box.append(el('div', { class: 'bad' }, `${model.suspect.length} date(s) disagree with the rest by more than 3σ (ringed): inherited grains, lead loss, or a wrong tie?`));
  return box;
}

/** Range chart: where each named form was found in the sampled depths of this core. */
export function rangeTable(fossils: FossilResult[], model: AgeModel | undefined): HTMLElement {
  const box = el('div', { class: 'dim' });
  const byName = new Map<string, { habit: string; min: number; max: number; n: number; count: number }>();
  for (const f of fossils) {
    for (const m of f.found) {
      const r = byName.get(m.name) ?? { habit: m.habit, min: Infinity, max: -Infinity, n: 0, count: 0 };
      r.min = Math.min(r.min, f.depthM); r.max = Math.max(r.max, f.depthM); r.n++; r.count += m.count;
      byName.set(m.name, r);
    }
  }
  if (!byName.size) { box.textContent = 'no fossil samples yet.'; return box; }
  const age = (z: number) => { const a = model?.at(z); return a ? `${a.ageMa.toFixed(2)} Ma` : '–'; };
  const rows = [...byName.entries()].sort((a, b) => a[1].min - b[1].min).map(([name, r]) =>
    el('tr', {}, el('td', {}, name), el('td', {}, r.habit), el('td', {}, `${r.n}/${fossils.length}`), el('td', {}, `${r.min.toFixed(0)} m (${age(r.min)})`), el('td', {}, `${r.max.toFixed(0)} m (${age(r.max)})`)));
  box.append(el('table', {}, el('tr', {}, el('th', {}, 'form'), el('th', {}, 'habit'), el('th', {}, 'samples'), el('th', {}, 'highest'), el('th', {}, 'lowest')), ...rows));
  box.append(el('div', {}, 'A form missing from a sample may simply be rare there: absence is weak evidence.'));
  return box;
}
