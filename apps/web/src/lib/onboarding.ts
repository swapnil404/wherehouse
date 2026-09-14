import {
  SUBSCORE_KEYS,
  SUBSCORE_LABELS,
  type PresetName,
  type SubscoreKey,
  type Weights,
} from "./cells";

/**
 * The intake questionnaire, and what its answers are allowed to change.
 *
 * **What this may configure, and what it may not.** Weights are the reader's to
 * choose — that is what the sliders are for — so translating plain answers into
 * weights is a friendlier weight editor and nothing more. Subscores and hard
 * constraints are not the reader's to choose: they are formulas in
 * `apps/fastapi/scoring.py`, and §4.3 of the spec keeps scoring math in exactly
 * one language. So nothing here invents a subscore, and nothing here invents a
 * constraint.
 *
 * That bounds question five in particular. "What must a suitable location
 * satisfy" reads like it adds rules, and it cannot: the hard constraints belong
 * to the preset and are evaluated in Python. What it does instead is switch on
 * the eligibility filter — which hides every cell failing the preset's *own*
 * hard rules — and lean the weights hard toward the named concern. That is the
 * closest this engine gets to "must", and the confirmation screen says so in
 * those terms rather than promising a rule that was never created.
 *
 * **The numbers below are editorial, not derived.** They are one defensible
 * reading of each answer, not an output of the model, and they are written as
 * multipliers on the preset's own weights rather than as absolute values on
 * purpose: the preset baseline stays authoritative and retunable in Python,
 * while an answer only says "more of this than that preset would".
 */

/** Mirrors `ReachabilityMode` in the map store; redeclared to keep lib free of store imports. */
type ReachabilityMode = "car" | "foot";

export const MAX_PRIORITIES = 3;

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const LOCATION_KINDS: readonly Option<PresetName>[] = [
  { value: "warehouse", label: "Warehouse or distribution center" },
  { value: "retail", label: "Retail store" },
  { value: "ev", label: "EV charging station" },
] as const;

export type PurposeKey =
  | "last_mile" | "regional" | "fulfillment" | "industrial"
  | "neighborhood" | "food" | "destination" | "services"
  | "fast_charge" | "shopping" | "workplace" | "highway";

/** Question two, which is the only one whose options depend on an earlier answer. */
export const PURPOSES: Record<PresetName, readonly Option<PurposeKey>[]> = {
  warehouse: [
    { value: "last_mile", label: "Local or last-mile deliveries" },
    { value: "regional", label: "Regional distribution" },
    { value: "fulfillment", label: "Storage and fulfillment" },
    { value: "industrial", label: "Manufacturing or industrial operations" },
  ],
  retail: [
    { value: "neighborhood", label: "Everyday neighborhood shopping" },
    { value: "food", label: "Food and beverages" },
    { value: "destination", label: "Large-format or destination retail" },
    { value: "services", label: "Professional or personal services" },
  ],
  ev: [
    { value: "fast_charge", label: "Quick stops and fast charging" },
    { value: "shopping", label: "Shopping or dining destinations" },
    { value: "workplace", label: "Workplaces and apartments" },
    { value: "highway", label: "Highway travel" },
  ],
};

export type ScopeKey = "draw" | "city";

export const SCOPES: readonly Option<ScopeKey>[] = [
  { value: "draw", label: "Draw an area on the map" },
  { value: "city", label: "Search across Austin" },
] as const;

export type AccessKey = "highway" | "local_roads" | "drive_catchment" | "walk_catchment" | "none";

export const ACCESS_OPTIONS: readonly Option<AccessKey>[] = [
  { value: "highway", label: "Easy highway access" },
  { value: "local_roads", label: "Access to major local roads" },
  { value: "drive_catchment", label: "A large driving catchment" },
  { value: "walk_catchment", label: "A large walking catchment" },
  { value: "none", label: "No strong preference" },
] as const;

export type RequirementKey =
  | "no_flood" | "zoning" | "near_highway" | "population" | "low_competition" | "none";

export const REQUIREMENT_OPTIONS: readonly Option<RequirementKey>[] = [
  { value: "no_flood", label: "Outside flood-risk areas" },
  { value: "zoning", label: "Industrial or commercial zoning" },
  { value: "near_highway", label: "Close to a highway" },
  { value: "population", label: "Strong surrounding population" },
  { value: "low_competition", label: "Low nearby competition" },
  { value: "none", label: "No strict requirements" },
] as const;

/** Question six reuses the scoring dimensions directly, under their plain labels. */
export const PRIORITY_OPTIONS: readonly Option<SubscoreKey>[] = SUBSCORE_KEYS.map((key) => ({
  value: key,
  label: SUBSCORE_LABELS[key],
}));

export interface Answers {
  kind: PresetName | null;
  purpose: PurposeKey | null;
  scope: ScopeKey | null;
  access: AccessKey | null;
  requirements: readonly RequirementKey[];
  priorities: readonly SubscoreKey[];
}

export const EMPTY_ANSWERS: Answers = {
  kind: null,
  purpose: null,
  scope: null,
  access: null,
  requirements: [],
  priorities: [],
};

