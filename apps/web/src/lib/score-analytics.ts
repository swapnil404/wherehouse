import {
  SUBSCORE_KEYS,
  compositeScore,
  type HeatmapCell,
  type SubscoreKey,
  type Subscores,
  type Weights,
} from "./cells";

/**
 * Derived statistics over the loaded grid.
 *
 * All of this is computed in the browser from the one `/v1/heatmap` payload —
 * no extra requests. The point is that a single score is meaningless without
 * the distribution it sits in: 44 is unremarkable under retail and strong
 * under warehouse, and only the grid can say which.
 */

export interface GridAnalytics {
  /** Mean of each subscore across every cell — the "metro mean" baseline. */
  subscoreMeans: Subscores;
  /** Every cell's composite score, ascending. Used for percentile lookup. */
  sortedScores: number[];
  cellCount: number;
}

export function computeGridAnalytics(
  cells: readonly HeatmapCell[],
  weights: Weights,
): GridAnalytics | null {
  if (cells.length === 0) return null;

  const sums = {} as Record<SubscoreKey, number>;
  for (const key of SUBSCORE_KEYS) sums[key] = 0;

  const scores: number[] = [];
  for (const cell of cells) {
    for (const key of SUBSCORE_KEYS) sums[key] += cell.subscores[key];
    const score = compositeScore(cell.subscores, weights);
    if (score != null) scores.push(score);
  }

  const subscoreMeans = {} as Subscores;
  for (const key of SUBSCORE_KEYS) subscoreMeans[key] = sums[key] / cells.length;

  scores.sort((a, b) => a - b);
  return { subscoreMeans, sortedScores: scores, cellCount: cells.length };
}

/** Share of cells scoring at or below `score`, as 0-100. */
export function percentileOf(score: number, sortedScores: readonly number[]): number {
  if (sortedScores.length === 0) return 0;

  // Upper bound via binary search — the arrays here are ~1k long and this runs
  // on every hover, so avoid a linear scan.
  let lo = 0;
  let hi = sortedScores.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedScores[mid] <= score) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sortedScores.length) * 100;
}

/**
 * Letter grade from the cell's **percentile within the loaded grid**, not from
 * an absolute cut on 0-100.
 *
 * Absolute grading would be actively misleading here: real composite scores
 * span roughly 16-92 and cluster in the 30s and 40s, so a 90/80/70/60 scale
 * would grade almost the entire metro an F and reserve an A for nothing. A
 * percentile grade answers the question a site selector is actually asking —
 * how does this location compare to everywhere else in Austin.
 */
export function gradeFor(percentile: number): string {
  if (percentile >= 98) return "A+";
  if (percentile >= 93) return "A";
  if (percentile >= 85) return "A-";
  if (percentile >= 75) return "B+";
  if (percentile >= 62) return "B";
  if (percentile >= 50) return "B-";
  if (percentile >= 38) return "C+";
  if (percentile >= 25) return "C";
  if (percentile >= 15) return "C-";
  if (percentile >= 7) return "D";
  return "F";
}

export interface Contribution {
  key: SubscoreKey;
  /** The cell's own subscore. */
  value: number;
  /** Grid mean for this layer. */
  mean: number;
  /** Normalized weight actually applied, 0-1. */
  weight: number;
  /** Signed points this layer moves the score away from the baseline. */
  delta: number;
}

export interface Waterfall {
  /** Composite score of a hypothetical average cell under these weights. */
  baseline: number;
  contributions: Contribution[];
  /** `baseline + Σ delta`, equal to the cell's composite score. */
  total: number;
}

/**
 * Per-layer contributions measured from the grid mean.
 *
 * A plain bar chart of subscores says "zoning is 95". This says "zoning is
 * pulling this site 12 points above an average Austin cell" — which is the
 * question a breakdown should answer. Deltas sum exactly to
 * `score - baseline`, so the waterfall closes.
 */
export function computeWaterfall(
  subscores: Subscores,
  means: Subscores,
  weights: Weights,
): Waterfall {
  const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (total === 0) return { baseline: 0, contributions: [], total: 0 };

  let baseline = 0;
  const contributions: Contribution[] = [];
  for (const key of SUBSCORE_KEYS) {
    const weight = (weights[key] ?? 0) / total;
    baseline += weight * means[key];
    contributions.push({
      key,
      value: subscores[key],
      mean: means[key],
      weight,
      delta: weight * (subscores[key] - means[key]),
    });
  }

  // Largest movers first — the reason to read a waterfall is to find them.
  contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    baseline,
    contributions,
    total: baseline + contributions.reduce((sum, c) => sum + c.delta, 0),
  };
}
