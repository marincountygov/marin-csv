# Marin CSV — CSV-4 local workspace recovery

Status: implemented specification  
Build: `0.1.0-csv.4`  
Date: 2026-10-14

## Purpose

CSV-4 allows current work to survive an ordinary page refresh, accidental tab
closure, and browser restart when browser-managed storage remains available.
It is local workspace recovery, not filesystem autosave. A completed recovery
write means Marin CSV can reconstruct the document; it does not mean the
original file was updated or a downloaded CSV was created.

CSV-4 must not change CSV parsing, field interpretation, serialization, large-
file classification, or the authority of the preservation engine.

## Accepted decisions

1. Local recovery is automatically enabled for every opened document.
2. Full snapshots are debounced approximately 500 milliseconds after changes.
3. Multiple recoverable documents are retained and exposed through Recent
   local documents.
4. Downloading does not remove a recovery copy; deletion is explicit.
5. Persistent browser storage is requested when available, with graceful
   best-effort fallback.
6. Shared-origin deployment is permitted only with explicit security and
   privacy review and restrictions for sensitive data.
7. Every committed mutation is written to a transactional edit journal; the
   journal closes most of the 500-millisecond snapshot window.
8. Recovered document values and metadata are restored, but undo/redo history
   starts empty.
9. A confirmed browser reload may restore automatically. Fresh visits,
   restarts, new tabs, and ambiguous navigation show recovery choices instead
   of automatically exposing retained content.

## Fundamental rules

- `CsvDocument` and `CsvPreviewDocument` remain authoritative for document
  semantics.
- IndexedDB stores validated recovery material; it does not parse or serialize
  CSV independently.
- Tabulator remains a presentation boundary.
- Every field remains a string.
- Recovery may report **Saved locally** only when the current revision can be
  reconstructed from a supported snapshot and a complete contiguous journal.
- Download remains the user-controlled operation that creates a CSV/TSV file
  outside browser-managed storage.
- CSV data must not enter URLs, `localStorage`, `sessionStorage`, analytics,
  telemetry, logs, or server requests. `sessionStorage` may contain only an
  opaque tab session ID and active document ID.
- Expanded workspace mode, focus, selection, sort/filter state, scroll
  position, dialogs, and other transient UI state are not persisted.

## Components

- `assets/csv-engine.js`: snapshot/hydration contract and deterministic forward
  recovery commands.
- `assets/recovery-store.js`: IndexedDB schema, transactions, revisions,
  snapshots, journals, source bytes, leases, deletion, and database lifecycle.
- `assets/recovery-coordinator.js`: document revisions, journal scheduling,
  snapshot compaction, writer leases, refresh detection, restoration, status,
  conflict handling, persistent-storage request, and recovery suspension.
- `assets/app.js`: Recent local documents, recovery notices, confirmation
  dialogs, startup behavior, and integration with existing CSV workflows.

## Storage model

The database is `marin-csv-recovery`, schema version 1. Database schema,
snapshot format, journal format, and source format are independently versioned.
The stores are:

| Store | Key | Purpose |
|---|---|---|
| `documents` | `documentId` | Lightweight identity, timestamps, current revisions, modes, and pointers |
| `sources` | `documentId` | Immutable original bytes and source conventions |
| `snapshots` | `[documentId, revision]` | Complete validated document snapshots |
| `journal` | `[documentId, revision]` | Ordered deterministic forward changes |
| `leases` | `documentId` | Active-writer ownership and expiry |
| `meta` | `key` | Origin-level persistence-request status and future migration metadata |

Filenames are display metadata, never unique identifiers.

## Journal and checkpoint lifecycle

For every committed document mutation:

1. The engine commits the in-memory change and emits a normalized command.
2. The coordinator increments the document revision.
3. The status changes to waiting/saving.
4. A journal transaction verifies lease ownership and the expected previous
   revision, then writes the entry and advances `lastSafeRevision` atomically.
5. Only transaction completion permits **Saved locally**.
6. A 500-millisecond debounce schedules a complete snapshot.
7. Snapshot compaction keeps the newest two valid snapshots and the journal
   required to reconstruct from the retained fallback snapshot.

Writes for one document are serialized. Stale or out-of-order writes abort.
Read/write IndexedDB transactions request strict durability where supported and
fall back to ordinary durability only when the transaction options API itself
is unsupported.

## Recovery reconstruction

Restoration loads the newest supported snapshot and applies each contiguous
journal entry in revision order. It validates snapshot, source, and command
format versions and every command base revision. If the newest state is
invalid, Marin CSV may open the last valid reconstructable revision read-only,
report the degradation, retain the damaged records, and allow the user to
create an independent writable copy.

Undo and redo stacks are intentionally empty after recovery. The field values,
physical row order, delimiter, BOM, newline conventions, trailing-newline
state, header configuration, dirty/download state, and preview totals remain
recoverable.

## Startup behavior

- Confirmed reload + valid opaque active-document ID + valid recovery record:
  restore automatically.
- Fresh navigation, browser restart, new tab, back/forward restoration, or
  ambiguous classification: show Recent local documents without opening data.
- No records: show the ordinary file-open interface.
- Every restored document opens in normal MarinOS workspace mode.

## Concurrency

One tab may write a document at a time. A writer lease contains the document
ID, session ID, acquisition and heartbeat timestamps, expiry, and expected
revision. The initial policy uses a 15-second heartbeat and 90-second expiry.
A second tab opens the document read-only and may create an independent copy.
A stale lease may be taken over only after expiry and explicit user action.
`BroadcastChannel` accelerates notifications but IndexedDB transactions remain
the consistency authority.

## Deletion and recovery suspension

Deleting an inactive record removes its metadata, source, snapshots, journal,
and lease. Deleting the active record keeps the in-memory document open but
sets **Local recovery off**, invalidates pending writes, and prevents later
edits from silently recreating the record. The user must explicitly choose
**Resume local recovery**. A changed document with recovery off retains unload
and document-switch protection even after a download.

## Storage and failure behavior

- Persistent storage is requested asynchronously after the first successful
  record. Denial does not disable IndexedDB.
- Quota estimates are advisory; transaction errors are authoritative.
- Quota or transaction failure retains the last valid checkpoint and must not
  falsely report the current revision as saved.
- IndexedDB unavailability does not block CSV editing, but the interface warns
  that local recovery is unavailable.
- Blocked database upgrades require another tab to close or refresh; the
  database is never deleted as a recovery strategy.
- A `versionchange` event stops new writes, closes the connection, preserves
  the in-memory document, and requests a user-controlled reload.

## Large-file modes

Standard and paged documents store the immutable source plus complete document
snapshots and journals. Paged recovery covers the complete model, not only the
visible page. Preview documents store original bytes, source metadata, totals,
and the bounded preview rows; recovery must not create a complete editable
model merely to persist a preview.

## Security and privacy boundary

IndexedDB is isolated by origin, not pathname or database name. Shared-origin
hosting therefore requires a County security and privacy review of every code
path capable of executing on that origin. A unique database name is not a
security boundary. The application does not claim user-managed encryption,
permanent archival storage, or protection from a user clearing browser data.

## Required verification

The release must include unit tests for snapshot/hydration, journal ordering,
strict durability fallback, fallback snapshots, failure handling, and leases;
browser tests for the complete UI workflow; and real-origin persistent-profile
tests for native IndexedDB, refresh, restart, and multi-tab behavior. The
in-memory browser fixture is a complementary deterministic test, not a
substitute for native IndexedDB.