const PRIORITY_BOOST = 1.8;
/** Above `PRIORITY_BOOST`: a stated requirement is a stronger claim than a ranking preference. */
const REQUIREMENT_BOOST = 2.2;

const REQUIREMENT_SUBSCORE: Record<Exclude<RequirementKey, "none">, SubscoreKey> = {
  no_flood: "flood",
  zoning: "zoning",
  near_highway: "transport",
  population: "demographics",
  low_competition: "poi",
};

/** What each use of the building implies, within the preset that already fits it. */
const PURPOSE_EMPHASIS: Record<PurposeKey, Partial<Record<SubscoreKey, number>>> = {
  // Last-mile wants to be near the people it delivers to; regional wants the road.
  last_mile: { demographics: 1.4, transport: 1.1 },
  regional: { transport: 1.5 },
  fulfillment: { zoning: 1.2, transport: 1.1 },
  industrial: { zoning: 1.4, flood: 1.2 },
  neighborhood: { demographics: 1.4 },
  // Food benefits from clustering with other food, which is the POI term.
  food: { poi: 1.4 },
  destination: { transport: 1.3, zoning: 1.2 },
  services: { demographics: 1.2, poi: 1.2 },
  fast_charge: { transport: 1.4 },
  shopping: { poi: 1.4 },
  workplace: { demographics: 1.4 },
  highway: { transport: 1.6 },
};

interface AccessEffect {
  emphasis: Partial<Record<SubscoreKey, number>>;
  catchment?: { mode: ReachabilityMode; minutes: number };
}

const ACCESS_EFFECT: Record<AccessKey, AccessEffect> = {
  highway: { emphasis: { transport: 1.6 } },
  local_roads: { emphasis: { transport: 1.3 } },
  // The catchment answers switch the reach overlay on as well as leaning the
  // weights, because someone who asked about catchment wants to see it.
  drive_catchment: { emphasis: { transport: 1.2 }, catchment: { mode: "car", minutes: 20 } },
  walk_catchment: { emphasis: { demographics: 1.2 }, catchment: { mode: "foot", minutes: 20 } },
  none: { emphasis: {} },
};

export interface DerivedSetup {
  preset: PresetName;
  /** Per-subscore multiplier on the preset's own weights. */
  emphasis: Record<SubscoreKey, number>;
  /**
   * Subscores the reader named as ranking priorities, which are guaranteed a
   * floor in the final weights. See `PRIORITY_FLOOR`.
   */
  floored: readonly SubscoreKey[];
  /** Hide cells failing the preset's hard rules. True when any requirement was named. */
  eligibleOnly: boolean;
  catchment: { mode: ReachabilityMode; minutes: number } | null;
  /** Arm the polygon tool on arrival, because the reader asked to pick an area. */
  startDrawing: boolean;
  /** Plain-English account of everything above, for the confirmation screen. */
  summary: string[];
}

function multiply(
  target: Record<SubscoreKey, number>,
  factors: Partial<Record<SubscoreKey, number>>,
) {
  for (const key of SUBSCORE_KEYS) {
    const factor = factors[key];
    if (factor !== undefined) target[key] *= factor;
  }
}

export function deriveSetup(answers: Answers): DerivedSetup {
  const preset = answers.kind ?? "warehouse";
  const emphasis = Object.fromEntries(
    SUBSCORE_KEYS.map((key) => [key, 1]),
  ) as Record<SubscoreKey, number>;
  const summary: string[] = [];

  const kindLabel = LOCATION_KINDS.find((k) => k.value === preset)?.label ?? preset;
  const purposeLabel = answers.purpose
    ? PURPOSES[preset].find((p) => p.value === answers.purpose)?.label
    : undefined;
  summary.push(
    purposeLabel
      ? `Scoring for a ${kindLabel.toLowerCase()}, leaning toward ${purposeLabel.toLowerCase()}`
      : `Scoring for a ${kindLabel.toLowerCase()}`,
  );

  if (answers.purpose) multiply(emphasis, PURPOSE_EMPHASIS[answers.purpose]);

  const access = answers.access ? ACCESS_EFFECT[answers.access] : null;
  if (access) multiply(emphasis, access.emphasis);
  const catchment = access?.catchment ?? null;
  if (catchment) {
    summary.push(
      `Showing the ${catchment.minutes}-minute ${catchment.mode === "car" ? "drive" : "walk"} catchment`,
    );
  } else if (answers.access && answers.access !== "none") {
    const label = ACCESS_OPTIONS.find((o) => o.value === answers.access)?.label;
    if (label) summary.push(`Weighted toward ${label.toLowerCase()}`);
  }

  const requirements = answers.requirements.filter(
    (value): value is Exclude<RequirementKey, "none"> => value !== "none",
  );
  for (const requirement of requirements) {
    emphasis[REQUIREMENT_SUBSCORE[requirement]] *= REQUIREMENT_BOOST;
  }
  if (requirements.length > 0) {
    summary.push(
      "Hiding locations that fail this use case's hard rules, and weighting heavily toward: "
      + requirements
        .map((r) => REQUIREMENT_OPTIONS.find((o) => o.value === r)?.label.toLowerCase())
        .filter(Boolean)
        .join(", "),
    );
  }

  for (const priority of answers.priorities.slice(0, MAX_PRIORITIES)) {
    emphasis[priority] *= PRIORITY_BOOST;
  }
  if (answers.priorities.length > 0) {
    summary.push(
      "Ranking on "
      + answers.priorities.slice(0, MAX_PRIORITIES).map((p) => SUBSCORE_LABELS[p]).join(", "),
    );
  }

  const startDrawing = answers.scope === "draw";
  summary.push(
    startDrawing
      ? "Opening with the area tool armed, so you can outline where to search"
      : "Searching every cell in Austin",
  );

  return {
    preset,
    emphasis,
    floored: answers.priorities.slice(0, MAX_PRIORITIES),
    eligibleOnly: requirements.length > 0,
    catchment,
    startDrawing,
    summary,
  };
}

