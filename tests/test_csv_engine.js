#!/usr/bin/env node

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");

const encode = (text, bom = false) => Engine.encodeUtf8(text, bom);
const decode = (bytes) => Engine.decodeUtf8(bytes).text;
const open = (text, options = {}) => Engine.CsvDocument.fromBytes(
  encode(text, Boolean(options.bom)),
  {
    filename: options.filename || "test.csv",
    delimiter: options.delimiter || "auto",
    headerMode: options.headerMode !== false,
    papa: options.papa,
  },
);

test("untouched export is byte-identical with UTF-8 BOM, CRLF, quotes, and no final newline", () => {
  const source = 'id,value,notes\r\n000123,"03-04","a,b"\r\n000124,1E10,"quote ""kept"""';
  const bytes = encode(source, true);
  const document = Engine.CsvDocument.fromBytes(bytes, { filename: "identifiers.csv" });
  assert.equal(document.bom, true);
  assert.equal(document.newline, "\r\n");
  assert.equal(document.trailingNewline, false);
  assert.ok(Engine.bytesEqual(document.exportBytes(), bytes));
  assert.notStrictEqual(document.exportBytes(), bytes, "export returns a copy, not the original typed array object");
  assert.equal(document.downloadName(), "identifiers-copy.csv");
});

test("all values remain strings without numeric, date, boolean, null, or formula conversion", () => {
  const document = open("id,zip,long,date_like,scientific,bool,nullish,formula\n000123,00901,12345678901234567890,03-04,1E10,TRUE,NULL,=SUM(A1:A2)\n");
  assert.deepEqual(document.rows[1].cells, [
    "000123",
    "00901",
    "12345678901234567890",
    "03-04",
    "1E10",
    "TRUE",
    "NULL",
    "=SUM(A1:A2)",
  ]);
  assert.ok(document.rows[1].cells.every((value) => typeof value === "string"));
  assert.equal(document.formulaLikeCells().length, 1);
  assert.ok(document.structuralWarnings().some((warning) => warning.code === "FORMULA_LIKE_VALUES"));
});

test("quoted delimiters, escaped quotes, and embedded CRLF are parsed exactly", () => {
  const document = open('a,b,c\r\n"one,two","quote ""inside""","line 1\r\nline 2"\r\n');
  assert.deepEqual(document.rows[1].cells, ["one,two", 'quote "inside"', "line 1\r\nline 2"]);
  assert.deepEqual(document.rows[1].quoteFlags, [true, true, true]);
});

test("tab-delimited files are detected deterministically and preserve literal commas", () => {
  const document = open("id\tvalue\tnote\n001\t03-04\ta,b\n", { filename: "sample.tsv" });
  assert.equal(document.delimiter, "\t");
  assert.deepEqual(document.rows[1].cells, ["001", "03-04", "a,b"]);
  assert.equal(document.metadata().delimiterName, "Tab");
});

test("the supported delimiter list drives names, labels, and download MIME types", () => {
  assert.deepEqual(Engine.supportedDelimiters().map(({ value, name, label, mimeType }) => ({
    value, name, label, mimeType,
  })), [
    { value: ",", name: "Comma", label: "Comma (,)", mimeType: "text/csv;charset=utf-8" },
    { value: "\t", name: "Tab", label: "Tab", mimeType: "text/tab-separated-values;charset=utf-8" },
    { value: ";", name: "Semicolon", label: "Semicolon (;)", mimeType: "text/plain;charset=utf-8" },
    { value: "|", name: "Pipe", label: "Pipe (|)", mimeType: "text/plain;charset=utf-8" },
  ]);
  assert.equal(Engine.delimiterMimeType(";"), "text/plain;charset=utf-8");
  assert.equal(Engine.delimiterMimeType("|"), "text/plain;charset=utf-8");
});

test("semicolon-delimited files preserve literal commas and quoted semicolons", () => {
  const document = open('id;amount;note\n001;1,23;"contains;semicolon"\n', {
    filename: "regional.csv",
  });
  assert.equal(document.delimiter, ";");
  assert.equal(document.metadata().delimiterName, "Semicolon");
  assert.deepEqual(document.rows[1].cells, ["001", "1,23", "contains;semicolon"]);
});

