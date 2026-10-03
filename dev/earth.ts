/**
 * Developer debug page: run the Earth-system model in the browser and plot the main curves.
 * NOT part of the game bundle (outside src/, own HTML entry) — it deliberately uses the truth layer.
 */
import { Rng } from '../src/shared/rng';
import { buildTimePlan } from '../src/shared/timeplan';
import { generateSlowDrivers } from '../src/truth/earth/drivers';
import { samplePlanet } from '../src/truth/earth/planet';
import { runEarthSystem } from '../src/truth/earth/run';
import type { DiagName } from '../src/truth/earth/model';

const PLOTS: { name: DiagName; label: string; color: string }[] = [
  { name: 'pCO2', label: 'pCO2 (ppm)', color: '#e8a33d' },
  { name: 'tempC', label: 'surface T (°C)', color: '#e5584f' },
  { name: 'seaLevel', label: 'sea level (m)', color: '#4fa3e5' },
  { name: 'ice', label: 'ice volume', color: '#bfe6ff' },
  { name: 'd13C_carb', label: 'δ13C carbonate (‰)', color: '#8bd17c' },
  { name: 'd18O_carb', label: 'δ18O carbonate (‰)', color: '#c58be5' },
  { name: 'ccd', label: 'CCD (m)', color: '#d1b38b' },
  { name: 'O2deep', label: 'deep-ocean O2 (µmol/kg)', color: '#7ce0d1' },
  { name: 'O2atm', label: 'atmospheric O2 (mole fraction)', color: '#f5f58b' },
];

function plot(host: HTMLElement, label: string, color: string, ageMa: Float64Array, y: Float64Array): void {
  const w = Math.min(900, window.innerWidth - 40);
  const h = 110;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  host.appendChild(c);
  const g = c.getContext('2d')!;
  let lo = Infinity, hi = -Infinity;
  for (const v of y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi === lo) { hi = lo + 1; }
  const x0 = ageMa[0];
  g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath();
  for (let i = 0; i < y.length; i++) {
    const px = ((x0 - ageMa[i]) / x0) * (w - 60) + 50;
    const py = h - 14 - ((y[i] - lo) / (hi - lo)) * (h - 28);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
  g.fillStyle = '#9ab'; g.font = '11px system-ui';
  g.fillText(label, 54, 12);
  g.fillText(hi.toPrecision(4), 2, 20);
  g.fillText(lo.toPrecision(4), 2, h - 8);
  g.fillText(`${x0.toFixed(0)} Ma → now`, w - 110, h - 2);
}

function run(): void {
  const seed = (document.getElementById('seed') as HTMLInputElement).value;
  const dur = Number((document.getElementById('dur') as HTMLInputElement).value);
  const dt = Number((document.getElementById('dt') as HTMLInputElement).value) * 1000;
  const rng = new Rng(seed);
  const planet = samplePlanet(rng);
  const plan = buildTimePlan({ durationMyr: dur, baseDtYr: dt });
  const drivers = generateSlowDrivers(plan, planet, rng);
  const t0 = performance.now();
  const hist = runEarthSystem({ planet, plan, drivers });
  const ms = performance.now() - t0;
  (document.getElementById('info') as HTMLElement).textContent =
    ` ${plan.n} steps in ${ms.toFixed(0)} ms · pCO2 ref ${planet.pCO2Ref} ppm · ECS ${planet.ecs.toFixed(1)} K`;
  const host = document.getElementById('plots')!;
  host.replaceChildren();
  const age = plan.ageBaseMa;
  for (const p of PLOTS) plot(host, p.label, p.color, age, hist.mean[p.name]);
}

document.getElementById('go')!.addEventListener('click', run);
run();
