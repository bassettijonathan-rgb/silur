/**
 * The solvability gate (design D11): draw a world, ask the ideal observer whether the puzzle is fair, and if not
 * redraw (same seed, next attempt) up to `maxTries` times. A configurable fraction of worlds may be left "murky" on
 * purpose — then the right answer is "I can't tell", and the reveal shows the ideal observer's own uncertainty.
 */
import { WorldConfig } from '../../shared/config';
import { Rng } from '../../shared/rng';
import { GenerateOptions, Progress, World, generateWorld } from '../../truth/world';
import { Assessment, assess } from './ideal';
import { Library, Model, fitModel } from './library';
import signatures from './signatures.json';

export interface Solvability {
  assessment: Assessment;
  /** Number of draws made (1 = first draw was fine). */
  attempts: number;
  /** Left unsolved on purpose or after running out of tries. */
  murky: boolean;
}

let cached: Model | null = null;
export function loadLibrary(): Library {
  return signatures as unknown as Library;
}
export function loadModel(): Model {
  return (cached ??= fitModel(loadLibrary()));
}

export function generateSolvableWorld(
  config: WorldConfig, onProgress: Progress = () => undefined, model: Model = loadModel(), options: GenerateOptions = {},
): { world: World; solvability: Solvability } {
  const d = config.difficulty;
  const murkyDraw = new Rng(`${config.seed}|murky`).next() < d.murkyFraction;
  let best: { world: World; assessment: Assessment } | null = null;
  for (let attempt = 0; attempt < Math.max(1, d.maxTries); attempt++) {
    const world = generateWorld(config, onProgress, { ...options, attempt });
    onProgress('solvability', 0);
    const assessment = assess(world, model, d.worldPosteriorMin);
    onProgress('solvability', 1);
    if (murkyDraw) return { world, solvability: { assessment, attempts: attempt + 1, murky: true } };
    if (assessment.solvable) return { world, solvability: { assessment, attempts: attempt + 1, murky: false } };
    if (!best || assessment.minTruePosterior > best.assessment.minTruePosterior) best = { world, assessment };
  }
  return { world: best!.world, solvability: { assessment: best!.assessment, attempts: Math.max(1, d.maxTries), murky: true } };
}
