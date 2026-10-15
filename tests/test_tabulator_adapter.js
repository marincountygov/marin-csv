#!/usr/bin/env node

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {
      values: new Map(),
      setProperty(name, value) { this.values.set(name, String(value)); },
      removeProperty(name) { this.values.delete(name); },
    };
    this.classList = new FakeClassList();
    this.value = "";
    this.type = "";
    this.className = "";
    this.focused = false;
    this.clicked = 0;
    this.selected = false;
    this.rows = 1;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const remaining = (this.listeners.get(type) || []).filter((candidate) => candidate !== listener);
    if (remaining.length) this.listeners.set(type, remaining);
    else this.listeners.delete(type);
  }

  dispatch(type, event = {}) {
    const payload = {
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  replaceChildren() {}

  contains() {
    return true;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return { left: 100, top: 50, width: 120, height: 30, right: 220, bottom: 80 };
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked += 1;
  }

  select() {
    this.selected = true;
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }

  setRangeText(replacement, start, end, selectionMode = "preserve") {
    this.value = `${this.value.slice(0, start)}${replacement}${this.value.slice(end)}`;
    const replacementEnd = start + replacement.length;
    if (selectionMode === "end") {
      this.selectionStart = replacementEnd;
      this.selectionEnd = replacementEnd;
    }
  }
}

class FakeHTMLElement extends FakeElement {}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.document = {
  createElement(tagName) {
    return new FakeElement(tagName);
  },
};

const Adapter = require("../assets/tabulator-adapter.js");

function open(text) {
  return Engine.CsvDocument.fromBytes(Engine.encodeUtf8(text), {
    filename: "adapter.csv",
    headerMode: true,
  });
}

class FakeTabulator {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.handlers = new Map();
    this.filter = null;
    this.sorters = [];
    this.clearFilterCalls = 0;
    this.destroyed = false;
    this.height = options.height;
    this.redrawCalls = 0;
    this.deselectRangeCalls = 0;
    this.rows = options.data.map((record) => ({
      getData: () => record,
      getCell: () => null,
    }));
  }

  on(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(handler);
  }

  fire(name, ...args) {
    for (const handler of this.handlers.get(name) || []) handler(...args);
  }

  destroy() {
    this.destroyed = true;
  }

  clearFilter() {
    this.clearFilterCalls += 1;
    this.filter = null;
  }

  setFilter(filter) {
    this.filter = filter;
  }

  setSort(sorters) {
    this.sorters = sorters;
  }

  setHeight(height) {
    this.height = height;
  }

  redraw() {
    this.redrawCalls += 1;
  }

  getRows() {
    return this.rows;
  }

  deselectRange() {
    this.deselectRangeCalls += 1;
  }
}

function fakeCell(documentIndex = 1, columnIndex = 0, value = "000999") {
  const element = new FakeElement("div");
  const rowData = { __documentIndex: documentIndex };
  const row = {
    getData: () => rowData,
    scrollTo: () => undefined,
  };
  const cell = {
    getRow: () => row,
    getField: () => `c${columnIndex}`,
    getValue: () => value,
    getElement: () => element,
    edit() {
      cell.edited = (cell.edited || 0) + 1;
    },
  };
  return { cell, rowData, element };
}

function renderEditor(column, value) {
  const completed = [];
  const cancelled = [];
  let rendered;
  const editor = column.editor(
    { getValue: () => value },
    (callback) => { rendered = callback; },
    (result) => completed.push(result),
    () => cancelled.push(true),
    column.editorParams,
  );
  rendered();
  return { editor, completed, cancelled };
}

test("dependency report requires exact vendored Papa Parse and Tabulator releases", () => {
  const complete = {
    MarinCsvVendor: { phase: "vendored", papaParse: "5.7.0", tabulator: "6.6.1" },
    Papa: { parse() {} },
    Tabulator() {},
  };
  assert.deepEqual(Adapter.dependencyReport(complete).problems, []);
  assert.equal(Adapter.dependencyReport(complete).available, true);

  const missing = Adapter.dependencyReport({ MarinCsvVendor: { phase: "csv-0-reference" } });
  assert.equal(missing.available, false);
  assert.ok(missing.problems.some((problem) => problem.includes("vendored mode")));
  assert.ok(missing.problems.some((problem) => problem.includes("Papa Parse 5.7.0 did not load")));
  assert.ok(missing.problems.some((problem) => problem.includes("Tabulator 6.6.1 did not load")));
});

