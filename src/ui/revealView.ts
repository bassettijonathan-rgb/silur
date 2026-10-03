/** Reveal tab: score, truth-vs-claim timeline, evidence audit, ideal observer, destroyed evidence, calibration. */
import { GameRecord, calibrationError, reliability } from '../game/history';
import { RevealEvent, RevealMessage } from '../shared/reveal';
import { Submission } from '../shared/submission';
import { el } from './dom';

export const TYPE_COLOR: Record<string, string> = {
  lip: '#e5584f', bolide: '#e8a33d', clathrate: '#c58be5', supernova: '#7ce0d1', aridification: '#b59a5a', civilization: '#ffec4d',
  glaciation: '#9ad0ff', oae: '#5a6fd6', hyperthermal: '#ff8a65', extinction: '#8bd17c', other: '#889',
};
const bits = (x: number): string => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

export function renderReveal(root: HTMLElement, r: RevealMessage, sub: Submission, history: GameRecord[]): void {
  const { score: s, reveal: v } = r;
  const timeline = el('canvas', { width: '900', height: '560' });
  const erased = el('canvas', { width: '440', height: '120' });
  const calib = el('canvas', { width: '220', height: '220' });
  root.replaceChildren(
    el('h3', {}, `The truth about world "${v.seed}"`),
    el('div', { class: 'dim' }, 'Timeline: filled bars are what happened (a slash marks events nobody could have been expected to find); outlines are your claims, dashed if they matched nothing.'),
    summary(r),
    timeline,
    el('h4', {}, 'Every event, and what survived of it'), eventTable(v.events, s.matches.map((m) => m.truthId), v.cells),
    el('h4', {}, 'Rock destroyed by erosion, by the age of the rock'), erased,
    el('div', { class: 'dim' }, `Mean removed per cell: ${(v.erasedByAge.thicknessM.reduce((a, b) => a + b, 0) / v.cells).toFixed(0)} m. Events whose rock was destroyed or never formed are not charged as misses.`),
    el('h4', {}, 'Your calibration'), el('div', { class: 'row' }, calib, calibrationText(s.calibration, history)),
  );
  drawTimeline(timeline, r, sub);
  drawErased(erased, v.erasedByAge);
  drawReliability(calib, s.calibration, history);
}

function summary(r: RevealMessage): HTMLElement {
  const { score: s, reveal: v } = r;
  const present = v.civilization.present;
  const box = el('div', { class: 'hyp' });
  box.append(
    el('div', {}, el('b', {}, present ? 'A civilization DID exist' : 'No civilization existed'),
      present && v.civilization.ageMa ? ` (${v.civilization.ageMa[0].toFixed(3)}–${v.civilization.ageMa[1].toFixed(3)} Ma, ${Math.round(v.civilization.params?.durationYr ?? 0)} yr, ${Math.round(v.civilization.params?.carbonPg ?? 0)} Pg C burned)` : '.'),
    el('div', {}, `You said ${Math.round(s.headline.p * 100)} %: ${bits(s.headline.bits)} bits (Brier ${s.headline.brier.toFixed(2)}).`),
  );
  if (v.ideal) {
    box.append(el('div', {}, `The ideal observer — unlimited budget, every column — said ${Math.round(v.ideal.pCivilization * 100)} %: ${bits(v.ideal.headlineBits)} bits.` +
      (v.ideal.murky ? ' This world was left murky on purpose: "I can\'t tell" was a good answer.' : '')));
  }
  const t = s.totals;
  box.append(el('table', {},
    ...[['headline', t.headline], ['events: really happened?', t.existence], ['episodes: cause', t.cause], ['ages (interval score)', t.age], ['missed detectable events', t.miss], ['TOTAL', t.total], ['(an empty answer would have scored)', s.doNothing]]
      .map(([k, x]) => el('tr', k === 'TOTAL' ? { class: 'total' } : String(k).startsWith('(') ? { class: 'dim' } : {}, el('td', {}, String(k)), el('td', {}, `${bits(x as number)} bits`)))));
  box.append(el('div', { class: 'dim' }, `${s.matches.length} found · ${s.falsePositives.length} false alarms · ${s.misses.length} detectable events missed. Mean Brier over all your probabilities: ${s.brier.toFixed(2)}.`));
  return box;
}

