import assert from "node:assert/strict";
import test from "node:test";
import { distributeMasonry } from "../src/composables/masonryDistribution.ts";

const groups = [
  { key: "chinese", height: 210 },
  { key: "math", height: 170 },
  { key: "english", height: 150 },
  { key: "physics", height: 190 },
];

test("uses the shortest existing column that can still fit", () => {
  const result = distributeMasonry(groups, 500, 24);

  assert.deepEqual(result.columns.map((column) => column.map((item) => item.key)), [
    ["chinese", "math"],
    ["english", "physics"],
  ]);
});

test("adds a new right-hand column only when every current column would overflow", () => {
  const result = distributeMasonry(groups.slice(0, 3), 300, 24);

  assert.deepEqual(result.columns.map((column) => column.map((item) => item.key)), [
    ["chinese"],
    ["math"],
    ["english"],
  ]);
});

test("keeps a previous column when that placement still fits", () => {
  const priorColumns = new Map<string, number>([
    ["alpha", 0],
    ["beta", 1],
    ["gamma", 0],
  ]);
  const result = distributeMasonry([
    { key: "alpha", height: 300 },
    { key: "beta", height: 200 },
    { key: "gamma", height: 50 },
  ], 400, 24, priorColumns);

  assert.equal(result.columnByKey.get("gamma"), 0);
});
