/**
 * Depositional facies (design §4.4) and which facies may sit directly on top of which.
 *
 * Walther's law: facies that follow each other without a break in a vertical section must also have been
 * neighbours laterally. `FACIES_NEIGHBOURS` is that adjacency; the simulator flags any jump the time step
 * is too coarse to resolve as a DROWN/condensed surface instead of pretending it is continuous.
 */

export const FACIES = [
  'fluvial', //              channel belts, sand-rich alluvium
  'terrestrial', //          floodplain, paleosol, lake, coal swamp, aeolian
  'glacial', //              diamict / till
  'evaporite', //            sabkha, playa, restricted lagoon
  'deltaic', //              delta plain/front, shoreface
  'shelfSiliciclastic', //   shelf mud and sand
  'shelfCarbonate', //       platform and ramp limestone
  'deepMarine', //           slope, basin, pelagic ooze, turbidite
] as const;
export type FaciesName = (typeof FACIES)[number];
export const F: { readonly [K in FaciesName]: number } = Object.fromEntries(
  FACIES.map((n, i) => [n, i]),
) as { [K in FaciesName]: number };

/** Code stored in the environment history when a cell is exposed/eroding and records nothing. */
export const NO_DEPOSIT = 255;

const PAIRS: [FaciesName, FaciesName][] = [
  ['fluvial', 'terrestrial'],
  ['fluvial', 'deltaic'],
  ['fluvial', 'glacial'],
  ['terrestrial', 'deltaic'],
  ['terrestrial', 'evaporite'],
  ['terrestrial', 'glacial'],
  ['evaporite', 'deltaic'],
  ['evaporite', 'shelfCarbonate'],
  ['evaporite', 'shelfSiliciclastic'],
  ['deltaic', 'shelfSiliciclastic'],
  ['deltaic', 'shelfCarbonate'],
  ['glacial', 'deltaic'],
  ['glacial', 'shelfSiliciclastic'],
  ['shelfSiliciclastic', 'shelfCarbonate'],
  ['shelfSiliciclastic', 'deepMarine'],
  ['shelfCarbonate', 'deepMarine'],
];

const N = FACIES.length;
const ADJ = new Uint8Array(N * N);
for (let i = 0; i < N; i++) ADJ[i * N + i] = 1;
for (const [a, b] of PAIRS) {
  ADJ[F[a] * N + F[b]] = 1;
  ADJ[F[b] * N + F[a]] = 1;
}

/** True if facies `b` may directly overlie facies `a` without a hiatus. */
export function isAllowedTransition(a: number, b: number): boolean {
  return ADJ[a * N + b] === 1;
}

export const isMarine = (f: number): boolean => f >= F.deltaic || f === F.evaporite;
