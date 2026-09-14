import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SUBSCORE_KEYS } from "./cells";
import {
  applyEmphasis,
  deriveSetup,
  EMPTY_ANSWERS,
  isComplete,
  MAX_PRIORITIES,
  projectNameFor,
  PURPOSES,
  type Answers,
} from "./onboarding";

const answers = (overrides: Partial<Answers> = {}): Answers => ({
  ...EMPTY_ANSWERS,
  kind: "retail",
  purpose: "food",
  scope: "city",
  access: "none",
  eligibility: "show_all",
  priorities: ["poi"],
  ...overrides,
});

function mustWeights(value: ReturnType<typeof applyEmphasis>) {
  assert.ok(value, "expected authoritative preset weights");
  return value;
}

describe("deriveSetup", () => {
  test("carries the use case through as the preset", () => {
    assert.equal(deriveSetup(answers({ kind: "ev", purpose: "highway" })).preset, "ev");
  });

  test("leaves every subscore untouched when nothing was asked for", () => {
    const setup = deriveSetup({ ...EMPTY_ANSWERS, kind: "warehouse" });
    for (const key of SUBSCORE_KEYS) assert.equal(setup.emphasis[key], 1);
  });

  test("the stated use leans the weights within the preset", () => {
    // Food retail benefits from clustering with other food, which is the POI term.
    const food = deriveSetup(answers({ purpose: "food" }));
    assert.ok(food.emphasis.poi > 1);
    assert.equal(food.emphasis.flood, 1);

    // Last-mile warehousing cares about the people it delivers to.
    const lastMile = deriveSetup(answers({ kind: "warehouse", purpose: "last_mile" }));
    assert.ok(lastMile.emphasis.demographics > 1);
  });

  test("a catchment answer switches the reach overlay on, not just the weights", () => {
    const drive = deriveSetup(answers({ access: "drive_catchment" }));
    assert.deepEqual(drive.catchment, { mode: "car", minutes: 20 });

    const walk = deriveSetup(answers({ access: "walk_catchment" }));
    assert.equal(walk.catchment?.mode, "foot");

    assert.equal(deriveSetup(answers({ access: "highway" })).catchment, null);
  });

  test("the workable-only choice switches on the complete preset filter", () => {
    const setup = deriveSetup(answers({ eligibility: "workable_only" }));
    assert.equal(setup.eligibleOnly, true);
    for (const key of SUBSCORE_KEYS) assert.equal(setup.emphasis[key], key === "poi" ? 2.52 : 1);
  });

  test("show-all does not filter anything out", () => {
    // The filter hides ~99% of the grid under some presets, so it must not be
    // switched on by an answer that asks to see every location. Isolated
    // from the other questions so nothing else can be supplying the boost.
    const setup = deriveSetup({ ...EMPTY_ANSWERS, kind: "retail", eligibility: "show_all" });
    assert.equal(setup.eligibleOnly, false);
    for (const key of SUBSCORE_KEYS) assert.equal(setup.emphasis[key], 1);
  });

  test("a purpose and a priority on the same subscore compound", () => {
    // Deliberate: someone selling food who also ranks on nearby businesses has
    // said the same thing twice, and the weights should reflect both.
    const both = deriveSetup(answers({ purpose: "food", priorities: ["poi"] }));
    const purposeOnly = deriveSetup(answers({ purpose: "food", priorities: [] }));
    assert.ok(both.emphasis.poi > purposeOnly.emphasis.poi);
  });

  test("eligibility changes filtering without secretly changing ranking weights", () => {
    const filtered = deriveSetup(answers({ eligibility: "workable_only" }));
    const all = deriveSetup(answers({ eligibility: "show_all" }));
    assert.deepEqual(filtered.emphasis, all.emphasis);
  });

  test("only the first three priorities count", () => {
    // No purpose or access, so priorities are the only source of emphasis.
    const setup = deriveSetup({
      ...EMPTY_ANSWERS,
      kind: "retail",
      priorities: ["demographics", "transport", "poi", "zoning", "flood"],
    });
    const boosted = SUBSCORE_KEYS.filter((key) => setup.emphasis[key] > 1);
    assert.equal(boosted.length, MAX_PRIORITIES);
    assert.equal(setup.emphasis.zoning, 1);
    assert.equal(setup.emphasis.flood, 1);
  });

  test("choosing to draw an area arms the tool", () => {
    assert.equal(deriveSetup(answers({ scope: "draw" })).startDrawing, true);
    assert.equal(deriveSetup(answers({ scope: "city" })).startDrawing, false);
  });

  test("the summary describes the filter honestly, not as a new rule", () => {
    const setup = deriveSetup(answers({ eligibility: "workable_only" }));
    const line = setup.summary.find((entry) => entry.includes("hard rule"));
    // The engine cannot add constraints, so the wording has to promise the
    // filter it does apply rather than a rule it never created.
    assert.ok(line?.includes("every hard rule"));
    assert.ok(!setup.summary.join(" ").includes("requirement added"));
  });

  test("every answer contributes a line the reader can check", () => {
    const setup = deriveSetup(
      answers({ scope: "draw", access: "drive_catchment", eligibility: "workable_only" }),
    );
    assert.ok(setup.summary.length >= 4);
    assert.ok(setup.summary.every((line) => line.length > 0));
  });
});

