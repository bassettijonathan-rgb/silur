/**
 * The only vocabulary the main thread and the worker share. The main thread sends ACTIONS and receives
 * MEASUREMENTS; nothing in here describes the hidden history (design D1).
 */
import type { WorldConfig } from './config';
import type { ProxyId, ProxyInfo } from './proxies';

export type Stage = 'planet' | 'earth' | 'biosphere' | 'strata' | 'catalog' | 'solvability';

export interface PublicInfo {
  nx: number;
  ny: number;
  cellKm: number;
  /** Present-day topography relative to sea level, m (map survey, ±few m). Negative = sea floor. */
  elevationM: Float32Array;
  /** Free remote-sensing guess of the surface rock type (index into LITHOLOGIES; ~15 % wrong). */
  surfaceClass: Uint8Array;
  /** How much rock is exposed, 0–100 (outcrop quality). */
  exposure: Uint8Array;
  budget: number;
  maxCoreM: number;
  drillCost: { base: number; perMeter: number; offshoreFactor: number };
  proxies: ProxyInfo[];
}

export type Action =
  | { kind: 'drill'; cell: number; depthM: number }
  | { kind: 'assay'; coreId: string; proxy: ProxyId; depthsM: number[] };

export interface Bed {
  topM: number;
  baseM: number;
  /** Index into LITHOLOGIES. */
  lith: number;
  /** Visual estimates, % (±noise). */
  carbonatePct: number;
  sandPct: number;
  organicPct: number;
  contact: 'gradational' | 'sharp';
  notes: string[];
}

export interface CoreResult {
  kind: 'core';
  coreId: string;
  cell: number;
  requestedM: number;
  lengthM: number;
  /** The hole bottomed out in crystalline basement. */
  reachedBasement: boolean;
  beds: Bed[];
  /** Lost core intervals (depth in core, m). */
  gaps: { topM: number; baseM: number }[];
  cost: number;
  budgetLeft: number;
}

export interface AssaySample {
  depthM: number;
  value: number | null;
  /** Nominal 1σ analytical uncertainty (not including diagenesis or contamination). */
  sigma: number;
  note?: 'lost core' | 'below detection' | 'no carbonate' | 'no organic matter' | 'out of range';
}

export interface AssayResult {
  kind: 'assay';
  coreId: string;
  proxy: ProxyId;
  samples: AssaySample[];
  cost: number;
  budgetLeft: number;
}

export type Measurement = CoreResult | AssayResult;

export type ClientMessage =
  | { kind: 'generate'; config: WorldConfig }
  | { kind: 'act'; reqId: number; action: Action }
  | { kind: 'submit'; reqId: number; submission: unknown };

export type ErrorCode = 'insufficient_budget' | 'unknown_core' | 'out_of_range' | 'bad_request' | 'not_ready' | 'sealed';

export type ServerMessage =
  | { kind: 'progress'; stage: Stage; frac: number }
  | { kind: 'ready'; info: PublicInfo }
  | { kind: 'result'; reqId: number; measurement: Measurement }
  | { kind: 'error'; reqId?: number; code: ErrorCode; message: string };
