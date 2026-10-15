/* Marin CSV CSV-2 same-origin parsing worker. */
"use strict";

importScripts(
  "../vendor/third-party/papaparse.min.js",
  "large-file-policy.js",
  "csv-engine.js",
);

const Engine = self.MarinCsvEngine;
const Policy = self.MarinCsvLargeFilePolicy;

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function progress(phase, message) {
  self.postMessage({ type: "progress", phase, message });
}

function stats(documentModel) {
  const metadata = documentModel.metadata();
  return {
    bytes: metadata.bytes,
    rows: metadata.rows,
    columns: metadata.columns,
    cells: metadata.cells,
  };
}

function errorRecord(error) {
  return {
    code: error?.code || "WORKER_PARSE_FAILED",
    message: error?.message || "Marin CSV could not parse this file in its local worker.",
    details: error?.details || {},
  };
}

self.addEventListener("message", (event) => {
  const request = event.data || {};
  if (request.type !== "parse") return;
  const started = now();
  try {
    if (!Engine || !Policy || !self.Papa) {
      throw new Error("The parsing worker could not load its reviewed local dependencies.");
    }
    const bytes = new Uint8Array(request.buffer);
    const options = request.options || {};
    const headerMode = options.headerMode !== false;
    progress("inspect", "Inspecting document size and structure");
    const inspectionStarted = now();
    const profile = Engine.profileBytes(bytes, {
      filename: options.filename,
      delimiter: options.delimiter,
      previewRowLimit: Policy.thresholds.previewDataRows + (headerMode ? 1 : 0),
    });
    const inspectionMs = now() - inspectionStarted;
    const preflightPolicy = Policy.classify({
      bytes: profile.originalBytes.byteLength,
      rows: profile.totalRows,
      columns: profile.maxColumns,
      cells: profile.totalCells,
    });
    if (preflightPolicy.mode === "preview") {
      progress("preview", "Preparing a read-only preview");
      const preview = Engine.CsvPreviewDocument.fromProfile(profile, { headerMode });
      const transfer = preview.toTransfer({ move: true });
      self.postMessage({
        type: "result",
        document: transfer,
        policy: preflightPolicy,
        metrics: { inspectionMs, parseMs: 0, totalMs: now() - started },
      }, [transfer.originalBytes.buffer]);
      return;
    }

    progress("parse", "Parsing and independently validating every field");
    const parseStarted = now();
    const sourceBytes = profile?.originalBytes || bytes;
    if (profile) profile.originalText = null;
    const fullDocument = Engine.CsvDocument.fromBytes(sourceBytes, {
      filename: options.filename,
      delimiter: options.delimiter,
      headerMode,
      papa: self.Papa,
    });
    const parseMs = now() - parseStarted;
    const classification = Policy.classify(stats(fullDocument));
    const documentModel = classification.mode === "preview"
      ? Engine.CsvPreviewDocument.fromDocument(fullDocument, {
        headerMode,
        previewDataRows: Policy.thresholds.previewDataRows,
      })
      : fullDocument;
    const transfer = documentModel.toTransfer({ move: true });
    self.postMessage({
      type: "result",
      document: transfer,
      policy: classification,
      metrics: { inspectionMs, parseMs, totalMs: now() - started },
    }, [transfer.originalBytes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", error: errorRecord(error) });
  }
});
