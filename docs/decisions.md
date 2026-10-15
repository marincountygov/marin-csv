# Marin CSV architecture decisions

Status: accepted and authoritative for CSV-6 and subsequent implementation phases  
Original product decision date: 2026-10-13  
CSV-2 operational policy formalized: 2026-10-14  
CSV-3 workspace architecture formalized: 2026-10-14  
CSV-4 local recovery architecture formalized: 2026-10-14  
CSV-5 common delimiter support formalized: 2026-10-15
CSV-6 cell context-menu behavior formalized: 2026-10-15

## Product purpose

Marin CSV is a standalone MarinOS viewer and editor for comma-, tab-,
semicolon-, and pipe-delimited text files. It provides a familiar local-browser
editing interface without the silent type inference, date conversion,
scientific-notation conversion, leading-zero removal, or long-number precision
loss that spreadsheet software can introduce.

Marin CSV is a text-preserving delimited-file editor, not a spreadsheet. Every
field is represented as a string. The application does not provide formulas,
cell types, number formats, date formats, or automatic data cleanup.

## Accepted product decisions

### Decision 1 — Preservation guarantee: option B

Marin CSV guarantees both of the following:

1. When a file is opened and downloaded without data edits, the downloaded
   bytes are exactly the bytes that were opened.
2. After an edit, Marin CSV preserves the detected file-level conventions:
   delimiter, UTF-8 byte-order mark, dominant line-ending style, and final-line
   ending. It also preserves the original representation of each unchanged row
   wherever that row remains in the document.

Field values must never be interpreted, converted, normalized, truncated, or
sanitized without an explicit user operation.

This is not a promise that an edited file is byte-identical to the original.
Rows changed by an editing operation must be serialized again. Their quoting
may therefore change when required to represent the edited value safely.

### Decision 2 — First-row handling: option C

The first row is treated as column names by default. The user can switch the
current document to treat the first row as ordinary data. Marin CSV does not
use probabilistic or heuristic header detection.

Changing this setting changes view and editing semantics. It does not edit the
file by itself.

### Decision 3 — Initial editing scope: option B

The initial product scope includes:

- cell editing;
- row and column insertion and deletion;
- range copy and paste;
- undo and redo;
- view-only sorting and filtering;
- find and replace; and
- editing first-row column names when header mode is enabled.

Sorting and filtering never change exported row order. A future explicit
"apply sort" operation requires a separate product decision.

### Decision 4 — Supported formats: option B, expanded by CSV-5

Marin CSV supports a fixed list of four common single-character delimiters:

- comma;
- tab;
- semicolon; and
- pipe.

The application automatically evaluates all four and shows the selected
delimiter in the existing user-facing select list. The user may choose another
supported interpretation before editing. `.tsv` and `.psv` filenames are
tie-breaking hints; structural consistency remains authoritative. Custom and
multi-character delimiters remain out of scope.

### Decision 5 — Save behavior: option A

Saving always downloads a new file. Marin CSV does not request write access to
the original file and does not use a browser-specific direct-save API.

The generated name adds `-copy` to an untouched file or `-edited` to a changed
file before the extension. Repeated downloads add a numeric suffix. The
original file is never overwritten.

## Accepted implementation architecture

Marin CSV uses:

- Marin App Shell for application framing, standard information pages,
  navigation, status announcements, and MarinOS integration;
- Marin UI for the shared visual, responsive, light/dark, and accessibility
  baseline;
- Papa Parse 5.7.0 as an independent parser cross-check;
- Tabulator 6.6.1 for the spreadsheet-style grid; and
- a custom Marin CSV preservation engine as the authoritative document model.

The preservation engine, not Papa Parse and not Tabulator, is authoritative for
opened bytes, physical row order, exact field strings, edit history, and
export. Papa Parse disagreement is a blocking condition for fully editable
documents. Tabulator sorting and filtering remain view-only, and every grid
edit is returned to the preservation engine before it can affect a download.

There is no silent fallback editor. Missing, modified, or incorrectly declared
runtime dependencies block file opening with a visible error.

## CSV-2 operational decisions

### Profile every input before full materialization

Every file is scanned structurally before the complete editable row model is
created. Byte size alone is not sufficient: a small file can contain hundreds
of thousands of short records, and a modest row count can contain an unsafe
number of columns or fields.

The profile determines total physical rows, total fields, maximum columns,
delimiter, line-ending counts, formula-like-value count, structural warnings,
and a bounded row sample. Malformed UTF-8 and unclosed quotes remain blocking.

### Use three execution modes

The current conservative policy is:

- **Standard editing:** all paging and preview thresholds are below their
  limits.
- **Paged editing:** more than 5,000 physical rows, more than 100,000 fields, or
  more than 100 columns, provided no preview threshold is reached. The
  preservation engine retains the complete editable document; Tabulator
  receives 1,000 data rows per page. Sorting and filtering are disabled because
  applying them only to the active page would be misleading.
