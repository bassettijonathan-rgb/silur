/** Play bots over many seeds and print the score ladder: npx tsx tools/run-bots.ts [nSeeds] [preset] [difficulty] [firstSeed] */
import { PRESET_DIFFICULTY, DifficultyName, PresetName, makeConfig } from '../src/shared/config';
import { ObservationService } from '../src/observation/service';
import { scoreAndReveal } from '../src/observation/reveal';
import { generateSolvableWorld } from '../src/observation/solvability/gate';
import { Rng } from '../src/shared/rng';
import { BOTS } from './bots';

const n = Number(process.argv[2] ?? 12), preset = (process.argv[3] ?? 'dev') as PresetName;
const level = (process.argv[4] ?? 'normal') as DifficultyName, first = Number(process.argv[5] ?? 0), budgetOverride = process.argv[6] ? Number(process.argv[6]) : undefined;

interface Row { gain: number; total: number; headline: number; right: boolean; matches: number; spent: number }
const rows: Record<string, Row[]> = Object.fromEntries(Object.keys(BOTS).map((k) => [k, []]));
let civ = 0, clear = 0, attempts = 0, murky = 0;
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const config = makeConfig(`bot-${first + i}`, preset, { ...PRESET_DIFFICULTY[level], ...(budgetOverride ? { budget: budgetOverride } : {}) });
  if (preset === 'dev') { config.grid = { nx: 24, ny: 24, cellKm: 8 }; config.durationMyr = 80; }
  const { world, solvability } = generateSolvableWorld(config);
  civ += world.agents.length ? 1 : 0;
  const pIdeal = solvability.assessment.pCivilization, rightP = world.agents.length ? pIdeal : 1 - pIdeal;
  clear += rightP >= 0.8 ? 1 : 0; attempts += solvability.attempts; murky += solvability.murky ? 1 : 0;
  for (const [name, bot] of Object.entries(BOTS)) {
    const svc = new ObservationService(world);
    const sub = bot({ world, svc, solv: solvability, rng: new Rng(`bot|${name}|${first + i}`) });
    const { score } = scoreAndReveal(world, solvability, sub);
    rows[name].push({ gain: score.totals.total - score.doNothing, total: score.totals.total, headline: score.totals.headline, right: (sub.pCivilization > 0.5) === world.agents.length > 0, matches: score.matches.length, spent: config.difficulty.budget - svc.budget });
  }
  process.stderr.write(`\r${i + 1}/${n} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const se = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / Math.max(1, v.length - 1) / v.length);
console.log(`\n${n} worlds, preset ${preset}, difficulty ${level}${budgetOverride ? ` budget ${budgetOverride}` : ''}, civilization in ${civ}`);
console.log(`ideal observer: right by ≥ 0.8 in ${(100 * clear / n).toFixed(0)} % of worlds (clear), murky ${(100 * murky / n).toFixed(0)} %, mean draws ${(attempts / n).toFixed(2)}`);
console.log('bot         gain over doing nothing (bits)   headline   headline right   events found   budget spent   beats do-nothing');
for (const [name, r] of Object.entries(rows)) {
  const beats = mean(r.map((x, i) => (x.gain > rows['do-nothing'][i].gain + 1e-9 ? 1 : 0)));
  console.log(`${name.padEnd(11)} ${mean(r.map((x) => x.gain)).toFixed(1).padStart(7)} ±${se(r.map((x) => x.gain)).toFixed(1).padEnd(5)} ${mean(r.map((x) => x.headline)).toFixed(2).padStart(8)} ${(100 * mean(r.map((x) => (x.right ? 1 : 0)))).toFixed(0).padStart(12)} % ${mean(r.map((x) => x.matches)).toFixed(1).padStart(14)} ${mean(r.map((x) => x.spent)).toFixed(0).padStart(14)} ${(100 * beats).toFixed(0).padStart(14)} %`);
}
