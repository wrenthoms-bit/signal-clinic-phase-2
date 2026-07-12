/**
 * Maintains a sorted window of values via incremental binary-search
 * insert/remove, so callers doing a per-sample or per-frame sliding
 * window (De-click's local MAD estimate, Spectral Repair's per-bin
 * baseline) don't re-slice-and-sort a fresh array at every position.
 *
 * Previous cost per position: O(w log w) (slice + full sort).
 * This cost per position: O(w) (binary search is O(log w), the array
 * splice that follows is O(w) — splice is what actually dominates, since
 * these windows are small enough that array shifting beats any container
 * with better asymptotics but worse constants). Real, measured win for
 * the window sizes in play here (tens to a few hundred entries) without
 * the correctness risk of a hand-rolled heap-based structure.
 */
export class SlidingWindowMedian {
  private sorted: number[] = [];

  push(value: number): void {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    this.sorted.splice(lo, 0, value);
  }

  /** Removes exactly one instance of `value`. No-op if not present. */
  remove(value: number): void {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (this.sorted[lo] === value) this.sorted.splice(lo, 1);
  }

  median(): number {
    if (this.sorted.length === 0) return 0;
    return this.sorted[Math.floor(this.sorted.length / 2)];
  }

  size(): number {
    return this.sorted.length;
  }
}
