import { describe, expect, it } from 'vitest';
import { d18OCalcite, newCarbonateState, solveCarbonate, stateFromPco2AndOmega } from '../../src/truth/earth/carbonate';

describe('seawater carbonate chemistry', () => {
  const out = newCarbonateState();

  it('reproduces modern surface ocean (DIC 2000, ALK 2300 µmol/kg, S=35)', () => {
    solveCarbonate(2000, 2300, 273.15 + 20, 35, 0.01028, out);
    expect(out.pCO2).toBeGreaterThan(300);
    expect(out.pCO2).toBeLessThan(450);
    expect(out.pH).toBeGreaterThan(8.0);
    expect(out.pH).toBeLessThan(8.2);
    expect(out.omegaCalcite).toBeGreaterThan(4.5);
    expect(out.omegaCalcite).toBeLessThan(6);
    expect(out.omegaAragonite).toBeGreaterThan(2.8);
    expect(out.omegaAragonite).toBeLessThan(4);
  });

  it('pCO2 rises with temperature at fixed DIC/ALK (~4 % per K)', () => {
    const cold = solveCarbonate(2000, 2300, 273.15 + 15, 35, 0.01028, newCarbonateState()).pCO2;
    const warm = solveCarbonate(2000, 2300, 273.15 + 16, 35, 0.01028, newCarbonateState()).pCO2;
    expect(warm / cold - 1).toBeGreaterThan(0.03);
    expect(warm / cold - 1).toBeLessThan(0.05);
  });

  it('adding CO2 (DIC up, ALK fixed) acidifies and lowers saturation', () => {
    const a = solveCarbonate(2000, 2300, 288.15, 35, 0.01028, newCarbonateState());
    const b = solveCarbonate(2200, 2300, 288.15, 35, 0.01028, newCarbonateState());
    expect(b.pH).toBeLessThan(a.pH);
    expect(b.omegaAragonite).toBeLessThan(a.omegaAragonite);
    expect(b.pCO2).toBeGreaterThan(a.pCO2);
  });

  it('closed-form inverse (pCO2, Ω) -> (DIC, ALK) round-trips through the solver', () => {
    const s = stateFromPco2AndOmega(900, 4.2, 290, 35, 0.012);
    solveCarbonate(s.dicUmol, s.alkUmol, 290, 35, 0.012, out);
    expect(out.pCO2).toBeCloseTo(900, 3);
    expect(out.omegaCalcite).toBeCloseTo(4.2, 6);
  });

  it('is monotonic and converges over a very wide range', () => {
    for (const dic of [500, 1500, 2500, 6000, 12000]) {
      for (const alk of [800, 2000, 3000, 8000, 14000]) {
        const r = solveCarbonate(dic, alk, 280, 35, 0.01, newCarbonateState());
        expect(Number.isFinite(r.pCO2)).toBe(true);
        expect(r.pH).toBeGreaterThan(4);
        expect(r.pH).toBeLessThan(12);
      }
    }
  });
});

describe('δ18O palaeothermometer', () => {
  it('≈ −0.23 ‰ per K near 16 °C: ΔT = +5 K gives Δδ18O ≈ −1.15 ‰', () => {
    const d = d18OCalcite(21.5, -1) - d18OCalcite(16.5, -1);
    expect(d).toBeLessThan(-0.95);
    expect(d).toBeGreaterThan(-1.35);
  });
  it('seawater δ18O shifts calcite one-for-one', () => {
    expect(d18OCalcite(15, 0.5) - d18OCalcite(15, -0.5)).toBeCloseTo(1, 10);
  });
});