test("Tabulator adapter uses text-only columns, plaintext headers, range copying, and a row header", () => {
  const container = new FakeHTMLElement();
  const documentModel = open("id,zip,long\n000123,00901,12345678901234567890\n");
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(documentModel);

  const options = grid.table.options;
  assert.equal(options.data.length, 1);
  assert.deepEqual([options.data[0].c0, options.data[0].c1, options.data[0].c2], [
    "000123", "00901", "12345678901234567890",
  ]);
  assert.ok([options.data[0].c0, options.data[0].c1, options.data[0].c2]
    .every((value) => typeof value === "string"));

  assert.equal(options.columns.length, 3);
  assert.ok(options.columns.every((column) => column.titleFormatter === "plaintext"));
  assert.ok(options.columns.every((column) => column.formatter === "textarea"));
  assert.ok(options.columns.every((column) => typeof column.editor === "function"));
  assert.ok(options.columns.every((column) => column.sorter === "string"));
  assert.ok(options.columns.every((column) => column.headerSort === true));
  assert.equal(options.rowHeader.title, "Row");
  assert.equal(options.rowHeader.titleFormatter, "plaintext");
  assert.equal(options.rowHeader.formatter, "plaintext");
  assert.equal(options.rowHeader.editor, false);
  assert.equal(options.rowHeader.frozen, undefined,
    "Tabulator's rowHeader option is already frozen and must not trigger a range warning");
  assert.equal(options.maxHeight, undefined);
  assert.equal(options.minHeight, "120px");
  assert.equal(options.height, "760px",
    "The adapter should retain a deterministic fallback until the workspace is measured");

  assert.equal(options.selectableRange, 1);
  assert.equal(options.selectableRangeColumns, false);
  assert.equal(options.selectableRangeRows, false);
  assert.equal(options.selectableRangeClearCells, false);
  assert.equal(options.clipboard, "copy");
  assert.equal(options.clipboardCopyRowRange, "range");
  assert.equal(options.clipboardCopyStyled, false);
  assert.deepEqual(options.clipboardCopyConfig, {
    rowHeaders: false,
    columnHeaders: false,
    columnGroups: false,
    rowGroups: false,
    columnCalcs: false,
    dataTree: false,
    formatCells: false,
  });

  assert.equal(grid.ready, false);
  assert.equal(grid.table.clearFilterCalls, 0,
    "Tabulator methods must not run before the asynchronous tableBuilt event");
  grid.table.fire("tableBuilt");
  assert.equal(grid.ready, true);
  assert.equal(grid.table.clearFilterCalls, 1);
  assert.equal(container.getAttribute("aria-label"), "adapter.csv data editor");
  assert.equal(container.getAttribute("aria-rowcount"), "2");
  assert.equal(container.getAttribute("aria-colcount"), "4");
});

test("viewport resizing updates Tabulator without rebuilding the document", () => {
  const container = new FakeHTMLElement();
  const documentModel = open("id,value\n001,alpha\n002,beta\n");
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setViewportHeight(640, { redraw: false });
  grid.setDocument(documentModel);
  assert.equal(grid.table.options.height, "640px");

  const table = grid.table;
  const result = grid.setViewportHeight(880);
  assert.equal(result, 880);
  assert.equal(grid.table, table, "Workspace resizing must not reconstruct Tabulator");
  assert.equal(table.height, "880px");
  assert.equal(table.redrawCalls, 1);
  assert.equal(container.style.values.get("--csv-grid-height"), "880px");
  assert.equal(grid.getActiveCell(), null);

  assert.equal(grid.setViewportHeight(Number.POSITIVE_INFINITY), 880);
  assert.equal(grid.setViewportHeight("not-a-height"), 880);
  assert.equal(table.height, "880px", "Invalid heights must leave the live grid unchanged");
  assert.equal(table.redrawCalls, 1);
});

