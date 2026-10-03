import { describe, expect, it } from 'vitest';
import { ColumnStore, DepositInput, ErodeInfo, FLAG } from '../../src/truth/strat/column';
import { NT, T, massOf, solidOf } from '../../src/truth/strat/tracers';
import { compactedThickness, layerThickness } from '../../src/truth/strat/compaction';
import { F } from '../../src/truth/strat/facies';

/** Deposit `thick` m of clastic mud with an optional Ir flux, at age `age`. */
function dep(thick: number, age: number, lmix: number, ir = 0, facies: number = F.deepMarine, flags = 0): DepositInput {
  const tr = new Float64Array(NT);
  tr[T.clastic] = thick;
  tr[T.Ir] = ir;
  return { tr, facies, flags, env: new Uint8Array(4), lmix, ageMa: age };
}

function sum(col: ColumnStore): Float64Array {
  const s = new Float64Array(NT);
  col.sumTracers(s);
  return s;
}

/** Concentration profile of Ir (ng per g sediment) layer by layer, bottom→top, with cumulative thickness. */
function irProfile(col: ColumnStore): { z: number; c: number; s: number }[] {
  const out = [];
  let z = 0;
  for (let i = 0; i < col.n; i++) {
    const o = i * NT;
    const arr = col.tr.subarray(o, o + NT);
    out.push({ z: z + col.solid[i] / 2, c: arr[T.Ir] / (massOf(arr) * 1000), s: col.solid[i] });
    z += col.solid[i];
  }
  return out;
}

describe('bioturbation (mixed layer)', () => {
  // 5 cm of mud per kyr; a 1-kyr pulse of iridium at step 100 of 200.
  const run = (lmix: number) => {
    const col = new ColumnStore();
    col.mergeBedM = 0; // keep full resolution so we can see the smear
    for (let step = 0; step < 200; step++) col.deposit(step, dep(0.05, 100 - step * 0.001, lmix, step === 100 ? 1e6 : 0));
    col.finalize();
    return col;
  };

  it('without mixing the pulse stays in one thin bed; with L = 10 cm it is smeared and weakened', () => {
    const sharp = irProfile(run(0)).filter((p) => p.c > 0);
    const smear = irProfile(run(0.1)).filter((p) => p.c > 1e-9);
    expect(sharp.length).toBe(1);
    expect(smear.length).toBeGreaterThanOrEqual(2);

    const peakSharp = Math.max(...sharp.map((p) => p.c));
    const peakSmear = Math.max(...smear.map((p) => p.c));
    expect(peakSharp / peakSmear).toBeGreaterThan(2.5);

    // The pulse is spread over a stratigraphic thickness of several L, not one 5 cm bed.
    const thickness = smear.reduce((a, p) => a + p.s, 0);
    expect(thickness).toBeGreaterThan(0.2);
  });

  it('conserves the signal: total iridium in the rock equals total delivered', () => {
    for (const L of [0, 0.03, 0.1, 0.5]) {
      const col = run(L);
      expect(sum(col)[T.Ir] / 1e6).toBeCloseTo(1, 5); // layers are stored as float32
      expect(sum(col)[T.clastic] / 10).toBeCloseTo(1, 5);
    }
  });

  it('the tail of the smeared signal decays like exp(−z/L) (Berger–Heath)', () => {
    const L = 0.1;
    const prof = irProfile(run(L));
    // find peak, then compare concentration 2 L above it with 1 L above it: ratio ≈ e^-1
    const iPeak = prof.reduce((m, p, i) => (p.c > prof[m].c ? i : m), 0);
    const zPeak = prof[iPeak].z;
    const at = (z: number) => prof.reduce((best, p) => (Math.abs(p.z - z) < Math.abs(best.z - z) ? p : best), prof[0]).c;
    const r = at(zPeak + 2 * L) / at(zPeak + L);
    expect(r).toBeGreaterThan(0.25);
    expect(r).toBeLessThan(0.55); // e^-1 = 0.37
  });

  it('layer ages are monotonic (younger upward) and spread grows with mixing', () => {
    const a = run(0), b = run(0.2);
    for (const col of [a, b]) for (let i = 1; i < col.n; i++) expect(col.ageMean[i]).toBeLessThanOrEqual(col.ageMean[i - 1] + 1e-6);
    const mean = (c: ColumnStore) => c.ageSigma.subarray(0, c.n).reduce((x, y) => x + y, 0) / c.n;
    expect(mean(b)).toBeGreaterThan(mean(a));
  });
});

describe('dilution and condensation', () => {
  it('concentration of an atmospheric/extraterrestrial tracer scales inversely with sedimentation rate', () => {
    // same Ir flux per kyr; one column accumulates 4 cm/kyr, the other 1 cm/kyr
    const make = (rate: number) => {
      const col = new ColumnStore();
      for (let s = 0; s < 100; s++) col.deposit(s, dep(rate, 10 - s * 0.001, 0, 1000));
      col.finalize();
      return irProfile(col)[0].c;
    };
    const fast = make(0.04), slow = make(0.01);
    expect(slow / fast).toBeGreaterThan(3.6);
    expect(slow / fast).toBeLessThan(4.4);
  });
});