test("pipe-delimited files preserve quoted pipes and retain PSV filenames", () => {
  const source = 'id|value|note\n001|03-04|"contains | a pipe"\n';
  const document = open(source, { filename: "records.psv" });
  assert.equal(document.delimiter, "|");
  assert.equal(document.metadata().delimiterName, "Pipe");
  assert.deepEqual(document.rows[1].cells, ["001", "03-04", "contains | a pipe"]);
  document.setCell(1, 1, "changed|value");
  assert.equal(decode(document.exportBytes()), 'id|value|note\n001|"changed|value"|"contains | a pipe"\n');
  assert.equal(document.downloadName(), "records-edited.psv");
});

test("delimiter detection reports ambiguous and single-column files without repairing them", () => {
  const ambiguous = open("a,b;c\n1,2;3\n", { filename: "ambiguous.txt" });
  assert.equal(ambiguous.delimiter, ",");
  assert.ok(ambiguous.structuralWarnings().some((warning) => warning.code === "AMBIGUOUS_DELIMITER"));

  const oneColumn = open("plain text\nsecond line\n", { filename: "notes.txt" });
  assert.equal(oneColumn.delimiter, ",");
  assert.deepEqual(oneColumn.rows.map((row) => row.cells), [["plain text"], ["second line"]]);
  assert.ok(oneColumn.structuralWarnings().some((warning) => warning.code === "SINGLE_COLUMN"));

  const pipeHint = open("plain text\nsecond line\n", { filename: "notes.psv" });
  assert.equal(pipeHint.delimiter, "|");
});

test("a filename hint never overrides stronger delimiter structure", () => {
  const document = open("a,b,c\n1,2,3\n", { filename: "misnamed.psv" });
  assert.equal(document.delimiter, ",");
  assert.equal(document.rows[1].cells[2], "3");
});

test("explicit delimiter selection overrides filename and detection", () => {
  const document = open("a\tb\n1\t2\n", { filename: "misnamed.csv", delimiter: "," });
  assert.equal(document.delimiter, ",");
  assert.deepEqual(document.rows[0].cells, ["a\tb"]);
});

test("trailing empty fields, short records, and blank records remain distinct", () => {
  const document = open("A,B,C\n1,2,\n1,2\n\n");
  assert.deepEqual(document.rows.map((row) => row.cells), [
    ["A", "B", "C"],
    ["1", "2", ""],
    ["1", "2"],
    [""],
  ]);
  const inconsistent = document.structuralWarnings().filter((warning) => warning.code === "INCONSISTENT_COLUMNS");
  assert.equal(inconsistent.length, 2);
});

test("editing one row preserves other rows' raw representation and CRLF convention", () => {
  const source = 'id,value\r\n001,"plain"\r\n002,"quoted"\r\n';
  const document = open(source);
  const unchangedHeader = document.rows[0].raw;
  const unchangedThird = document.rows[2].raw;
  assert.equal(document.setCell(1, 1, "changed, value"), true);
  const output = decode(document.exportBytes());
  assert.equal(document.rows[0].raw, unchangedHeader);
  assert.equal(document.rows[2].raw, unchangedThird);
  assert.equal(output, 'id,value\r\n001,"changed, value"\r\n002,"quoted"\r\n');
  assert.equal(document.downloadName(), "test-edited.csv");
});

test("edited output retains an original BOM and no-final-newline choice", () => {
  const document = open("id,value\n001,old", { bom: true });
  document.setCell(1, 1, "new");
  const output = document.exportBytes();
  assert.equal(output[0], 0xef);
  assert.equal(output[1], 0xbb);
  assert.equal(output[2], 0xbf);
  assert.equal(decode(output), "id,value\n001,new");
});

test("undo restores exact original export and redo reapplies the change", () => {
  const source = "id,value\r\n001,old\r\n";
  const document = open(source);
  document.setCell(1, 1, "new");
  assert.equal(document.modifiedFromOpen, true);
  assert.equal(document.undo(), "Edit cell");
  assert.equal(document.modifiedFromOpen, false);
  assert.ok(Engine.bytesEqual(document.exportBytes(), encode(source)));
  assert.equal(document.redo(), "Edit cell");
  assert.equal(decode(document.exportBytes()), "id,value\r\n001,new\r\n");
});