function eventTable(events: RevealEvent[], matchedIds: number[], cells: number): HTMLElement {
  const matched = new Set(matchedIds);
  const rows = events.map((e) => {
    const a = e.audit;
    const status = matched.has(e.id) ? 'found' : a.weight > 0 ? 'MISSED' : a.preservedCells === 0 ? 'no rock left' : 'too subtle';
    return el('tr', status === 'MISSED' ? { class: 'bad' } : {}, el('td', {}, el('span', { style: `color:${TYPE_COLOR[e.type] ?? '#889'}` }, e.type)),
      el('td', {}, e.ageMa[0] === e.ageMa[1] ? e.ageMa[0].toFixed(3) : `${e.ageMa[0].toFixed(3)}–${e.ageMa[1].toFixed(3)}`), el('td', {}, magnitudeText(e)),
      el('td', {}, e.cause + (e.parents.length ? ` (← #${e.parents.join(', #')})` : '')), el('td', {}, `${a.preservedCells}/${a.depositedCells}`),
      el('td', {}, `${Math.round(a.detectability * 100)} %`), el('td', {}, a.erasedThicknessM > 0 ? `${(a.erasedThicknessM / cells).toFixed(1)} m` : '–'), el('td', {}, status));
  });
  return el('table', {}, el('tr', {}, ...['type', 'age (Ma)', 'size', 'cause', 'cells with rock / depositing', 'detectable', 'rock eroded (mean m/cell)', 'you'].map((h) => el('th', {}, h))), ...rows);
}

function magnitudeText(e: RevealEvent): string {
  switch (e.type) {
    case 'bolide': return `${e.magnitude.toFixed(1)} km`;
    case 'lip': case 'clathrate': case 'civilization': return `${e.magnitude.toExponential(1)} Pg C`;
    case 'extinction': return `${Math.round(e.magnitude * 100)} % of species`;
    default: return e.magnitude.toPrecision(2);
  }
}

