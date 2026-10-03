/**
 * World configuration. A world is fully determined by (config, modelVersion): saving a world means saving
 * this small object, and the generator reproduces everything else from the seed.
 */

/** Bump when a change to the model would alter generated worlds. Saved worlds warn on mismatch. */
export const MODEL_VERSION = '0.5.0-m5';

export interface DifficultyParams {
  /** 0 (poor) .. 1 (excellent): erosion rate, bioturbation depth, diagenesis. */
  preservation: number;
  /** Multiplier on the Poisson rates of natural catastrophes. */
  eventDensity: number;
  /** How often natural events imitating civilization signatures are injected (0..1). */
  mimicFrequency: number;
  /** Multiplier on instrument noise. */
  noiseScale: number;
  /** Probability that a generated world hosted a civilization. Never shown to the player. */
  civBaseRate: number;
  /** Minimum joint AUC the ideal observer must reach for a world to be accepted (M5). */
  solvabilityAUC: number;
  /** Fraction of worlds allowed to fail the solvability gate ("murky" worlds) (M5). */
  murkyFraction: number;
  /** The ideal observer must call "civilization present" with at least this probability (or absent with at most 1 − this) for a world to be accepted. */
  worldPosteriorMin: number;
  /** How many times the generator may redraw a world (same seed, different attempt) to pass the gate. */
  maxTries: number;
  /** Player budget, in cost units. */
  budget: number;
}

export interface GridConfig {
  nx: number;
  ny: number;
  cellKm: number;
}

export interface WorldConfig {
  seed: string;
  modelVersion: string;
  grid: GridConfig;
  /** Length of the simulated history, million years. */
  durationMyr: number;
  /** Background time step, years. */
  baseDtYr: number;
  /** Hard cap on number of steps (memory guard). */
  maxSteps: number;
  difficulty: DifficultyParams;
}

export const DEFAULT_DIFFICULTY: DifficultyParams = {
  preservation: 0.6,
  eventDensity: 1,
  mimicFrequency: 0.5,
  noiseScale: 1,
  civBaseRate: 0.4,
  solvabilityAUC: 0.85,
  murkyFraction: 0,
  worldPosteriorMin: 0.6,
  maxTries: 4,
  budget: 100,
};

export type PresetName = 'dev' | 'standard' | 'large';

export const PRESETS: Record<PresetName, Omit<WorldConfig, 'seed' | 'modelVersion' | 'difficulty'>> = {
  dev: { grid: { nx: 32, ny: 32, cellKm: 8 }, durationMyr: 100, baseDtYr: 250_000, maxSteps: 1500 },
  standard: { grid: { nx: 64, ny: 64, cellKm: 5 }, durationMyr: 250, baseDtYr: 100_000, maxSteps: 6000 },
  large: { grid: { nx: 96, ny: 96, cellKm: 4 }, durationMyr: 300, baseDtYr: 100_000, maxSteps: 7000 },
};

export function makeConfig(
  seed: string,
  preset: PresetName = 'standard',
  difficulty: Partial<DifficultyParams> = {},
): WorldConfig {
  return {
    seed,
    modelVersion: MODEL_VERSION,
    ...PRESETS[preset],
    difficulty: { ...DEFAULT_DIFFICULTY, ...difficulty },
  };
}
