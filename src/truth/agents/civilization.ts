/**
 * An industrial civilization that lasted a geological blink (Schmidt & Frank 2018, "The Silurian hypothesis").
 *
 * Everything it does is a rate on an ordinary `Forcing` channel:
 *   fossil-carbon burning  → carbonEmission at δ13C ≈ −25 ‰, mercury, soot/fire, persistent organics (combustion, polymers)
 *   fertiliser & sewage    → nutrientRunoff with a δ15N that can shift either way (synthetic ≈ 0 ‰, manure ≈ +10 ‰)
 *   agriculture            → landCoverLoss, sedimentFluxMultiplier, habitatConversion (decaying over millennia after collapse)
 *   hunting & trade        → harvestPressure (large, narrow-ranged and island species suffer most — decided by the biosphere's
 *                            own vulnerability rules, not here)
 * Natural mimics for each channel exist (clathrate/LIP carbon, LIP mercury, impact fire, aridification, OAE nitrogen).
 */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { Agent } from './types';

export interface CivilizationParams {
  ageMa: number;
  durationYr: number;
  /** Total fossil carbon burned, Pg C, and its δ13C. */
  carbonPg: number;
  d13C: number;
  hgPeak: number; //          mercury flux multiple at peak
  firePeak: number; //        wildfire / soot multiples at peak
  persistPeak: number; //     persistent-organics flux multiple at peak
  nutrientPeak: number; //    extra riverine P at peak (fraction)
  nutrientD15N: number; //    δ15N of the runoff nitrate
  sedMultPeak: number; //     erosion multiplier at peak land use
  coverLossPeak: number;
  habitatPeak: number;
  harvestPeak: number;
  /** Land-use effects decay with this e-folding time after the collapse, years. */
  tailYr: number;
}

export function drawCivilization(ageMa: number, r: Rng): CivilizationParams {
  return {
    ageMa,
    durationYr: Math.min(8000, Math.max(300, r.logNormal(1500, 0.7))),
    carbonPg: r.logUniform(1e3, 8e3),
    d13C: r.range(-28, -22),
    hgPeak: r.range(2, 8),
    firePeak: r.range(3, 12),
    persistPeak: r.range(5, 40),
    nutrientPeak: r.range(0.3, 1.2),
    nutrientD15N: r.range(-2, 12),
    sedMultPeak: r.range(1.5, 4),
    coverLossPeak: r.range(0.2, 0.6),
    habitatPeak: r.range(0.3, 0.8),
    harvestPeak: r.range(0.2, 0.7),
    tailYr: r.range(800, 3000),
  };
}

/** Industrial intensity over the active period: logistic rise, plateau, then an abrupt collapse. u = fraction of the duration. */
const industry = (u: number): number => (u < 0 ? 0 : (1 / (1 + Math.exp(-(u - 0.3) / 0.1))) * (u < 0.65 ? 1 : Math.exp(-(u - 0.65) / 0.07)));
// ∫ industry du over [0, ∞) — fixed number so total carbon is preserved
const INDUSTRY_INTEGRAL = (() => { let s = 0; for (let k = 0; k < 4000; k++) s += industry((k + 0.5) / 1000) / 1000; return s; })();

export class Civilization implements Agent {
  readonly kind = 'civilization' as const;
  constructor(readonly p: CivilizationParams) {}
  get ageMa(): number { return this.p.ageMa; }

  windows(): TimeWindow[] {
    const { ageMa, durationYr } = this.p;
    const dt = Math.min(250, Math.max(50, durationYr / 14));
    const end = ageMa - durationYr / 1e6;
    return [
      { ageStartMa: ageMa, ageEndMa: end, dtYr: dt, tag: 71 },
      { ageStartMa: end, ageEndMa: end - 12_000 / 1e6, dtYr: 1_000, tag: 72 },
      { ageStartMa: end - 12_000 / 1e6, ageEndMa: end - 0.1, dtYr: 20_000, tag: 73 },
    ];
  }

  /** Land-use footprint: follows industry but lags and persists after the collapse. */
  private landUse(tYr: number): number {
    const { durationYr, tailYr } = this.p;
    if (tYr < 0) return 0;
    const u = tYr / durationYr;
    const ramp = 1 / (1 + Math.exp(-(u - 0.2) / 0.12));
    if (u <= 0.65) return ramp;
    return ramp * Math.exp(-(tYr - 0.65 * durationYr) / tailYr);
  }

