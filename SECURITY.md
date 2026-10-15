# Security policy

## Reporting a vulnerability

Report suspected security or privacy issues to
`innovation@marincounty.gov`. Do not include confidential data, personal
information, or a real CSV file in the initial report. Use a minimal synthetic
reproduction. Reporting metadata is also published at
`.well-known/security.txt`.

## Data handling

Marin CSV parses and edits selected files locally on the application origin. It
does not upload CSV contents, add them to URLs, send them to analytics or error
telemetry, or write them to `localStorage` or `sessionStorage`.

CSV-4 intentionally stores browser-local recovery records in IndexedDB. These
records may include original file bytes, current field values, file metadata,
snapshots, and edit-journal entries. They remain until the user deletes them,
browser storage is cleared, the browser evicts best-effort storage, or the
browser profile is removed. Downloading a CSV does not delete its recovery
copy.

`sessionStorage` contains only opaque tab/document identifiers used to
recognize a confirmed refresh. No CSV values or filenames are stored there.

On normal HTTP/HTTPS origins, a same-origin Web Worker inspects and parses the
file. CSP restricts workers to `'self'`.

## IndexedDB security boundary

IndexedDB is isolated by origin, not URL path or database name. On shared-origin
hosting, other applications or compromised code executing on that origin are
inside the same browser-storage security boundary. A unique database name does
not isolate Marin CSV from other same-origin JavaScript.

Production use of local recovery on a shared origin therefore requires explicit
County security and privacy review, particularly before use with PHI or other
restricted information. A dedicated origin remains a future hardening option.

Browser-managed storage is not user-key encrypted and Marin CSV does not claim
that it is archival, permanent, or protected from a user clearing site data.
Use an appropriate managed device and follow County information-handling and
retention rules.

## Recovery integrity controls

- Every committed edit uses an ordered transactional journal.
- `lastSafeRevision` advances only with the corresponding committed recovery
  material and expected-revision check.
- Snapshot compaction retains a previous snapshot and the journal needed to
  reconstruct it.
- One active writer is allowed per recovered document.
- Lease ownership and revisions are validated in the same IndexedDB transaction
  as journal/snapshot writes.
- Stale writes abort rather than overwriting newer state.
- Damaged or unsupported records are retained and may fall back to the last
  valid revision read-only.
- Read/write transactions request strict durability when supported.
- Recovery does not depend on asynchronous work begun during `beforeunload`.

## Dependency and release controls

Core runtime assets are served locally. Papa Parse and Tabulator must remain at
the exact reviewed versions, be copied by the deterministic vendoring script,
retain their licenses, and be recorded with SHA-256 checksums. A release
requires a reviewed lockfile, dependency scan, license review, and browser
verification.

`security.json` generates static CSP/referrer metadata and `security.txt` and
must remain synchronized.

## CSV-specific risks

Values beginning with `=`, `+`, `-`, or `@` may be interpreted as formulas by
spreadsheet software after export. Marin CSV warns but does not silently alter
them.

Malformed UTF-8 and unclosed quoted fields are rejected. Papa Parse
cross-validation is mandatory for fully editable documents. Preview mode has a
different explicit contract: the preservation scanner validates the complete
input, only bounded rows are materialized, and download returns exact source
bytes.

User-controlled headers and cells are rendered as literal text. Structural
warning collection is bounded to reduce memory-amplification risk.

## Large-document safeguards

Every input is profiled before full materialization. Conservative row, field,
column, and byte thresholds select standard editing, paged editing, or a
bounded read-only preview. Preview recovery retains source bytes and bounded
metadata without constructing a complete editable model.
