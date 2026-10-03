/**
 * Calibration history across games (pure + a tiny storage adapter). After each reveal the probability statements
 * the player made, with what turned out true, are appended; the reliability diagram bins them by stated probability.
 */
export interface Statement { kind: 'headline' | 'event' | 'cause'; p: number; outcome: boolean }
export interface GameRecord { seed: string; at: number; total: number; headlineBits: number; statements: Statement[] }

export const HISTORY_KEY = 'silur-history';
export const MAX_GAMES = 50;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadHistory(kv: KV | null): GameRecord[] {
  try {
    const raw = kv?.getItem(HISTORY_KEY);
    const d = raw ? (JSON.parse(raw) as GameRecord[]) : [];
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

export function recordGame(kv: KV | null, g: GameRecord): GameRecord[] {
  const all = [...loadHistory(kv).filter((x) => !(x.seed === g.seed && x.at === g.at)), g].slice(-MAX_GAMES);
  try { kv?.setItem(HISTORY_KEY, JSON.stringify(all)); } catch { /* storage unavailable: history is a convenience */ }
  return all;
}

export interface ReliabilityBin { lo: number; hi: number; n: number; meanP: number; freq: number }

export function reliability(statements: Pick<Statement, 'p' | 'outcome'>[], bins = 5): ReliabilityBin[] {
  const out: ReliabilityBin[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, meanP: 0, freq: 0 }));
  for (const s of statements) {
    const b = out[Math.min(bins - 1, Math.max(0, Math.floor(s.p * bins)))];
    b.n++; b.meanP += s.p; b.freq += s.outcome ? 1 : 0;
  }
  for (const b of out) if (b.n) { b.meanP /= b.n; b.freq /= b.n; }
  return out;
}

/** Expected calibration error: the n-weighted gap between stated probability and observed frequency. */
export function calibrationError(bins: ReliabilityBin[]): number {
  const n = bins.reduce((a, b) => a + b.n, 0);
  return n ? bins.reduce((a, b) => a + b.n * Math.abs(b.meanP - b.freq), 0) / n : 0;
}