test("custom cell editor preserves multiline line endings and commits only explicit changes", () => {
  const container = new FakeHTMLElement();
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(open("id,notes\r\n001,\"Line one\r\nLine two\"\r\n"));
  const column = grid.table.options.columns[1];

  const single = renderEditor(column, "000123");
  assert.equal(single.editor.tagName, "TEXTAREA");
  assert.equal(single.editor.value, "000123");
  assert.match(single.editor.getAttribute("aria-label"), /Enter saves/);
  assert.match(single.editor.getAttribute("aria-label"), /Alt\+Enter adds a line/);
  assert.equal(single.editor.dataset.multiline, undefined);
  assert.equal(single.editor.focused, true);
  assert.equal(single.editor.selected, true);
  single.editor.value = "000999";
  single.editor.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(single.completed, ["000999"]);
  assert.deepEqual(single.cancelled, []);

  const promoted = renderEditor(column, "000123");
  promoted.editor.selectionStart = 3;
  promoted.editor.selectionEnd = 3;
  promoted.editor.dispatch("keydown", { key: "Enter", altKey: true });
  assert.equal(promoted.editor.value, "000\n123");
  assert.equal(promoted.editor.dataset.multiline, "true");
  assert.match(promoted.editor.getAttribute("aria-label"), /Shift\+Enter saves/);
  promoted.editor.dispatch("keydown", { key: "Enter", shiftKey: true });
  assert.deepEqual(promoted.completed, ["000\r\n123"],
    "A new multiline value should use the document's CRLF convention");

  const pastedMultiline = renderEditor(column, "plain");
  pastedMultiline.editor.value = "first\nsecond";
  pastedMultiline.editor.dispatch("input");
  assert.equal(pastedMultiline.editor.dataset.multiline, "true");
  pastedMultiline.editor.dispatch("keydown", { key: "Enter", shiftKey: true });
  assert.deepEqual(pastedMultiline.completed, ["first\r\nsecond"]);

  for (const [source, expected] of [
    ["id,notes\n001,plain\n", "plain\nnext"],
    ["id,notes\r001,plain\r", "plain\rnext"],
  ]) {
    const conventionGrid = new Adapter.TabulatorGrid(new FakeHTMLElement(), {}, FakeTabulator);
    conventionGrid.setDocument(open(source));
    const conventionEditor = renderEditor(conventionGrid.table.options.columns[1], "plain");
    conventionEditor.editor.selectionStart = conventionEditor.editor.value.length;
    conventionEditor.editor.selectionEnd = conventionEditor.editor.value.length;
    conventionEditor.editor.dispatch("keydown", { key: "Enter", altKey: true });
    conventionEditor.editor.value += "next";
    conventionEditor.editor.dispatch("keydown", { key: "Enter", shiftKey: true });
    assert.deepEqual(conventionEditor.completed, [expected],
      "New multiline text must use the source document's retained newline style");
  }

  const noOp = renderEditor(column, "Line one\r\nLine two");
  assert.equal(noOp.editor.tagName, "TEXTAREA");
  assert.equal(noOp.editor.value, "Line one\nLine two");
  assert.match(noOp.editor.getAttribute("aria-label"), /Shift\+Enter saves/);
  noOp.editor.dispatch("keydown", { key: "Enter", shiftKey: true });
  assert.deepEqual(noOp.completed, ["Line one\r\nLine two"],
    "Opening and committing an unchanged textarea must not normalize CRLF to LF");

  const edited = renderEditor(column, "Line one\r\nLine two");
  edited.editor.value = "Changed one\nLine two\nLine three";
  edited.editor.dispatch("keydown", { key: "Enter", shiftKey: true });
  assert.deepEqual(edited.completed, ["Changed one\r\nLine two\r\nLine three"],
    "Intentional multiline edits should retain the field's existing newline convention");

  const aborted = renderEditor(column, "unchanged");
  aborted.editor.value = "discarded";
  aborted.editor.dispatch("keydown", { key: "Escape" });
  assert.deepEqual(aborted.completed, []);
  assert.deepEqual(aborted.cancelled, [true]);
  aborted.editor.dispatch("blur");
  assert.deepEqual(aborted.completed, [], "Blur after cancellation must not commit");
});