/**
 * The smallest share a subscore can hold after being named a ranking priority.
 *
 * Multiplying a baseline is not enough on its own. The warehouse preset spans
 * 0.36 for zoning down to 0.02 for air quality, an eighteen-fold spread, so
 * scaling a 0.06 term by 1.8 still leaves it near the bottom — someone can name
 * "nearby residents" a top-three priority and watch its share come out *lower*
 * than it started, because a term they also emphasised took a bigger multiple.
 * That reads as the questionnaire having ignored them, which is worse than the
 * weighting being slightly off.
 *
 * Applied only to question six, which is explicitly about ranking weight.
 * Requirements from question five are enforced by the eligibility filter rather
 * than by weight, so they get emphasis but no floor. Ten percent is deliberately
 * modest: enough to be visible among six terms, small enough that three
 * priorities reserve under a third of the total and the preset keeps the rest.
 */
const PRIORITY_FLOOR = 0.1;

/**
 * Turns the emphasis multipliers into weights, against the preset's own numbers.
 *
 * Normalised to sum to one so the result reads like the presets the sidecar
 * serves. `compositeScore` divides by the total anyway, so this is legibility
 * rather than arithmetic — the sliders show a share, not a magnitude.
 *
 * Falls back to the emphasis alone when there is no baseline to scale. That
 * happens when the sidecar has not served `/v1/presets` yet, which on a cold
 * start is exactly when someone is filling in this questionnaire; answering six
 * questions and getting an unweighted map would be the worse failure.
 */
export function applyEmphasis(
  baseline: Weights,
  emphasis: Record<SubscoreKey, number>,
  floored: readonly SubscoreKey[] = [],
): Weights {
  const scaled = SUBSCORE_KEYS.map((key) => (baseline[key] ?? 0) * emphasis[key]);
  const total = scaled.reduce((sum, value) => sum + value, 0);
  const source = total > 0 ? scaled : SUBSCORE_KEYS.map((key) => emphasis[key]);
  const divisor = total > 0 ? total : source.reduce((sum, value) => sum + value, 0);

  const shares = new Map<SubscoreKey, number>(
    SUBSCORE_KEYS.map((key, index) => [key, source[index] / divisor]),
  );

  // Raise the named priorities to the floor, then shrink everything else into
  // whatever share is left. Relative order is preserved inside both groups, so
  // the preset still decides which of the unnamed terms matters most.
  const named = new Set(floored);
  if (named.size > 0) {
    for (const key of named) {
      shares.set(key, Math.max(shares.get(key) ?? 0, PRIORITY_FLOOR));
    }
    const namedTotal = [...named].reduce((sum, key) => sum + (shares.get(key) ?? 0), 0);
    const restKeys = SUBSCORE_KEYS.filter((key) => !named.has(key));
    const restTotal = restKeys.reduce((sum, key) => sum + (shares.get(key) ?? 0), 0);
    const room = Math.max(0, 1 - namedTotal);
    for (const key of restKeys) {
      shares.set(key, restTotal > 0 ? ((shares.get(key) ?? 0) / restTotal) * room : 0);
    }
  }

  const weights: Weights = {};
  for (const key of SUBSCORE_KEYS) {
    weights[key] = Math.round((shares.get(key) ?? 0) * 1000) / 1000;
  }
  return weights;
}

/** Whether every question with a required answer has one. */
export function isComplete(answers: Answers): boolean {
  return (
    answers.kind !== null
    && answers.purpose !== null
    && answers.scope !== null
    && answers.access !== null
    && answers.requirements.length > 0
    && answers.priorities.length > 0
  );
}

/** "Retail · Food and beverages" — a project name that says what it was built for. */
export function projectNameFor(answers: Answers): string {
  const kind = answers.kind
    ? (LOCATION_KINDS.find((k) => k.value === answers.kind)?.label ?? "Sites")
    : "Sites";
  const short = kind.split(" or ")[0];
  const purpose = answers.purpose && answers.kind
    ? PURPOSES[answers.kind].find((p) => p.value === answers.purpose)?.label
    : undefined;
  return purpose ? `${short} · ${purpose}` : short;
}
