"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../assets/csv-engine.js");
const Store = require("../assets/recovery-store.js");
const Recovery = require("../assets/recovery-coordinator.js");

function bytes(text) { return new TextEncoder().encode(text); }
function decoded(documentModel) { return new TextDecoder().decode(documentModel.exportBytes()); }

class MemorySessionStorage {
  constructor(seed = {}) { this.values = new Map(Object.entries(seed)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function coordinator(store, sessionStorage = new MemorySessionStorage(), options = {}) {
  return new Recovery.RecoveryCoordinator({
    store,
    engine: Engine,
    sessionStorage,
    navigator: options.navigator || { storage: { persist: async () => false, estimate: async () => ({ usage: 0, quota: 1_000_000 }) } },
    BroadcastChannel: null,
    debounceMs: options.debounceMs ?? 1,
    heartbeatMs: options.heartbeatMs ?? 100000,
    leaseMs: options.leaseMs ?? 200000,
    largeCommandBytes: options.largeCommandBytes ?? 1024 * 1024,
    storagePreflightBytes: options.storagePreflightBytes ?? 8 * 1024 * 1024,
    performance: options.performance || { getEntriesByType: () => [{ type: "navigate" }] },
  });
}

test("journaled edits and snapshots survive a refresh with empty undo history", async () => {
  const store = new Store.MemoryRecoveryStore();
  const session = new MemorySessionStorage();
  const first = coordinator(store, session);
  await first.initialize();
  const source = bytes("id,value\n001,alpha\n002,beta\n");
  const documentModel = Engine.CsvDocument.fromBytes(source, { filename: "work.csv" });
  const started = await first.startNewDocument(documentModel, { policyMode: "standard" });
  documentModel.setCell(1, 1, "changed");
  documentModel.setCell(2, 1, "pending");
  await first.flush();

  assert.equal(first.isCurrentRevisionSafe(), true);
  const bundle = await store.getBundle(started.documentId);
  assert.equal(bundle.documentRecord.lastSafeRevision, 2);
  assert.equal(bundle.snapshots[0].revision, 2);
  assert.deepEqual(bundle.journal.map((entry) => entry.revision), [1, 2]);

  first.destroy();
  const refreshed = coordinator(store, session, {
    performance: { getEntriesByType: () => [{ type: "reload" }] },
  });
  await refreshed.initialize();
  assert.equal(refreshed.isConfirmedReload(), true);
  assert.equal(refreshed.activeDocumentIdFromSession(), started.documentId);
  const restored = await refreshed.restoreDocument(started.documentId);
  assert.equal(restored.writable, true);
  assert.equal(decoded(restored.document), decoded(documentModel));
  assert.equal(restored.document.canUndo, false);
  assert.equal(restored.document.hasUndownloadedChanges, true);
  refreshed.destroy();
});

test("rapid edits are recoverable from a snapshot plus a contiguous journal", async () => {
  const store = new Store.MemoryRecoveryStore();
  const owner = coordinator(store, new MemorySessionStorage(), { debounceMs: 100000 });
  await owner.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a,b\n1,2\n"), { filename: "rapid.csv" });
  const started = await owner.startNewDocument(documentModel);
  documentModel.setCell(1, 0, "001");
  documentModel.setCell(1, 1, "002");
  await owner.writeChain;

  const bundle = await store.getBundle(started.documentId);
  assert.equal(bundle.snapshots[0].revision, 0);
  assert.deepEqual(bundle.journal.map((entry) => entry.revision), [1, 2]);

  const reader = coordinator(store, new MemorySessionStorage());
  await reader.initialize();
  const result = await reader.restoreDocument(started.documentId, { writable: false });
  assert.equal(decoded(result.document), "a,b\n001,002\n");
  owner.destroy();
  reader.destroy();
});

test("large mutations advance the safe revision with an immediate snapshot instead of an oversized journal", async () => {
  const store = new Store.MemoryRecoveryStore();
  const owner = coordinator(store, new MemorySessionStorage(), {
    debounceMs: 100000,
    largeCommandBytes: 1024,
  });
  await owner.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\nsmall\n"), { filename: "large-change.csv" });
  const started = await owner.startNewDocument(documentModel);
  const largeValue = "x".repeat(4096);
  documentModel.setCell(1, 0, largeValue);
  await owner.writeChain;

  const bundle = await store.getBundle(started.documentId);
  assert.equal(bundle.documentRecord.lastSafeRevision, 1);
  assert.equal(bundle.snapshots[0].revision, 1);
  assert.deepEqual(bundle.journal, []);

  const reader = coordinator(store, new MemorySessionStorage());
  await reader.initialize();
  const restored = await reader.restoreDocument(started.documentId, { writable: false });
  assert.equal(restored.document.getCell(1, 0), largeValue);
  owner.destroy();
  reader.destroy();
});

test("large recovery writes consult browser storage estimates without treating estimates as authoritative", async () => {
  let estimateRequests = 0;
  const store = new Store.MemoryRecoveryStore();
  const current = coordinator(store, new MemorySessionStorage(), {
    storagePreflightBytes: 1024,
    navigator: {
      storage: {
        persisted: async () => false,
        persist: async () => false,
        estimate: async () => {
          estimateRequests += 1;
          return { usage: 900, quota: 1000 };
        },
      },
    },
  });
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(
    bytes(`value\n${"x".repeat(2048)}\n`),
    { filename: "storage-estimate.csv" },
  );
  const result = await current.startNewDocument(documentModel);

  assert.equal(result.enabled, true);
  assert.equal(estimateRequests > 0, true);
  assert.equal(current.lastStorageEstimate.storagePressure, true);
  assert.equal(current.status.code, Recovery.STATUS.SAVED);
  current.destroy();
});

test("recovery initialization failure does not prevent a document from remaining usable in memory", async () => {
  const failure = new Store.RecoveryUnavailableError("IndexedDB blocked by policy.");
  const store = {
    async open() { throw failure; },
    close() {},
  };
  const current = coordinator(store);
  const initialized = await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"));
  const result = await current.startNewDocument(documentModel);

  assert.equal(initialized.available, false);
  assert.equal(result.enabled, false);
  assert.equal(result.document, documentModel);
  assert.equal(current.status.code, Recovery.STATUS.UNAVAILABLE);
  assert.equal(documentModel.getCell(1, 0), "1");
  current.destroy();
});

test("a second tab cannot silently overwrite an active writer and can create an independent copy", async () => {
  const store = new Store.MemoryRecoveryStore();
  const owner = coordinator(store, new MemorySessionStorage());
  const second = coordinator(store, new MemorySessionStorage());
  await owner.initialize();
  await second.initialize();
  const original = Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "same.csv" });
  const started = await owner.startNewDocument(original);

  const conflict = await second.restoreDocument(started.documentId);
  assert.equal(conflict.writable, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.document.readOnly, true);

  const independent = await second.createIndependentCopy(started.documentId);
  assert.equal(independent.writable, true);
  assert.notEqual(independent.documentId, started.documentId);
  assert.equal((await store.listDocuments()).length, 2);
  owner.destroy();
  second.destroy();
});

test("stale leases require explicit takeover", async () => {
  let now = 1000;
  const store = new Store.MemoryRecoveryStore({ now: () => now });
  const first = new Recovery.RecoveryCoordinator({
    store, engine: Engine, sessionStorage: new MemorySessionStorage(), BroadcastChannel: null,
    now: () => now, debounceMs: 1, heartbeatMs: 1000, leaseMs: 3000,
  });
  await first.initialize();
  const started = await first.startNewDocument(Engine.CsvDocument.fromBytes(bytes("a\n1\n")));
  now = 5000;
  const other = new Recovery.RecoveryCoordinator({
    store, engine: Engine, sessionStorage: new MemorySessionStorage(), BroadcastChannel: null,
    now: () => now, debounceMs: 1, heartbeatMs: 1000, leaseMs: 3000,
  });
  await other.initialize();
  const stale = await other.restoreDocument(started.documentId);
  assert.equal(stale.writable, false);
  assert.equal(stale.conflictReason, "stale");
  await other.detachCurrent({ clearSession: false });
  const taken = await other.restoreDocument(started.documentId, { explicitTakeover: true });
  assert.equal(taken.writable, true);
  first.destroy();
  other.destroy();
});

test("deleting an active local copy suspends recovery until explicitly resumed", async () => {
  const store = new Store.MemoryRecoveryStore();
  const current = coordinator(store);
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "delete.csv" });
  const started = await current.startNewDocument(documentModel);
  await current.deleteDocument(started.documentId);
  assert.equal(current.status.code, Recovery.STATUS.OFF);
  assert.equal((await store.listDocuments()).length, 0);

