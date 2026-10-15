#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");
const Loader = require("../assets/document-loader.js");
const Papa = require("../vendor/third-party/papaparse.min.js");

function bytes(text, bom = false) {
  return Engine.encodeUtf8(text, bom);
}

test("profile scanner counts a full document while retaining only the requested preview rows", () => {
  const text = `id,value\r\n${Array.from({ length: 10_000 }, (_, index) => `${index},v${index}`).join("\r\n")}`;
  const profile = Engine.profileBytes(bytes(text), {
    filename: "large.csv",
    previewRowLimit: 4,
  });
  assert.equal(profile.totalRows, 10_001);
  assert.equal(profile.totalCells, 20_002);
  assert.equal(profile.maxColumns, 2);
  assert.equal(profile.previewRows.length, 4);
  assert.deepEqual(profile.previewRows[3].cells, ["2", "v2"]);
  assert.equal(profile.newline, "\r\n");
});

test("read-only preview retains exact bytes and reports total versus displayed rows", () => {
  const original = bytes("id,value\n001,alpha\n002,beta\n003,gamma\n", true);
  const preview = Engine.CsvPreviewDocument.fromBytes(original, {
    filename: "preview.csv",
    headerMode: true,
    previewDataRows: 2,
  });
  assert.equal(preview.readOnly, true);
  assert.equal(preview.preview, true);
  assert.equal(preview.dataRowCount, 3);
  assert.equal(preview.displayDataRowCount, 2);
  assert.equal(preview.previewTruncated, true);
  assert.equal(Engine.bytesEqual(preview.exportBytes(), original), true);
  assert.equal(preview.downloadName(), "preview-copy.csv");
  preview.markDownloaded();
  assert.equal(preview.downloadName(), "preview-copy-2.csv");
});

test("full and preview transfer records reconstruct without changing bytes or metadata", () => {
  const full = Engine.CsvDocument.fromBytes(bytes("id,value\r\n001,alpha\r\n"), {
    filename: "transfer.csv",
    papa: Papa,
  });
  const restoredFull = Engine.documentFromTransfer(full.toTransfer());
  assert.equal(restoredFull.constructor.name, "CsvDocument");
  assert.equal(Engine.bytesEqual(restoredFull.exportBytes(), full.exportBytes()), true);
  assert.deepEqual(restoredFull.metadata(), full.metadata());

  const preview = Engine.CsvPreviewDocument.fromDocument(full, { previewDataRows: 1 });
  const restoredPreview = Engine.documentFromTransfer(preview.toTransfer());
  assert.equal(restoredPreview.constructor.name, "CsvPreviewDocument");
  assert.equal(restoredPreview.readOnly, true);
  assert.equal(Engine.bytesEqual(restoredPreview.exportBytes(), full.exportBytes()), true);
});

test("repeated downloads receive deterministic new filenames", () => {
  const documentModel = Engine.CsvDocument.fromBytes(bytes("id\n001\n"), { filename: "records.csv" });
  assert.equal(documentModel.downloadName(), "records-copy.csv");
  documentModel.markDownloaded();
  assert.equal(documentModel.downloadName(), "records-copy-2.csv");
  documentModel.setCell(1, 0, "002");
  assert.equal(documentModel.downloadName(), "records-edited-2.csv");
  documentModel.markDownloaded();
  assert.equal(documentModel.downloadName(), "records-edited-3.csv");
});

test("empty, header-only, blank-record, null, and unusual Unicode content remain distinct", () => {
  const empty = Engine.CsvDocument.fromBytes(bytes(""), { filename: "empty.csv" });
  assert.equal(empty.rowCount, 0);
  assert.equal(empty.columnCount, 0);
  assert.equal(empty.serializeText(), "");

  const header = Engine.CsvDocument.fromBytes(bytes("id,name"), { filename: "header.csv" });
  assert.equal(header.dataRowCount, 0);
  assert.deepEqual(header.getHeaders(), ["id", "name"]);

  const source = "id,value\n1,\u0000\n\n2,👩🏽‍💻 é 漢字\n";
  const documentModel = Engine.CsvDocument.fromBytes(bytes(source), { filename: "unicode.csv" });
  assert.equal(documentModel.rows[1].cells[1], "\u0000");
  assert.deepEqual(documentModel.rows[2].cells, [""]);
  assert.equal(documentModel.rows[3].cells[1], "👩🏽‍💻 é 漢字");
  assert.equal(Engine.bytesEqual(documentModel.exportBytes(), bytes(source)), true);
});

test("profile scanner rejects an unclosed quote even outside the retained preview", () => {
  const source = `id,value\n1,ok\n${Array.from({ length: 20 }, (_, index) => `${index + 2},ok`).join("\n")}\n22,"broken`;
  assert.throws(
    () => Engine.profileBytes(bytes(source), { filename: "broken.csv", previewRowLimit: 2 }),
    (error) => error instanceof Engine.CsvError && error.code === "UNCLOSED_QUOTE",
  );
});

