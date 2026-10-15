# Marin CSV data-integrity contract

Status: authoritative for CSV-4  
Last reviewed: 2026-10-14

## Governing rule

Marin CSV must never silently interpret, convert, normalize, truncate, repair,
reorder, or sanitize a field. Every field is a string. Display state must not
become export state.

## Input and encoding

Marin CSV accepts comma-delimited CSV and tab-delimited TSV. Input is decoded as
strict UTF-8, with or without a UTF-8 BOM. Invalid UTF-8 and unclosed quoted
fields are rejected rather than guessed or repaired.

Delimiter detection is deterministic between comma and tab. The user may
explicitly choose either delimiter before editing. The app does not infer
whether the first row is a header: header mode is on by default and remains
user-controlled.

## Mandatory structural profile

Every input is scanned across its complete byte content before the application
creates a fully editable model. The profile records:

- total physical rows and fields;
- maximum column count;
- delimiter and BOM state;
- CRLF, LF, and CR counts;
- final-line-ending state;
- structural warnings;
- formula-like-value count; and
- only the bounded number of row objects needed to support a possible preview.

This inspection must occur even for a small byte stream because short records
can still produce unsafe row or field counts.

## Fully editable documents

For standard and paged editing, Marin CSV parses with its preservation scanner
and independently parses the same text with Papa Parse using string-only,
non-skipping settings. A mismatch or Papa Parse error blocks editing and
download.

The preservation engine retains:

- the original byte array;
- exact cell strings;
- original raw text for unchanged rows;
- row separators;
- quote preference flags;
- physical row order;
- edit history; and
- the current download sequence.

Tabulator receives view data only. It may not own the source bytes, serialize
the file, or redefine physical row coordinates.

## Unchanged download

When no document edit has occurred, `exportBytes()` returns a copy of the
original byte array. Header-mode changes, page changes, filters, visual sorts,
selection, and focus are not document edits and do not alter the bytes.

## Workspace-state independence

Normal and expanded workspace modes are presentation state only. Expanding,
collapsing, resizing, opening or closing toolbar disclosures, and restoring
focus must not:

- change source bytes or field strings;
- modify delimiter, header, encoding, line-ending, or preview metadata;
- create a document-history command;
- change dirty or downloaded state;
- clear undo or redo history;
- reorder rows or columns;
- invoke parsing or serialization; or
- change download output.

Equivalent data edits made in normal and expanded modes must serialize to
identical bytes. Workspace mode is not stored in the CSV document or exported
metadata.

## Edited download

After an edit, Marin CSV:

- retains the original comma or tab delimiter;
- retains an original UTF-8 BOM;
- uses the original dominant line-ending style for inserted or reconstructed
  separators;
- retains the original final-line-ending choice;
- emits each unchanged surviving row from its original raw text; and
- serializes a changed or inserted row with correct escaping for the active
  delimiter, quotes, carriage returns, and line feeds.

A field is quoted when required. A field that was quoted originally remains
quoted when its row is reconstructed. Marin CSV does not add a quote merely to
change how another application may infer a data type.

Immediately before download, the current serialized editable document is
independently parsed again with Papa Parse and compared cell-for-cell with the
authoritative model. A disagreement or parser error stops the download without
changing the open document.

## Read-only exact-copy preview

A preview document retains the complete original byte array, complete
structural totals, and no more than 1,000 data rows for display. It is
read-only. Cell edits, paste, row/column changes, headers editing, find/replace,
undo/redo, sorting, and filtering are unavailable.

The strict preservation profile has already scanned the entire file for UTF-8
and quote validity. Papa Parse is not applied to the complete preview input
because no reconstructed output is permitted. Download returns a new exact
copy of the original bytes. A preview must never be presented as a fully parsed
or editable file.

## Paged editing

Paged mode retains the complete editable `CsvDocument` and exposes 1,000 data
rows at a time to Tabulator. Each visible row carries its physical document
index. Edits, paste, undo, redo, page changes, and downloads continue to address
the full preservation model.

