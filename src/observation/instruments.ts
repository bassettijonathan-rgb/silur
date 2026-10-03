/**
 * Laboratory instruments: turn the composition of a drilled sample into a measured number.
 *
 * All proxies are RATIOS of extensive tracers (design D2), so dilution by sedimentation rate, condensed
 * sections and bioturbation smearing are already in the numbers. On top of that the instruments add what real
 * ones have: analytical noise, counting statistics, detection limits, diagenetic overprint (δ¹⁸O), and
 * contamination (persistent organics). Noise is a pure function of (seed, what was measured), so the same
 * measurement always gives the same answer, whatever else the player did before.
 */
import { ProxyId } from '../shared/proxies';
import { Rng, hashNormal, hashUnit } from '../shared/rng';
import { FE60_HALF_LIFE_MYR } from '../truth/events/supernova';
import { T, massOf } from '../truth/strat/tracers';

export interface SampleContext {
  seed: string;
  noiseScale: number;
  cell: number;
  /** Reported depth key (cm) so that the same sample is the same sample. */
  depthKey: number;
  /** Mean age of the sampled rock, Ma, and its present burial depth, m (used for physics, never reported). */
  ageMa: number;
  burialM: number;
}

export interface Reading {
  value: number | null;
  sigma: number;
  note?: 'below detection' | 'no carbonate' | 'no organic matter';
}

const SAMPLE_G = 10; // grams processed for counting measurements

export function measureProxy(proxy: ProxyId, acc: ArrayLike<number>, c: SampleContext): Reading {
  const mass = massOf(acc); // kg per m² of sampled rock
  if (mass <= 0) return { value: null, sigma: 0, note: 'below detection' };
  const z = (k: string) => hashNormal(c.seed, 'assay', proxy, c.cell, c.depthKey, k);
  const ns = c.noiseScale;
  const carb = acc[T.caco3];
  const org = acc[T.orgC];
  const carbFrac = (carb * 2710) / mass;
  const tocFrac = (org * 2) / mass;
  switch (proxy) {
    case 'd13C_carb': {
      if (carbFrac < 0.02) return { value: null, sigma: 0.1 * ns, note: 'no carbonate' };
      const s = 0.1 * ns;
      return { value: acc[T.d13C_carb] / carb + s * z('n'), sigma: s };
    }
    case 'd18O_carb': {
      if (carbFrac < 0.02) return { value: null, sigma: 0.15 * ns, note: 'no carbonate' };
      // burial diagenesis drives δ18O lighter; ~0.5 ‰ per km plus a slow drift with age, with a per-sample overprint
      const shift = -0.5 * (c.burialM / 1000) - 0.4 * (c.ageMa / 100) + 0.25 * hashNormal(c.seed, 'diagenesis', c.cell, Math.round(c.burialM / 5));
      const s = 0.15 * ns;
      return { value: acc[T.d18O_carb] / carb + shift + s * z('n'), sigma: s };
    }
    case 'd13C_org': {
      if (tocFrac < 0.0005) return { value: null, sigma: 0.2 * ns, note: 'no organic matter' };
      const s = 0.2 * ns;
      return { value: acc[T.d13C_org] / org + s * z('n'), sigma: s };
    }
    case 'd15N': {
      if (tocFrac < 0.001) return { value: null, sigma: 0.3 * ns, note: 'no organic matter' };
      const s = 0.3 * ns;
      return { value: acc[T.d15N] / org + s * z('n'), sigma: s };
    }
    case 'toc': return rel(tocFrac * 100, 0.03 * ns, z('n'), 0.005);
    case 'caco3': { const s = 1 * ns; return { value: Math.max(0, carbFrac * 100 + s * z('n')), sigma: s }; }
    case 'sulfur': return rel(((acc[T.pyriteS]) / mass) * 100, 0.03 * ns, z('n'), 0.005);
    case 'hg': return rel(acc[T.Hg] / mass, 0.05 * ns, z('n'), 1); //                       µg/kg = ppb
    case 'ir': return rel(acc[T.Ir] / (mass * 1000), 0.1 * ns, z('n'), 0.02); //             ng/g = ppb
    case 'charcoal': return rel((acc[T.charcoal] * 1000) / mass, 0.08 * ns, z('n'), 0.5); //   mg/kg
    case 'fe60': {
      const decayed = acc[T.Fe60] * Math.pow(0.5, c.ageMa / FE60_HALF_LIFE_MYR);
      const conc = decayed / (mass * 1000); // atoms per g
      const counts = new Rng(`${c.seed}|fe60|${c.cell}|${c.depthKey}`).poisson(conc * SAMPLE_G);
      const v = counts / SAMPLE_G;
      return v < 20 ? { value: null, sigma: Math.sqrt(Math.max(conc, 1) / SAMPLE_G), note: 'below detection' } : { value: v, sigma: Math.sqrt(v / SAMPLE_G) };
    }
    case 'spherules':
    case 'shockedQz': {
      const t = proxy === 'spherules' ? acc[T.spherules] : acc[T.shockedQz];
      const mean = ((t * 1000) / (mass * 1000)) * SAMPLE_G; // tracer is in 1000 m⁻²
      const counts = new Rng(`${c.seed}|count|${proxy}|${c.cell}|${c.depthKey}`).poisson(mean);
      return { value: counts, sigma: Math.sqrt(Math.max(mean, 1)) };
    }
    case 'persistOrg': {
      const idx = acc[T.persistOrg] / mass;
      // natural false positives: wildfire residue, diagenesis, laboratory contamination
      const contaminated = hashUnit(c.seed, 'contam', c.cell, c.depthKey) < 0.03;
      const v = idx * Math.exp(0.3 * ns * z('n')) * (contaminated ? 6 + 4 * hashUnit(c.seed, 'contam-size', c.cell, c.depthKey) : 1);
      return { value: v, sigma: 0.3 * v };
    }
  }
}

function rel(value: number, relSigma: number, zScore: number, detection: number): Reading {
  if (value < detection) return { value: null, sigma: detection, note: 'below detection' };
  const v = value * (1 + relSigma * zScore);
  return { value: Math.max(v, 0), sigma: value * relSigma };
}