  documentModel.setCell(1, 0, "2");
  await current.writeChain;
  assert.equal((await store.listDocuments()).length, 0);

  const resumed = await current.resumeCurrent();
  assert.equal(resumed.enabled, true);
  assert.equal((await store.listDocuments()).length, 1);
  current.destroy();
});

test("quota failures preserve the last valid revision and never report saved", async () => {
  const store = new Store.MemoryRecoveryStore();
  const statuses = [];
  const current = new Recovery.RecoveryCoordinator({
    store,
    engine: Engine,
    sessionStorage: new MemorySessionStorage(),
    BroadcastChannel: null,
    debounceMs: 100000,
    heartbeatMs: 100000,
    leaseMs: 200000,
    onStatus: (status) => statuses.push(status.code),
  });
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"));
  const started = await current.startNewDocument(documentModel);
  store.failNext = new Store.RecoveryStoreError("full", "QUOTA_EXCEEDED");
  documentModel.setCell(1, 0, "2");
  await current.writeChain;

  const bundle = await store.getBundle(started.documentId);
  assert.equal(bundle.documentRecord.lastSafeRevision, 0);
  assert.equal(current.isCurrentRevisionSafe(), false);
  assert.equal(current.status.code, Recovery.STATUS.FULL);
  assert.equal(statuses.at(-1), Recovery.STATUS.FULL);
  current.destroy();
});

