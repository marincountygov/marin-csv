#!/usr/bin/env node

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");
const Papa = require("../vendor/third-party/papaparse.min.js");

function open(text, options = {}) {
  return Engine.CsvDocument.fromBytes(Engine.encodeUtf8(text, Boolean(options.bom)), {
    filename: options.filename || "integration.csv",
    delimiter: options.delimiter || "auto",
    headerMode: options.headerMode !== false,
    papa: Papa,
  });
}

test("vendored Papa Parse independently agrees on preservation-sensitive CSV fields", () => {
  const source = [
    "id,zip,long,date_like,scientific,formula,notes,blank",
    '000123,00901,12345678901234567890,03-04,1E10,"=SUM(A1:A2)","Comma, quote ""and"" line one',
    'line two",',
    "000124,02108,00000000001234567890,01-02,9E3,@example,,",
    "",
  ].join("\r\n");
  const documentModel = open(source, { bom: true });

  assert.equal(documentModel.parserValidation.available, true);
  assert.equal(documentModel.parserValidation.matched, true);
  assert.deepEqual(documentModel.parserValidation.errors, []);
  assert.equal(documentModel.rows[1].cells[0], "000123");
  assert.equal(documentModel.rows[1].cells[2], "12345678901234567890");
  assert.equal(documentModel.rows[1].cells[3], "03-04");
  assert.equal(documentModel.rows[1].cells[4], "1E10");
  assert.equal(documentModel.rows[1].cells[5], "=SUM(A1:A2)");
  assert.equal(documentModel.rows[1].cells[6], "Comma, quote \"and\" line one\r\nline two");
  assert.ok(documentModel.rows.flatMap((row) => row.cells).every((value) => typeof value === "string"));
});

test("current-document validation agrees after quoted and multiline edits", () => {
  const documentModel = open('id,notes\r\n001,"Line one\r\nLine two"\r\n');
  assert.equal(documentModel.setCell(1, 1, 'Changed, with "quote"\r\nLine two'), true);

  const validation = documentModel.validateCurrentWithPapa(Papa);
  assert.equal(validation.available, true);
  assert.equal(validation.matched, true);
  assert.deepEqual(validation.errors, []);
  assert.match(documentModel.serializeText(), /"Changed, with ""quote""\r\nLine two"/);
});

test("tab-delimited validation preserves commas and text-like values", () => {
  const documentModel = open("id\tvalue\tnote\n001\t03-04\ta,b\n002\t00001\t1E10\n", {
    filename: "integration.tsv",
  });
  assert.equal(documentModel.delimiter, "\t");
  assert.equal(documentModel.parserValidation.matched, true);
  assert.deepEqual(documentModel.rows[1].cells, ["001", "03-04", "a,b"]);
  assert.deepEqual(documentModel.validateCurrentWithPapa(Papa).errors, []);
});

test("Papa Parse disagreement and errors remain blocking evidence", () => {
  const documentModel = open('a,b\n1,"x"y\n');
  assert.equal(documentModel.parserValidation.available, true);
  assert.equal(documentModel.parserValidation.matched, false);
  assert.ok(documentModel.parserValidation.errors.length >= 1);
  assert.ok(documentModel.structuralWarnings().some((warning) => warning.code === "PARSER_DISAGREEMENT"));
});

test("validation explicitly reports unavailable when Papa Parse is absent", () => {
  const documentModel = Engine.CsvDocument.fromBytes(Engine.encodeUtf8("a,b\n1,2\n"), {
    filename: "no-papa.csv",
  });
  assert.deepEqual(documentModel.validateCurrentWithPapa(null), {
    available: false,
    matched: null,
    errors: [],
    version: null,
  });
});

test("deterministic generated records for every supported delimiter agree across newline styles", () => {
  let seed = 0x4d415249;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const values = [
    "", "plain", "000123", "03-04", "1E10", "TRUE", "NULL",
    "comma,value", "tab\tvalue", "semicolon;value", "pipe|value", 'quote"value', "line\nfeed",
    "line\rfeed", "line\r\npair", " leading", "trailing ", "=SUM(A1:A2)",
  ];

  const filenames = new Map([[",", "generated.csv"], ["\t", "generated.tsv"], [";", "generated.csv"], ["|", "generated.psv"]]);
  for (const delimiter of Engine.supportedDelimiters().map((definition) => definition.value)) {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const expected = Array.from({ length: 40 }, () => (
        Array.from({ length: 8 }, () => values[Math.floor(random() * values.length)])
      ));
      const source = expected.map((cells, rowIndex) => Engine.serializeRow({
        cells,
        quoteFlags: cells.map((_value, columnIndex) => (rowIndex + columnIndex) % 5 === 0),
      }, delimiter)).join(newline) + newline;
      const documentModel = open(source, {
        filename: filenames.get(delimiter),
        delimiter,
        headerMode: false,
      });

      assert.equal(documentModel.parserValidation.matched, true,
        `Parser mismatch for ${JSON.stringify(delimiter)} and ${JSON.stringify(newline)}`);
      assert.deepEqual(documentModel.rows.map((row) => row.cells), expected);
      documentModel.setCell(5, 3, `changed${delimiter}value${newline}line`);
      const validation = documentModel.validateCurrentWithPapa(Papa);
      assert.equal(validation.matched, true);
      assert.deepEqual(validation.errors, []);
    }
  }
});
