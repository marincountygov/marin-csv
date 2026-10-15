/* Marin CSV CSV-2 evidence-based large-document policy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvLargeFilePolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MEBIBYTE = 1024 * 1024;
  const thresholds = Object.freeze({
    preflightBytes: 8 * MEBIBYTE,
    pagedRows: 5_000,
    pagedCells: 100_000,
    pagedColumns: 100,
    previewBytes: 24 * MEBIBYTE,
    previewRows: 250_000,
    previewCells: 1_500_000,
    previewColumns: 1_000,
    pageSize: 1_000,
    previewDataRows: 1_000,
  });

  function finiteInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
  }

  function normalizeStats(stats = {}) {
    const rows = finiteInteger(stats.rows ?? stats.rowCount);
    const columns = finiteInteger(stats.columns ?? stats.columnCount);
    const cells = finiteInteger(stats.cells ?? stats.cellCount) || rows * columns;
    const bytes = finiteInteger(stats.bytes ?? stats.byteLength);
    return { rows, columns, cells, bytes };
  }

  function reason(code, label, actual, limit) {
    return { code, label, actual, limit };
  }

  function classify(input = {}) {
    const stats = normalizeStats(input);
    const previewReasons = [];
    if (stats.bytes >= thresholds.previewBytes) {
      previewReasons.push(reason("bytes", "file bytes", stats.bytes, thresholds.previewBytes));
    }
    if (stats.rows >= thresholds.previewRows) {
      previewReasons.push(reason("rows", "rows", stats.rows, thresholds.previewRows));
    }
    if (stats.cells >= thresholds.previewCells) {
      previewReasons.push(reason("cells", "fields", stats.cells, thresholds.previewCells));
    }
    if (stats.columns >= thresholds.previewColumns) {
      previewReasons.push(reason("columns", "columns", stats.columns, thresholds.previewColumns));
    }
    if (previewReasons.length) {
      return Object.freeze({
        mode: "preview",
        readOnly: true,
        paged: true,
        pageSize: thresholds.previewDataRows,
        reasons: previewReasons,
        stats,
      });
    }

    const pagedReasons = [];
    if (stats.rows > thresholds.pagedRows) {
      pagedReasons.push(reason("rows", "rows", stats.rows, thresholds.pagedRows));
    }
    if (stats.cells > thresholds.pagedCells) {
      pagedReasons.push(reason("cells", "fields", stats.cells, thresholds.pagedCells));
    }
    if (stats.columns > thresholds.pagedColumns) {
      pagedReasons.push(reason("columns", "columns", stats.columns, thresholds.pagedColumns));
    }
    if (pagedReasons.length) {
      return Object.freeze({
        mode: "paged",
        readOnly: false,
        paged: true,
        pageSize: thresholds.pageSize,
        reasons: pagedReasons,
        stats,
      });
    }

    return Object.freeze({
      mode: "standard",
      readOnly: false,
      paged: false,
      pageSize: null,
      reasons: [],
      stats,
    });
  }

  function needsPreflight(byteLength) {
    return finiteInteger(byteLength) >= thresholds.preflightBytes;
  }

  function formatCount(value) {
    return finiteInteger(value).toLocaleString("en-US");
  }

  function describe(classification) {
    if (!classification || classification.mode === "standard") {
      return "Standard editing mode";
    }
    const first = classification.reasons?.[0];
    const trigger = first ? `${formatCount(first.actual)} ${first.label}` : "document complexity";
    return classification.mode === "preview"
      ? `Read-only preview mode (${trigger})`
      : `Paged editing mode (${trigger})`;
  }

  return {
    classify,
    describe,
    needsPreflight,
    normalizeStats,
    thresholds,
    version: "0.3.0-csv2",
  };
});
