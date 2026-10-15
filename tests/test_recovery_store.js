"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../assets/recovery-store.js");

test("read/write IndexedDB transactions request strict durability when supported", () => {
  const expected = { name: "strict-transaction" };
  const calls = [];
  const db = {
    transaction(...args) {
      calls.push(args);
      return expected;
    },
  };

  assert.equal(Store.createTransaction(db, ["documents"], "readwrite"), expected);
  assert.deepEqual(calls, [[["documents"], "readwrite", { durability: "strict" }]]);
});

test("read/write transactions gracefully fall back when transaction durability options are unsupported", () => {
  const expected = { name: "fallback-transaction" };
  const calls = [];
  const db = {
    transaction(...args) {
      calls.push(args);
      if (args.length === 3) throw new TypeError("The transaction options argument is unsupported.");
      return expected;
    },
  };

  assert.equal(Store.createTransaction(db, ["documents"], "readwrite"), expected);
  assert.deepEqual(calls, [
    [["documents"], "readwrite", { durability: "strict" }],
    [["documents"], "readwrite"],
  ]);
});

test("transaction creation does not hide ordinary IndexedDB errors", () => {
  const error = new Error("The requested object store does not exist.");
  error.name = "NotFoundError";
  const db = { transaction() { throw error; } };
  assert.throws(
    () => Store.createTransaction(db, ["missing"], "readwrite"),
    (caught) => caught === error,
  );
});

test("read-only transactions do not request durability options", () => {
  const expected = { name: "readonly-transaction" };
  const calls = [];
  const db = {
    transaction(...args) {
      calls.push(args);
      return expected;
    },
  };

  assert.equal(Store.createTransaction(db, ["documents"], "readonly"), expected);
  assert.deepEqual(calls, [[["documents"], "readonly"]]);
});
