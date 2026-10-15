/* Marin CSV CSV-4 IndexedDB persistence adapter and deterministic in-memory test store. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvRecoveryStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DATABASE_NAME = "marin-csv-recovery";
  const DATABASE_VERSION = 1;
  const STORE_NAMES = Object.freeze({
    documents: "documents",
    sources: "sources",
    snapshots: "snapshots",
    journal: "journal",
    leases: "leases",
    meta: "meta",
  });
  const MAX_REVISION = Number.MAX_SAFE_INTEGER;

  class RecoveryStoreError extends Error {
    constructor(message, code = "RECOVERY_STORE_ERROR", cause = null) {
      super(message);
      this.name = "RecoveryStoreError";
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  class RecoveryConflictError extends RecoveryStoreError {
    constructor(message, code = "RECOVERY_CONFLICT") {
      super(message, code);
      this.name = "RecoveryConflictError";
    }
  }

  class RecoveryUnavailableError extends RecoveryStoreError {
    constructor(message, cause = null) {
      super(message, "RECOVERY_UNAVAILABLE", cause);
      this.name = "RecoveryUnavailableError";
    }
  }

  function cloneValue(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      return new value.constructor(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      const result = {};
      Object.entries(value).forEach(([key, item]) => { result[key] = cloneValue(item); });
      return result;
    }
    return value;
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new RecoveryStoreError("IndexedDB request failed."));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new RecoveryStoreError("IndexedDB transaction was aborted.", "TRANSACTION_ABORTED"));
      transaction.onerror = () => {
        // The abort handler supplies the authoritative failure after request
        // error handlers have had a chance to prevent an expected abort.
      };
    });
  }

  function normalizeError(error, message) {
    if (error instanceof RecoveryStoreError) return error;
    if (error?.name === "QuotaExceededError") {
      return new RecoveryStoreError(message || "Browser storage is full.", "QUOTA_EXCEEDED", error);
    }
    return new RecoveryStoreError(message || error?.message || "IndexedDB operation failed.", "RECOVERY_STORE_ERROR", error);
  }

  function leaseState(lease, now) {
    if (!lease) return { status: "available", lease: null };
    if (Number(lease.expiresAt) <= now) return { status: "stale", lease: cloneValue(lease) };
    return { status: "active", lease: cloneValue(lease) };
  }

  function documentIndexRange(IDBKeyRangeImpl, documentId) {
    return IDBKeyRangeImpl.only(documentId);
  }

  function journalCleanupRevision(snapshots) {
    const revisions = (snapshots || [])
      .map((record) => Number(record?.revision))
      .filter((revision) => Number.isInteger(revision) && revision >= 0)
      .sort((a, b) => b - a);
    return revisions.length > 1 ? revisions[1] : -1;
  }

  async function deleteIndexRecords(index, range, predicate = () => true) {
    await new Promise((resolve, reject) => {
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error || new RecoveryStoreError("Could not enumerate recovery records."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (!predicate(cursor.value)) {
          cursor.continue();
          return;
        }
        const remove = cursor.delete();
        remove.onerror = () => reject(remove.error || new RecoveryStoreError("Could not delete recovery record."));
        remove.onsuccess = () => cursor.continue();
      };
    });
  }


  function createTransaction(db, storeNames, mode) {
    if (mode !== "readwrite") return db.transaction(storeNames, mode);
    try {
      return db.transaction(storeNames, mode, { durability: "strict" });
    } catch (error) {
      if (error instanceof TypeError || error?.name === "TypeError" || error?.name === "NotSupportedError") {
        return db.transaction(storeNames, mode);
      }
      throw error;
    }
  }

  class IndexedDbRecoveryStore {
    constructor(options = {}) {
      this.indexedDB = options.indexedDB || (typeof indexedDB !== "undefined" ? indexedDB : null);
      this.IDBKeyRange = options.IDBKeyRange || (typeof IDBKeyRange !== "undefined" ? IDBKeyRange : null);
      this.name = options.name || DATABASE_NAME;
      this.version = options.version || DATABASE_VERSION;
      this.now = options.now || Date.now;
      this.db = null;
      this.openPromise = null;
      this.onBlocked = options.onBlocked || null;
      this.onVersionChange = options.onVersionChange || null;
    }

    async open() {
      if (this.db) return this.db;
      if (this.openPromise) return this.openPromise;
      if (!this.indexedDB || !this.IDBKeyRange) {
        throw new RecoveryUnavailableError("IndexedDB is not available in this browser.");
      }
      this.openPromise = new Promise((resolve, reject) => {
        let request;
        try {
          request = this.indexedDB.open(this.name, this.version);
        } catch (error) {
          reject(new RecoveryUnavailableError("IndexedDB could not be opened.", error));
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          const transaction = request.transaction;
          if (!db.objectStoreNames.contains(STORE_NAMES.documents)) {
            const store = db.createObjectStore(STORE_NAMES.documents, { keyPath: "documentId" });
            store.createIndex("lastActiveAt", "lastActiveAt");
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.sources)) {
            db.createObjectStore(STORE_NAMES.sources, { keyPath: "documentId" });
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.snapshots)) {
            const store = db.createObjectStore(STORE_NAMES.snapshots, { keyPath: ["documentId", "revision"] });
            store.createIndex("documentId", "documentId");
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.journal)) {
            const store = db.createObjectStore(STORE_NAMES.journal, { keyPath: ["documentId", "revision"] });
            store.createIndex("documentId", "documentId");
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.leases)) {
            db.createObjectStore(STORE_NAMES.leases, { keyPath: "documentId" });
          }
          if (!db.objectStoreNames.contains(STORE_NAMES.meta)) {
            db.createObjectStore(STORE_NAMES.meta, { keyPath: "key" });
          }
          transaction?.addEventListener?.("abort", () => {
            reject(normalizeError(transaction.error, "The recovery database upgrade failed."));
          }, { once: true });
        };
        request.onblocked = () => {
          this.onBlocked?.();
        };
        request.onerror = () => reject(normalizeError(request.error, "IndexedDB could not be opened."));
        request.onsuccess = () => {
          this.db = request.result;
          this.db.onversionchange = () => {
            this.onVersionChange?.();
            this.db?.close();
            this.db = null;
            this.openPromise = null;
          };
          resolve(this.db);
        };
      }).finally(() => {
        if (!this.db) this.openPromise = null;
      });
      return this.openPromise;
    }

    close() {
      this.db?.close();
      this.db = null;
      this.openPromise = null;
    }

    async _transaction(storeNames, mode, operation) {
      const db = await this.open();
      let transaction;
      try {
        transaction = createTransaction(db, storeNames, mode);
      } catch (error) {
        throw normalizeError(error, "Could not start a recovery transaction.");
      }
      const completion = transactionPromise(transaction);
      try {
        const result = await operation(transaction);
        await completion;
        return result;
      } catch (error) {
        try { transaction.abort(); } catch (_) {}
        try { await completion; } catch (_) {}
        throw normalizeError(error);
      }
    }

    async createDocument({ documentRecord, sourceRecord, snapshotRecord, leaseRecord }) {
      return this._transaction(Object.values(STORE_NAMES), "readwrite", async (tx) => {
        const documents = tx.objectStore(STORE_NAMES.documents);
        const existing = await requestPromise(documents.get(documentRecord.documentId));
        if (existing) throw new RecoveryConflictError("A local recovery document with this identifier already exists.", "DOCUMENT_EXISTS");
        documents.add(cloneValue(documentRecord));
        tx.objectStore(STORE_NAMES.sources).add(cloneValue(sourceRecord));
        tx.objectStore(STORE_NAMES.snapshots).add(cloneValue(snapshotRecord));
        tx.objectStore(STORE_NAMES.leases).put(cloneValue(leaseRecord));
        return cloneValue(documentRecord);
      });
    }

    async listDocuments() {
      return this._transaction([STORE_NAMES.documents, STORE_NAMES.leases], "readonly", async (tx) => {
        const documents = await requestPromise(tx.objectStore(STORE_NAMES.documents).getAll());
        const leases = await requestPromise(tx.objectStore(STORE_NAMES.leases).getAll());
        const byDocument = new Map(leases.map((lease) => [lease.documentId, lease]));
        const now = this.now();
        return documents
          .map((record) => ({ ...cloneValue(record), leaseState: leaseState(byDocument.get(record.documentId), now) }))
          .sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0));
      });
    }

    async getBundle(documentId) {
      return this._transaction(Object.values(STORE_NAMES), "readonly", async (tx) => {
        const documentRecord = await requestPromise(tx.objectStore(STORE_NAMES.documents).get(documentId));
        if (!documentRecord) return null;
        const sourceRecord = await requestPromise(tx.objectStore(STORE_NAMES.sources).get(documentId));
        const snapshots = await requestPromise(tx.objectStore(STORE_NAMES.snapshots).index("documentId").getAll(documentId));
        const journal = await requestPromise(tx.objectStore(STORE_NAMES.journal).index("documentId").getAll(documentId));
        const lease = await requestPromise(tx.objectStore(STORE_NAMES.leases).get(documentId));
        snapshots.sort((a, b) => b.revision - a.revision);
        journal.sort((a, b) => a.revision - b.revision);
        return cloneValue({ documentRecord, sourceRecord, snapshots, journal, lease, leaseState: leaseState(lease, this.now()) });
      });
    }

    async acquireLease(documentId, sessionId, options = {}) {
      const now = this.now();
      const duration = Math.max(1000, Number(options.durationMs) || 90000);
      return this._transaction([STORE_NAMES.documents, STORE_NAMES.leases], "readwrite", async (tx) => {
        const documents = tx.objectStore(STORE_NAMES.documents);
        const documentRecord = await requestPromise(documents.get(documentId));
        if (!documentRecord) throw new RecoveryStoreError("The local recovery document no longer exists.", "DOCUMENT_NOT_FOUND");
        const leases = tx.objectStore(STORE_NAMES.leases);
        const current = await requestPromise(leases.get(documentId));
        const sameSession = current?.sessionId === sessionId;
        const expired = !current || Number(current.expiresAt) <= now;
        if (current && !sameSession && !expired) {
          return { acquired: false, reason: "active", lease: cloneValue(current) };
        }
        if (current && !sameSession && expired && !options.explicitTakeover) {
          return { acquired: false, reason: "stale", lease: cloneValue(current) };
        }
        const lease = {
          documentId,
          sessionId,
          acquiredAt: sameSession ? current.acquiredAt : now,
          heartbeatAt: now,
          expiresAt: now + duration,
          expectedRevision: Number(documentRecord.lastSafeRevision || 0),
        };
        leases.put(lease);
        return { acquired: true, lease: cloneValue(lease) };
      });
    }

    async heartbeatLease(documentId, sessionId, options = {}) {
      const now = this.now();
      const duration = Math.max(1000, Number(options.durationMs) || 90000);
      return this._transaction([STORE_NAMES.documents, STORE_NAMES.leases], "readwrite", async (tx) => {
        const leases = tx.objectStore(STORE_NAMES.leases);
        const current = await requestPromise(leases.get(documentId));
        if (!current || current.sessionId !== sessionId || Number(current.expiresAt) <= now) {
          throw new RecoveryConflictError("This tab no longer owns the local recovery writer lease.", "LEASE_LOST");
        }
        const documentRecord = await requestPromise(tx.objectStore(STORE_NAMES.documents).get(documentId));
        current.heartbeatAt = now;
        current.expiresAt = now + duration;
        current.expectedRevision = Number(documentRecord?.lastSafeRevision || current.expectedRevision || 0);
        leases.put(current);
        return cloneValue(current);
      });
    }

    async releaseLease(documentId, sessionId) {
      return this._transaction([STORE_NAMES.leases], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_NAMES.leases);
        const current = await requestPromise(store.get(documentId));
        if (current?.sessionId === sessionId) store.delete(documentId);
        return true;
      });
    }

    async commitJournal({ documentId, sessionId, expectedRevision, revision, entry, documentPatch = {}, leaseDurationMs = 90000 }) {
      const now = this.now();
      return this._transaction([STORE_NAMES.documents, STORE_NAMES.journal, STORE_NAMES.leases], "readwrite", async (tx) => {
        const documents = tx.objectStore(STORE_NAMES.documents);
        const documentRecord = await requestPromise(documents.get(documentId));
        if (!documentRecord) throw new RecoveryStoreError("The local recovery document no longer exists.", "DOCUMENT_NOT_FOUND");
        if (documentRecord.recoveryStatus === "suspended") {
          throw new RecoveryConflictError("Local recovery is suspended for this document.", "RECOVERY_SUSPENDED");
        }
        const leases = tx.objectStore(STORE_NAMES.leases);
        const lease = await requestPromise(leases.get(documentId));
        if (!lease || lease.sessionId !== sessionId || Number(lease.expiresAt) <= now) {
          throw new RecoveryConflictError("This tab no longer owns the local recovery writer lease.", "LEASE_LOST");
        }
        if (Number(documentRecord.lastSafeRevision || 0) !== Number(expectedRevision)) {
          throw new RecoveryConflictError("The local recovery revision changed in another tab.", "STALE_REVISION");
        }
        tx.objectStore(STORE_NAMES.journal).add(cloneValue(entry));
        const updated = {
          ...documentRecord,
          ...cloneValue(documentPatch),
          lastSafeRevision: revision,
          latestJournalRevision: revision,
          lastActiveAt: now,
          lastModifiedAt: now,
          recoveryStatus: "active",
        };
        documents.put(updated);
        leases.put({
          ...lease,
          heartbeatAt: now,
          expiresAt: now + Math.max(1000, Number(leaseDurationMs) || 90000),
          expectedRevision: revision,
        });
        return cloneValue(updated);
      });
    }

    async commitSnapshot({ documentId, sessionId, expectedRevision, revision, snapshotRecord, documentPatch = {}, advanceSafe = false, leaseDurationMs = 90000 }) {
      const now = this.now();
      return this._transaction([STORE_NAMES.documents, STORE_NAMES.snapshots, STORE_NAMES.journal, STORE_NAMES.leases], "readwrite", async (tx) => {
        const documents = tx.objectStore(STORE_NAMES.documents);
        const documentRecord = await requestPromise(documents.get(documentId));
        if (!documentRecord) throw new RecoveryStoreError("The local recovery document no longer exists.", "DOCUMENT_NOT_FOUND");
        const leases = tx.objectStore(STORE_NAMES.leases);
        const lease = await requestPromise(leases.get(documentId));
        if (!lease || lease.sessionId !== sessionId || Number(lease.expiresAt) <= now) {
          throw new RecoveryConflictError("This tab no longer owns the local recovery writer lease.", "LEASE_LOST");
        }
        const currentSafe = Number(documentRecord.lastSafeRevision || 0);
        if (advanceSafe) {
          if (currentSafe !== Number(expectedRevision)) {
            throw new RecoveryConflictError("The local recovery revision changed before the snapshot was committed.", "STALE_REVISION");
          }
        } else if (currentSafe < Number(revision)) {
          throw new RecoveryConflictError("The snapshot is newer than the committed journal.", "SNAPSHOT_AHEAD_OF_JOURNAL");
        }
        const snapshotsStore = tx.objectStore(STORE_NAMES.snapshots);
        snapshotsStore.put(cloneValue(snapshotRecord));
        const updatedSafe = advanceSafe ? revision : currentSafe;
        const updated = {
          ...documentRecord,
          ...cloneValue(documentPatch),
          lastSafeRevision: updatedSafe,
          latestSnapshotRevision: revision,
          latestJournalRevision: Math.max(Number(documentRecord.latestJournalRevision || 0), updatedSafe),
          lastActiveAt: now,
          lastModifiedAt: now,
          recoveryStatus: "active",
        };
        documents.put(updated);
        const snapshots = await requestPromise(snapshotsStore.index("documentId").getAll(documentId));
        snapshots.sort((a, b) => b.revision - a.revision);
        snapshots.slice(2).forEach((old) => snapshotsStore.delete([documentId, old.revision]));
        const cleanupThrough = journalCleanupRevision(snapshots.slice(0, 2));
        if (cleanupThrough >= 0) {
          const journalIndex = tx.objectStore(STORE_NAMES.journal).index("documentId");
          await deleteIndexRecords(
            journalIndex,
            documentIndexRange(this.IDBKeyRange, documentId),
            (record) => Number(record?.revision) <= cleanupThrough,
          );
        }
        leases.put({
          ...lease,
          heartbeatAt: now,
          expiresAt: now + Math.max(1000, Number(leaseDurationMs) || 90000),
          expectedRevision: updatedSafe,
        });
        return cloneValue(updated);
      });
    }

    async updateDocument(documentId, patch) {
      return this._transaction([STORE_NAMES.documents], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_NAMES.documents);
        const current = await requestPromise(store.get(documentId));
        if (!current) throw new RecoveryStoreError("The local recovery document no longer exists.", "DOCUMENT_NOT_FOUND");
        const updated = { ...current, ...cloneValue(patch) };
        store.put(updated);
        return cloneValue(updated);
      });
    }

    async deleteDocument(documentId) {
      return this._transaction(Object.values(STORE_NAMES), "readwrite", async (tx) => {
        tx.objectStore(STORE_NAMES.documents).delete(documentId);
        tx.objectStore(STORE_NAMES.sources).delete(documentId);
        tx.objectStore(STORE_NAMES.leases).delete(documentId);
        await deleteIndexRecords(
          tx.objectStore(STORE_NAMES.snapshots).index("documentId"),
          documentIndexRange(this.IDBKeyRange, documentId),
        );
        await deleteIndexRecords(
          tx.objectStore(STORE_NAMES.journal).index("documentId"),
          documentIndexRange(this.IDBKeyRange, documentId),
        );
        return true;
      });
    }

    async getMeta(key) {
      return this._transaction([STORE_NAMES.meta], "readonly", async (tx) => {
        const record = await requestPromise(tx.objectStore(STORE_NAMES.meta).get(key));
        return record ? cloneValue(record.value) : undefined;
      });
    }

    async setMeta(key, value) {
      return this._transaction([STORE_NAMES.meta], "readwrite", async (tx) => {
        tx.objectStore(STORE_NAMES.meta).put({ key, value: cloneValue(value) });
        return cloneValue(value);
      });
    }
  }

  class MemoryRecoveryStore {
    constructor(options = {}) {
      this.now = options.now || Date.now;
      this.documents = new Map();
      this.sources = new Map();
      this.snapshots = new Map();
      this.journal = new Map();
      this.leases = new Map();
      this.meta = new Map();
      this.opened = false;
      this.failNext = null;
    }

    async open() { this.opened = true; return this; }
    close() { this.opened = false; }
    _throwIfRequested(operation) {
      if (!this.failNext) return;
      const failure = this.failNext;
      this.failNext = null;
      throw failure instanceof Error ? failure : new RecoveryStoreError(String(failure), operation);
    }
    _snapshotMap(documentId) {
      if (!this.snapshots.has(documentId)) this.snapshots.set(documentId, new Map());
      return this.snapshots.get(documentId);
    }
    _journalMap(documentId) {
      if (!this.journal.has(documentId)) this.journal.set(documentId, new Map());
      return this.journal.get(documentId);
    }

    async createDocument({ documentRecord, sourceRecord, snapshotRecord, leaseRecord }) {
      this._throwIfRequested("createDocument");
      if (this.documents.has(documentRecord.documentId)) throw new RecoveryConflictError("Document exists.", "DOCUMENT_EXISTS");
      this.documents.set(documentRecord.documentId, cloneValue(documentRecord));
      this.sources.set(sourceRecord.documentId, cloneValue(sourceRecord));
      this._snapshotMap(snapshotRecord.documentId).set(snapshotRecord.revision, cloneValue(snapshotRecord));
      this.leases.set(leaseRecord.documentId, cloneValue(leaseRecord));
      return cloneValue(documentRecord);
    }

    async listDocuments() {
      const now = this.now();
      return [...this.documents.values()]
        .map((record) => ({ ...cloneValue(record), leaseState: leaseState(this.leases.get(record.documentId), now) }))
        .sort((a, b) => Number(b.lastActiveAt || 0) - Number(a.lastActiveAt || 0));
    }

    async getBundle(documentId) {
      const documentRecord = this.documents.get(documentId);
      if (!documentRecord) return null;
      const snapshots = [...(this.snapshots.get(documentId)?.values() || [])].sort((a, b) => b.revision - a.revision);
      const journal = [...(this.journal.get(documentId)?.values() || [])].sort((a, b) => a.revision - b.revision);
      const lease = this.leases.get(documentId) || null;
      return cloneValue({
        documentRecord,
        sourceRecord: this.sources.get(documentId),
        snapshots,
        journal,
        lease,
        leaseState: leaseState(lease, this.now()),
      });
    }

    async acquireLease(documentId, sessionId, options = {}) {
      const record = this.documents.get(documentId);
      if (!record) throw new RecoveryStoreError("Document not found.", "DOCUMENT_NOT_FOUND");
      const now = this.now();
      const current = this.leases.get(documentId);
      const same = current?.sessionId === sessionId;
      const expired = !current || Number(current.expiresAt) <= now;
      if (current && !same && !expired) return { acquired: false, reason: "active", lease: cloneValue(current) };
      if (current && !same && expired && !options.explicitTakeover) return { acquired: false, reason: "stale", lease: cloneValue(current) };
      const duration = Math.max(1000, Number(options.durationMs) || 90000);
      const lease = {
        documentId,
        sessionId,
        acquiredAt: same ? current.acquiredAt : now,
        heartbeatAt: now,
        expiresAt: now + duration,
        expectedRevision: Number(record.lastSafeRevision || 0),
      };
      this.leases.set(documentId, lease);
      return { acquired: true, lease: cloneValue(lease) };
    }

    async heartbeatLease(documentId, sessionId, options = {}) {
      const now = this.now();
      const lease = this.leases.get(documentId);
      if (!lease || lease.sessionId !== sessionId || Number(lease.expiresAt) <= now) {
        throw new RecoveryConflictError("Lease lost.", "LEASE_LOST");
      }
      lease.heartbeatAt = now;
      lease.expiresAt = now + Math.max(1000, Number(options.durationMs) || 90000);
      lease.expectedRevision = Number(this.documents.get(documentId)?.lastSafeRevision || 0);
      return cloneValue(lease);
    }

    async releaseLease(documentId, sessionId) {
      const lease = this.leases.get(documentId);
      if (lease?.sessionId === sessionId) this.leases.delete(documentId);
      return true;
    }

    _assertWrite(documentId, sessionId, expectedRevision) {
      const now = this.now();
      const record = this.documents.get(documentId);
      if (!record) throw new RecoveryStoreError("Document not found.", "DOCUMENT_NOT_FOUND");
      const lease = this.leases.get(documentId);
      if (!lease || lease.sessionId !== sessionId || Number(lease.expiresAt) <= now) {
        throw new RecoveryConflictError("Lease lost.", "LEASE_LOST");
      }
      if (Number(record.lastSafeRevision || 0) !== Number(expectedRevision)) {
        throw new RecoveryConflictError("Stale revision.", "STALE_REVISION");
      }
      return { record, lease, now };
    }

    async commitJournal({ documentId, sessionId, expectedRevision, revision, entry, documentPatch = {}, leaseDurationMs = 90000 }) {
      this._throwIfRequested("commitJournal");
      const { record, lease, now } = this._assertWrite(documentId, sessionId, expectedRevision);
      this._journalMap(documentId).set(revision, cloneValue(entry));
      const updated = {
        ...record,
        ...cloneValue(documentPatch),
        lastSafeRevision: revision,
        latestJournalRevision: revision,
        lastActiveAt: now,
        lastModifiedAt: now,
        recoveryStatus: "active",
      };
      this.documents.set(documentId, updated);
      this.leases.set(documentId, {
        ...lease,
        heartbeatAt: now,
        expiresAt: now + Math.max(1000, Number(leaseDurationMs) || 90000),
        expectedRevision: revision,
      });
      return cloneValue(updated);
    }

    async commitSnapshot({ documentId, sessionId, expectedRevision, revision, snapshotRecord, documentPatch = {}, advanceSafe = false, leaseDurationMs = 90000 }) {
      this._throwIfRequested("commitSnapshot");
      const record = this.documents.get(documentId);
      const now = this.now();
      const lease = this.leases.get(documentId);
      if (!record) throw new RecoveryStoreError("Document not found.", "DOCUMENT_NOT_FOUND");
      if (!lease || lease.sessionId !== sessionId || Number(lease.expiresAt) <= now) {
        throw new RecoveryConflictError("Lease lost.", "LEASE_LOST");
      }
      const safe = Number(record.lastSafeRevision || 0);
      if (advanceSafe && safe !== Number(expectedRevision)) throw new RecoveryConflictError("Stale revision.", "STALE_REVISION");
      if (!advanceSafe && safe < Number(revision)) throw new RecoveryConflictError("Snapshot ahead of journal.", "SNAPSHOT_AHEAD_OF_JOURNAL");
      const snapshots = this._snapshotMap(documentId);
      snapshots.set(revision, cloneValue(snapshotRecord));
      const retainedRevisions = [...snapshots.keys()].sort((a, b) => b - a);
      retainedRevisions.slice(2).forEach((old) => snapshots.delete(old));
      const cleanupThrough = retainedRevisions.length > 1 ? retainedRevisions[1] : -1;
      const journal = this._journalMap(documentId);
      [...journal.keys()].filter((value) => value <= cleanupThrough).forEach((value) => journal.delete(value));
      const updatedSafe = advanceSafe ? revision : safe;
      const updated = {
        ...record,
        ...cloneValue(documentPatch),
        lastSafeRevision: updatedSafe,
        latestSnapshotRevision: revision,
        latestJournalRevision: Math.max(Number(record.latestJournalRevision || 0), updatedSafe),
        lastActiveAt: now,
        lastModifiedAt: now,
        recoveryStatus: "active",
      };
      this.documents.set(documentId, updated);
      this.leases.set(documentId, {
        ...lease,
        heartbeatAt: now,
        expiresAt: now + Math.max(1000, Number(leaseDurationMs) || 90000),
        expectedRevision: updatedSafe,
      });
      return cloneValue(updated);
    }

    async updateDocument(documentId, patch) {
      const current = this.documents.get(documentId);
      if (!current) throw new RecoveryStoreError("Document not found.", "DOCUMENT_NOT_FOUND");
      const updated = { ...current, ...cloneValue(patch) };
      this.documents.set(documentId, updated);
      return cloneValue(updated);
    }

    async deleteDocument(documentId) {
      this.documents.delete(documentId);
      this.sources.delete(documentId);
      this.snapshots.delete(documentId);
      this.journal.delete(documentId);
      this.leases.delete(documentId);
      return true;
    }

    async getMeta(key) { return cloneValue(this.meta.get(key)); }
    async setMeta(key, value) { this.meta.set(key, cloneValue(value)); return cloneValue(value); }
  }

  return {
    DATABASE_NAME,
    DATABASE_VERSION,
    STORE_NAMES,
    IndexedDbRecoveryStore,
    MemoryRecoveryStore,
    RecoveryStoreError,
    RecoveryConflictError,
    RecoveryUnavailableError,
    cloneValue,
    leaseState,
    documentIndexRange,
    journalCleanupRevision,
    createTransaction,
    version: "0.1.0-csv4",
  };
});