test("Tabulator events report edits and range focus by physical document coordinates", () => {
  const container = new FakeHTMLElement();
  const documentModel = open("id,value\n001,old\n002,other\n");
  const changes = [];
  const active = [];
  const grid = new Adapter.TabulatorGrid(container, {
    onCellChange: (...args) => changes.push(args),
    onActiveCell: (cell) => active.push(cell),
  }, FakeTabulator);
  grid.setDocument(documentModel);

  const edit = fakeCell(2, 1, "changed");
  grid.table.fire("cellEdited", edit.cell);
  assert.deepEqual(changes, [[2, 1, "changed"]]);
  assert.deepEqual(active.at(-1), { rowIndex: 2, columnIndex: 1 });

  const rangeCell = fakeCell(1, 0, "001").cell;
  grid.table.fire("rangeAdded", { getBounds: () => ({ start: rangeCell, end: rangeCell }) });
  assert.deepEqual(grid.getActiveCell(), { rowIndex: 1, columnIndex: 0 });
  grid.table.fire("rangeChanged", { getBounds: () => ({ start: edit.cell, end: edit.cell }) });
  assert.deepEqual(grid.getActiveCell(), { rowIndex: 2, columnIndex: 1 });

  grid.table.fire("dataSorted", [{ field: "c1", dir: "desc" }, { field: "__rowId", dir: "asc" }]);
  assert.deepEqual(grid.sorters, [{ column: "c1", dir: "desc" }]);
});