Sorting and filtering are disabled in paged mode. Applying either only to the
active physical page would imply a whole-file operation that did not occur.

## Worker transfer

On a normal HTTP/HTTPS origin, the same-origin worker receives ownership of the
input `ArrayBuffer`. After parsing, it transfers the original byte buffer back
and allows the main thread to adopt the returned row and metadata structures.
The transfer path must avoid redundant full-document copies while preserving
the same model and validation behavior as direct parsing.

The worker is an execution boundary, not a trust boundary or alternate parser.
Worker failure is surfaced as an error; it must not produce a partially parsed
editable document.

## Multiline field editing

HTML textareas normalize carriage-return line endings. The grid editor must not
allow that browser behavior to alter a field merely because the user opened and
closed it.

For a multiline field:

- opening and saving without a text change returns the original exact string;
- an intentional edit uses the field's existing dominant embedded line-ending
  convention; and
- a field with no existing embedded line ending uses the document's retained
  line-ending convention for newly entered line breaks.

## Structural fidelity

These records are distinct and remain distinct:

```csv
A,B,C
1,2,
1,2
```

The first data record has three fields; the second has two. Marin CSV warns
about inconsistent record width but does not repair it automatically.

Blank records, trailing empty fields, blank column names, and duplicate column
names are allowed, warned about, and preserved. Warning collection is bounded
so highly irregular input cannot create an unbounded warning object list; the
summary states when additional warnings were omitted.

## Editing and history

Document-changing commands participate in undo and redo. Creating a new edit
from an earlier history position discards the former redo branch and
invalidates any prior downloaded marker for that branch.

Cell edits, block paste, row/column insertion or deletion, header edits, and
find/replace all use preservation-engine commands. The grid must not serialize
or independently retain a different document state.

An empty or whitespace-only find value is rejected by the interface.

## Sorting and filtering

In standard mode, sorting and filtering operate on view-model references to
document rows. They must not reorder, delete, or rewrite authoritative rows.
Export order remains physical document order.

## Rendering untrusted text

Headers and cells are untrusted local-file content. They must be rendered as
text, not interpreted as HTML. A value such as `<img onerror=...>` or
`<script>...</script>` must remain visible literal text and must not create an
element or execute code.

## Formula-like text

Fields beginning with `=`, `+`, `-`, or `@` can be interpreted as formulas by
spreadsheet software. Marin CSV warns about these values but preserves them
exactly. It does not prefix an apostrophe, remove characters, or otherwise
sanitize the value silently.

## Local recovery integrity

When IndexedDB is available, Marin CSV stores exact source bytes, versioned
preservation-engine snapshots, and deterministic forward journal commands in
browser-managed storage. Recovery must reconstruct the same current document
state that would have serialized before refresh.

A revision is locally safe only after the IndexedDB transaction containing its
journal entry or approved snapshot has completed and the revision sequence is
contiguous. An older or stale write cannot advance the safe revision.

Recovery must preserve exact strings, physical row/column structure, delimiter,
BOM, newline conventions, trailing-newline choice, header mode, dirty/download
state, and preview totals. It intentionally does not restore undo/redo or
transient UI state.

If newer recovery material is damaged or unsupported, Marin CSV may use the
last valid snapshot plus contiguous journal and open that state read-only. It
must not silently fabricate missing commands, skip a gap, or delete the record.

Preview recovery stores exact source bytes and bounded preview metadata. It must
not materialize omitted rows merely to create a checkpoint.

## Local processing and storage

Marin CSV does not place file content in URLs, `localStorage`, `sessionStorage`,
analytics, console output, error telemetry, or network requests. CSV-4 does
intentionally persist recovery records in IndexedDB until explicitly deleted or
removed by browser storage controls. `sessionStorage` may contain only opaque
session/document identifiers.

IndexedDB is a recovery mechanism, not CSV authority and not a downloaded file.
The App Shell may request its standard public MarinOS metadata feeds as declared
in `security.json`; those requests must not include CSV-derived values.
