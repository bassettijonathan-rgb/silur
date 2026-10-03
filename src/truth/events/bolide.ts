/**
 * Bolide impact. Global effects switch on above a few km: months-to-years of darkness (dose given as a
 * step-average), sulfate aerosol, acid pulse, UV from NOx. Deposits (ejecta clay with Ir, spherules, shocked
 * quartz, charcoal, tsunamites) come from the EventSource.
 *
 * Calibration to the real K–Pg record: a 10-km impactor gives a global Ir fluence ≈ 70·D³ ng m⁻² ≈ 7·10⁴, which in
 * a ~3-mm distal clay is ≈ 8 ppb. Proximal ejecta thickens as r⁻³.
 */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { BolideEvent, avgOverStep } from './types';

/** Impactor diameter, km: power law N(>D) ∝ D^-2 from 1 km up. */
export function drawDiameter(r: Rng, minKm: number, maxKm: number): number {
  const u = r.next();
  const a = minKm ** -2, b = maxKm ** -2;
  return (a - u * (a - b)) ** -0.5;
}

export function makeBolide(ageMa: number, diameterKm: number, r: Rng, mapHalfKm: number): BolideEvent {
  // Crater somewhere within a few thousand km; distance sets the proximal enhancement.
  const dist = r.logUniform(Math.max(30, mapHalfKm * 0.2), 9000);
  const bearing = r.range(0, 2 * Math.PI);
  return { kind: 'bolide', ageMa, diameterKm, xKm: dist * Math.cos(bearing), yKm: dist * Math.sin(bearing) };
}

/** Global-effect strength 0..1 (cubic in diameter, saturating at ~10 km). */
export const globalStrength = (dKm: number): number => Math.min(1, (dKm / 10) ** 3);

export function bolideWindows(e: BolideEvent): TimeWindow[] {
  if (e.diameterKm < 2) return [];
  return [
    { ageStartMa: e.ageMa, ageEndMa: e.ageMa - 0.001, dtYr: 1_000, tag: 31 },
    { ageStartMa: e.ageMa - 0.001, ageEndMa: e.ageMa - 0.03, dtYr: 5_000, tag: 32 },
  ];
}

export function bolideForcing(e: BolideEvent, a0: number, a1: number): Forcing {
  const f = zeroForcing();
  const g = globalStrength(e.diameterKm);
  if (g < 0.01) return f;
  const dark = 0.95 * g;
  const durYr = 2 * Math.sqrt(Math.max(e.diameterKm, 1) / 10);
  f.lightReduction = avgOverStep(dark, e.ageMa, durYr, a0, a1);
  f.aerosolOpticalDepth = avgOverStep(0.5 * g, e.ageMa, 3, a0, a1);
  f.ozoneLoss = avgOverStep(0.2 * g, e.ageMa, 5, a0, a1);
  f.acidPulse = avgOverStep(0.5 * g, e.ageMa, 1, a0, a1);
  f.fireIgnition = avgOverStep(3 * g, e.ageMa, 1, a0, a1);
  return f;
}

/** Ejecta amounts at a cell r km from the crater (distal values scale with D; proximal thickens as r⁻³). */
export function ejectaAt(e: BolideEvent, rKm: number): { clayM: number; irNg: number; spherules: number; quartz: number; charcoalG: number; persist: number } {
  const D = e.diameterKm;
  const prox = 1 + (300 / Math.max(rKm, 20)) ** 3;
  const s = (D / 10) ** 2;
  return {
    clayM: 0.003 * s * prox,
    irNg: 70 * D ** 3 * prox,
    spherules: 10 * D * D * prox,
    quartz: D >= 3 ? 5 * D * D * prox : 0,
    charcoalG: 30 * s * Math.min(prox, 5),
    persist: 20 * s,
  };
}
