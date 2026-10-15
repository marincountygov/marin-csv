#!/usr/bin/env node

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Workspace = require("../assets/workspace-state.js");

test("workspace mode is explicit and defaults safely to normal", () => {
  assert.equal(Workspace.normalizeMode("normal"), "normal");
  assert.equal(Workspace.normalizeMode("expanded"), "expanded");
  assert.equal(Workspace.normalizeMode("fullscreen"), "normal");
  assert.deepEqual(Workspace.MODES, { NORMAL: "normal", EXPANDED: "expanded" });
});

test("workspace route parsing is session-local and deterministic", () => {
  assert.equal(Workspace.routeName(""), "start");
  assert.equal(Workspace.routeName("#start"), "start");
  assert.equal(Workspace.routeName("#Accessibility"), "accessibility");
  assert.equal(Workspace.routeName("#unknown-route"), "unknown-route");
});

test("grid height uses the available viewport without an arbitrary maximum", () => {
  assert.equal(Workspace.calculateGridHeight({
    viewportHeight: 1_000,
    gridTop: 260,
    footerHeight: 120,
    statusHeight: 32,
    bottomGap: 16,
    minimumHeight: 240,
  }), 572);

  assert.equal(Workspace.calculateGridHeight({
    viewportHeight: 1_800,
    gridTop: 140,
    footerHeight: 0,
    statusHeight: 32,
    bottomGap: 8,
    minimumHeight: 200,
  }), 1_620, "Very tall windows must not be capped at the CSV-2 height");

  assert.equal(Workspace.calculateGridHeight({
    viewportHeight: 420,
    gridTop: 360,
    footerHeight: 100,
    statusHeight: 40,
    minimumHeight: 240,
  }), 240, "Crowded layouts retain a usable minimum and allow page reflow");
});

test("Escape precedence protects dialogs, transient controls, and active editing", () => {
  assert.equal(Workspace.escapePriority({ mode: "expanded", dialogOpen: true }), "dialog");
  assert.equal(Workspace.escapePriority({ mode: "expanded", transientOpen: true }), "transient");
  assert.equal(Workspace.escapePriority({ mode: "expanded", interactionActive: true }), "interaction");
  assert.equal(Workspace.escapePriority({ mode: "expanded" }), "collapse");
  assert.equal(Workspace.escapePriority({ mode: "normal" }), "none");
});
