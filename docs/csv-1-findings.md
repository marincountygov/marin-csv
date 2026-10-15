# CSV-1 integration findings

Date: 2026-10-13
Status: completed implementation phase; alpha release gates remain

## Objective

CSV-1 replaced CSV-0's temporary dependency-independent editor with the exact
reviewed Papa Parse 5.7.0 and Tabulator 6.6.1 distributions. The phase tested
whether those libraries could be integrated without giving either library
authority over CSV values, physical row order, history, or serialization.

## Outcome

The selected architecture is feasible:

- the custom preservation engine remains the sole document model;
- Papa Parse independently validates the source at open and the current
  serialization immediately before download;
- Tabulator provides the visual editor, range selection, copying, sorting, and
  filtering;
- edits and pasted blocks are returned to the preservation engine; and
- sorting and filtering do not alter exported row order.

CSV-1 removes the reference editor from the production runtime. If the exact
vendored dependencies are missing, modified, incorrectly declared, or fail to
load, Marin CSV shows a blocking error rather than silently switching editors.

## Integration defects found and corrected

### Multiline editor normalization

Tabulator's ordinary single-line input editor is not suitable for multiline CSV
fields. In addition, an HTML textarea normalizes CRLF and CR in its value to LF.
Merely opening and committing a multiline field could therefore change data.

CSV-1 adds a text-only custom textarea editor that:

- uses a compact one-line presentation until the field becomes multiline;
- returns the original exact string after a no-op multiline edit;
- converts intentional multiline edits back to the field's existing dominant
  embedded line-ending convention;
- uses the document line-ending convention when a previously single-line field
  becomes multiline;
- uses Enter to save a single-line field and Alt+Enter to add its first line
  break; and
- uses Shift+Enter to save a multiline field while leaving Enter available for
  another line.

Byte-level browser regressions cover no-op, intentional existing-multiline, and
newly promoted multiline edits.

### Header HTML interpretation

Tabulator's default header rendering can interpret title strings as HTML. A CSV
header containing markup could therefore create DOM elements and execute an
inline event handler.

Every data column and the row-header column now use Tabulator's plaintext title
formatter. Cell values use a text formatter. Browser tests open synthetic
`<img onerror>` and `<script>` values and verify that no element is created and
no code executes.

### Asynchronous grid lifecycle

Several Tabulator methods are not safe to treat as synchronously ready at
construction. CSV-1 waits for `tableBuilt` before applying stored sort/filter
state, accessibility metadata, or pending focus. Render tokens prevent events
from a destroyed grid instance from affecting a replacement instance.

### View state and physical coordinates

Tabulator rows carry immutable document row identifiers and physical document
indices. Active-cell, edit, paste, deletion, and focus-restoration callbacks use
those physical coordinates rather than current visual order. This keeps
commands correct after filtering or sorting.

### Production boundary cleanup

CSV-1 also:

- removes the reference-grid script from production markup;
- validates exact dependency declarations, lockfile presence, byte counts, and
  SHA-256 values;
- disables opening when dependencies are unavailable;
- blocks download on pre-download parser disagreement;
- preserves Tabulator sort/filter state across model re-renders where valid;
- adds row/column count and index metadata to the real grid;
- caps the grid's height for large documents without stretching small files
  into an unnecessarily empty fixed-height surface; and
- maps Tabulator's visual surface to MarinOS light, dark, focus, and
  forced-colors tokens without taking over its layout calculations.

## Scope demonstrated

CSV-1 demonstrates the accepted initial editing scope:

- CSV and TSV opening;
- first-row header mode and first-row data mode;
- exact string fields;
- direct editing, multiline editing, range copy, and block paste;
- row and column insertion/deletion;
- undo and redo;
- find and replace;
- view-only sorting and filtering;
- structural warnings;
- untouched byte-identical download; and
- convention-preserving edited download.

## Remaining release gates

CSV-1 is still alpha. Before a production release, complete:

1. the normal-origin HTTP browser suite in an environment that permits
   localhost browser navigation;
2. keyboard-only and browser-computed accessibility-tree review in each
   supported browser;
3. screen-reader review of navigation mode, editing mode, headers, ranges,
   dialogs, and status announcements;
4. 200% and 400% zoom/reflow, forced-colors, contrast, touch-target, and narrow
   viewport review;
5. browser compatibility testing beyond the available Chromium runtime;
6. large-file benchmarks and an evidence-based size/read-only policy;
7. dependency vulnerability and license review in the release pipeline; and
8. operational review of hosting, security metadata, and release status.

No WCAG conformance or maximum-file-size claim is made by CSV-1.
