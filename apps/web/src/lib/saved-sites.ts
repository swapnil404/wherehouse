import {
  compositeScore,
  SUBSCORE_KEYS,
  type PresetName,
  type ScoredCell,
  type Subscores,
  type Weights,
} from "./cells";

/**
 * What a saved site records, and why it records a score at all.
 *
 * A project's saved list is the one place in this app that is *not* live. Every
 * other surface recomputes from the current weights on purpose — the heatmap,
 * the shortlist, the compare tray — because the whole point of weight-
 * independent subscores is that tuning a slider reshapes the answer instantly.
 *
 * A saved list behaving that way would be a bug rather than a feature. Someone
 * saves a site at 71, writes "best of the north cluster" against it, tunes
 * zoning down a week later, and comes back to a list where the note argues with
 * the number beside it. So the snapshot freezes the score *and the setup that
 * produced it*, and the row can say what has changed since.
 *
 * The subscores ride along so a saved site can be re-scored under today's
 * weights without another round trip — that comparison is the reason the
 * snapshot is worth keeping.
 */
export type ScoreSnapshot = {
  score: number;
  subscores: Subscores;
  eligible: boolean;
  /** Failed hard rules at save time; the constraint list itself is not kept. */
  failedRules: number;
  preset: PresetName;
  /** Resolved weights, never `null` — "the preset's own" is not stable over time. */
  weights: Weights;
  savedAt: string;
};

/**
 * Mirrors `MAX_SAVED_SITES_PER_PROJECT` in `@wherehouse/db/projects`, which is
 * the authority — it enforces the cap inside a transaction so two simultaneous
 * fifth saves cannot both win. This copy exists only so the button can go
 * disabled before a round trip, never as the check itself.
 */
export const MAX_SAVED_SITES = 5;

/** Keeps a stored weight map to keys the scorer actually knows about. */
export function toWeights(source: Record<string, number> | null | undefined): Weights {
  if (!source) return {};
  const weights: Weights = {};
  for (const key of SUBSCORE_KEYS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) weights[key] = value;
  }
  return weights;
}

/**
 * Whether two weight maps are the same *stored configuration*.
 *
 * Not the same thing as scoring identically, and the difference is deliberate.
 * `compositeScore` reads a missing weight as zero, so `{}` and `{ poi: 0, … }`
 * produce the same number — but they do not mean the same thing to a project.
 * An empty map means "whatever this preset defines" and follows the preset if
 * its numbers are ever retuned; a full map with a zero in it is a deliberate
 * choice that should survive. Collapsing the two would skip the write that
 * records that choice.
 *
 * Compared key by key over the known subscores rather than by deep equality,
 * because unknown keys are not weights and key order is not information. Used
 * on a debounce to decide whether the map has drifted from the project it was
 * loaded from, so a false positive here is a database write per render.
 */
export function sameWeights(a: Weights, b: Weights): boolean {
  return SUBSCORE_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

/**
 * Which project the session is working in, given the list and the chosen id.
 *
 * The `null` and not-found cases are deliberately different. No choice yet
 * means "the one you last worked in", which is index 0 because the server
 * orders by `updatedAt`. A choice that is missing from the list means the list
 * is mid-flight, and answering with a *different* project would be worse than
 * answering with nothing: a save issued in that window would land in whichever
 * project happened to sort first, which is how a site ends up filed under the
 * project you just navigated away from.
 */
export function resolveActiveProject<T extends { id: string }>(
  projects: readonly T[],
  storedId: string | null,
): T | null {
  if (storedId !== null) {
    return projects.find((project) => project.id === storedId) ?? null;
  }
  return projects[0] ?? null;
}

export function buildSnapshot(
  cell: ScoredCell,
  preset: PresetName,
  weights: Weights,
  score: number,
): ScoreSnapshot {
  return {
    score,
    subscores: cell.subscores,
    eligible: cell.eligible,
    failedRules: cell.constraints.filter((constraint) => !constraint.pass).length,
    preset,
    weights: toWeights(weights as Record<string, number>),
    savedAt: new Date().toISOString(),
  };
}

/**
 * Reads back what `buildSnapshot` wrote.
 *
 * Defensive because the column is typed as an open record on both sides of the
 * wire, so nothing structural stops an older or hand-written row from landing
 * here. A row that fails to parse still renders — it keeps its name and notes
 * and simply has no score to show, which beats dropping the user's saved work
 * because one field went missing.
 */
export function parseSnapshot(value: unknown): ScoreSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const score = raw.score;
  const subscores = raw.subscores;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (!subscores || typeof subscores !== "object") return null;

  const parsedSubscores = {} as Subscores;
  for (const key of SUBSCORE_KEYS) {
    const entry = (subscores as Record<string, unknown>)[key];
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    parsedSubscores[key] = entry;
  }

  return {
    score,
    subscores: parsedSubscores,
    eligible: raw.eligible === true,
    failedRules: typeof raw.failedRules === "number" ? raw.failedRules : 0,
    preset: (raw.preset as PresetName) ?? "warehouse",
    weights: toWeights(raw.weights as Record<string, number>),
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
  };
}

/** Smallest score gap worth reporting; below this the row would claim a change nobody made. */
const DRIFT_EPSILON = 0.05;

export interface SnapshotDrift {
  /** The site's score under today's weights. */
  liveScore: number | null;
  presetChanged: boolean;
  /** True only when the *number* moved, not merely the weights behind it. */
  scoreChanged: boolean;
}

/**
 * What has changed since this site was saved.
 *
 * Weights can move without the score following — raising two weights in
 * proportion leaves a weighted average where it was. The row reports the score
 * gap rather than the weight edit, because the gap is the part that would make
 * the user's note look wrong.
 */
export function snapshotDrift(
  snapshot: ScoreSnapshot,
  preset: PresetName,
  weights: Weights,
): SnapshotDrift {
  const liveScore = compositeScore(snapshot.subscores, weights);
  return {
    liveScore,
    presetChanged: snapshot.preset !== preset,
    scoreChanged:
      liveScore !== null && Math.abs(liveScore - snapshot.score) >= DRIFT_EPSILON,
  };
}

/**
 * "Site 3" / "Project 2" — the lowest number not already taken.
 *
 * Saving and creating happen in one click, with renaming left to the panel that
 * lists the result. Asking for a name up front puts a modal between the reader
 * and the thing they are trying to keep, and most of those names would be typed
 * once and never read; a predictable placeholder they can overwrite later is
 * the cheaper trade.
 *
 * Fills gaps rather than counting: deleting "Site 2" of three should make the
 * next save "Site 2", not a second "Site 4".
 */
export function nextSequentialName(
  prefix: string,
  existing: readonly { name: string }[],
): string {
  const taken = new Set(existing.map((item) => item.name));
  for (let index = 1; index <= existing.length + 1; index += 1) {
    const candidate = `${prefix} ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix} ${existing.length + 1}`;
}

export function defaultSiteName(existing: readonly { name: string }[]): string {
  return nextSequentialName("Site", existing);
}
