# CSV-4 IndexedDB schema

Database: `marin-csv-recovery`  
Database schema version: `1`

## `documents`

Key path: `documentId`  
Index: `lastActiveAt`

Important fields:

- `documentId`, `filename`
- `createdAt`, `lastActiveAt`, `lastModifiedAt`
- `documentMode`: `standard`, `paged`, or `preview`
- `headerConfiguration`, `delimiter`, `workingStatus`
- `latestSnapshotRevision`, `latestJournalRevision`, `lastSafeRevision`
- `lastDownloadedRevision`
- `snapshotFormatVersion`, `journalFormatVersion`
- `recoveryStatus`

The record is intentionally lightweight so Recent local documents can render
without loading source bytes or full snapshots.

## `sources`

Key path: `documentId`

The source record is written once per local document and contains format
version, exact original bytes, byte length, filename, delimiter, BOM, newline
counts, dominant newline, trailing-newline state, and initial document mode.
It is not rewritten at every checkpoint.

## `snapshots`

Compound key path: `[documentId, revision]`  
Index: `documentId`

Each record contains `documentId`, `revision`, `formatVersion`, `createdAt`, and
the engine-generated `payload`. The store retains the newest two snapshots.

## `journal`

Compound key path: `[documentId, revision]`  
Index: `documentId`

Each record contains:

- `documentId`, `revision`, `baseRevision`
- `sessionId`, `createdAt`
- `commandFormatVersion`, `commandType`, `payload`
- post-command recovery `state`
- human-readable command `label`

Journal cleanup removes entries only through the older retained snapshot.

## `leases`

Key path: `documentId`

Fields: `documentId`, `sessionId`, `acquiredAt`, `heartbeatAt`, `expiresAt`, and
`expectedRevision`.

## `meta`

Key path: `key`

CSV-4 stores the origin-level persistent-storage request outcome under
`persistentStorage`. Future migrations may add metadata without changing
snapshot or journal payload versions.