- **Read-only preview:** at least 24 MiB, at least 250,000 physical rows, at
  least 1,500,000 fields, or at least 1,000 columns. The application retains
  the exact source bytes and structural totals, displays no more than 1,000
  data rows, disables all document-changing and partial-view operations, and
  offers only an exact-copy download.

These thresholds are application safeguards supported by CSV-2 measurements.
They are not a universal maximum-file-size claim and may be revised through a
reviewed policy change with updated evidence and tests.

### Use a same-origin parsing worker where available

On normal HTTP and HTTPS origins, inspection, full parsing, Papa Parse
cross-validation, and policy classification run in a same-origin Web Worker.
The worker transfers the input buffer and adopts the completed transfer record
to avoid redundant full-document copies.

Where a worker cannot run, the application uses the same deterministic loader
on the main thread and identifies that execution path in file metadata. It
must not silently switch to a different parser or data model.

### Bound the visual grid independently of document size

Tabulator receives only the current view slice in paged mode and only the
retained sample in preview mode. The grid must create its own vertical and
horizontal scroll regions rather than expanding or clipping the page.

CSV-2 initially used a responsive maximum-height cap. CSV-3 supersedes that
presentation decision with an explicit viewport-aware pixel height calculated
from the actual grid position, viewport, status area, and visible normal-mode
footer. This changes only the visual workspace; paged and preview data limits
remain unchanged.

### Preserve exact-copy preview semantics

A read-only preview is not a partially validated editable document. Papa Parse
is intentionally not run across the full file in this mode because the file is
not reserialized. Download returns a copy of the original bytes. The strict
preservation scanner still validates UTF-8 and CSV quote structure across the
entire input before the preview opens.


## CSV-3 workspace decisions

### Use one explicit workspace state

Workspace mode is application UI state with exactly two values: `normal` and
`expanded`. It is represented authoritatively on the document body and changed
through one coordinated state transition. Workspace mode is independent of
CSV bytes, document metadata, dirty state, history, parsing, and serialization.

### Make normal mode a full-width spreadsheet workspace

Normal mode retains the complete MarinOS App Shell and footer while allowing
the editor to use essentially the full available content width. The grid,
compact toolbar, filename, warnings, file details, and status area form a
single spreadsheet-oriented workspace rather than a narrow content card.

### Provide in-page expanded mode, not browser fullscreen

Expanded mode consumes the usable browser viewport but must not call the
Fullscreen API. Browser tabs, address bar, controls, and operating-system chrome
remain available. The mode is session-only and is not written to storage, a
cookie, or the URL. A fresh page load starts in normal mode.

### Hide shell regions without duplicating them

Expanded mode temporarily hides the existing App Shell skip link, banner/header,
footer, and feedback hosts and makes them inert so their descendants are not exposed to
keyboard or accessibility interaction. Collapse restores each host's exact
previous `hidden` and `inert` state. Marin CSV retains a local application name,
current filename, command toolbar, warnings, and an always-visible Collapse
workspace control; it does not duplicate the full MarinOS navigation.

### Use a compact existing-command toolbar

CSV-3 reorganizes existing CSV-0 through CSV-2 commands into a compact toolbar.
It does not add non-functional spreadsheet controls or change command
semantics. Ambiguous actions retain visible plain-language labels and local
Lucide-style icons. Find/replace remains because it is existing accepted
functionality, even though introducing new find/replace behavior is outside the
CSV-3 scope.

### Resize Tabulator without rebuilding file state

The application measures the available dynamic viewport and supplies Tabulator
with an explicit pixel height. ResizeObserver, window/visual-viewport resize,
workspace transitions, and relevant disclosure changes schedule targeted
`setHeight()` and redraw operations. A workspace transition must not reparse,
serialize, recreate the document, clear history, or reload the page.

Grid focus is restored after resizing only when focus originated inside the
grid. Layout work must not synthesize clicks or steal focus from toolbar,
dialog, or other application controls.

### Define Escape and focus behavior

Escape precedence is: an open dialog or transient control, an active grid or
form interaction, then expanded workspace collapse. Expand and Collapse are
keyboard operable. After a workspace transition, focus remains on the persistent
workspace toggle or returns there predictably; it does not reset to the top of
the document.

### Workspace mode has zero serialization effect

Equivalent edits made in normal and expanded modes must produce identical
bytes. Expanding or collapsing is not navigation and must not trigger an
unsaved-change warning, alter dirty/download state, clear undo/redo history, or
change the document.

## CSV-4 local recovery decisions

### Automatically recover every opened document

Every opened standard, paged, or preview document receives a stable generated
local document ID and a browser-local IndexedDB recovery record when storage is
available. A filename is display metadata, not identity.

### Combine immediate journal writes with debounced snapshots

Every committed engine mutation creates a deterministic forward journal entry.
The entry and safe-revision pointer commit transactionally and in order. Full
snapshots are compacted approximately 500 milliseconds after changes. **Saved
locally** means the current revision can be reconstructed from a supported
snapshot plus a complete contiguous journal; it does not mean a file was
downloaded.

### Keep multiple local documents and retain them after download