describe("applyEmphasis", () => {
  const flat = Object.fromEntries(SUBSCORE_KEYS.map((key) => [key, 1])) as Record<
    (typeof SUBSCORE_KEYS)[number],
    number
  >;

  test("scales the preset's own weights and normalises to a share", () => {
    const baseline = { demographics: 0.28, transport: 0.12, poi: 0.3, zoning: 0.14, flood: 0.1, aqi: 0.06 };
    const weights = mustWeights(applyEmphasis(baseline, { ...flat, poi: 2 }));
    const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
    assert.ok(Math.abs(total - 1) < 0.01);
    // POI doubled against a fixed field, so its share has to rise.
    assert.ok((weights.poi ?? 0) > 0.3);
    assert.ok((weights.demographics ?? 0) < 0.28);
  });

  test("preserves the preset's shape when nothing is emphasised", () => {
    const baseline = { demographics: 0.5, transport: 0.5 };
    const weights = mustWeights(applyEmphasis(baseline, flat));
    assert.equal(weights.demographics, 0.5);
    assert.equal(weights.transport, 0.5);
  });

  test("refuses to invent weights before the authoritative preset loads", () => {
    assert.equal(applyEmphasis({}, { ...flat, flood: 3 }), null);
  });

  test("a named priority is never left below the floor by a lopsided preset", () => {
    // The regression this exists for: warehouse spans 0.36 zoning to 0.02 air
    // quality, so scaling a 0.06 term by 1.8 still left it *below* its starting
    // share once a term the reader also emphasised took a bigger multiple.
    // Naming something a top-three priority and watching it shrink reads as the
    // questionnaire having ignored the answer.
    const baseline = { demographics: 0.06, transport: 0.28, poi: 0.22, zoning: 0.36, flood: 0.06, aqi: 0.02 };
    const emphasis = { ...flat, demographics: 1.8, transport: 3.24, poi: 1.8 };

    const unfloored = mustWeights(applyEmphasis(baseline, emphasis));
    assert.ok((unfloored.demographics ?? 0) < 0.06, "precondition: it really does shrink");

    const floored = mustWeights(
      applyEmphasis(baseline, emphasis, ["demographics", "transport", "poi"]),
    );
    assert.ok((floored.demographics ?? 0) >= 0.1);
  });

  test("flooring keeps the weights a normalised share", () => {
    const floored = mustWeights(
      applyEmphasis({ aqi: 0.02, zoning: 0.9 }, flat, ["aqi", "flood", "demographics"]),
    );
    const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (floored[key] ?? 0), 0);
    assert.ok(Math.abs(total - 1) < 0.01, `total was ${total}`);
  });

  test("unnamed subscores keep the preset's ordering among themselves", () => {
    // The floor takes room from the rest, but which of the rest matters most is
    // still the preset's call, not the questionnaire's.
    const baseline = { demographics: 0.05, zoning: 0.4, poi: 0.3, transport: 0.2, flood: 0.04, aqi: 0.01 };
    const floored = mustWeights(applyEmphasis(baseline, flat, ["demographics"]));
    assert.ok((floored.zoning ?? 0) > (floored.poi ?? 0));
    assert.ok((floored.poi ?? 0) > (floored.transport ?? 0));
    assert.ok((floored.flood ?? 0) > (floored.aqi ?? 0));
  });

  test("eligibility never buys ranking weight", () => {
    const setup = deriveSetup(answers({ eligibility: "workable_only", priorities: [] }));
    assert.deepEqual(setup.floored, []);
  });

  test("never emits a weight the scorer would reject", () => {
    const weights = mustWeights(applyEmphasis({ poi: 0.4 }, { ...flat, poi: 5 }));
    for (const key of SUBSCORE_KEYS) {
      const value = weights[key] ?? 0;
      assert.ok(Number.isFinite(value) && value >= 0, `${key} = ${value}`);
    }
  });
});

describe("isComplete", () => {
  test("requires an answer to every question", () => {
    assert.equal(isComplete(answers()), true);
    assert.equal(isComplete(EMPTY_ANSWERS), false);
    assert.equal(isComplete(answers({ purpose: null })), false);
    assert.equal(isComplete(answers({ eligibility: null })), false);
    assert.equal(isComplete(answers({ priorities: [] })), false);
  });
});

