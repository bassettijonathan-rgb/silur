/** Rock types a geologist can name from a core, with log colours. */

export const LITHOLOGIES = [
  'limestone', 'marl', 'mudstone', 'muddy sandstone', 'sandstone', 'diamictite', 'evaporite', 'coal', 'black shale', 'tuff (volcanic ash)', 'crystalline basement',
] as const;
export type LithologyName = (typeof LITHOLOGIES)[number];
export const LITH: { readonly [K in LithologyName]: number } = Object.fromEntries(LITHOLOGIES.map((n, i) => [n, i])) as { [K in LithologyName]: number };

/** CSS colours, indexed like LITHOLOGIES. */
export const LITH_COLORS = ['#7fb8d9', '#9fc3c9', '#8a7f72', '#c9a96a', '#e3cb7c', '#a0a0a8', '#e8a0d8', '#2b2b2b', '#4a4452', '#c9c9b0', '#c25b5b'];
