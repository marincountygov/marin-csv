/* Marin CSV CSV-3 workspace state and viewport sizing helpers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvWorkspaceState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODES = Object.freeze({ NORMAL: "normal", EXPANDED: "expanded" });

  function normalizeMode(value) {
    return value === MODES.EXPANDED ? MODES.EXPANDED : MODES.NORMAL;
  }

  function routeName(hash = "") {
    const normalized = String(hash || "").replace(/^#/, "").trim().toLowerCase();
    return normalized || "start";
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function calculateGridHeight(measurements = {}) {
    const viewportHeight = Math.max(1, finiteNumber(measurements.viewportHeight, 800));
    const gridTop = Math.max(0, finiteNumber(measurements.gridTop));
    const footerHeight = Math.max(0, finiteNumber(measurements.footerHeight));
    const statusHeight = Math.max(0, finiteNumber(measurements.statusHeight));
    const bottomGap = Math.max(0, finiteNumber(measurements.bottomGap, 16));
    const minimumHeight = Math.max(120, finiteNumber(measurements.minimumHeight, 280));
    const available = Math.floor(viewportHeight - gridTop - footerHeight - statusHeight - bottomGap);
    return Math.max(minimumHeight, available);
  }

  function escapePriority(context = {}) {
    if (context.dialogOpen) return "dialog";
    if (context.transientOpen) return "transient";
    if (context.interactionActive) return "interaction";
    if (normalizeMode(context.mode) === MODES.EXPANDED) return "collapse";
    return "none";
  }

  return {
    MODES,
    normalizeMode,
    routeName,
    calculateGridHeight,
    escapePriority,
    version: "0.1.0-csv3",
  };
});
