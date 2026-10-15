# CSV-4 implementation findings

Build: `0.1.0-csv.4`  
Date: 2026-10-14

## Architecture result

Native IndexedDB is implementable without changing the preservation contract.
The final implementation keeps persistence in two new modules and adds only a
versioned snapshot/hydration and normalized-command boundary to the engine.
Tabulator and Papa Parse remain outside the persistence authority.

## Material defects found during implementation

1. **Browser timer receiver failure.** Passing unbound native timer functions
   into the coordinator caused an `Illegal invocation` after the first record
   was created. Default timers are now receiver-safe wrappers.
2. **IndexedDB cleanup key mismatch.** Snapshot/journal cleanup initially used
   a compound key range against an index keyed only by `documentId`. Cleanup
   now uses the index's actual key and predicate-based revision filtering.
3. **Fallback reconstruction gap.** Deleting all journal entries covered by the
   newest snapshot made the retained older snapshot unusable. Compaction now
   retains the journal needed by the second snapshot.
4. **Restricted storage initialization.** Reading `sessionStorage` can throw on
   opaque or policy-restricted origins. All session reads/writes are guarded;
   recovery failure no longer prevents ordinary CSV file handlers from loading.
5. **Stale asynchronous writes after deletion.** A journal already in flight
   could otherwise recreate or reclassify a deliberately deleted active copy.
   Attachment generations now invalidate queued/in-flight results.
6. **Active-document poisoning.** Failure to create an unrelated independent
   copy could mark a safe active document as failed. Copy failures now preserve
   the active attachment and its correct status.
7. **Grid focus timing regression.** Recovery status updates added an
   asynchronous layout cycle after block paste. The replacement grid now
   receives the physical focus target during construction and after the
   operation.
8. **Recovery-off unload gap.** A user could download, delete the local copy,
   and then close a still-modified in-memory document without a warning because
   the download marker was current. Recovery-off modified work now retains
   unload and document-switch protection.
9. **Duplicate-filename action ambiguity.** Filename-only accessible names were
   not sufficient when two retained documents shared the same name. Recent
   document actions now include both the filename and local-save timestamp, and
   each entry exposes whether work is unchanged, downloaded, or not downloaded.

## Retained limitations

- IndexedDB data is origin-scoped and not user-key encrypted.
- Browsers may clear best-effort storage; persistent-storage requests may be
  denied.
- The managed test Chromium blocks localhost, so native IndexedDB, persistent
  browser-profile restart, and real-origin multi-tab tests were authored but
  could not run in this environment.
- Recovery does not restore undo/redo or transient grid/workspace state.
- After an abrupt close, a writer lease may remain active for up to 90 seconds;
  another tab remains read-only or creates an independent copy until explicit
  stale-lease takeover is available.
- CSV-4 remains Alpha pending human accessibility, privacy, security, managed-
  device, and normal-origin browser review.