describe('erosion and hiatus', () => {
  it('removes from the top, returns the tracers, and keeps totals consistent', () => {
    const col = new ColumnStore();
    for (let s = 0; s < 50; s++) col.deposit(s, dep(1, 50 - s, 0.2, 10));
    col.finalize();
    const before = sum(col);
    const removed = new Float64Array(NT);
    const info: ErodeInfo = { removedSolid: 0, ageOldMa: 0, ageYoungMa: 0 };
    col.erode(12.5, removed, info);
    expect(info.removedSolid).toBeCloseTo(12.5, 9);
    expect(removed[T.clastic]).toBeCloseTo(12.5, 6);
    expect(info.ageYoungMa).toBeLessThan(info.ageOldMa);
    expect(info.ageYoungMa).toBeLessThan(2);
    const after = sum(col);
    for (let k = 0; k < NT; k++) expect(after[k] + removed[k]).toBeCloseTo(before[k], 3);
    expect(col.totalSolid).toBeCloseTo(50 - 12.5, 6);
  });

  it('cannot erode more than exists', () => {
    const col = new ColumnStore();
    col.deposit(0, dep(2, 5, 0));
    col.finalize();
    const removed = new Float64Array(NT);
    const info: ErodeInfo = { removedSolid: 0, ageOldMa: 0, ageYoungMa: 0 };
    col.erode(10, removed, info);
    expect(info.removedSolid).toBeCloseTo(2, 9);
    expect(col.n).toBe(0);
  });

  it('a gap in deposition freezes the old mixed layer and flags a hiatus', () => {
    const col = new ColumnStore();
    for (let s = 0; s < 10; s++) col.deposit(s, dep(0.05, 10 - s, 0.1));
    for (let s = 30; s < 40; s++) col.deposit(s, dep(0.05, 10 - s, 0.1)); // 20-step gap
    col.finalize();
    let hiatus = 0;
    for (let i = 0; i < col.n; i++) if (col.flags[i] & FLAG.HIATUS) { hiatus++; expect(col.gap[i]).toBe(20); }
    expect(hiatus).toBe(1);
    expect(sum(col)[T.clastic]).toBeCloseTo(1.0, 6);
  });
});

describe('layer merging', () => {
  it('merges thin background beds without changing totals or mean ages', () => {
    const merged = new ColumnStore();
    const unmerged = new ColumnStore();
    unmerged.mergeBedM = 0;
    for (let s = 0; s < 400; s++) { merged.deposit(s, dep(0.01, 40 - s * 0.1, 0.05, 3)); unmerged.deposit(s, dep(0.01, 40 - s * 0.1, 0.05, 3)); }
    merged.finalize(); unmerged.finalize();
    expect(merged.n).toBeLessThan(unmerged.n / 5);
    const a = sum(merged), b = sum(unmerged);
    for (let k = 0; k < NT; k++) expect(a[k]).toBeCloseTo(b[k], 3);
    const meanAge = (c: ColumnStore) => { let w = 0, m = 0; for (let i = 0; i < c.n; i++) { w += c.solid[i]; m += c.solid[i] * c.ageMean[i]; } return m / w; };
    expect(meanAge(merged)).toBeCloseTo(meanAge(unmerged), 3);
  });
  it('never merges event-flagged or fine-step layers', () => {
    const col = new ColumnStore();
    col.deposit(0, dep(0.01, 5, 0));
    col.deposit(1, dep(0.01, 5, 0, 0, F.deepMarine, FLAG.EVENT));
    col.deposit(2, dep(0.01, 5, 0));
    col.finalize();
    expect(col.n).toBe(3);
  });
});

describe('compaction', () => {
  it('compacted thickness exceeds solid thickness and tends to S/(1−φ0) at shallow depth', () => {
    const phi0 = 0.63, lam = 1960;
    expect(compactedThickness(1, phi0, lam)).toBeCloseTo(1 / (1 - phi0) * 1, 0);
    expect(compactedThickness(1000, phi0, lam)).toBeGreaterThan(1000);
    expect(compactedThickness(1000, phi0, lam)).toBeLessThan(1000 / (1 - phi0));
  });
  it('a stack of thin layers compacts to the same total as the whole column', () => {
    const phi0 = 0.5, lam = 1500, S = 3000, n = 300;
    let z = 0;
    for (let i = 0; i < n; i++) z += layerThickness(S / n, z, phi0, lam);
    // layers are filled top-down here; compare against the closed form
    expect(z / compactedThickness(S, phi0, lam)).toBeGreaterThan(0.995);
    expect(z / compactedThickness(S, phi0, lam)).toBeLessThan(1.005);
  });
  it('solidOf/massOf are consistent', () => {
    const tr = new Float64Array(NT);
    tr[T.clastic] = 2; tr[T.caco3] = 1; tr[T.orgC] = 6;
    expect(solidOf(tr)).toBeCloseTo(3.01, 9);
    expect(massOf(tr)).toBeCloseTo(2 * 2700 + 2710 + 12, 6);
  });
});
