/**
 * Trait vocabularies and the stressor registry of the biosphere.
 * To add a stressor: add its id here, a lethal time in params.ts, an intensity series in stressors.ts,
 * and a vulnerability rule in stressors.ts → vulnerabilities().
 */

export const REALM = { marine: 0, terrestrial: 1, freshwater: 2 } as const;
export const TROPHIC = { autotroph: 0, grazer: 1, predator: 2, detritivore: 3 } as const;
export const HARD = { soft: 0, chitin: 1, carbonate: 2, phosphate: 3, silica: 4 } as const;
export const MINERAL = { none: 0, lmc: 1, hmc: 2, aragonite: 3 } as const;

/** Environmental stressors that act on all species through per-species vulnerabilities (thermal stress is per species). */
export const STRESSORS = ['acid', 'anoxia', 'light', 'uv', 'fire', 'shelf', 'harvest', 'habitat'] as const;
export type StressorId = (typeof STRESSORS)[number];
export const NS = STRESSORS.length;
export const S: { readonly [K in StressorId]: number } = Object.fromEntries(
  STRESSORS.map((n, i) => [n, i]),
) as { [K in StressorId]: number };

/** The traits that decide who dies and who is fossilised. */
export interface Traits {
  realm: number;
  trophic: number;
  hard: number;
  mineral: number;
  endo: number; //      1 = endothermic (high energy needs)
  burrower: number; //  1 = burrows / shelters underground
  insular: number; //   1 = island endemic
  pelagic: number; //   1 = floats/swims (marine) — planktonic larvae or adults
  logMass: number; //   ln(body mass / kg)
  breadth: number; //   habitat breadth 0 (specialist) .. 1 (generalist)
  range: number; //     geographic range 0 (tiny) .. 1 (global)
  depthPref: number; // preferred water depth, m (marine)
  latPref: number; //   preferred absolute latitude, degrees
  tOff: number; //      thermal-niche offset from the (slowly adapting) global mean temperature, K
}

export const GUILDS = 12; // realm × trophic
export const guildOf = (realm: number, trophic: number): number => realm * 4 + trophic;
