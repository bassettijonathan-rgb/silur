/** The instruments a field geologist can buy time on. Pure metadata — shared by the observation service and the UI. */

export const PROXY_IDS = [
  'd13C_carb', 'd13C_org', 'd18O_carb', 'd15N', 'toc', 'caco3', 'sulfur', 'hg', 'ir', 'charcoal', 'fe60', 'spherules', 'shockedQz', 'persistOrg',
] as const;
export type ProxyId = (typeof PROXY_IDS)[number];

export interface ProxyInfo {
  id: ProxyId;
  label: string;
  unit: string;
  /** Cost per sample, budget units. */
  cost: number;
  /** One-line description for the UI. */
  about: string;
  /** Plot hint: log axis for concentrations spanning orders of magnitude. */
  log: boolean;
}

export const PROXIES: Record<ProxyId, ProxyInfo> = {
  d13C_carb: { id: 'd13C_carb', label: 'δ¹³C carbonate', unit: '‰ VPDB', cost: 1, about: 'Carbon-cycle changes; negative excursions mean light carbon released.', log: false },
  d13C_org: { id: 'd13C_org', label: 'δ¹³C organic', unit: '‰ VPDB', cost: 2, about: 'Carbon isotopes of organic matter.', log: false },
  d18O_carb: { id: 'd18O_carb', label: 'δ¹⁸O carbonate', unit: '‰ VPDB', cost: 1, about: 'Temperature and ice volume (confounded); altered by burial diagenesis.', log: false },
  d15N: { id: 'd15N', label: 'δ¹⁵N', unit: '‰ air', cost: 2, about: 'Nitrogen cycling: ocean redox and nutrient sources.', log: false },
  toc: { id: 'toc', label: 'Total organic carbon', unit: 'wt %', cost: 1, about: 'Organic richness; needed to normalise mercury.', log: true },
  caco3: { id: 'caco3', label: 'Carbonate', unit: 'wt %', cost: 1, about: 'Calcium carbonate content.', log: false },
  sulfur: { id: 'sulfur', label: 'Pyrite sulfur', unit: 'wt %', cost: 1, about: 'Sulfide burial: euxinic (sulfidic) bottom waters.', log: true },
  hg: { id: 'hg', label: 'Mercury', unit: 'ppb', cost: 2, about: 'Volcanism proxy (and combustion). Compare with TOC.', log: true },
  ir: { id: 'ir', label: 'Iridium', unit: 'ppb', cost: 4, about: 'Extraterrestrial matter: impacts. Concentration depends on sedimentation rate.', log: true },
  charcoal: { id: 'charcoal', label: 'Charcoal', unit: 'mg/kg', cost: 2, about: 'Wildfire.', log: true },
  fe60: { id: 'fe60', label: '⁶⁰Fe', unit: 'atoms/g', cost: 6, about: 'Supernova fallout; half-life 2.6 Myr so only young rocks keep it.', log: true },
  spherules: { id: 'spherules', label: 'Spherules', unit: 'per 10 g', cost: 3, about: 'Impact melt droplets.', log: false },
  shockedQz: { id: 'shockedQz', label: 'Shocked quartz', unit: 'grains per 10 g', cost: 3, about: 'Impact shock metamorphism.', log: false },
  persistOrg: { id: 'persistOrg', label: 'Persistent organics', unit: 'index', cost: 4, about: 'Pyrogenic and unusually durable organic compounds. Natural sources exist.', log: true },
};
