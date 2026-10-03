/** The shelf carbonate factory (Bosscher & Schlager 1992 light curve with temperature, saturation and mud limits). */
import { StratParams } from './params';

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/** Temperature factor: tropical = 1, cold water = the cool-water (heterozoan) floor. */
export function carbonateTempFactor(P: StratParams, localTempC: number): number {
  return P.carbCoolFraction + (1 - P.carbCoolFraction) * logistic((localTempC - 18) / 3);
}

/**
 * Production rate, m/yr of solid carbonate.
 * @param depth        water depth, m
 * @param fTemp        from carbonateTempFactor
 * @param fOmega       saturation factor 0..1.3 (ocean chemistry)
 * @param clasticRate  terrigenous input at this cell, m/yr (mud smothers and clouds the water)
 */
export function shelfCarbonateRate(P: StratParams, depth: number, fTemp: number, fOmega: number, clasticRate: number): number {
  if (depth <= 0) return 0;
  const light = P.carbI0 * Math.exp(-P.carbK * depth);
  return P.carbGmax * Math.tanh(light / P.carbIk) * fTemp * fOmega * Math.exp(-clasticRate / P.carbClasticTol);
}