test("snapshot compaction retains the journal needed by the fallback snapshot", async () => {
  const store = new Store.MemoryRecoveryStore();
  const current = coordinator(store);
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"));
  const started = await current.startNewDocument(documentModel);
  documentModel.setCell(1, 0, "2");
  await current.flush();
  documentModel.setCell(1, 0, "3");
  await current.flush();

  const bundle = await store.getBundle(started.documentId);
  assert.deepEqual(bundle.snapshots.map((record) => record.revision), [2, 1]);
  assert.deepEqual(bundle.journal.map((entry) => entry.revision), [2]);
  current.destroy();
});

test("damaged newest recovery data opens the last valid revision read-only", async () => {
  const store = new Store.MemoryRecoveryStore();
  const owner = coordinator(store);
  await owner.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "fallback.csv" });
  const started = await owner.startNewDocument(documentModel);
  documentModel.setCell(1, 0, "2");
  await owner.writeChain;

  const journal = store.journal.get(started.documentId);
  journal.delete(1);
  owner.destroy();

  const reader = coordinator(store, new MemorySessionStorage());
  await reader.initialize();
  const restored = await reader.restoreDocument(started.documentId);
  assert.equal(restored.degraded, true);
  assert.equal(restored.writable, false);
  assert.equal(restored.document.readOnly, true);
  assert.equal(restored.recoveredRevision, 0);
  assert.equal(restored.expectedRevision, 1);
  assert.equal(decoded(restored.document), "a\n1\n");
  assert.equal(reader.status.code, Recovery.STATUS.DEGRADED);
  reader.destroy();
});

test("restoring the same document does not release the newly acquired lease", async () => {
  const store = new Store.MemoryRecoveryStore();
  const session = new MemorySessionStorage();
  const current = coordinator(store, session);
  await current.initialize();
  const started = await current.startNewDocument(Engine.CsvDocument.fromBytes(bytes("a\n1\n")));
  const restored = await current.restoreDocument(started.documentId);
  assert.equal(restored.writable, true);
  restored.document.setCell(1, 0, "2");
  await current.writeChain;
  assert.equal((await store.getBundle(started.documentId)).documentRecord.lastSafeRevision, 1);
  current.destroy();
});

test("IndexedDB cleanup ranges target the document index key, not the compound primary key", () => {
  const calls = [];
  const keyRange = { only(value) { calls.push(value); return { kind: "only", value }; } };
  const range = Store.documentIndexRange(keyRange, "document-123");
  assert.deepEqual(range, { kind: "only", value: "document-123" });
  assert.deepEqual(calls, ["document-123"]);
  assert.equal(Store.journalCleanupRevision([{ revision: 9 }, { revision: 5 }, { revision: 2 }]), 5);
  assert.equal(Store.journalCleanupRevision([{ revision: 9 }]), -1);
});

test("confirmed reload classification is strict and privacy preserving", () => {
  assert.equal(Recovery.confirmedReload({ getEntriesByType: () => [{ type: "reload" }] }), true);
  assert.equal(Recovery.confirmedReload({ getEntriesByType: () => [{ type: "back_forward" }] }), false);
  assert.equal(Recovery.confirmedReload({ getEntriesByType: () => [] }), false);
  assert.equal(Recovery.confirmedReload(null), false);
});

