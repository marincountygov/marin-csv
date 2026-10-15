"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");

function bytes(text) {
  return new TextEncoder().encode(text);
}

function text(documentModel) {
  return new TextDecoder().decode(documentModel.exportBytes());
}

test("recovery snapshots reconstruct edited documents without restoring undo history", () => {
  const source = bytes("id,value\r\n001,alpha\r\n002,beta\r\n");
  const documentModel = Engine.CsvDocument.fromBytes(source, { filename: "ids.csv" });
  documentModel.setCell(1, 1, "changed");
  documentModel.addRow(3, ["003", "gamma"]);
  documentModel.markDownloaded();
  documentModel.setCell(2, 1, "pending");
  documentModel.setHeaderMode(false);

  const snapshot = documentModel.toRecoverySnapshot();
  const recovered = Engine.documentFromRecoverySnapshot(snapshot, source);

  assert.equal(text(recovered), text(documentModel));
  assert.deepEqual(recovered.metadata(), documentModel.metadata());
  assert.equal(recovered.headerMode, false);
  assert.equal(recovered.canUndo, false);
  assert.equal(recovered.canRedo, false);
  assert.equal(recovered.modifiedFromOpen, true);
  assert.equal(recovered.hasUndownloadedChanges, true);
  assert.equal(recovered.downloadCount, 1);
});

test("normalized recovery events replay deterministic forward document changes", () => {
  const source = bytes("a,b,c\n1,2,3\n4,5,6\n");
  const initial = Engine.CsvDocument.fromBytes(source, { filename: "changes.csv" });
  const snapshot = initial.toRecoverySnapshot();
  const events = [];
  initial.subscribeRecovery((event) => events.push(event));

  initial.setCell(1, 1, "002");
  initial.setCells([
    { rowIndex: 2, columnIndex: 0, value: "004" },
    { rowIndex: 2, columnIndex: 2, value: "006" },
  ], "Paste 2 cells");
  initial.addRow(3, ["7", "8", "9"]);
  initial.deleteRow(2);
  initial.addColumn(1);
  initial.deleteColumn(3);
  initial.undo();
  initial.redo();
  initial.setHeaderMode(false);
  initial.markDownloaded();

  const replayed = Engine.documentFromRecoverySnapshot(snapshot, source);
  events.forEach((event) => replayed.applyRecoveryCommand(event.command, event.state));

  assert.equal(text(replayed), text(initial));
  assert.deepEqual(replayed.rows, initial.rows);
  assert.equal(replayed.headerMode, initial.headerMode);
  assert.equal(replayed.downloadCount, initial.downloadCount);
  assert.equal(replayed.hasUndownloadedChanges, initial.hasUndownloadedChanges);
  assert.equal(replayed.canUndo, false);
});

test("preview snapshots remain bounded and preserve exact source bytes", () => {
  const source = bytes("a,b\n1,2\n3,4\n5,6\n");
  const preview = Engine.CsvPreviewDocument.fromBytes(source, {
    filename: "preview.csv",
    previewDataRows: 1,
  });
  preview.setHeaderMode(false);
  preview.markDownloaded();
  const snapshot = preview.toRecoverySnapshot();
  const recovered = Engine.documentFromRecoverySnapshot(snapshot, source);

  assert.equal(recovered.preview, true);
  assert.equal(recovered.rows.length, preview.rows.length);
  assert.deepEqual(recovered.exportBytes(), source);
  assert.equal(recovered.headerMode, false);
  assert.equal(recovered.downloadCount, 1);
});

test("recovery snapshots retain semicolon and pipe delimiters without a format migration", () => {
  for (const [filename, delimiter, sourceText] of [
    ["regional.csv", ";", 'id;note\n001;"contains;semicolon"\n'],
    ["records.psv", "|", 'id|note\n001|"contains|pipe"\n'],
  ]) {
    const source = bytes(sourceText);
    const documentModel = Engine.CsvDocument.fromBytes(source, { filename, delimiter });
    documentModel.setCell(1, 1, `changed${delimiter}value`);
    const snapshot = documentModel.toRecoverySnapshot();
    const recovered = Engine.documentFromRecoverySnapshot(snapshot, source);

    assert.equal(snapshot.formatVersion, 1);
    assert.equal(recovered.delimiter, delimiter);
    assert.equal(recovered.metadata().delimiterName, delimiter === ";" ? "Semicolon" : "Pipe");
    assert.equal(text(recovered), text(documentModel));
  }
});

test("unsupported snapshots and journal commands fail explicitly", () => {
  const source = bytes("a\n1\n");
  assert.throws(
    () => Engine.documentFromRecoverySnapshot({ formatVersion: 99, kind: "full", rows: [] }, source),
    (error) => error.code === "UNSUPPORTED_RECOVERY_SNAPSHOT",
  );
  const documentModel = Engine.CsvDocument.fromBytes(source);
  assert.throws(
    () => documentModel.applyRecoveryCommand({ type: "unknown" }, {}),
    (error) => error.code === "UNSUPPORTED_RECOVERY_COMMAND",
  );
});
