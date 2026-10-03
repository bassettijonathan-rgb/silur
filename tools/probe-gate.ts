/** How often does the gate pass, and how well does the ideal observer call civilizations? npx tsx tools/probe-gate.ts [n] [preset] */
import { makeConfig, PresetName } from '../src/shared/config';
import { generateSolvableWorld } from '../src/observation/solvability/gate';

const n = Number(process.argv[2] ?? 20);
const preset = (process.argv[3] ?? 'dev') as PresetName;
let tries = 0, murky = 0, civ = 0, hit = 0, falseAlarm = 0, noCiv = 0;
const t0 = performance.now();
for (let k = 0; k < n; k++) {
  const cfg = makeConfig(`gate-probe-${k}`, preset);
  const { world, solvability: s } = generateSolvableWorld(cfg);
  tries += s.attempts; if (s.murky) murky++;
  const has = world.agents.length > 0;
  const p = s.assessment.pCivilization;
  if (has) { civ++; if (p > 0.5) hit++; } else { noCiv++; if (p > 0.5) falseAlarm++; }
  console.log(`seed ${k}: attempts ${s.attempts}${s.murky ? ' MURKY' : ''}  civ=${has ? 'yes' : 'no '}  ideal P(civ)=${p.toFixed(2)}  minTruePosterior=${s.assessment.minTruePosterior.toFixed(2)}  events=${world.catalog.length}`);
}
console.log(`mean attempts ${(tries / n).toFixed(2)}, murky ${murky}/${n}; civ worlds called ${hit}/${civ}; false alarms ${falseAlarm}/${noCiv}; ${((performance.now() - t0) / 1000 / n).toFixed(1)} s per world`);
