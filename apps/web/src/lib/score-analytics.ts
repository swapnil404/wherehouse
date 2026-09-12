import {
  SUBSCORE_KEYS,
  SUBSCORE_LABELS,
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
  /**
   * Each layer's values across the grid, ascending.
   *
   * The mean alone cannot say whether being above it is remarkable. Zoning fit
   * is bimodal — a cell is either in a permitted class or it is not — so
   * sitting six points over the mean can be the 55th percentile or the 95th
   * depending on the layer. Keeping the distribution is what lets the
   * breakdown say "top 10% in Austin" instead of "above average", which is
   * the difference between a ranking and a platitude.
   */
  subscoreSorted: Record<SubscoreKey, number[]>;
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
  const subscoreSorted = {} as Record<SubscoreKey, number[]>;
  for (const key of SUBSCORE_KEYS) {
    sums[key] = 0;
    subscoreSorted[key] = [];
  }

  const scores: number[] = [];
  for (const cell of cells) {
    for (const key of SUBSCORE_KEYS) {
      sums[key] += cell.subscores[key];
      subscoreSorted[key].push(cell.subscores[key]);
    }
    const score = compositeScore(cell.subscores, weights);
    if (score != null) scores.push(score);
  }

  const subscoreMeans = {} as Subscores;
  for (const key of SUBSCORE_KEYS) {
    subscoreMeans[key] = sums[key] / cells.length;
    subscoreSorted[key].sort((a, b) => a - b);
  }

  scores.sort((a, b) => a - b);
  return {
    subscoreMeans,
    subscoreSorted,
    sortedScores: scores,
    cellCount: cells.length,
  };
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

/**
 * Below this a layer is noise. Half a composite point out of 100 is smaller
 * than the panel rounds to, so listing it would name a factor whose own bar
 * reads as zero.
 */
const NARRATIVE_FLOOR = 0.5;
/** Three a side. A list of six is the waterfall again, in sentences. */
const NARRATIVE_LIMIT = 3;

export interface NarrativeItem {
  key: SubscoreKey;
  /** Signed points this layer moves the score, straight from the waterfall. */
  delta: number;
  /** Where this cell's own subscore ranks against the grid, 0-100. */
  percentile: number;
  /** True when this layer is weighted more heavily than any other. */
  topPriority: boolean;
}

export interface ScoreNarrative {
  /** Layers pushing the score up, largest mover first. */
  drivers: NarrativeItem[];
  detractors: NarrativeItem[];
  /** One line naming the biggest mover each way. */
  summary: string;
}

/**
 * Where a layer's value sits in the city, in words.
 *
 * Bands rather than a raw percentile because the number invites false
 * precision: the difference between the 71st and 74th percentile of road
 * access is not a thing anyone should site a warehouse on, and printing both
 * implies it is.
 */
export function rankPhrase(percentile: number): string {
  if (percentile >= 90) return "top 10% in Austin";
  if (percentile >= 75) return "top quarter in Austin";
  if (percentile >= 60) return "better than most of Austin";
  if (percentile > 40) return "middle of the pack";
  if (percentile > 25) return "worse than most of Austin";
  if (percentile > 10) return "bottom quarter in Austin";
  return "bottom 10% in Austin";
}

/** Mid-sentence form of a layer label. None of the six is a proper noun. */
function lower(key: SubscoreKey): string {
  return SUBSCORE_LABELS[key].toLowerCase();
}

function summarize(drivers: NarrativeItem[], detractors: NarrativeItem[]): string {
  const lead = drivers[0];
  const drag = detractors[0];

  if (lead && drag) {
    return `Lifted most by ${lower(lead.key)}, held back most by ${lower(drag.key)}.`;
  }
  if (lead) {
    return `Lifted most by ${lower(lead.key)}, with nothing pulling the score down.`;
  }
  if (drag) {
    return `Held back most by ${lower(drag.key)}, with nothing lifting it.`;
  }
  return "Every layer sits close to the Austin average, so this scores like a typical location.";
}

/**
 * The waterfall, said out loud.
 *
 * Built from the same contributions the bars draw, so the prose and the chart
 * can never name different movers. What it adds is the second half of the
 * story: a delta folds in the weight, so a layer can top the list because the
 * reader weighted it heavily rather than because the site is remarkable there.
 * Pairing each one with its rank in the city separates those two cases —
 * "zoning fit, top 10% in Austin" is a property of the location, while
 * "zoning fit, middle of the pack, your top priority" is a property of the
 * question being asked.
 */
export function buildNarrative(
  waterfall: Waterfall,
  analytics: GridAnalytics,
): ScoreNarrative {
  // Only flagged when one layer is strictly ahead. Under an evenly weighted
  // preset there is no top priority to name, and picking one arbitrarily
  // would invent an emphasis the reader never set.
  const weights = waterfall.contributions.map((c) => c.weight);
  const maxWeight = Math.max(...weights, 0);
  const leaders = weights.filter((w) => w === maxWeight).length;
  const topPriorityKey =
    leaders === 1
      ? (waterfall.contributions.find((c) => c.weight === maxWeight)?.key ?? null)
      : null;

  const toItem = (c: Contribution): NarrativeItem => ({
    key: c.key,
    delta: c.delta,
    percentile: percentileOf(c.value, analytics.subscoreSorted[c.key]),
    topPriority: c.key === topPriorityKey,
  });

  // `contributions` arrives sorted by absolute delta, so both lists come out
  // largest mover first without re-sorting.
  const material = waterfall.contributions.filter(
    (c) => Math.abs(c.delta) >= NARRATIVE_FLOOR,
  );
  const drivers = material.filter((c) => c.delta > 0).slice(0, NARRATIVE_LIMIT).map(toItem);
  const detractors = material.filter((c) => c.delta < 0).slice(0, NARRATIVE_LIMIT).map(toItem);

  return { drivers, detractors, summary: summarize(drivers, detractors) };
}