describe("projectNameFor", () => {
  test("names the project after what it was built for", () => {
    assert.equal(projectNameFor(answers({ kind: "retail", purpose: "food" })), "Retail store · Food and beverages");
  });

  test("trims the either/or out of the longer use cases", () => {
    const name = projectNameFor(answers({ kind: "warehouse", purpose: "regional" }));
    assert.ok(!name.includes(" or "));
    assert.ok(name.startsWith("Warehouse"));
  });

  test("survives a half-answered questionnaire", () => {
    assert.equal(typeof projectNameFor(EMPTY_ANSWERS), "string");
    assert.ok(projectNameFor(EMPTY_ANSWERS).length > 0);
  });
});

describe("PURPOSES", () => {
  test("every use case offers its own four options", () => {
    // Question two's options depend on question one, so a missing entry would
    // strand the reader on a question with nothing to pick.
    for (const kind of ["warehouse", "retail", "ev"] as const) {
      assert.equal(PURPOSES[kind].length, 4);
    }
  });

  test("no purpose key is shared between use cases", () => {
    const all = Object.values(PURPOSES).flatMap((options) => options.map((o) => o.value));
    assert.equal(new Set(all).size, all.length);
  });
});

describe("applying a completed questionnaire to the map", () => {
  // Drives the real store rather than a stand-in, because the bug this guards
  // was not in the derivation — those numbers were right all along. It was that
  // nothing carried them to the map: the whole effect of six questions was
  // routed through creating a project and waiting for another component to
  // notice, so one failed request meant the answers did nothing at all.
  test("every answer reaches the map store", async () => {
    const { useMapStore } = await import("@/stores/map-store");

    const sidecarWarehouse = {
      demographics: 0.06, transport: 0.28, poi: 0.22, zoning: 0.36, flood: 0.06, aqi: 0.02,
    };
    const completed: Answers = {
      kind: "warehouse",
      purpose: "regional",
      scope: "draw",
      access: "drive_catchment",
      eligibility: "workable_only",
      priorities: ["demographics", "transport", "poi"],
    };

    const revisionBefore = useMapStore.getState().setupRevision;

    const setup = deriveSetup(completed);
    const weights = mustWeights(applyEmphasis(sidecarWarehouse, setup.emphasis, setup.floored));
    const store = useMapStore.getState();
    store.applyProjectSetup(setup.preset, weights, {
      eligibleOnly: setup.eligibleOnly,
      catchment: {
        enabled: setup.catchment !== null,
        mode: setup.catchment?.mode ?? "car",
        minutes: setup.catchment?.minutes ?? 20,
      },
      searchScope: setup.startDrawing ? "draw" : "city",
    });

    const after = useMapStore.getState();
    assert.equal(after.preset, "warehouse", "question one sets the use case");
    assert.equal(after.eligibleOnly, true, "question five switches on the eligibility filter");
    assert.equal(after.catchmentOn, true, "question four switches on the reach overlay");
    assert.equal(after.catchmentMode, "car", "question four picks the travel mode");
    assert.equal(after.drawMode, "polygon", "question three arms the area tool");

    assert.notEqual(after.customWeights, null, "the derived weights are actually held");
    // Regional distribution, a driving catchment and a transport priority all
    // point the same way, so road access has to come out on top.
    const heaviest = SUBSCORE_KEYS.reduce((best, key) =>
      (after.customWeights?.[key] ?? 0) > (after.customWeights?.[best] ?? 0) ? key : best,
    );
    assert.equal(heaviest, "transport");
    assert.ok((after.customWeights?.demographics ?? 0) >= 0.1, "a named priority clears the floor");

    // Loading a configuration is not a user edit, so it must not look like one
    // to the write-back that persists slider changes.
    assert.equal(after.setupRevision, revisionBefore);
  });

  test("a saved project's map settings restore as one non-user update", async () => {
    const { useMapStore } = await import("@/stores/map-store");
    const store = useMapStore.getState();
    const revisionBefore = store.setupRevision;

    store.applyProjectSetup("retail", { poi: 0.6, demographics: 0.4 }, {
      eligibleOnly: true,
      catchment: { enabled: true, mode: "foot", minutes: 10 },
      searchScope: "draw",
      studyArea: {
        kind: "radius",
        center: [-97.7431, 30.2672],
        radiusMeters: 2_500,
      },
    });

    const restored = useMapStore.getState();
    assert.equal(restored.eligibleOnly, true);
    assert.equal(restored.catchmentOn, true);
    assert.equal(restored.catchmentMode, "foot");
    assert.equal(restored.catchmentMinutes, 10);
    assert.deepEqual(restored.studyArea, {
      kind: "radius",
      center: [-97.7431, 30.2672],
      radiusMeters: 2_500,
    });
    assert.equal(restored.drawMode, null, "a saved shape should not reopen an empty draw tool");
    assert.equal(restored.setupRevision, revisionBefore);
  });
});