function drawTimeline(canvas: HTMLCanvasElement, r: RevealMessage, sub: Submission): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height, L = 70, R = 10;
  const D = r.reveal.durationMyr;
  const x = (age: number) => L + (1 - age / D) * (W - L - R); // old on the left, present on the right
  g.clearRect(0, 0, W, H); g.font = '11px system-ui'; g.textBaseline = 'middle';
  const plots = ['d13C', 'temp', 'extinction'];
  const ph = 70;
  plots.forEach((id, k) => {
    const s = r.reveal.curves.series.find((q) => q.id === id)!;
    const y0 = 8 + k * (ph + 6);
    let lo = Infinity, hi = -Infinity;
    for (const v of s.values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    g.strokeStyle = '#334'; g.strokeRect(L, y0, W - L - R, ph);
    g.fillStyle = '#9ab'; g.fillText(s.label, 4, y0 + 10); g.fillText(lo.toPrecision(3), 4, y0 + ph - 4); g.fillText(hi.toPrecision(3), 4, y0 + 24);
    g.strokeStyle = '#7aa8ff'; g.beginPath();
    s.values.forEach((v, i) => { const px = x(r.reveal.curves.ageMa[i]), py = y0 + ph - ((v - lo) / (hi - lo)) * ph; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
    g.stroke();
  });
  const top = 8 + plots.length * (ph + 6) + 6;
  const types = [...new Set([...r.reveal.events.map((e) => e.type), ...sub.events.map((e) => e.type)])];
  const lane = (t: string) => types.indexOf(t);
  const laneH = Math.min(16, (H - top - 40) / (2 * types.length + 1));
  // truth lanes
  g.fillStyle = '#9ab'; g.fillText('truth', 4, top + 6);
  for (const e of r.reveal.events) {
    const yy = top + 12 + lane(e.type) * laneH;
    g.fillStyle = TYPE_COLOR[e.type] ?? '#889';
    g.fillRect(x(e.ageMa[0]), yy, Math.max(3, x(e.ageMa[1]) - x(e.ageMa[0])), laneH - 3);
    if (e.audit.weight <= 0) { g.strokeStyle = '#000'; g.beginPath(); g.moveTo(x(e.ageMa[0]), yy); g.lineTo(x(e.ageMa[0]) + 3, yy + laneH - 3); g.stroke(); }
  }
  const base2 = top + 12 + types.length * laneH + 10;
  g.fillStyle = '#9ab'; g.fillText('you', 4, base2);
  const matched = new Set(r.score.matches.map((m) => m.submittedId));
  for (const e of sub.events) {
    const yy = base2 + 8 + lane(e.type) * laneH;
    g.strokeStyle = TYPE_COLOR[e.type] ?? '#889'; g.lineWidth = 2;
    g.setLineDash(matched.has(e.id) ? [] : [3, 3]);
    g.strokeRect(x(e.ageMaxMa), yy, Math.max(3, x(e.ageMinMa) - x(e.ageMaxMa)), laneH - 3);
  }
  g.setLineDash([]); g.lineWidth = 1;
  // legend + axis
  g.fillStyle = '#9ab'; g.textBaseline = 'alphabetic';
  types.forEach((t, i) => { g.fillStyle = TYPE_COLOR[t] ?? '#889'; g.fillText(t, 4 + (i % 6) * 90, H - 30 + Math.floor(i / 6) * 12); });
  g.fillStyle = '#9ab';
  for (let i = 0; i <= 5; i++) { const a = (D * i) / 5; g.textAlign = 'center'; g.fillText(`${a.toFixed(0)}`, x(a), H - 4); }
  g.textAlign = 'left'; g.fillText('Ma', 40, H - 4);
}

function drawErased(canvas: HTMLCanvasElement, e: { ageMa: number[]; thicknessM: number[] }): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const mx = Math.max(1, ...e.thicknessM);
  const bw = (W - 40) / e.thicknessM.length;
  g.fillStyle = '#e5584f';
  e.thicknessM.forEach((t, i) => { const h = (t / mx) * (H - 24); g.fillRect(36 + i * bw, H - 14 - h, Math.max(1, bw - 1), h); });
  g.fillStyle = '#9ab'; g.font = '10px system-ui';
  g.fillText(`${mx.toFixed(0)} m`, 2, 10); g.fillText(`${e.ageMa[0].toFixed(0)} Ma`, 36, H - 2); g.fillText(`${e.ageMa[e.ageMa.length - 1].toFixed(0)} Ma`, W - 40, H - 2);
}

function drawReliability(canvas: HTMLCanvasElement, thisGame: { p: number; outcome: boolean }[], history: GameRecord[]): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width, S = W - 36;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = '#334'; g.strokeRect(30, 6, S - 4, S - 4);
  g.beginPath(); g.moveTo(30, S + 2); g.lineTo(S + 26, 6); g.strokeStyle = '#556'; g.stroke();
  const plot = (st: { p: number; outcome: boolean }[], color: string, r: number) => {
    for (const b of reliability(st).filter((q) => q.n > 0)) {
      g.fillStyle = color; g.beginPath(); g.arc(30 + b.meanP * (S - 4), S + 2 - b.freq * (S - 4), r + Math.min(5, Math.log2(b.n + 1)), 0, 7); g.fill();
    }
  };
  plot(history.flatMap((h) => h.statements), 'rgba(122,168,255,0.8)', 2);
  plot(thisGame, '#ffec4d', 2);
  g.fillStyle = '#9ab'; g.font = '10px system-ui';
  g.fillText('stated probability →', 40, W - 4); g.save(); g.translate(10, S - 20); g.rotate(-Math.PI / 2); g.fillText('how often true →', 0, 0); g.restore();
}

function calibrationText(thisGame: { p: number; outcome: boolean }[], history: GameRecord[]): HTMLElement {
  const all = history.flatMap((h) => h.statements);
  const e1 = calibrationError(reliability(thisGame)), e2 = calibrationError(reliability(all));
  return el('div', { class: 'dim' },
    el('div', {}, 'On the diagonal = well calibrated: when you say 80 %, it happens about 80 % of the time. Above it = you were underconfident; below = overconfident.'),
    el('div', {}, `This game (yellow): ${thisGame.length} statements, calibration error ${(e1 * 100).toFixed(0)} points.`),
    el('div', {}, `All your games (blue): ${history.length} games, ${all.length} statements, error ${(e2 * 100).toFixed(0)} points.`),
    el('div', {}, history.length ? `Previous totals: ${history.slice(-8).map((h) => bits(h.total)).join(', ')} bits.` : ''));
}
