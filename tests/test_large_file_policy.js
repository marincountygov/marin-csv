#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../assets/large-file-policy.js");

test("large-file policy keeps ordinary documents in standard mode", () => {
  const result = Policy.classify({ bytes: 500_000, rows: 1_000, columns: 12, cells: 12_000 });
  assert.equal(result.mode, "standard");
  assert.equal(result.readOnly, false);
  assert.equal(result.paged, false);
});

test("large-file policy pages documents before grid duplication becomes expensive", () => {
  const byRows = Policy.classify({ bytes: 1_000_000, rows: 6_000, columns: 10, cells: 60_000 });
  assert.equal(byRows.mode, "paged");
  assert.equal(byRows.pageSize, 1_000);
  assert.equal(byRows.readOnly, false);

  const byCells = Policy.classify({ bytes: 1_000_000, rows: 2_000, columns: 80, cells: 160_000 });
  assert.equal(byCells.mode, "paged");
  assert.ok(byCells.reasons.some((item) => item.code === "cells"));
});

test("large-file policy uses an explicit read-only preview at measured risk thresholds", () => {
  for (const stats of [
    { bytes: 24 * 1024 * 1024, rows: 1, columns: 1, cells: 1 },
    { bytes: 100, rows: 250_000, columns: 2, cells: 500_000 },
    { bytes: 100, rows: 10_000, columns: 200, cells: 1_500_000 },
    { bytes: 100, rows: 2, columns: 1_000, cells: 2_000 },
  ]) {
    const result = Policy.classify(stats);
    assert.equal(result.mode, "preview");
    assert.equal(result.readOnly, true);
    assert.equal(result.pageSize, 1_000);
  }
});

test("preflight and policy descriptions are deterministic", () => {
  assert.equal(Policy.needsPreflight(8 * 1024 * 1024 - 1), false);
  assert.equal(Policy.needsPreflight(8 * 1024 * 1024), true);
  assert.match(Policy.describe(Policy.classify({ rows: 6_000, columns: 2, cells: 12_000 })), /Paged editing/);
  assert.match(Policy.describe(Policy.classify({ rows: 250_000, columns: 2, cells: 500_000 })), /Read-only preview/);
});
