/**
 * Tectonic templates (design D12). Each world picks one; together with sea level and sediment supply it
 * decides where basins form, where mountains shed sediment, and — through a final exhumation phase — what
 * ends up exposed at the surface for the player.
 *
 * A template gives (a) the starting basement elevation field and (b) the vertical motion rate field
 * (m/yr, + = uplift) as a function of elapsed time. "Basement" here is the elevation the surface would
 * have with no sediment on it; sediment loading and unloading is added by the simulator (local isostasy).
 */

import { Rng } from '../../shared/rng';
import { fractalField } from './noise';

export type TemplateName = 'passive-margin' | 'foreland' | 'intracratonic';
export const TEMPLATES: TemplateName[] = ['passive-margin', 'foreland', 'intracratonic'];

export interface Tectonics {
  name: TemplateName;
  /** Initial basement elevation, m. */
  initial: Float32Array;
  /** Fill `rate` with vertical motion in m/yr at elapsed time tMyr (0 = start of history). */
  rate(tMyr: number, rate: Float32Array): void;
  /** Static smooth fields in [0,1] used by the climate / evaporite logic. */
  wetness: Float32Array;
  restriction: Float32Array;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const bump = (x: number, c: number, w: number) => Math.exp(-0.5 * ((x - c) / w) ** 2);

export function makeTectonics(
  name: TemplateName, nx: number, ny: number, durationMyr: number, rng: Rng,
  /** Length of the final exhumation (regional uplift) phase, Myr. 0 disables it. */
  exhumeMyr = Math.min(35, durationMyr * 0.2),
): Tectonics {
  const r = rng.fork('tectonics:' + name);
  const N = nx * ny;
  const theta = r.range(0, Math.PI * 2);
  const ct = Math.cos(theta), st = Math.sin(theta);

  // Normalised coordinates: u along "dip" (0 hinterland … 1 basin), v along strike. Both span [0,1].
  const u = new Float32Array(N), v = new Float32Array(N);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const cx = x - nx / 2, cy = y - ny / 2;
    const a = cx * ct + cy * st, b = -cx * st + cy * ct;
    u[y * nx + x] = a; v[y * nx + x] = b;
    umin = Math.min(umin, a); umax = Math.max(umax, a); vmin = Math.min(vmin, b); vmax = Math.max(vmax, b);
  }
  for (let i = 0; i < N; i++) { u[i] = (u[i] - umin) / (umax - umin); v[i] = (v[i] - vmin) / (vmax - vmin); }

  const rough = fractalField(nx, ny, Math.max(3, nx / 6), r.fork('rough'));
  const wetness = fractalField(nx, ny, Math.max(4, nx / 4), r.fork('wet'));
  const restriction = fractalField(nx, ny, Math.max(4, nx / 5), r.fork('restrict'));
  const initial = new Float32Array(N);
  const stripe = r.range(0, 6.28); // strike variation of shelf width
  const tilt = new Float32Array(N); // random regional tilt rate pattern, m/yr
  const tiltPhase = r.range(0, 6.28);
  for (let i = 0; i < N; i++) tilt[i] = 1.2e-5 * Math.sin(6.28 * v[i] + tiltPhase) * (0.5 + u[i]);

  const exhume0 = durationMyr - exhumeMyr; // exhumation starts here (Myr elapsed)
  const exhumeRamp = (t: number) => (exhumeMyr <= 0 ? 0 : Math.min(1, Math.max(0, (t - exhume0) / Math.max(1, durationMyr - exhume0))));

  if (name === 'passive-margin') {
    for (let i = 0; i < N; i++) {
      const shelfShift = 0.07 * Math.sin(6.28 * v[i] * 1.5 + stripe);
      const uu = u[i] + shelfShift;
      initial[i] = 250 + 700 * bump(u[i], 0.08, 0.1) - 280 * sig((uu - 0.35) / 0.03) - 2400 * sig((uu - 0.66) / 0.07) + (rough[i] - 0.5) * 120;
    }
    const tau = 60; // Myr, thermal subsidence
    return {
      name, initial, wetness, restriction,
      rate(t, rate) {
        const decay = Math.exp(-t / tau) / (tau * 1e6); // 1/yr
        const exh = exhumeRamp(t) > 0 ? 1 / Math.max(1, durationMyr - exhume0) / 1e6 : 0;
        for (let i = 0; i < N; i++) {
          const sub = 1500 * sig((u[i] - 0.3) / 0.15); // total thermal subsidence, m
          const hinterland = 2.5e-5 * bump(u[i], 0.08, 0.12) * Math.exp(-t / 120); // orogenic uplift, m/yr
          const dome = 1800 * (1 - 0.6 * u[i]) * exh; // inversion & exhumation
          rate[i] = -sub * decay + hinterland + dome + tilt[i];
        }
      },
    };
  }

  if (name === 'foreland') {
    for (let i = 0; i < N; i++) {
      initial[i] = 450 - 700 * u[i] + 1200 * bump(u[i], 0.06, 0.07) + (rough[i] - 0.5) * 150;
    }
    return {
      name, initial, wetness, restriction,
      rate(t, rate) {
        const f = t / durationMyr;
        const front = 0.12 + 0.22 * f; // the thrust front advances into the craton
        const belt = Math.max(0, 1 - f / 0.7); // orogeny wanes
        const exh = exhumeRamp(t) > 0 ? 1 / Math.max(1, durationMyr - exhume0) / 1e6 : 0;
        for (let i = 0; i < N; i++) {
          const up = 5e-5 * belt * bump(u[i], front - 0.08, 0.07);
          const flex = -3.5e-5 * (0.4 + 0.6 * belt) * bump(u[i], front + 0.18, 0.12);
          rate[i] = up + flex + 1500 * (1 - 0.5 * u[i]) * exh + tilt[i];
        }
      },
    };
  }

  // intracratonic basin
  for (let i = 0; i < N; i++) {
    const dx = u[i] - 0.5, dy = v[i] - 0.5;
    const rr = Math.sqrt(dx * dx + dy * dy);
    initial[i] = 150 - 300 * Math.exp(-((rr / 0.35) ** 2)) + (rough[i] - 0.5) * 100;
  }
  const phase = r.range(0, 6.28);
  return {
    name, initial, wetness, restriction,
    rate(t, rate) {
      const decay = Math.exp(-t / 90) / (90 * 1e6); // 1/yr, integrates to 1 over the decay
      const exh = exhumeRamp(t) > 0 ? 1 / Math.max(1, durationMyr - exhume0) / 1e6 : 0;
      const osc = 0.5 + 0.5 * Math.sin(t / 25 * 6.28 + phase); // episodic epeirogeny
      for (let i = 0; i < N; i++) {
        const dx = u[i] - 0.5, dy = v[i] - 0.5;
        const g = Math.exp(-(((dx * dx + dy * dy) ** 0.5 / 0.4) ** 2));
        rate[i] = -1400 * g * decay * (0.6 + 0.8 * osc) + 700 * g * exh + tilt[i];
      }
    },
  };
}
