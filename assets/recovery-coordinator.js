/* Marin CSV CSV-4 local recovery coordinator: journal, snapshots, leases, and startup recovery. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinCsvRecovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SNAPSHOT_FORMAT_VERSION = 1;
  const JOURNAL_FORMAT_VERSION = 1;
  const SOURCE_FORMAT_VERSION = 1;
  const DEFAULT_DEBOUNCE_MS = 500;
  const DEFAULT_HEARTBEAT_MS = 15000;
  const DEFAULT_LEASE_MS = 90000;
  const DEFAULT_LARGE_COMMAND_BYTES = 512 * 1024;
  const DEFAULT_STORAGE_PREFLIGHT_BYTES = 8 * 1024 * 1024;
  const SESSION_ID_KEY = "marinCsv.tabSessionId";
  const ACTIVE_DOCUMENT_KEY = "marinCsv.activeDocumentId";
  const CHANNEL_NAME = "marin-csv-recovery";

  const STATUS = Object.freeze({
    IDLE: "idle",
    WAITING: "waiting",
    SAVING: "saving",
    SAVED: "saved",
    RECOVERED: "recovered",
    DEGRADED: "degraded",
    OFF: "off",
    UNAVAILABLE: "unavailable",
    FULL: "full",
    CONFLICT: "conflict",
    BLOCKED: "blocked",
    RELOAD_REQUIRED: "reload-required",
    UNSUPPORTED: "unsupported",
    ERROR: "error",
  });

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

  function createId(prefix = "csv") {
    const cryptoObject = typeof crypto !== "undefined" ? crypto : null;
    if (typeof cryptoObject?.randomUUID === "function") return `${prefix}-${cryptoObject.randomUUID()}`;
    const random = Math.random().toString(36).slice(2);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function defaultSessionStorage() {
    try { return globalThis?.sessionStorage || null; } catch (_) { return null; }
  }

  function safeSessionGet(storage, key) {
    try { return storage?.getItem?.(key) || null; } catch (_) { return null; }
  }

  function safeSessionSet(storage, key, value) {
    try { storage?.setItem?.(key, value); return true; } catch (_) { return false; }
  }

  function safeSessionRemove(storage, key) {
    try { storage?.removeItem?.(key); return true; } catch (_) { return false; }
  }

  function confirmedReload(performanceObject) {
    try {
      const navigation = performanceObject?.getEntriesByType?.("navigation")?.[0];
      return navigation?.type === "reload";
    } catch (_) {
      return false;
    }
  }

  function commandSize(command) {
    try {
      const text = JSON.stringify(command);
      if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
      return text.length * 2;
    } catch (_) {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  function normalizeTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function makeDocumentPatch(documentModel, policyMode, revision, previous = {}, capturedState = null) {
    const state = capturedState || documentModel.recoveryState?.() || {};
    const downloadedRevision = !state.hasUndownloadedChanges && Number(state.downloadCount || 0) > 0
      ? revision
      : previous.lastDownloadedRevision ?? null;
    return {
      filename: documentModel.filename || "Untitled CSV",
      documentMode: policyMode || (documentModel.preview ? "preview" : "standard"),
      headerConfiguration: state.headerMode === false ? "data" : "headers",
      delimiter: documentModel.delimiter,
      lastDownloadedRevision: downloadedRevision,
      snapshotFormatVersion: SNAPSHOT_FORMAT_VERSION,
      journalFormatVersion: JOURNAL_FORMAT_VERSION,
      workingStatus: state.hasUndownloadedChanges ? "changed" : state.modifiedFromOpen ? "downloaded" : "unchanged",
    };
  }

  function sourceRecord(documentId, documentModel) {
    return {
      documentId,
      formatVersion: SOURCE_FORMAT_VERSION,
      originalBytes: new Uint8Array(documentModel.originalBytes),
      byteLength: documentModel.originalBytes.byteLength,
      filename: documentModel.filename || "data.csv",
      delimiter: documentModel.delimiter,
      bom: Boolean(documentModel.bom),
      newline: documentModel.newline,
      newlineCounts: { ...(documentModel.newlineCounts || {}) },
      trailingNewline: Boolean(documentModel.trailingNewline),
      initialDocumentMode: documentModel.preview ? "preview" : "editable",
    };
  }

  function snapshotRecord(documentId, revision, documentModel, now) {
    const payload = documentModel.toRecoverySnapshot();
    return {
      documentId,
      revision,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      createdAt: now,
      payload,
    };
  }

  function journalRecord(documentId, revision, sessionId, event, now) {
    return {
      documentId,
      revision,
      baseRevision: revision - 1,
      sessionId,
      commandFormatVersion: JOURNAL_FORMAT_VERSION,
      commandType: event.command?.type || "unknown",
      payload: cloneValue(event.command),
      state: cloneValue(event.state || {}),
      label: String(event.label || "Document change"),
      createdAt: now,
    };
  }

  class RecoveryCoordinator {
    constructor(options = {}) {
      if (!options.store) throw new TypeError("RecoveryCoordinator requires a persistence store.");
      if (!options.engine) throw new TypeError("RecoveryCoordinator requires the Marin CSV preservation engine.");
      this.store = options.store;
      this.engine = options.engine;
      this.now = options.now || Date.now;
      // Window timer functions require their native receiver in some browsers.
      // Wrapping the defaults keeps them callable as coordinator methods while
      // preserving injectable deterministic timers for tests.
      this.setTimeout = options.setTimeout || ((callback, delay) => globalThis.setTimeout(callback, delay));
      this.clearTimeout = options.clearTimeout || ((handle) => globalThis.clearTimeout(handle));
      this.setInterval = options.setInterval || ((callback, delay) => globalThis.setInterval(callback, delay));
      this.clearInterval = options.clearInterval || ((handle) => globalThis.clearInterval(handle));
      this.sessionStorage = Object.prototype.hasOwnProperty.call(options, "sessionStorage")
        ? options.sessionStorage
        : defaultSessionStorage();
      this.performance = Object.prototype.hasOwnProperty.call(options, "performance")
        ? options.performance
        : (typeof performance !== "undefined" ? performance : null);
      this.navigator = Object.prototype.hasOwnProperty.call(options, "navigator")
        ? options.navigator
        : (typeof navigator !== "undefined" ? navigator : null);
      this.BroadcastChannel = Object.prototype.hasOwnProperty.call(options, "BroadcastChannel")
        ? options.BroadcastChannel
        : (typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null);
      this.debounceMs = Math.max(0, Number(options.debounceMs ?? DEFAULT_DEBOUNCE_MS));
      this.heartbeatMs = Math.max(1000, Number(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS));
      this.leaseMs = Math.max(this.heartbeatMs * 2, Number(options.leaseMs ?? DEFAULT_LEASE_MS));
      this.largeCommandBytes = Math.max(1024, Number(options.largeCommandBytes ?? DEFAULT_LARGE_COMMAND_BYTES));
      this.storagePreflightBytes = Math.max(
        1024,
        Number(options.storagePreflightBytes ?? DEFAULT_STORAGE_PREFLIGHT_BYTES),
      );
      this.onStatus = options.onStatus || (() => {});
      this.onConflict = options.onConflict || (() => {});
      this.onDocumentsChanged = options.onDocumentsChanged || (() => {});
      this.onBlocked = options.onBlocked || (() => {});
      this.onVersionChange = options.onVersionChange || (() => {});

      this.initialized = false;
      this.available = false;
      this.sessionId = safeSessionGet(this.sessionStorage, SESSION_ID_KEY) || createId("session");
      safeSessionSet(this.sessionStorage, SESSION_ID_KEY, this.sessionId);
      this.document = null;
      this.documentId = null;
      this.policyMode = "standard";
      this.revision = 0;
      this.safeRevision = 0;
      this.snapshotRevision = 0;
      this.lastDownloadedRevision = null;
      this.writable = false;
      this.suspended = false;
      this.failed = false;
      this.unsubscribe = null;
      this.writeChain = Promise.resolve();
      this.snapshotTimer = null;
      this.heartbeatTimer = null;
      this.channel = null;
      this.status = { code: STATUS.IDLE, message: "", documentId: null, revision: 0 };
      this.lastCompactionError = null;
      this.lastDownloadedRevision = null;
      this.attachmentGeneration = 0;
      this.lastStorageEstimate = null;
    }

    _setStatus(code, message = "", details = {}) {
      this.status = {
        code,
        message,
        documentId: this.documentId,
        revision: this.revision,
        safeRevision: this.safeRevision,
        writable: this.writable,
        suspended: this.suspended,
        ...details,
      };
      this.onStatus(cloneValue(this.status));
      return this.status;
    }

    async initialize() {
      if (this.initialized) return { available: this.available, status: cloneValue(this.status) };
      this.initialized = true;
      try {
        await this.store.open();
        this.available = true;
        this._openChannel();
        this._setStatus(STATUS.IDLE, "Local recovery is ready.");
      } catch (error) {
        this.available = false;
        this._setStatus(STATUS.UNAVAILABLE, "Local recovery is unavailable.", { error });
      }
      return { available: this.available, status: cloneValue(this.status) };
    }

    _openChannel() {
      if (!this.BroadcastChannel || this.channel) return;
      try {
        this.channel = new this.BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          const message = event?.data;
          if (!message || message.sessionId === this.sessionId) return;
          if (message.documentId === this.documentId) {
            if (message.type === "deleted") {
              this.writable = false;
              this.failed = true;
              this._stopHeartbeat();
              this._setStatus(STATUS.CONFLICT, "The local recovery copy was deleted in another tab.", { reason: "deleted" });
              this.onConflict({ type: "deleted", message });
            } else if (message.type === "writer" || message.type === "revision") {
              this.onConflict({ type: "external-change", message });
            }
          }
          this.onDocumentsChanged();
        };
      } catch (_) {
        this.channel = null;
      }
    }

    _broadcast(type, details = {}) {
      try {
        this.channel?.postMessage?.({
          type,
          sessionId: this.sessionId,
          documentId: details.documentId || this.documentId,
          revision: details.revision ?? this.revision,
          ...details,
        });
      } catch (_) {}
    }

    isConfirmedReload() {
      return confirmedReload(this.performance);
    }

    activeDocumentIdFromSession() {
      return safeSessionGet(this.sessionStorage, ACTIVE_DOCUMENT_KEY);
    }

    async listDocuments() {
      if (!this.available) return [];
      try { return await this.store.listDocuments(); }
      catch (error) {
        this._setStatus(STATUS.ERROR, "Local recovery records could not be listed.", { error });
        return [];
      }
    }

    _documentRecord(documentId, documentModel, policyMode, now) {
      return {
        documentId,
        createdAt: now,
        lastActiveAt: now,
        lastModifiedAt: now,
        latestSnapshotRevision: 0,
        latestJournalRevision: 0,
        lastSafeRevision: 0,
        lastDownloadedRevision: null,
        snapshotFormatVersion: SNAPSHOT_FORMAT_VERSION,
        journalFormatVersion: JOURNAL_FORMAT_VERSION,
        recoveryStatus: "active",
        ...makeDocumentPatch(documentModel, policyMode, 0),
      };
    }

    _leaseRecord(documentId, revision = 0) {
      const now = this.now();
      return {
        documentId,
        sessionId: this.sessionId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + this.leaseMs,
        expectedRevision: revision,
      };
    }

    async startNewDocument(documentModel, options = {}) {
      if (!this.initialized) await this.initialize();
      if (!this.available) {
        this._setStatus(STATUS.UNAVAILABLE, "Local recovery is unavailable.");
        return { enabled: false, document: documentModel, documentId: null };
      }
      const documentId = options.documentId || createId("document");
      const policyMode = options.policyMode || (documentModel.preview ? "preview" : "standard");
      const now = this.now();
      try {
        await this._preflightStorage(this._estimatedRecoveryBytes(documentModel));
        await this.store.createDocument({
          documentRecord: this._documentRecord(documentId, documentModel, policyMode, now),
          sourceRecord: sourceRecord(documentId, documentModel),
          snapshotRecord: snapshotRecord(documentId, 0, documentModel, now),
          leaseRecord: this._leaseRecord(documentId, 0),
        });
        await this.detachCurrent({ releaseLease: true, clearSession: false });
        this._attach(documentModel, {
          documentId,
          policyMode,
          revision: 0,
          safeRevision: 0,
          snapshotRevision: 0,
          lastDownloadedRevision: null,
          writable: true,
        });
        this._setStatus(STATUS.SAVED, "Saved locally.");
        this._broadcast("writer");
        this.onDocumentsChanged();
        this.requestPersistentStorage().catch(() => {});
        return { enabled: true, document: documentModel, documentId, writable: true, policyMode };
      } catch (error) {
        // Creating an independent copy must not poison an already safe active
        // document when the new record cannot be written. Initial opening, an
        // explicitly detached replacement, and recovery resumption still need
        // to report the persistence failure on the current coordinator.
        const preserveActive = Boolean(this.document && !this.suspended && !options.detachOnFailure);
        if (options.detachOnFailure) await this.detachCurrent({ releaseLease: true });
        if (!preserveActive) this._handleWriteError(error);
        return { enabled: false, document: documentModel, documentId: null, error };
      }
    }

    _attach(documentModel, options) {
      this.attachmentGeneration += 1;
      this.document = documentModel;
      this.documentId = options.documentId;
      this.policyMode = options.policyMode || (documentModel.preview ? "preview" : "standard");
      this.revision = Number(options.revision || 0);
      this.safeRevision = Number(options.safeRevision ?? this.revision);
      this.snapshotRevision = Number(options.snapshotRevision ?? 0);
      this.lastDownloadedRevision = options.lastDownloadedRevision ?? null;
      this.writable = Boolean(options.writable);
      this.suspended = false;
      this.failed = false;
      this.lastCompactionError = null;
      this.unsubscribe?.();
      this.unsubscribe = this.writable && typeof documentModel.subscribeRecovery === "function"
        ? documentModel.subscribeRecovery((event) => this._onMutation(event))
        : null;
      safeSessionSet(this.sessionStorage, ACTIVE_DOCUMENT_KEY, this.documentId);
      if (this.writable) this._startHeartbeat();
      else this._stopHeartbeat();
    }

    async detachCurrent(options = {}) {
      this.attachmentGeneration += 1;
      if (this.snapshotTimer) {
        this.clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      this.unsubscribe?.();
      this.unsubscribe = null;
      this._stopHeartbeat();
      const documentId = this.documentId;
      const writable = this.writable;
      this.document = null;
      this.documentId = null;
      this.revision = 0;
      this.safeRevision = 0;
      this.snapshotRevision = 0;
      this.writable = false;
      this.suspended = false;
      this.failed = false;
      if (options.releaseLease && documentId && writable && this.available) {
        try { await this.store.releaseLease(documentId, this.sessionId); } catch (_) {}
        this._broadcast("released", { documentId });
      }
      if (options.clearSession !== false) safeSessionRemove(this.sessionStorage, ACTIVE_DOCUMENT_KEY);
    }

    _isCurrentAttachment(generation, documentId, documentModel = null) {
      return generation === this.attachmentGeneration
        && documentId === this.documentId
        && (!documentModel || documentModel === this.document);
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      this.heartbeatTimer = this.setInterval(() => {
        if (!this.documentId || !this.writable || this.failed) return;
        const generation = this.attachmentGeneration;
        const documentId = this.documentId;
        this.store.heartbeatLease(documentId, this.sessionId, { durationMs: this.leaseMs })
          .catch((error) => {
            if (this._isCurrentAttachment(generation, documentId)) this._handleWriteError(error);
          });
      }, this.heartbeatMs);
    }

    _stopHeartbeat() {
      if (this.heartbeatTimer) this.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    _onMutation(event) {
      if (!this.document || !this.documentId || !this.writable || this.suspended || this.failed) return;
      this.revision += 1;
      const revision = this.revision;
      const now = this.now();
      const generation = this.attachmentGeneration;
      const documentId = this.documentId;
      const documentModel = this.document;
      const policyMode = this.policyMode;
      const sessionId = this.sessionId;
      const capturedState = cloneValue(event.state || documentModel.recoveryState?.() || {});
      const patch = makeDocumentPatch(
        documentModel,
        policyMode,
        revision,
        { lastDownloadedRevision: this.lastDownloadedRevision },
        capturedState,
      );
      const entry = journalRecord(documentId, revision, sessionId, event, now);
      const attachment = { generation, documentId, documentModel };
      const entryBytes = commandSize(entry.payload);
      this._setStatus(STATUS.WAITING, "Changes waiting to save.");
      if (entryBytes > this.largeCommandBytes) {
        const snapshot = snapshotRecord(documentId, revision, documentModel, now);
        this._queueWrite(async () => {
          this._setStatus(STATUS.SAVING, "Saving locally…");
          await this._preflightStorage(Math.max(entryBytes, this._estimatedRecoveryBytes(documentModel)));
          await this.store.commitSnapshot({
            documentId,
            sessionId,
            expectedRevision: revision - 1,
            revision,
            snapshotRecord: snapshot,
            documentPatch: patch,
            advanceSafe: true,
            leaseDurationMs: this.leaseMs,
          });
          if (!this._isCurrentAttachment(generation, documentId, documentModel)) return;
          this.safeRevision = revision;
          this.snapshotRevision = revision;
          if (patch.lastDownloadedRevision != null) this.lastDownloadedRevision = patch.lastDownloadedRevision;
          this._afterWrite(revision);
        }, attachment);
      } else {
        this._queueWrite(async () => {
          this._setStatus(STATUS.SAVING, "Saving locally…");
          await this.store.commitJournal({
            documentId,
            sessionId,
            expectedRevision: revision - 1,
            revision,
            entry,
            documentPatch: patch,
            leaseDurationMs: this.leaseMs,
          });
          if (!this._isCurrentAttachment(generation, documentId, documentModel)) return;
          this.safeRevision = revision;
          if (patch.lastDownloadedRevision != null) this.lastDownloadedRevision = patch.lastDownloadedRevision;
          this._afterWrite(revision);
        }, attachment);
      }
      this._scheduleSnapshot();
    }

    _queueWrite(task, attachment = null) {
      this.writeChain = this.writeChain.then(async () => {
        if (attachment && !this._isCurrentAttachment(
          attachment.generation,
          attachment.documentId,
          attachment.documentModel,
        )) return;
        if (this.failed || !this.writable || this.suspended) return;
        try { await task(); }
        catch (error) {
          if (!attachment || this._isCurrentAttachment(
            attachment.generation,
            attachment.documentId,
            attachment.documentModel,
          )) this._handleWriteError(error);
        }
      });
      return this.writeChain;
    }

    _afterWrite(revision) {
      this._broadcast("revision", { revision });
      if (this.safeRevision >= this.revision) this._setStatus(STATUS.SAVED, "Saved locally.");
      else this._setStatus(STATUS.WAITING, "Changes waiting to save.");
      this.onDocumentsChanged();
    }

    _scheduleSnapshot() {
      if (this.snapshotTimer) this.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = this.setTimeout(() => {
        this.snapshotTimer = null;
        this.checkpointNow().catch(() => {});
      }, this.debounceMs);
    }

    async checkpointNow() {
      if (!this.document || !this.documentId || !this.writable || this.suspended || this.failed) return false;
      const revision = this.revision;
      const generation = this.attachmentGeneration;
      const documentId = this.documentId;
      const documentModel = this.document;
      const policyMode = this.policyMode;
      const sessionId = this.sessionId;
      const capturedState = cloneValue(documentModel.recoveryState?.() || {});
      const patch = makeDocumentPatch(
        documentModel,
        policyMode,
        revision,
        { lastDownloadedRevision: this.lastDownloadedRevision },
        capturedState,
      );
      const snapshot = snapshotRecord(documentId, revision, documentModel, this.now());
      this.writeChain = this.writeChain.then(async () => {
        if (!this._isCurrentAttachment(generation, documentId, documentModel)
            || this.failed || !this.writable || this.suspended || revision > this.safeRevision) return;
        try {
          await this._preflightStorage(this._estimatedRecoveryBytes(documentModel));
          await this.store.commitSnapshot({
            documentId,
            sessionId,
            expectedRevision: this.safeRevision,
            revision,
            snapshotRecord: snapshot,
            documentPatch: patch,
            advanceSafe: false,
            leaseDurationMs: this.leaseMs,
          });
          if (!this._isCurrentAttachment(generation, documentId, documentModel)) return;
          this.snapshotRevision = Math.max(this.snapshotRevision, revision);
          if (patch.lastDownloadedRevision != null) this.lastDownloadedRevision = patch.lastDownloadedRevision;
          this.lastCompactionError = null;
          if (this.safeRevision >= this.revision) this._setStatus(STATUS.SAVED, "Saved locally.");
        } catch (error) {
          if (!this._isCurrentAttachment(generation, documentId, documentModel)) return;
          // A compaction failure does not invalidate already committed journal
          // entries. Keep the document marked recoverable and retry later.
          this.lastCompactionError = error;
          if (this.safeRevision >= this.revision) {
            this._setStatus(STATUS.SAVED, "Saved locally.", { compactionWarning: true, error });
          } else this._handleWriteError(error);
        }
      });
      await this.writeChain;
      return this._isCurrentAttachment(generation, documentId, documentModel)
        && this.snapshotRevision >= revision;
    }

    async flush() {
      if (this.snapshotTimer) {
        this.clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      await this.writeChain;
      await this.checkpointNow();
      await this.writeChain;
      return this.safeRevision >= this.revision;
    }

    _handleWriteError(error) {
      const code = error?.code || error?.name || "RECOVERY_ERROR";
      if (code === "QUOTA_EXCEEDED" || error?.name === "QuotaExceededError") {
        this.failed = true;
        this._setStatus(STATUS.FULL, "Browser storage is full.", { error });
      } else if (["LEASE_LOST", "STALE_REVISION", "RECOVERY_SUSPENDED"].includes(code)) {
        this.failed = true;
        this.writable = false;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this._stopHeartbeat();
        this._setStatus(STATUS.CONFLICT, "This document is open or changed in another tab.", { error, reason: code });
        this.onConflict({ type: code, error });
      } else if (code === "RECOVERY_UNAVAILABLE") {
        this.failed = true;
        this._setStatus(STATUS.UNAVAILABLE, "Local recovery is unavailable.", { error });
      } else {
        this.failed = true;
        this._setStatus(STATUS.ERROR, "Changes are not saved locally.", { error });
      }
    }

    _supportedSnapshot(bundle) {
      const failures = [];
      const targetRevision = Number(bundle?.documentRecord?.lastSafeRevision);
      if (!Number.isInteger(targetRevision) || targetRevision < 0) {
        const error = new Error("The local recovery record has an invalid revision.");
        error.code = "INVALID_RECOVERY_REVISION";
        throw error;
      }
      if (!bundle.sourceRecord || bundle.sourceRecord.formatVersion !== SOURCE_FORMAT_VERSION) {
        const error = new Error("This local copy uses an unsupported source format.");
        error.code = "UNSUPPORTED_SOURCE";
        throw error;
      }
      const journalEntries = [...(bundle.journal || [])]
        .sort((a, b) => Number(a.revision) - Number(b.revision));
      const journalByRevision = new Map();
      journalEntries.forEach((entry) => {
        const revision = Number(entry?.revision);
        if (!Number.isInteger(revision) || revision < 1 || journalByRevision.has(revision)) return;
        journalByRevision.set(revision, entry);
      });

      for (const record of bundle.snapshots || []) {
        let documentModel;
        const snapshotRevision = Number(record?.revision);
        try {
          if (record.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
            failures.push({ revision: snapshotRevision, code: "UNSUPPORTED_SNAPSHOT" });
            continue;
          }
          if (!Number.isInteger(snapshotRevision) || snapshotRevision < 0 || snapshotRevision > targetRevision) {
            failures.push({ revision: snapshotRevision, code: "INVALID_SNAPSHOT_REVISION" });
            continue;
          }
          documentModel = this.engine.documentFromRecoverySnapshot(
            record.payload,
            bundle.sourceRecord.originalBytes,
          );
        } catch (error) {
          failures.push({ revision: snapshotRevision, code: error?.code || "INVALID_SNAPSHOT", error });
          continue;
        }

        let recoveredRevision = snapshotRevision;
        for (let expected = snapshotRevision + 1; expected <= targetRevision; expected += 1) {
          const entry = journalByRevision.get(expected);
          if (!entry) {
            failures.push({ revision: expected, code: "JOURNAL_GAP" });
            break;
          }
          try {
            if (entry.commandFormatVersion !== JOURNAL_FORMAT_VERSION) {
              throw Object.assign(new Error("Unsupported recovery journal format."), { code: "UNSUPPORTED_JOURNAL" });
            }
            if (Number(entry.baseRevision) !== expected - 1) {
              throw Object.assign(new Error("The recovery journal contains a revision gap."), { code: "JOURNAL_GAP" });
            }
            documentModel.applyRecoveryCommand(entry.payload, entry.state);
            recoveredRevision = expected;
          } catch (error) {
            failures.push({ revision: expected, code: error?.code || "INVALID_JOURNAL", error });
            break;
          }
        }

        return {
          document: documentModel,
          snapshotRevision,
          recoveredRevision,
          expectedRevision: targetRevision,
          degraded: recoveredRevision < targetRevision,
          failures,
        };
      }
      const error = new Error("This local copy cannot be reconstructed by this version of Marin CSV.");
      error.code = "UNSUPPORTED_RECOVERY";
      error.failures = failures;
      throw error;
    }

    async restoreDocument(documentId, options = {}) {
      if (!this.initialized) await this.initialize();
      if (!this.available) throw Object.assign(new Error("Local recovery is unavailable."), { code: "RECOVERY_UNAVAILABLE" });
      const bundle = await this.store.getBundle(documentId);
      if (!bundle) throw Object.assign(new Error("The selected local copy no longer exists."), { code: "DOCUMENT_NOT_FOUND" });
      const recovered = this._supportedSnapshot(bundle);
      const degraded = Boolean(recovered.degraded);
      let writable = options.writable !== false && !degraded;
      let leaseResult = { acquired: false, reason: degraded ? "degraded" : "read-only" };
      if (writable) {
        leaseResult = await this.store.acquireLease(documentId, this.sessionId, {
          durationMs: this.leaseMs,
          explicitTakeover: Boolean(options.explicitTakeover),
        });
        writable = Boolean(leaseResult.acquired);
      }
      const sameDocument = documentId === this.documentId;
      await this.detachCurrent({ releaseLease: !sameDocument, clearSession: false });
      if (!writable && !recovered.document.preview) recovered.document.readOnly = true;
      this._attach(recovered.document, {
        documentId,
        policyMode: bundle.documentRecord.documentMode,
        revision: recovered.recoveredRevision,
        safeRevision: recovered.recoveredRevision,
        snapshotRevision: recovered.snapshotRevision,
        lastDownloadedRevision: bundle.documentRecord.lastDownloadedRevision ?? null,
        writable,
      });
      if (degraded) {
        this._setStatus(STATUS.DEGRADED, "Recovered the last valid local revision. Newer recovery data could not be applied.", {
          failures: recovered.failures,
          expectedRevision: recovered.expectedRevision,
          recoveredRevision: recovered.recoveredRevision,
          readOnly: true,
          reason: "degraded",
        });
      } else if (writable) {
        this._setStatus(STATUS.RECOVERED, "Recovered local work.", { failures: recovered.failures });
        this._broadcast("writer");
      } else {
        this._setStatus(STATUS.CONFLICT, "This document is open in another tab.", {
          reason: leaseResult.reason,
          lease: leaseResult.lease,
          readOnly: true,
          failures: recovered.failures,
        });
      }
      this.onDocumentsChanged();
      return {
        document: recovered.document,
        documentId,
        writable,
        conflict: !writable && !degraded,
        degraded,
        conflictReason: leaseResult.reason,
        policyMode: bundle.documentRecord.documentMode,
        failures: recovered.failures,
        expectedRevision: recovered.expectedRevision,
        recoveredRevision: recovered.recoveredRevision,
      };
    }

    async createIndependentCopy(documentId) {
      const bundle = await this.store.getBundle(documentId);
      if (!bundle) throw Object.assign(new Error("The selected local copy no longer exists."), { code: "DOCUMENT_NOT_FOUND" });
      const recovered = this._supportedSnapshot(bundle);
      if (!recovered.document.preview) recovered.document.readOnly = false;
      const result = await this.startNewDocument(recovered.document, { policyMode: bundle.documentRecord.documentMode });
      if (!result.enabled) throw result.error || Object.assign(new Error("The independent local copy could not be created."), { code: "COPY_FAILED" });
      return result;
    }

    async createIndependentCopyFromCurrent() {
      if (!this.document) throw Object.assign(new Error("No document is open."), { code: "NO_ACTIVE_DOCUMENT" });
      const copy = this.engine.documentFromRecoverySnapshot(
        this.document.toRecoverySnapshot(),
        this.document.originalBytes,
      );
      if (!copy.preview) copy.readOnly = false;
      const result = await this.startNewDocument(copy, { policyMode: this.policyMode });
      if (!result.enabled) throw result.error || Object.assign(new Error("The independent local copy could not be created."), { code: "COPY_FAILED" });
      return result;
    }

    async deleteDocument(documentId) {
      const active = documentId === this.documentId;
      if (active) {
        // Invalidate queued writes before deleting so an in-flight checkpoint
        // cannot recreate or reclassify a deliberately removed local copy.
        this.attachmentGeneration += 1;
        if (this.snapshotTimer) {
          this.clearTimeout(this.snapshotTimer);
          this.snapshotTimer = null;
        }
        this.unsubscribe?.();
        this.unsubscribe = null;
        this._stopHeartbeat();
      }
      await this.store.deleteDocument(documentId);
      this._broadcast("deleted", { documentId });
      if (active) {
        this.suspended = true;
        this.writable = false;
        this.failed = false;
        safeSessionRemove(this.sessionStorage, ACTIVE_DOCUMENT_KEY);
        this._setStatus(STATUS.OFF, "Local recovery off.");
      }
      this.onDocumentsChanged();
      return true;
    }

    async resumeCurrent() {
      if (!this.document) return { enabled: false };
      const model = this.document;
      const mode = this.policyMode;
      const documentId = this.documentId || createId("document");
      return this.startNewDocument(model, { policyMode: mode, documentId });
    }

    async requestPersistentStorage() {
      try {
        const previous = await this.store.getMeta("persistentStorage");
        if (previous?.status) return previous;
      } catch (_) {}
      const storage = this.navigator?.storage;
      if (!storage || typeof storage.persist !== "function") {
        const result = { status: "unsupported", granted: false, checkedAt: this.now() };
        await this.store.setMeta("persistentStorage", result);
        return result;
      }
      try {
        if (typeof storage.persisted === "function" && await storage.persisted()) {
          const result = { status: "granted", granted: true, checkedAt: this.now() };
          await this.store.setMeta("persistentStorage", result);
          return result;
        }
        const granted = Boolean(await storage.persist());
        const result = { status: granted ? "granted" : "denied", granted, checkedAt: this.now() };
        await this.store.setMeta("persistentStorage", result);
        return result;
      } catch (error) {
        const result = { status: "error", granted: false, checkedAt: this.now(), message: String(error?.message || error) };
        try { await this.store.setMeta("persistentStorage", result); } catch (_) {}
        return result;
      }
    }

    async storageEstimate() {
      try {
        const estimate = await this.navigator?.storage?.estimate?.();
        return estimate ? { usage: Number(estimate.usage || 0), quota: Number(estimate.quota || 0) } : null;
      } catch (_) { return null; }
    }

    _estimatedRecoveryBytes(documentModel) {
      const sourceBytes = Number(documentModel?.originalBytes?.byteLength || 0);
      const cellCount = Number(documentModel?.cellCount || 0);
      // This estimate is intentionally conservative and allocation-free. It is
      // advisory only; the IndexedDB transaction remains authoritative.
      const structuredStateBytes = Math.max(0, cellCount) * 24;
      return Math.max(sourceBytes, sourceBytes + structuredStateBytes);
    }

    async _preflightStorage(estimatedWriteBytes) {
      const requested = Math.max(0, Number(estimatedWriteBytes) || 0);
      if (requested < this.storagePreflightBytes) return null;
      const estimate = await this.storageEstimate();
      if (!estimate) return null;
      const remaining = Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0));
      const result = {
        ...estimate,
        remaining,
        estimatedWriteBytes: requested,
        storagePressure: Number(estimate.quota || 0) > 0 && requested > remaining,
        checkedAt: this.now(),
      };
      this.lastStorageEstimate = result;
      return result;
    }

    handleBlockedUpgrade() {
      this._setStatus(STATUS.BLOCKED, "Close or refresh other Marin CSV tabs to continue local recovery.");
      this.onBlocked();
    }

    handleVersionChange() {
      this.attachmentGeneration += 1;
      if (this.snapshotTimer) {
        this.clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      this.failed = true;
      this.writable = false;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this._stopHeartbeat();
      this._setStatus(STATUS.RELOAD_REQUIRED, "Marin CSV was updated in another tab. Reload to continue local recovery.");
      this.onVersionChange();
    }

    isCurrentRevisionSafe() {
      return !this.document || this.suspended || (this.safeRevision >= this.revision && !this.failed);
    }

    destroy() {
      if (this.snapshotTimer) this.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
      this._stopHeartbeat();
      this.unsubscribe?.();
      this.unsubscribe = null;
      try { this.channel?.close?.(); } catch (_) {}
      this.channel = null;
      this.store.close?.();
    }
  }

  return {
    RecoveryCoordinator,
    STATUS,
    SNAPSHOT_FORMAT_VERSION,
    JOURNAL_FORMAT_VERSION,
    SOURCE_FORMAT_VERSION,
    DEFAULT_DEBOUNCE_MS,
    DEFAULT_HEARTBEAT_MS,
    DEFAULT_LEASE_MS,
    DEFAULT_LARGE_COMMAND_BYTES,
    DEFAULT_STORAGE_PREFLIGHT_BYTES,
    SESSION_ID_KEY,
    ACTIVE_DOCUMENT_KEY,
    confirmedReload,
    commandSize,
    createId,
    makeDocumentPatch,
    sourceRecord,
    snapshotRecord,
    journalRecord,
    normalizeTimestamp,
    version: "0.1.0-csv4",
  };
});
