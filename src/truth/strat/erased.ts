/**
 * Log of rock destroyed by erosion — the evidence "destroyed before the player ever arrived" (reveal, §7).
 * One entry per erosion EPISODE in one cell (consecutive eroding steps are merged).
 */
export class ErasedLog {
  n = 0;
  private cap = 256;
  cell = new Uint32Array(this.cap);
  stepStart = new Uint16Array(this.cap);
  stepEnd = new Uint16Array(this.cap);
  /** Oldest / youngest mean age of the removed rock, Ma. */
  ageOldMa = new Float32Array(this.cap);
  ageYoungMa = new Float32Array(this.cap);
  /** Solid thickness removed, m (stack rock only; excludes basement). */
  thickness = new Float32Array(this.cap);

  private grow(): void {
    const c = this.cap * 2;
    const g = <A extends Float32Array | Uint16Array | Uint32Array>(a: A): A => {
      const b = new (a.constructor as new (n: number) => A)(c);
      b.set(a);
      return b;
    };
    this.cell = g(this.cell); this.stepStart = g(this.stepStart); this.stepEnd = g(this.stepEnd);
    this.ageOldMa = g(this.ageOldMa); this.ageYoungMa = g(this.ageYoungMa); this.thickness = g(this.thickness);
    this.cap = c;
  }

  open(cell: number, step: number, ageOld: number, ageYoung: number, thickness: number): number {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.cell[i] = cell; this.stepStart[i] = step; this.stepEnd[i] = step;
    this.ageOldMa[i] = ageOld; this.ageYoungMa[i] = ageYoung; this.thickness[i] = thickness;
    return i;
  }

  extend(i: number, step: number, ageOld: number, ageYoung: number, thickness: number): void {
    this.stepEnd[i] = step;
    this.ageOldMa[i] = Math.max(this.ageOldMa[i], ageOld);
    this.ageYoungMa[i] = Math.min(this.ageYoungMa[i], ageYoung);
    this.thickness[i] += thickness;
  }
}
