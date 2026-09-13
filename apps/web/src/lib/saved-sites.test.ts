import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildSnapshot,
  defaultSiteName,
  nextSequentialName,
  parseSnapshot,
  snapshotDrift,
  toWeights,
} from "./saved-sites";

const subscores = {
  demographics: 80,
  transport: 60,
  poi: 40,
  zoning: 100,
  flood: 100,
  aqi: 50,
};

const cell = {
  h3_index: "88a0b1",
  lat: 30.26,
  lon: -97.74,
  score: 0,
  eligible: false,
  subscores,
  constraints: [
    { id: "flood", label: "", pass: true },
    { id: "pop", label: "", pass: false },
    { id: "zone", label: "", pass: false },
  ],
} as unknown as Parameters<typeof buildSnapshot>[0];

const evenWeights = {
  demographics: 1,
  transport: 1,
  poi: 1,
  zoning: 1,
  flood: 1,
  aqi: 1,
};

describe("toWeights", () => {
  test("drops keys the scorer does not know about", () => {
    const weights = toWeights({ demographics: 3, nonsense: 9 } as Record<string, number>);
    assert.deepEqual(weights, { demographics: 3 });
  });

  test("drops non-finite values rather than poisoning the average", () => {
    // A NaN weight would make every composite built from it NaN, which renders
    // as a blank score with no indication of which input was bad.
    assert.deepEqual(toWeights({ poi: Number.NaN, zoning: 2 }), { zoning: 2 });
  });

  test("treats a missing map as no weights", () => {
    assert.deepEqual(toWeights(null), {});
  });
});

describe("buildSnapshot", () => {
  test("counts the failed rules and keeps the setup that produced the score", () => {
    const snapshot = buildSnapshot(cell, "retail", evenWeights, 71.6);
    assert.equal(snapshot.score, 71.6);
    assert.equal(snapshot.failedRules, 2);
    assert.equal(snapshot.eligible, false);
    assert.equal(snapshot.preset, "retail");
    assert.deepEqual(snapshot.weights, evenWeights);
    assert.deepEqual(snapshot.subscores, subscores);
  });

  test("round-trips through parseSnapshot", () => {
    // The column is an open record on both sides of the wire, so the write and
    // the read have to agree without a schema holding them together.
    const snapshot = buildSnapshot(cell, "warehouse", evenWeights, 55);
    assert.deepEqual(parseSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  });
});

describe("parseSnapshot", () => {
  test("rejects a row with no usable score", () => {
    assert.equal(parseSnapshot(null), null);
    assert.equal(parseSnapshot({ subscores }), null);
    assert.equal(parseSnapshot({ score: "71.6", subscores }), null);
  });

  test("rejects a partial subscore set instead of scoring around the hole", () => {
    const { aqi: _aqi, ...partial } = subscores;
    assert.equal(parseSnapshot({ score: 60, subscores: partial }), null);
  });

  test("keeps a row whose optional fields went missing", () => {
    // Losing the saved date should cost the date, not the user's saved site.
    const parsed = parseSnapshot({ score: 60, subscores });
    assert.equal(parsed?.score, 60);
    assert.equal(parsed?.failedRules, 0);
    assert.equal(parsed?.savedAt, "");
  });
});

describe("snapshotDrift", () => {
  const snapshot = buildSnapshot(cell, "retail", evenWeights, 71.6);

  // Even weights over the subscores above: (80+60+40+100+100+50) / 6.
  const EVEN_AVERAGE = 430 / 6;

  test("reports no change when the weights still produce the saved score", () => {
    const drift = snapshotDrift(
      { ...snapshot, score: EVEN_AVERAGE },
      "retail",
      evenWeights,
    );
    assert.equal(drift.presetChanged, false);
    assert.equal(drift.scoreChanged, false);
  });

  test("reports the live score when priorities have moved", () => {
    const drift = snapshotDrift(snapshot, "retail", { zoning: 1 });
    assert.equal(drift.liveScore, 100);
    assert.equal(drift.scoreChanged, true);
    assert.equal(drift.presetChanged, false);
  });

  test("notices a different use case even when the number holds", () => {
    const drift = snapshotDrift(snapshot, "warehouse", evenWeights);
    assert.equal(drift.presetChanged, true);
  });

  test("proportional weight changes are not drift", () => {
    // Doubling every weight leaves a weighted average exactly where it was.
    // Reporting that as a change would cry wolf on an edit with no effect.
    const doubled = Object.fromEntries(
      Object.entries(evenWeights).map(([key, value]) => [key, value * 2]),
    );
    const drift = snapshotDrift(
      { ...snapshot, score: EVEN_AVERAGE },
      "retail",
      doubled,
    );
    assert.equal(drift.scoreChanged, false);
  });
});

describe("nextSequentialName", () => {
  test("fills the lowest free gap rather than counting upward", () => {
    // Deleting "Site 2" of three should make the next save "Site 2" again,
    // not a second "Site 4" sitting beside the existing one.
    const existing = [{ name: "Site 1" }, { name: "Site 3" }];
    assert.equal(nextSequentialName("Site", existing), "Site 2");
  });

  test("starts at one and respects renamed entries", () => {
    assert.equal(defaultSiteName([]), "Site 1");
    assert.equal(defaultSiteName([{ name: "North lot" }]), "Site 1");
  });

  test("carries the prefix through", () => {
    assert.equal(nextSequentialName("Project", [{ name: "Project 1" }]), "Project 2");
  });
});
