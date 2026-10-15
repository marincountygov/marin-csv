# CSV-4 recovery payload formats

Snapshot, journal, source, and IndexedDB schema versions are intentionally
separate.

## Snapshot format version 1

### Full document

`kind: "full"` snapshots contain filename, delimiter, BOM, cloned physical
rows including raw representation and row identity, warnings, parser-validation
result, newline counts and convention, trailing-newline state, and recovery
state. Original bytes are referenced from the separate source record.

### Preview document

`kind: "preview"` snapshots contain the bounded retained rows, document totals,
formula-like count, warnings, file conventions, and recovery state. The source
record supplies exact bytes. The payload never contains a complete editable
model.

### Excluded state

Undo/redo stacks, selection, focus, scroll position, sort, filter, current
page, dialogs, and expanded workspace mode are excluded.

## Journal command format version 1

Commands are deterministic forward engine operations:

- `replace-rows`: replace exact physical rows by zero-based index.
- `splice-rows`: insert/delete physical rows at an exact index.
- `set-header-mode`: change first-row presentation semantics without changing
  bytes.
- `download-state`: update download count and dirty/download markers.

Each entry also records the complete post-command recovery state. Replay rejects
unsupported commands, invalid coordinates, duplicate revisions, base-revision
mismatches, and journal gaps.

## Source format version 1

The source record contains exact original bytes and immutable file-level
conventions. It permits untouched byte-identical download and snapshot
reconstruction without duplicating source bytes in every snapshot.
