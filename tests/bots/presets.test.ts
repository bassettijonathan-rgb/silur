import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, PRESET_DIFFICULTY, makeConfig } from '../../src/shared/config';

describe('difficulty presets', () => {
  it('are ordered easy → hard on every knob that makes the puzzle harder', () => {
    const e = { ...DEFAULT_DIFFICULTY, ...PRESET_DIFFICULTY.easy }, n = { ...DEFAULT_DIFFICULTY, ...PRESET_DIFFICULTY.normal }, h = { ...DEFAULT_DIFFICULTY, ...PRESET_DIFFICULTY.hard };
    expect(e.preservation).toBeGreaterThan(n.preservation); expect(n.preservation).toBeGreaterThan(h.preservation);
    expect(e.noiseScale).toBeLessThan(n.noiseScale); expect(n.noiseScale).toBeLessThan(h.noiseScale);
    expect(e.mimicFrequency).toBeLessThan(n.mimicFrequency); expect(n.mimicFrequency).toBeLessThan(h.mimicFrequency);
    expect(e.budget).toBeGreaterThan(n.budget); expect(n.budget).toBeGreaterThan(h.budget);
  });
  it('normal is exactly the defaults', () => {
    expect(makeConfig('x', 'dev', PRESET_DIFFICULTY.normal).difficulty).toEqual(DEFAULT_DIFFICULTY);
  });
});