test("a failed independent-copy write leaves the safe active document attached and saved", async () => {
  const store = new Store.MemoryRecoveryStore();
  const current = coordinator(store);
  await current.initialize();
  const original = Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "safe.csv" });
  const started = await current.startNewDocument(original);
  assert.equal(current.status.code, Recovery.STATUS.SAVED);

  store.failNext = new Store.RecoveryStoreError("full", "QUOTA_EXCEEDED");
  await assert.rejects(() => current.createIndependentCopyFromCurrent(), /full/);

  assert.equal(current.documentId, started.documentId);
  assert.equal(current.document, original);
  assert.equal(current.status.code, Recovery.STATUS.SAVED);
  assert.equal(current.isCurrentRevisionSafe(), true);
  assert.equal((await store.listDocuments()).length, 1);
  current.destroy();
});

test("deleting an active copy invalidates an in-flight journal without recreating it", async () => {
  let releaseWrite;
  const gate = new Promise((resolve) => { releaseWrite = resolve; });
  let journalStarted;
  const startedGate = new Promise((resolve) => { journalStarted = resolve; });
  class DelayedStore extends Store.MemoryRecoveryStore {
    async commitJournal(options) {
      journalStarted();
      await gate;
      return super.commitJournal(options);
    }
  }

  const store = new DelayedStore();
  const current = coordinator(store, new MemorySessionStorage(), { debounceMs: 100000 });
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "delete-race.csv" });
  const started = await current.startNewDocument(documentModel);
  documentModel.setCell(1, 0, "2");
  await startedGate;

  await current.deleteDocument(started.documentId);
  assert.equal(current.status.code, Recovery.STATUS.OFF);
  assert.equal((await store.listDocuments()).length, 0);

  releaseWrite();
  await current.writeChain;
  assert.equal(current.status.code, Recovery.STATUS.OFF);
  assert.equal((await store.listDocuments()).length, 0);
  current.destroy();
});

test("restricted session storage cannot disable local recovery initialization", async () => {
  const restricted = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const store = new Store.MemoryRecoveryStore();
  const current = coordinator(store, restricted);
  await current.initialize();
  assert.equal(current.available, true);
  assert.equal(current.activeDocumentIdFromSession(), null);
  const result = await current.startNewDocument(
    Engine.CsvDocument.fromBytes(bytes("a\n1\n"), { filename: "restricted.csv" }),
  );
  assert.equal(result.enabled, true);
  current.destroy();
});

test("persistent storage denial and lack of support are recorded without disabling recovery", async () => {
  let requests = 0;
  const deniedStore = new Store.MemoryRecoveryStore();
  const denied = coordinator(deniedStore, new MemorySessionStorage(), {
    navigator: {
      storage: {
        persisted: async () => false,
        persist: async () => { requests += 1; return false; },
        estimate: async () => ({ usage: 10, quota: 100 }),
      },
    },
  });
  await denied.initialize();
  const first = await denied.requestPersistentStorage();
  const second = await denied.requestPersistentStorage();
  assert.deepEqual(first, second);
  assert.equal(first.status, "denied");
  assert.equal(requests, 1);
  assert.deepEqual(await denied.storageEstimate(), { usage: 10, quota: 100 });
  denied.destroy();

  const unsupportedStore = new Store.MemoryRecoveryStore();
  const unsupported = coordinator(unsupportedStore, new MemorySessionStorage(), { navigator: {} });
  await unsupported.initialize();
  const result = await unsupported.requestPersistentStorage();
  assert.equal(result.status, "unsupported");
  assert.equal(unsupported.available, true);
  unsupported.destroy();
});

test("blocked upgrades and version changes produce explicit non-destructive states", async () => {
  const store = new Store.MemoryRecoveryStore();
  const statuses = [];
  const current = new Recovery.RecoveryCoordinator({
    store,
    engine: Engine,
    sessionStorage: new MemorySessionStorage(),
    BroadcastChannel: null,
    onStatus: (status) => statuses.push(status.code),
  });
  await current.initialize();
  const documentModel = Engine.CsvDocument.fromBytes(bytes("a\n1\n"));
  await current.startNewDocument(documentModel);

  current.handleBlockedUpgrade();
  assert.equal(current.status.code, Recovery.STATUS.BLOCKED);
  assert.equal(current.document, documentModel);

  current.handleVersionChange();
  assert.equal(current.status.code, Recovery.STATUS.RELOAD_REQUIRED);
  assert.equal(current.document, documentModel);
  assert.equal(current.writable, false);
  assert.deepEqual(statuses.slice(-2), [Recovery.STATUS.BLOCKED, Recovery.STATUS.RELOAD_REQUIRED]);
  current.destroy();
});
