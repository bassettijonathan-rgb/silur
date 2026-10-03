/**
 * The ideal observer (design D5, §5): with perfect access to the rock record — every column, every proxy, unlimited
 * budget, optimal sampling — what is the probability of each cause for each anomaly, and is a civilization present?
 *
 * "Approximately ideal": its power is bounded by the features it uses. If a real player could ever beat it, a
 * feature is missing. It supplies (a) the solvability gate at world generation, (b) the baseline score in the reveal.
 */
import { World } from '../../truth/world';
import { TruthEvent } from '../../truth/events/types';
import { FEATURES, Features, extractFeatures } from './features';
import { Model, Posterior, posterior } from './library';
import { Cls } from './miniworld';

/** Typical mix of anomalies in a world — the prior used for "is a civilization present" (class-uniform priors are used for gating). */
export const WORLD_PRIOR: Posterior = { civilization: 0.1, clathrate: 0.17, lip: 0.2, bolide: 0.3, supernova: 0.05, aridification: 0.18 };

export const CLASS_OF: Partial<Record<TruthEvent['type'], Cls>> = {
  civilization: 'civilization', clathrate: 'clathrate', lip: 'lip', bolide: 'bolide', supernova: 'supernova', aridification: 'aridification',
};

export interface EventAssessment {
  eventId: number;
  type: TruthEvent['type'];
  trueClass: Cls;
  /** Posterior under a uniform class prior (comparable across worlds; used for gating) and under the world prior. */
  uniform: Posterior;
  informed: Posterior;
  featuresUsed: number;
  /** Is this a "major, measurable" anomaly that counts toward solvability? */
  major: boolean;
  features: Features;
}

export interface Assessment {
  events: EventAssessment[];
  /** Ideal observer's probability that a civilization existed. */
  pCivilization: number;
  /** Lowest uniform-prior posterior of the true cause over major anomalies (1 if none) — informational. */
  minTruePosterior: number;
  solvable: boolean;
}

/** Major, measurable anomalies: the ones a field geologist could be asked to explain. */
function isMajor(e: TruthEvent, used: number, f: Features): boolean {
  if (used < 6) return false;
  if (e.type === 'supernova') return false;
  if (e.type === 'bolide' && e.magnitude < 4) return false;
  const signal = !Number.isNaN(f.cie) || !Number.isNaN(f.ext) || !Number.isNaN(f.ir);
  return signal;
}

export function assess(world: World, model: Model, worldPosteriorMin: number, temperature = 0.5): Assessment {
  const events: EventAssessment[] = [];
  for (const e of world.catalog) {
    const cls = CLASS_OF[e.type];
    if (!cls || e.cls !== 'forced') continue;
    if (e.type === 'supernova' || (e.type === 'bolide' && e.magnitude < 4)) continue; // never major: skip the (costly) measurement
    const f = extractFeatures(world, e.ageMa[0], e.ageMa[1]);
    const used = FEATURES.filter((k) => !Number.isNaN(f[k])).length;
    const uniform = posterior(model, f, undefined, temperature).post;
    const informed = posterior(model, f, WORLD_PRIOR, temperature).post;
    events.push({ eventId: e.id, type: e.type, trueClass: cls, uniform, informed, featuresUsed: used, major: isMajor(e, used, f), features: f });
  }
  // Probability that a civilization existed: any major anomaly may be its trace (noisy-OR over the world's prior mix of causes).
  const majors = events.filter((a) => a.major);
  const pCivilization = 1 - majors.reduce((p, a) => p * (1 - a.informed.civilization), 1);
  const minTruePosterior = majors.length ? Math.min(...majors.map((a) => a.uniform[a.trueClass])) : 1;
  // The puzzle is fair when the ideal observer gets the headline question right with margin: sees the civilization if there
  // is one (not eroded away, not drowned by look-alikes), and is not fooled by a mimic if there is none.
  const civPresent = world.agents.length > 0;
  const solvable = civPresent ? pCivilization >= worldPosteriorMin : pCivilization <= 1 - worldPosteriorMin;
  return { events, pCivilization, minTruePosterior, solvable };
}