test("Tabulator paste is intercepted and routed to the preservation-engine callback", () => {
  const container = new FakeHTMLElement();
  const pasted = [];
  const grid = new Adapter.TabulatorGrid(container, {
    onPasteBlock: (...args) => pasted.push(args),
  }, FakeTabulator);
  grid.setDocument(open("id,value\n001,old\n"));
  const active = fakeCell(1, 1, "old").cell;
  grid.table.fire("cellClick", {}, active);

  let prevented = false;
  container.dispatch("paste", {
    target: { closest: () => null },
    clipboardData: { getData: (type) => type === "text/plain" ? "new\tvalue" : "" },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(pasted, [[1, 1, "new\tvalue"]]);

  container.dispatch("paste", {
    target: { closest: () => ({ tagName: "INPUT" }) },
    clipboardData: { getData: () => "editor text" },
    preventDefault: () => assert.fail("Native editor paste must not be intercepted"),
  });
  assert.equal(pasted.length, 1);
});

test("filtering waits for tableBuilt, ignores adapter metadata, and clearing restores rows", () => {
  const container = new FakeHTMLElement();
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(open("id,value\n001,Alpha\n002,Beta\n"));

  grid.setFilter("alpha");
  assert.equal(grid.table.filter, null, "Filtering must wait for Tabulator initialization");
  grid.table.fire("tableBuilt");
  assert.equal(typeof grid.table.filter, "function");
  assert.equal(grid.table.filter({ __rowId: "alpha", c0: "001", c1: "Alpha" }), true);
  assert.equal(grid.table.filter({ __rowId: "alpha", c0: "001", c1: "Beta" }), false);

  const clearCalls = grid.table.clearFilterCalls;
  grid.setFilter("");
  assert.equal(grid.table.clearFilterCalls, clearCalls + 1);
});

test("exact value filtering combines with the global text filter without changing document data", () => {
  const container = new FakeHTMLElement();
  const documentModel = open("id,status,notes\n001,Active,Alpha\n002,active,Alpha\n003,Active,Beta\n004,,Alpha\n");
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(documentModel);
  grid.table.fire("tableBuilt");

  assert.equal(grid.setValueFilter(1, "Active"), true);
  assert.deepEqual(grid.getValueFilter(), { columnIndex: 1, value: "Active" });
  assert.equal(grid.table.filter({ c0: "001", c1: "Active", c2: "Alpha" }), true);
  assert.equal(grid.table.filter({ c0: "002", c1: "active", c2: "Alpha" }), false,
    "Exact value matching must remain case-sensitive");

  grid.setFilter("alpha");
  assert.equal(grid.table.filter({ c0: "001", c1: "Active", c2: "Alpha" }), true);
  assert.equal(grid.table.filter({ c0: "003", c1: "Active", c2: "Beta" }), false,
    "Global text and exact-value filters must combine with AND semantics");

  grid.setFilter("");
  grid.setValueFilter(1, "");
  assert.equal(grid.table.filter({ c0: "004", c1: "", c2: "Alpha" }), true,
    "Blank values must be filterable");
  assert.equal(grid.clearValueFilter(), true);
  assert.equal(grid.getValueFilter(), null);
  assert.deepEqual(documentModel.exportBytes(), Engine.encodeUtf8("id,status,notes\n001,Active,Alpha\n002,active,Alpha\n003,Active,Beta\n004,,Alpha\n"));
});

test("exact value filter coordinates follow column insertion and deletion", () => {
  const grid = new Adapter.TabulatorGrid(new FakeHTMLElement(), {}, FakeTabulator);
  grid.setDocument(open("id,status\n001,Active\n"));
  grid.table.fire("tableBuilt");
  grid.setValueFilter(1, "Active");
  assert.deepEqual(grid.adjustValueFilterForColumnInsert(1), { columnIndex: 2, value: "Active" });
  assert.deepEqual(grid.adjustValueFilterForColumnDelete(0), { columnIndex: 1, value: "Active" });
  assert.equal(grid.adjustValueFilterForColumnDelete(1), null);
});

test("cell context events expose stable physical targets and programmatic editing", () => {
  const container = new FakeHTMLElement();
  const requests = [];
  const grid = new Adapter.TabulatorGrid(container, {
    onContextMenu: (target) => {
      requests.push(target);
      return true;
    },
  }, FakeTabulator);
  const documentModel = open("id,status\n001,Active\n002,Inactive\n");
  grid.setDocument(documentModel);
  grid.table.fire("tableBuilt");

  const target = fakeCell(2, 1, "Inactive");
  const row = {
    getData: () => ({ __documentIndex: 2 }),
    getCell: (field) => field === "c1" ? target.cell : null,
  };
  grid.table.rows = [row];
  let prevented = 0;
  let stopped = 0;
  grid.table.fire("cellContext", {
    clientX: 420,
    clientY: 310,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  }, target.cell);

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(grid.table.deselectRangeCalls, 1);
  assert.deepEqual(requests[0], {
    rowId: documentModel.rows[2].id,
    rowIndex: 2,
    columnIndex: 1,
    value: "Inactive",
    columnName: "status",
    source: "pointer",
    clientX: 420,
    clientY: 310,
  });

  grid.table.fire("cellTapHold", {
    preventDefault: () => {},
    stopPropagation: () => {},
  }, target.cell);
  assert.equal(requests[1].source, "touch");

  target.element.dataset.documentRowIndex = "2";
  target.element.dataset.columnIndex = "1";
  let keyboardPrevented = 0;
  container.dispatch("keydown", {
    key: "ContextMenu",
    target: { closest: () => target.element },
    preventDefault: () => { keyboardPrevented += 1; },
    stopPropagation: () => {},
  });
  assert.equal(keyboardPrevented, 1);
  assert.equal(requests[2].source, "keyboard");
  assert.equal(requests[2].clientX, 132);
  assert.equal(requests[2].clientY, 65);
  assert.equal(grid.editCell(2, 1), true);
  assert.equal(target.cell.edited, 1);
});

test("focus restoration waits for tableBuilt and destroy removes all host listeners", () => {
  const container = new FakeHTMLElement();
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(open("id,value\n001,old\n"));
  const focusCell = fakeCell(1, 1, "old");
  const row = {
    getData: () => ({ __documentIndex: 1 }),
    getCell: (field) => field === "c1" ? focusCell.cell : null,
  };
  grid.table.rows = [row];

  grid.requestFocus(1, 1);
  assert.equal(focusCell.element.focused, false);
  grid.table.fire("tableBuilt");
  assert.equal(focusCell.element.focused, true);
  assert.equal(focusCell.element.clicked, 0,
    "Focus restoration must not synthesize a click with unrelated UI side effects");
  assert.deepEqual(grid.getActiveCell(), { rowIndex: 1, columnIndex: 1 });

  const table = grid.table;
  grid.destroy();
  assert.equal(table.destroyed, true);
  assert.equal(container.listeners.has("paste"), false);
  assert.equal(container.listeners.has("focusin"), false);
  assert.equal(container.listeners.has("keydown"), false);
  assert.equal(container.listeners.has("scroll"), false);
});

test("paged mode renders a bounded physical slice and keeps sort/filter disabled", async () => {
  const source = `id,value\n${Array.from({ length: 2_005 }, (_, index) => `${index},v${index}`).join("\n")}\n`;
  const documentModel = open(source);
  const container = new FakeHTMLElement();
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  const firstReady = grid.setDocument(documentModel, {
    mode: "paged",
    pageSize: 1_000,
    pageIndex: 0,
    disableSortFilter: true,
  });

  assert.equal(grid.table.options.data.length, 1_000);
  assert.equal(grid.table.options.data[0].__documentIndex, 1);
  assert.equal(grid.table.options.data.at(-1).__documentIndex, 1_000);
  assert.ok(grid.table.options.columns.every((column) => column.headerSort === false));
  assert.equal(grid.setFilter("v1"), false);
  assert.deepEqual(grid.pageInfo(), {
    pageIndex: 0,
    pageNumber: 1,
    pageCount: 3,
    pageSize: 1_000,
    start: 0,
    end: 1_000,
    visibleRows: 1_000,
    availableRows: 2_005,
    totalDocumentRows: 2_005,
  });
  grid.table.fire("tableBuilt");
  await firstReady;

  const secondReady = grid.setPage(1);
  assert.equal(grid.table.options.data.length, 1_000);
  assert.equal(grid.table.options.data[0].__documentIndex, 1_001);
  assert.equal(grid.table.options.data.at(-1).__documentIndex, 2_000);
  assert.match(container.getAttribute("aria-label"), /page 2 of 3/);
  grid.table.fire("tableBuilt");
  const page = await secondReady;
  assert.equal(page.pageNumber, 2);
  assert.equal(page.start, 1_000);
  assert.equal(page.end, 2_000);
});

test("read-only preview exposes only retained rows and disables every cell editor", () => {
  const source = `id,value\n${Array.from({ length: 8 }, (_, index) => `${index},v${index}`).join("\n")}\n`;
  const preview = Engine.CsvPreviewDocument.fromBytes(Engine.encodeUtf8(source), {
    filename: "preview.csv",
    headerMode: true,
    previewDataRows: 3,
  });
  const container = new FakeHTMLElement();
  const grid = new Adapter.TabulatorGrid(container, {}, FakeTabulator);
  grid.setDocument(preview, { mode: "preview", readOnly: true, disableSortFilter: true });

  assert.equal(grid.table.options.data.length, 3);
  assert.ok(grid.table.options.columns.every((column) => column.editor === false));
  assert.ok(grid.table.options.columns.every((column) => column.headerSort === false));
  assert.equal(container.getAttribute("aria-readonly"), "true");
  assert.equal(container.getAttribute("aria-rowcount"), "4");
  assert.match(container.getAttribute("aria-label"), /read-only data preview/);
  assert.equal(grid.pageInfo().totalDocumentRows, 8);
  assert.equal(grid.pageInfo().visibleRows, 3);
});

test("range selection exposes ARIA selection state and an accessible selection summary", () => {
  const container = new FakeHTMLElement();
  const summaries = [];
  const grid = new Adapter.TabulatorGrid(container, {
    onRangeChange: (selection) => summaries.push(selection),
  }, FakeTabulator);
  grid.setDocument(open("id,value\n001,alpha\n002,beta\n"));

  const first = fakeCell(1, 0, "001");
  const second = fakeCell(2, 1, "beta");
  const range = {
    getCells: () => [[first.cell, second.cell]],
    getBounds: () => ({ start: first.cell, end: second.cell }),
  };
  grid.table.fire("rangeAdded", range);
  assert.equal(first.element.getAttribute("aria-selected"), "true");
  assert.equal(second.element.getAttribute("aria-selected"), "true");
  assert.deepEqual(summaries.at(-1), {
    cellCount: 2,
    rowCount: 2,
    columnCount: 2,
    start: { rowIndex: 1, columnIndex: 0 },
    end: { rowIndex: 2, columnIndex: 1 },
  });

  grid.table.fire("rangeRemoved");
  assert.equal(summaries.at(-1), null);
});