Recent local documents may contain multiple records, including duplicate
filenames. Downloading does not delete a record. Deletion is explicit. Deleting
the active copy keeps the in-memory document open with local recovery off and
requires an explicit resume action before any new record is created.

### Restore only on a positively identified refresh

A browser-classified reload plus a matching opaque active-document ID may
restore automatically. A fresh visit, restart, new tab, back/forward navigation,
or ambiguous condition presents recovery choices instead of automatically
showing retained content. Recovered documents start in normal workspace mode.

### Restore contents, not undo/redo or transient view state

Recovery restores exact document values and preservation metadata. Undo and
redo start empty. Selection, focus, scrolling, sorting, filtering, paging,
dialog state, and expanded workspace state are not persisted.

### Permit one writer per document

IndexedDB leases and revision checks permit one active writer. A second tab
opens read-only and may create an independent copy. Stale lease takeover
requires expiry and explicit user action. BroadcastChannel notifications are
advisory; transaction checks remain authoritative.

### Request persistent browser storage without depending on it

Marin CSV requests persistent storage after the first successful record. Denial
or lack of support does not prevent ordinary IndexedDB recovery. The interface
must not claim that browser storage is permanent, archival, or user-key
encrypted.

### Permit shared-origin hosting only with governance review

IndexedDB isolation is origin-based. Shared-origin deployment is allowed for
CSV-4, but production use with sensitive information requires explicit County
security and privacy review of all code able to execute on the origin. A unique
database name is not a security boundary.

### Keep database and payload versions independent

IndexedDB schema, source records, snapshots, and journal commands are separately
versioned. Database upgrades are non-destructive. Unsupported or damaged
records are retained, and Marin CSV may offer the last valid revision read-only
rather than silently deleting or guessing.

## CSV-5 common delimiter decisions

### Use a fixed four-option list

The Delimiter control contains Comma (,), Tab, Semicolon (;), and Pipe (|). No
custom-character field or mandatory opening dialog is introduced.

### Keep automatic opening and advisory warnings

Marin CSV automatically selects the strongest supported interpretation. If two
interpretations are similarly plausible, it warns the user to check the
delimiter. If the selected interpretation has one column, it warns that another
delimiter may be appropriate. Warnings do not repair or reject data.

### Preserve filenames and use deliberate MIME types

Downloaded files keep the original extension. Comma uses `text/csv`, tab uses
`text/tab-separated-values`, and semicolon and pipe use `text/plain`, all with
UTF-8 charset metadata. Download bytes remain governed only by the preservation
engine.

### Do not migrate IndexedDB

Delimiter values are already versioned recovery strings. CSV-5 does not change
the IndexedDB database schema or snapshot format. Existing comma and tab local
copies remain compatible.

## Dependency policy

All production browser assets are vendored locally. Marin CSV does not load
Papa Parse, Tabulator, fonts, CSS, JavaScript, icons, or other core interface
assets from a public CDN.

Third-party versions are exact, not ranges. The vendoring script rejects other
versions and records SHA-256 checksums for copied browser files. A reviewed
`package-lock.json`, actual vendored distributions, notices, and licenses are
release requirements.

## CSV-6 cell context-menu decisions

### Use one single-cell context

Right-click, touch hold, Shift+F10, and the Context Menu key target one data
field. The target stores a stable row ID plus its physical document row and
column. Visual sorting and filtering never redefine the mutation target.

### Route every mutation through the preservation engine

Edit field, Clear field, Delete row, and Delete column use existing document
commands. They remain undoable, journaled for IndexedDB recovery, and governed
by the same download validation as direct edits and toolbar commands.

### Keep structural deletion confirmed

Deleting a row or column uses the existing accessible confirmation dialog.
Clearing one field is immediate and undoable. A header record cannot be
deleted as a data row, and the final remaining column cannot be deleted.

### Make value filtering exact and view-only

Filter to this value matches the clicked column using exact, case-sensitive
string equality, including blank, whitespace, and multiline values. It
combines with the global text filter using AND semantics. It never changes
dirty state, undo history, IndexedDB recovery, or serialized output.

### Keep the custom menu limited to useful modes

Standard editable documents expose all five commands. Standard read-only
conflict documents expose only exact-value filtering. Paged editable documents
expose edit, clear, and structural deletion but not filtering. Read-only
preview documents retain the browser's native context menu.

## Deferred decisions

The following remain outside CSV-5:

- a universal or publicly promised maximum file size;
- non-UTF-8 transcoding;
- custom, multi-character, or additional delimiters beyond comma, tab,
  semicolon, and pipe;
- applying a visual sort to the saved document;
- a sanitized export for formula-injection risk;
- browser File System Access API support;
- XLSX import or export;
- advanced row/column selection beyond the CSV-6 single-cell context menu;
- fill handles, drag-to-copy, freeze panes, and richer spreadsheet shortcuts;
- richer status-bar calculations or spreadsheet formulas; and
- claiming WCAG 2.2 AA conformance without complete manual evidence.

Each deferred capability must preserve the data-integrity contract and must not
be added as an implicit side effect of another feature.
