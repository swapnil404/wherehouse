import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCatchmentCells } from "./catchment";

describe("buildCatchmentCells", () => {
  test("turns cumulative bands into earliest-reach rings", () => {
    const cells = buildCatchmentCells(
      [
        { minutes: 20, destinationH3Indexes: ["a", "b", "c"] },
        { minutes: 10, destinationH3Indexes: ["a"] },
        { minutes: 30, destinationH3Indexes: ["a", "b", "c", "d"] },
      ],
      30,
    );

    assert.deepEqual(cells, [
      { h3Index: "a", minutes: 10 },
      { h3Index: "b", minutes: 20 },
      { h3Index: "c", minutes: 20 },
      { h3Index: "d", minutes: 30 },
    ]);
  });

  test("omits cells beyond the selected time", () => {
    const cells = buildCatchmentCells(
      [
        { minutes: 10, destinationH3Indexes: ["a"] },
        { minutes: 20, destinationH3Indexes: ["a", "b"] },
        { minutes: 30, destinationH3Indexes: ["a", "b", "c"] },
      ],
      20,
    );

    assert.deepEqual(cells, [
      { h3Index: "a", minutes: 10 },
      { h3Index: "b", minutes: 20 },
    ]);
  });
});