test("a new edit after undo invalidates the former downloaded history branch", () => {
  const document = open("id,value\n1,a\n");
  document.setCell(1, 1, "b");
  document.setCell(1, 1, "c");
  document.markDownloaded();
  assert.equal(document.hasUndownloadedChanges, false);
  document.undo();
  document.setCell(1, 1, "different branch");
  assert.equal(document.historyIndex, 2);
  assert.equal(document.hasUndownloadedChanges, true);
  assert.equal(document.canRedo, false);
});

test("header mode is explicit and does not modify bytes", () => {
  const source = "first,second\n1,2\n";
  const document = open(source);
  assert.deepEqual(document.getHeaders(), ["first", "second"]);
  assert.equal(document.dataRowCount, 1);
  document.setHeaderMode(false);
  assert.deepEqual(document.getHeaders(), ["Column A", "Column B"]);
  assert.equal(document.dataRowCount, 2);
  assert.equal(document.modifiedFromOpen, false);
  assert.ok(Engine.bytesEqual(document.exportBytes(), encode(source)));
});

test("find and replace honors case, whole-cell, and first-row options", () => {
  const document = open("Name,Note\nAlpha,alpha beta\nalpha,ALPHA\n");
  assert.equal(document.findMatches("alpha", { caseSensitive: false, wholeCell: false, includeHeader: false }).length, 4);
  assert.equal(document.findMatches("alpha", { caseSensitive: true, wholeCell: true, includeHeader: false }).length, 1);
  assert.equal(document.replaceAll("alpha", "X", { caseSensitive: false, wholeCell: true, includeHeader: false }), 3);
  assert.deepEqual(document.rows.map((row) => row.cells), [
    ["Name", "Note"],
    ["X", "alpha beta"],
    ["X", "X"],
  ]);
  assert.equal(document.undo(), "Replace 3 matches");
});

test("excluding the first row works whether or not header mode is enabled", () => {
  const document = open("match,value\nmatch,1\n", { headerMode: false });
  assert.equal(document.findMatches("match", { includeHeader: false }).length, 1);
  assert.deepEqual(document.findMatches("match", { includeHeader: false })[0], {
    rowIndex: 1,
    columnIndex: 0,
    value: "match",
  });
});

test("row and column operations participate in undo and redo", () => {
  const document = open("A,B\n1,2\n");
  const row = document.addRow(2, ["3", "4"]);
  assert.equal(row, 2);
  const column = document.addColumn(1);
  assert.equal(column, 1);
  document.setCell(2, 1, "inserted");
  assert.deepEqual(document.rows[2].cells, ["3", "inserted", "4"]);
  assert.equal(document.deleteColumn(2), true);
  assert.deepEqual(document.rows[2].cells, ["3", "inserted"]);
  assert.equal(document.deleteRow(2), true);
  assert.equal(document.rows.length, 2);
  assert.equal(document.undo(), "Delete row");
  assert.deepEqual(document.rows[2].cells, ["3", "inserted"]);
  assert.equal(document.undo(), "Delete column");
  assert.deepEqual(document.rows[2].cells, ["3", "inserted", "4"]);
});

test("blank and duplicate headers warn without being repaired", () => {
  const document = open("Name,,Name\nA,B,C\n");
  const codes = document.structuralWarnings().map((warning) => warning.code);
  assert.ok(codes.includes("BLANK_HEADER"));
  assert.ok(codes.includes("DUPLICATE_HEADER"));
  assert.deepEqual(document.getHeaders(), ["Name", "", "Name"]);
});

test("mixed newline styles warn while unchanged rows retain their separators", () => {
  const document = open("A,B\r\n1,2\n3,4\r");
  assert.ok(document.structuralWarnings().some((warning) => warning.code === "MIXED_NEWLINES"));
  document.setCell(1, 1, "changed");
  assert.equal(decode(document.exportBytes()), "A,B\r\n1,changed\n3,4\r");
});

test("invalid UTF-8 and unclosed quotes fail rather than being silently repaired", () => {
  assert.throws(
    () => Engine.CsvDocument.fromBytes(new Uint8Array([0xc3, 0x28]), { filename: "bad.csv" }),
    (error) => error instanceof Engine.CsvError && error.code === "UNSUPPORTED_ENCODING",
  );
  assert.throws(
    () => open('a,b\n1,"unclosed\n'),
    (error) => error instanceof Engine.CsvError && error.code === "UNCLOSED_QUOTE",
  );
});