  /** ADD the instantaneous forcing t years after the onset into `out`. */
  private at(tYr: number, out: Forcing): void {
    const p = this.p;
    const s = industry(tYr / p.durationYr);
    const land = this.landUse(tYr);
    const carbonRate = (p.carbonPg / (p.durationYr * INDUSTRY_INTEGRAL)) * s;
    out.carbonEmission += carbonRate;
    out.d13CofEmission = p.d13C;
    out.mercuryEmission += p.hgPeak * s;
    out.fireIgnition += p.firePeak * s;
    out.soot += 0.5 * p.firePeak * s;
    out.persistentOrgFlux += p.persistPeak * s;
    out.nutrientRunoff += p.nutrientPeak * land;
    out.nutrientRunoffD15N = p.nutrientD15N;
    out.sedimentFluxMultiplier += (p.sedMultPeak - 1) * land;
    out.landCoverLoss += p.coverLossPeak * land;
    out.habitatConversion += p.habitatPeak * land;
    out.harvestPressure += p.harvestPeak * Math.min(1, 1.5 * s);
  }

  forcing(a0: number, a1: number): Forcing {
    const p = this.p;
    const t0 = (p.ageMa - a0) * 1e6; //  years since onset at the step's older edge
    const t1 = (p.ageMa - a1) * 1e6;
    const lo = Math.max(t0, 0), hi = Math.min(t1, p.durationYr + 8 * p.tailYr);
    if (hi <= lo) return zeroForcing();
    // Midpoint-rule integral of the instantaneous forcing over the part of the step in which anything happens,
    // divided by the whole step length: a long step containing a short civilization sees a small, dose-correct average.
    const K = Math.min(4000, Math.max(24, Math.ceil((hi - lo) / 15))); // ~15-yr resolution so abrupt collapses are integrated accurately
    const sum = zeroForcing();
    sum.sedimentFluxMultiplier = 0;
    const tmp = zeroForcing();
    let d13 = 0, carbon = 0;
    for (let k = 0; k < K; k++) {
      Object.assign(tmp, zeroForcing());
      tmp.sedimentFluxMultiplier = 1;
      this.at(lo + ((k + 0.5) / K) * (hi - lo), tmp);
      sum.carbonEmission += tmp.carbonEmission; sum.mercuryEmission += tmp.mercuryEmission; sum.fireIgnition += tmp.fireIgnition;
      sum.soot += tmp.soot; sum.persistentOrgFlux += tmp.persistentOrgFlux; sum.nutrientRunoff += tmp.nutrientRunoff;
      sum.sedimentFluxMultiplier += tmp.sedimentFluxMultiplier - 1; sum.landCoverLoss += tmp.landCoverLoss;
      sum.habitatConversion += tmp.habitatConversion; sum.harvestPressure += tmp.harvestPressure;
      d13 += tmp.carbonEmission * p.d13C; carbon += tmp.carbonEmission;
    }
    const w = (hi - lo) / K / (t1 - t0); // weight of each sample in the step average
    const f = zeroForcing();
    f.carbonEmission = sum.carbonEmission * w; f.mercuryEmission = sum.mercuryEmission * w; f.fireIgnition = sum.fireIgnition * w;
    f.soot = sum.soot * w; f.persistentOrgFlux = sum.persistentOrgFlux * w; f.nutrientRunoff = sum.nutrientRunoff * w;
    f.sedimentFluxMultiplier = 1 + sum.sedimentFluxMultiplier * w;
    f.landCoverLoss = Math.min(1, sum.landCoverLoss * w); f.habitatConversion = Math.min(1, sum.habitatConversion * w);
    f.harvestPressure = Math.min(1, sum.harvestPressure * w);
    f.d13CofEmission = carbon > 0 ? d13 / carbon : p.d13C;
    f.nutrientRunoffD15N = p.nutrientD15N;
    return f;
  }

  truth() {
    const p = this.p;
    return {
      type: 'civilization' as const, cls: 'forced' as const,
      ageMa: [p.ageMa, p.ageMa - p.durationYr / 1e6] as [number, number],
      magnitude: p.carbonPg, cause: 'civilization' as const,
      params: { durationYr: p.durationYr, carbonPg: p.carbonPg, d13C: p.d13C, hgPeak: p.hgPeak, sedMultPeak: p.sedMultPeak, harvestPeak: p.harvestPeak, nutrientD15N: p.nutrientD15N },
    };
  }
}
