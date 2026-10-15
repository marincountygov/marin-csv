# CSV-4 local recovery architecture

## Boundary

```text
Tabulator / application controls
              |
              v
Authoritative CsvDocument or CsvPreviewDocument
              |
       normalized recovery events
              |
              v
RecoveryCoordinator
   | journal immediately
   | snapshot after 500 ms
   | one-writer lease
   v
IndexedDbRecoveryStore
   | documents | sources | snapshots | journal | leases | meta
```

The preservation engine is the only component allowed to define CSV state.
The store persists structured snapshots and engine commands; it never derives
rows from DOM order, Tabulator sorting, filtering, paging, or selection.

## Safe-revision invariant

`lastSafeRevision` advances only in the same read/write transaction that adds
the corresponding journal entry or, for an explicitly permitted initial or
large-command checkpoint, the corresponding snapshot. A document is locally
safe only when the coordinator's current revision is no greater than the
persisted safe revision and no write failure is active.

Snapshot compaction does not reduce safety: the newest two snapshots remain,
and journal cleanup stops at the older retained snapshot. This permits fallback
reconstruction if the newest snapshot is damaged.

Before an unusually large source or snapshot write, the coordinator consults
`navigator.storage.estimate()` when available. The result is advisory and is
never used as a substitute for the IndexedDB transaction result; quota errors
remain authoritative and preserve the last valid checkpoint.

## Startup privacy model

The only session-scoped values are opaque identifiers. Automatic recovery
requires both a browser-classified reload and a matching active document ID.
Every ambiguous case uses the chooser. This avoids automatically displaying
retained file contents after a browser restart or fresh visit.

## Writer model

A lease is acquired transactionally. Journal and snapshot transactions verify
that the writing session still owns a non-expired lease and that the expected
revision matches. A second tab is read-only. Explicit independent copy creates
a new document ID and its own source/snapshot chain. Expired leases require an
explicit takeover action.

After an abrupt tab or browser close, the previous writer lease can remain
active until its 90-second expiry. During that interval another tab opens the
record read-only or creates an independent copy; it never silently takes over.

## Degraded recovery

The coordinator attempts snapshots from newest to oldest. It applies only a
contiguous supported journal. If it reaches less than the expected safe
revision, it returns the last valid state read-only and reports every observed
failure. Records remain available for explicit deletion or future migration.

## Browser lifecycle

- `blocked`: initialization pauses and asks the user to close or refresh older
  tabs.
- `versionchange`: new writes stop, the connection closes, and the in-memory
  document remains available until the user reloads or downloads it.
- `beforeunload`: only a secondary warning. Recovery never depends on starting
  an asynchronous write while the page is closing.