test("document loader selects standard, paged, and read-only modes deterministically", () => {
  const standard = Loader.parseDirect(bytes("id,value\n1,alpha\n"), {
    filename: "standard.csv",
    papa: Papa,
  });
  assert.equal(standard.policy.mode, "standard");
  assert.equal(standard.document.readOnly, false);

  const pagedText = `id,value\n${Array.from({ length: 5_001 }, (_, index) => `${index},value`).join("\n")}`;
  const paged = Loader.parseDirect(bytes(pagedText), { filename: "paged.csv", papa: Papa });
  assert.equal(paged.policy.mode, "paged");
  assert.equal(paged.document.readOnly, false);

  const wideHeader = Array.from({ length: 1_000 }, (_, index) => `c${index}`).join(",");
  const wideRow = Array.from({ length: 1_000 }, () => "v").join(",");
  const preview = Loader.parseDirect(bytes(`${wideHeader}\n${wideRow}\n`), {
    filename: "wide.csv",
    papa: Papa,
  });
  assert.equal(preview.policy.mode, "preview");
  assert.equal(preview.document.readOnly, true);
  assert.equal(preview.document.columnCount, 1_000);
});

test("large-file modes retain semicolon and pipe delimiters", () => {
  const pagedText = `id|value\n${Array.from({ length: 5_001 }, (_, index) => `${index}|v${index}`).join("\n")}`;
  const paged = Loader.parseDirect(bytes(pagedText), { filename: "paged.psv", papa: Papa });
  assert.equal(paged.policy.mode, "paged");
  assert.equal(paged.document.delimiter, "|");

  const wideHeader = Array.from({ length: 1_000 }, (_, index) => `c${index}`).join(";");
  const wideRow = Array.from({ length: 1_000 }, () => "v").join(";");
  const preview = Loader.parseDirect(bytes(`${wideHeader}\n${wideRow}\n`), {
    filename: "wide.csv",
    delimiter: ";",
    papa: Papa,
  });
  assert.equal(preview.policy.mode, "preview");
  assert.equal(preview.document.delimiter, ";");
});

test("small but row-dense files are profiled before full materialization", () => {
  const source = `id\n${"x\n".repeat(250_001)}`;
  const phases = [];
  const result = Loader.parseDirect(bytes(source), {
    filename: "dense.csv",
    papa: Papa,
  }, ({ phase }) => phases.push(phase));
  assert.equal(result.policy.mode, "preview");
  assert.equal(result.document.readOnly, true);
  assert.equal(result.document.dataRowCount, 250_001);
  assert.equal(result.document.displayDataRowCount, 1_000);
  assert.deepEqual(phases, ["inspect", "preview"]);
});

test("full-document warning collection remains bounded for highly irregular files", () => {
  const regular = Array.from({ length: 60 }, (_, index) => `${index},value`);
  const irregular = Array.from({ length: 60 }, (_, index) => `short-${index}`);
  const documentModel = Engine.CsvDocument.fromBytes(bytes(["id,value", ...regular, ...irregular].join("\n")), {
    filename: "irregular.csv",
  });
  assert.equal(documentModel.warnings.filter((warning) => warning.code === "INCONSISTENT_COLUMNS").length, 50);
  assert.equal(documentModel.warnings.filter((warning) => warning.code === "ADDITIONAL_INCONSISTENT_COLUMNS").length, 1);
});

test("transfer records copy by default and can adopt worker-owned structures", () => {
  const full = Engine.CsvDocument.fromBytes(bytes("id,value\n001,alpha\n"), {
    filename: "transfer-copy.csv",
    papa: Papa,
  });
  const copied = full.toTransfer();
  assert.notStrictEqual(copied.originalBytes, full.originalBytes);
  assert.notStrictEqual(copied.rows, full.rows);
  assert.notStrictEqual(copied.rows[0], full.rows[0]);
  const moved = full.toTransfer({ move: true });
  assert.strictEqual(moved.originalBytes, full.originalBytes);
  assert.strictEqual(moved.rows, full.rows);
  assert.strictEqual(moved.warnings, full.warnings);
  const restoredFull = Engine.documentFromTransfer(moved);
  assert.strictEqual(restoredFull.originalBytes, moved.originalBytes);
  assert.strictEqual(restoredFull.rows, moved.rows);

  const preview = Engine.CsvPreviewDocument.fromDocument(full, { previewDataRows: 1 });
  const previewMoved = preview.toTransfer({ move: true });
  assert.strictEqual(previewMoved.originalBytes, preview.originalBytes);
  assert.strictEqual(previewMoved.rows, preview.rows);
  const restoredPreview = Engine.documentFromTransfer(previewMoved);
  assert.strictEqual(restoredPreview.originalBytes, previewMoved.originalBytes);
  assert.strictEqual(restoredPreview.rows, previewMoved.rows);
});
