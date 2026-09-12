import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toggleComparedSite } from "./compare";

const site = (h3_index: string) => ({ h3_index });

describe("toggleComparedSite", () => {
  test("adds and removes a candidate", () => {
    assert.deepEqual(toggleComparedSite([], site("a")), [site("a")]);
    assert.deepEqual(toggleComparedSite([site("a")], site("a")), []);
  });

  test("does not add a fifth candidate", () => {
    const full = [site("a"), site("b"), site("c"), site("d")];
    assert.deepEqual(toggleComparedSite(full, site("e")), full);
  });
});