test("Papa Parse disagreement is recorded as a blocking validation result", () => {
  const fakePapa = {
    VERSION: "test",
    parse() {
      return { data: [["different"]], errors: [] };
    },
  };
  const document = open("a,b\n1,2\n", { papa: fakePapa });
  assert.equal(document.parserValidation.available, true);
  assert.equal(document.parserValidation.matched, false);
  assert.ok(document.structuralWarnings().some((warning) => warning.code === "PARSER_DISAGREEMENT"));
});

test("serialization quotes only when needed while retaining prior quote preference", () => {
  assert.equal(Engine.serializeField("plain", ",", false), "plain");
  assert.equal(Engine.serializeField("a,b", ",", false), '"a,b"');
  assert.equal(Engine.serializeField('a"b', ",", false), '"a""b"');
  assert.equal(Engine.serializeField(" padded ", ",", false), '" padded "');
  assert.equal(Engine.serializeField("plain", ",", true), '"plain"');
});

test("download names are always new files", () => {
  const document = open("a\n1\n", { filename: "source.tsv", delimiter: "\t" });
  assert.equal(document.downloadName(), "source-copy.tsv");
  document.setCell(1, 0, "2");
  assert.equal(document.downloadName(), "source-edited.tsv");
});

test("no-op bulk edits and unchanged header saves do not mark the document modified", () => {
  const source = "A,B\n1,2\n";
  const document = open(source);
  assert.equal(document.setCells([
    { rowIndex: 1, columnIndex: 0, value: "1" },
    { rowIndex: 1, columnIndex: 1, value: "2" },
  ]), 0);
  assert.equal(document.setHeaders(["A", "B"]), 0);
  assert.equal(document.modifiedFromOpen, false);
  assert.equal(document.hasUndownloadedChanges, false);
  assert.ok(Engine.bytesEqual(document.exportBytes(), encode(source)));
});

test("find replacement text is literal even when it contains JavaScript replacement tokens", () => {
  const document = open("A\nalpha alpha\n");
  assert.equal(document.replaceAll("alpha", "$&-$1-$$", { includeHeader: false }), 1);
  assert.equal(document.getCell(1, 0), "$&-$1-$$ $&-$1-$$");
});

test("undoing a branched edit all the way to the original has no undownloaded change", () => {
  const document = open("A\none\n");
  document.setCell(1, 0, "two");
  document.setCell(1, 0, "three");
  document.markDownloaded();
  document.undo();
  document.setCell(1, 0, "branch");
  assert.equal(document.hasUndownloadedChanges, true);
  document.undo();
  document.undo();
  assert.equal(document.historyIndex, 0);
  assert.equal(document.hasUndownloadedChanges, false);
});

test("Papa Parse exceptions become parser disagreement results instead of escaping", () => {
  const fakePapa = {
    VERSION: "test",
    parse() {
      throw new Error("synthetic parser failure");
    },
  };
  const document = open("a,b\n1,2\n", { papa: fakePapa });
  assert.equal(document.parserValidation.available, true);
  assert.equal(document.parserValidation.matched, false);
  assert.equal(document.parserValidation.errors[0].code, "PAPA_PARSE_EXCEPTION");
});

test("invalid edit coordinates are ignored and non-finite insert positions use safe defaults", () => {
  const document = open("A,B\n1,2\n");
  assert.equal(document.setCell(-1, 0, "x"), false);
  assert.equal(document.setCell(1, -1, "x"), false);
  assert.equal(document.setCell(1.5, 0, "x"), false);
  assert.equal(document.modifiedFromOpen, false);

  assert.equal(document.addRow(Number.NaN, ["3", "4"]), 2);
  assert.deepEqual(document.rows[2].cells, ["3", "4"]);
  assert.equal(document.addColumn(Number.POSITIVE_INFINITY), 2);
  assert.deepEqual(document.rows[0].cells, ["A", "B", ""]);
});

test("deleting a column preserves the raw representation of rows that never contained it", () => {
  const source = 'A,B,C\r\n"1","2"\r\n3,4,5\r\n';
  const document = open(source);
  const shortRaw = document.rows[1].raw;
  assert.equal(document.deleteColumn(2), true);
  assert.equal(document.rows[1].changed, false);
  assert.equal(document.rows[1].raw, shortRaw);
  assert.equal(decode(document.exportBytes()), 'A,B\r\n"1","2"\r\n3,4\r\n');
});
