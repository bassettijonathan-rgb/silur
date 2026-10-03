/**
 * Developer debug page: generate Earth + strata in the browser and inspect the map and any column.
 * NOT part of the game bundle — it deliberately uses the truth layer.
 */
import { makeConfig } from '../src/shared/config';
import { Rng } from '../src/shared/rng';
import { buildTimePlan } from '../src/shared/timeplan';
import { generateSlowDrivers } from '../src/truth/earth/drivers';
import { samplePlanet } from '../src/truth/earth/planet';
import { runEarthSystem } from '../src/truth/earth/run';
import type { TemplateName } from '../src/truth/geo/tectonics';
import { layerThickness } from '../src/truth/strat/compaction';
import { FACIES } from '../src/truth/strat/facies';
import { StratWorld, memoryStats, simulateStrata } from '../src/truth/strat/simulate';
import { NT, T } from '../src/truth/strat/tracers';

const COLORS = ['#e0c060', '#8bbf6a', '#b8c4d0', '#d98ad9', '#e8a45c', '#a9906a', '#5fb7e8', '#2c3e6b'];
document.getElementById('legend')!.innerHTML = FACIES.map((n, i) => `<span><i style="background:${COLORS[i]}"></i>${n}</span>`).join('');

let world: StratWorld | null = null;
const mapC = document.getElementById('map') as HTMLCanvasElement;
const colC = document.getElementById('col') as HTMLCanvasElement;

function drawMap(sel = -1): void {
  if (!world) return;
  const g = mapC.getContext('2d')!;
  const { nx, ny } = world;
  const cw = mapC.width / nx, ch = mapC.height / ny;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    const h = world.surface[i] - world.seaLevelNow;
    if (h < 0) { const d = Math.min(1, -h / 3000); g.fillStyle = `rgb(${30 - 20 * d | 0},${90 - 50 * d | 0},${200 - 90 * d | 0})`; }
    else { const e = Math.min(1, h / 2500); g.fillStyle = `rgb(${70 + 110 * e | 0},${150 - 60 * e | 0},${60 + 20 * e | 0})`; }
    g.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
    if (i === sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x * cw, y * ch, cw, ch); }
  }
}

function drawColumn(ci: number): void {
  if (!world) return;
  const c = world.columns[ci];
  const g = colC.getContext('2d')!;
  g.clearRect(0, 0, colC.width, colC.height);
  g.fillStyle = '#9ab'; g.font = '11px system-ui';
  if (c.n === 0) { g.fillText('no rock in this column (bare basement)', 10, 20); return; }
  // present-day thickness of each layer, burial depth from the top down
  const m = { phi0: 0, lambda: 0, s: 0 };
  c.meanLitho(m);
  const th = new Float64Array(c.n);
  let z = 0;
  for (let i = c.n - 1; i >= 0; i--) { th[i] = layerThickness(c.solid[i], z, m.phi0, m.lambda); z += th[i]; }
  const total = z;
  const H = colC.height - 20;
  let top = 10;
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < c.n; i++) { const caco3 = c.tr[i * NT + T.caco3]; if (caco3 > 1e-4) { const v = c.tr[i * NT + T.d13C_carb] / caco3; dMin = Math.min(dMin, v); dMax = Math.max(dMax, v); } }
  for (let i = c.n - 1; i >= 0; i--) {
    const h = (th[i] / total) * H;
    g.fillStyle = COLORS[c.facies[i]];
    g.fillRect(10, top, 90, Math.max(h, 0.6));
    const caco3 = c.tr[i * NT + T.caco3];
    if (caco3 > 1e-4 && dMax > dMin) {
      const v = c.tr[i * NT + T.d13C_carb] / caco3;
      g.fillStyle = '#8bd17c'; g.fillRect(130, top, 40 + 140 * (v - dMin) / (dMax - dMin), Math.max(h, 0.6));
    }
    const mass = c.tr[i * NT + T.clastic] * 2700 + caco3 * 2710 + c.tr[i * NT + T.evap] * 2200;
    const toc = 100 * c.tr[i * NT + T.orgC] / Math.max(mass, 1);
    g.fillStyle = '#e5584f'; g.fillRect(340, top, Math.min(160, toc * 25), Math.max(h, 0.6));
    if (c.flags[i] & 1) { g.fillStyle = '#fff'; g.fillRect(8, top, 4, 1.5); }
    top += h;
  }
  g.fillStyle = '#9ab';
  g.fillText(`cell ${ci}: ${c.n} layers, ${total.toFixed(0)} m, oldest ${c.ageMean[0].toFixed(1)} Ma, white ticks = hiatus below`, 10, colC.height - 4);
  g.fillText(`δ13C ${dMin.toFixed(1)}…${dMax.toFixed(1)} ‰`, 130, 9);
}

function run(): void {
  const seed = (document.getElementById('seed') as HTMLInputElement).value;
  const tpl = (document.getElementById('tpl') as HTMLSelectElement).value as TemplateName;
  const nx = Number((document.getElementById('nx') as HTMLInputElement).value);
  const dur = Number((document.getElementById('dur') as HTMLInputElement).value);
  const config = makeConfig(seed, 'dev');
  config.grid = { nx, ny: nx, cellKm: 256 / nx };
  config.durationMyr = dur;
  const rng = new Rng(seed);
  const planet = samplePlanet(rng);
  const plan = buildTimePlan({ durationMyr: dur, baseDtYr: config.baseDtYr });
  const t0 = performance.now();
  const earth = runEarthSystem({ planet, plan, drivers: generateSlowDrivers(plan, planet, rng) });
  world = simulateStrata({ config, plan, earth, rng, template: tpl });
  const mem = memoryStats(world);
  (document.getElementById('info') as HTMLElement).textContent =
    ` ${plan.n} steps, ${((performance.now() - t0) / 1000).toFixed(1)} s, ${mem.layers.toLocaleString()} layers ≈ ${mem.mbytes.toFixed(0)} MB`;
  drawMap();
  drawColumn((nx / 2 | 0) * nx + (nx / 2 | 0));
}

mapC.addEventListener('click', (ev) => {
  if (!world) return;
  const r = mapC.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * world.nx);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * world.ny);
  const ci = y * world.nx + x;
  drawMap(ci);
  drawColumn(ci);
});
document.getElementById('go')!.addEventListener('click', run);
run();
