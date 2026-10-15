#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");
const Loader = require("../assets/document-loader.js");

function sourceBytes(text) {
  return Engine.encodeUtf8(text);
}

class FakeWorker {
  static response = null;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.terminated = false;
    this.posted = null;
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, data) {
    for (const listener of this.listeners.get(type) || []) listener({ data, message: data?.message });
  }

  postMessage(message, transfer) {
    this.posted = { message, transfer };
    queueMicrotask(() => this.emit("message", FakeWorker.response));
  }

  terminate() {
    this.terminated = true;
  }
}

function httpRoot(overrides = {}) {
  return {
    Worker: FakeWorker,
    location: { protocol: "https:", href: "https://example.test/marin-csv/" },
    document: { baseURI: "https://example.test/marin-csv/" },
    ...overrides,
  };
}

test("worker routing is restricted to same-origin HTTP contexts and can be disabled", () => {
  assert.equal(Loader.workerAllowed(httpRoot()), true);
  assert.equal(Loader.workerAllowed(httpRoot({ MarinCsvDisableWorker: true })), false);
  assert.equal(Loader.workerAllowed({ Worker: FakeWorker, location: { protocol: "file:" } }), false);
  assert.equal(Loader.workerAllowed({ location: { protocol: "https:" } }), false);
  assert.equal(Loader.workerUrl(httpRoot()), "https://example.test/marin-csv/assets/csv-worker.js");
});

test("worker results reconstruct the authoritative document and terminate the worker", async () => {
  FakeWorker.instances.length = 0;
  const original = sourceBytes("id,value\n001,alpha\n");
  const documentModel = Engine.CsvDocument.fromBytes(original, { filename: "worker.csv" });
  FakeWorker.response = {
    type: "result",
    document: documentModel.toTransfer(),
    policy: { mode: "standard", readOnly: false, paged: false, pageSize: null, reasons: [] },
    metrics: { inspectionMs: 1, parseMs: 2, totalMs: 3 },
  };
  const phases = [];
  const result = await Loader.parseBytes(new Uint8Array(original), {
    filename: "worker.csv",
  }, ({ phase }) => phases.push(phase), httpRoot());

  assert.equal(result.usedWorker, true);
  assert.equal(result.document.filename, "worker.csv");
  assert.equal(Engine.bytesEqual(result.document.exportBytes(), original), true);
  assert.deepEqual(phases, ["worker"]);
  assert.equal(FakeWorker.instances.length, 1);
  const worker = FakeWorker.instances[0];
  assert.equal(worker.url, "https://example.test/marin-csv/assets/csv-worker.js");
  assert.equal(worker.posted.transfer.length, 1);
  assert.equal(worker.terminated, true);
});

test("worker progress and structured parse errors are surfaced without fallback ambiguity", async () => {
  FakeWorker.instances.length = 0;
  FakeWorker.response = {
    type: "error",
    error: { code: "UNCLOSED_QUOTE", message: "A quoted field is not closed.", details: { row: 4 } },
  };
  await assert.rejects(
    Loader.parseBytes(sourceBytes("id\n\"broken"), { filename: "broken.csv" }, null, httpRoot()),
    (error) => error instanceof Engine.CsvError
      && error.code === "UNCLOSED_QUOTE"
      && error.details.row === 4,
  );
  assert.equal(FakeWorker.instances[0].terminated, true);
});
