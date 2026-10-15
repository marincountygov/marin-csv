# CSV-2 hardening findings

Date: 2026-10-14  
Build: `0.1.0-csv.2`  
Status: Alpha

## Summary

CSV-2 advances Marin CSV from a functioning real-library editor to a guarded
local-browser application with evidence-based behavior for unusually large,
dense, or wide delimited files.

The central finding is that source bytes alone are not a safe capacity signal.
A roughly 2.1 MiB one-column file can contain more than 250,000 rows, while a
10,000-row by 100-column editable file creates one million field strings and
substantial retained process memory. Every input is now profiled before full
materialization.

CSV-1 manual review passed without required remediation and was used as the
authoritative baseline. CSV-2 has automated and visual verification in this
environment; its changed large-file, paging, worker, and progress states still
require human release review over a normal HTTP origin.

## Three-mode policy

CSV-2 implements:

- standard editing for ordinary files;
- 1,000-row paged editing when full Tabulator duplication would be costly; and
- a bounded, read-only, exact-copy preview when full materialization crosses a
  conservative risk threshold.

Preview is not an editable partial parse. The preservation scanner validates the
complete input's UTF-8 and quoting, retains the source bytes, and materializes
only the display sample. Download returns the exact source bytes.

## Same-origin parsing worker

Normal HTTP and HTTPS deployments now parse through a same-origin Web Worker.
The worker performs the same strict profile, document construction, Papa Parse
cross-check, and policy classification as the direct path.

The input buffer is transferred rather than cloned. CSV-2 also added an
explicit move-transfer path so the worker does not create a redundant complete
copy of original bytes, rows, warnings, and metadata before `postMessage`.
Main-thread reconstruction adopts the returned transfer record. Default
`toTransfer()` behavior still creates an independent snapshot for callers that
do not explicitly request move semantics.

## Memory findings

The isolated benchmark records both V8 heap and process RSS. RSS is necessary
because parsing and byte buffers can allocate memory not reflected fully in
`heapUsed`.

Representative results in this environment:

- 10,000 rows by 10 columns: paged mode; 8.4 MiB retained V8 heap and 61.8 MiB
  retained RSS;
- 10,000 rows by 100 columns: paged mode; 63.1 MiB retained V8 heap and
  123.7 MiB retained RSS;
- 250,001 one-column data rows: preview mode; 0.3 MiB retained V8 heap after
  bounded construction and 74.0 MiB retained RSS;
- one million rows by five columns: preview mode; 0.5 MiB retained V8 heap and
  32.8 MiB retained RSS in the isolated final run.

Earlier exploratory full materialization of a roughly 55 MiB one-million-row
case exceeded 1 GiB of heap. That result established the need for structural
preflight and bounded preview; it is not retained as a supported full-edit
benchmark case because CSV-2 intentionally avoids that unsafe path.

## String-retention finding

JavaScript substring representations can retain a much larger source string
than the displayed preview needs. CSV-2 detaches retained row raw strings from
the full decoded source, then releases the profile's decoded text before
constructing a full model. This substantially reduces retained preview heap.

## Grid-height defect found during benchmarking

The CSV-1 Tabulator configuration supplied a CSS `min()` expression as
`maxHeight`. Tabulator applied that value to the host, but did not enter its
variable-height renderer. Large tables were visually clipped while the internal
holder remained tens of thousands of pixels tall.

CSV-2 now supplies simple pixel values and pairs `minHeight` with `maxHeight`,
which Tabulator 6.6 requires for variable-height behavior in this configuration.
The grid now has:

- a 120-pixel minimum;
- a maximum of 70% of the viewport, capped at 760 pixels;
- an internal vertical scroll region for long pages; and
- virtualized row rendering rather than a clipped full-height holder.

A unit assertion and real-browser paged-grid regression protect this behavior.

## Accessibility hardening

CSV-2 adds or strengthens:

- indeterminate progress and explicit operation labels for open, profile,
  parse, grid build, page changes, undo/redo, find/replace, and download;
- duplicate-action prevention while an operation is active;
- grid `aria-readonly`, row count, column count, accessible name, and selected
  range state;
- a live selected-range summary;
- page context, range, and validation messaging;
- focus restoration after page changes and grid reconstruction;
- forced-colors selection and focus treatment; and
- read-only preview language that does not imply hidden rows are editable or
  pageable.

A page-change focus race was found by the browser regression suite. Focus is now
applied only after the busy state ends, and the adapter activates the target
cell before final focus restoration.

No WCAG 2.2 AA conformance claim is made.

## Data-integrity and security additions

CSV-2 adds coverage for:

- empty and header-only files;
- blank records, short records, and trailing empty fields;
- null bytes and unusual Unicode;
- highly irregular row widths with bounded warning objects;
- small-byte/high-row inputs;
- exact-copy preview download and repeated naming;
- full-document paged edits and downloads;
- worker routing, transfer lists, progress, and structured errors;
- selected-range accessibility state;
- responsive maximum grid height and internal scrolling; and
- CSP restriction of parsing workers to the application origin.

User content remains text-only. Preview does not weaken the malicious-header or
cell-rendering protections established in CSV-1.

## Remaining release gates

Before advancing beyond Alpha, complete:

- the full normal-origin HTTP browser suite, including real worker startup,
  asset loading, CSP, deferred scripts, and identity-link reload;
- keyboard-only review of paging, progress, read-only preview, and all existing
  editing operations;
- browser-computed accessibility-tree inspection in all three modes;
- screen-reader testing of grid context, selection, page context, progress,
  errors, and dialogs;
- 200% and 400% zoom/reflow;
- forced-colors and numerical contrast review;
- cross-browser testing;
- touch/mobile interaction review;
- dependency vulnerability and license review in the release pipeline; and
- benchmarks on managed County hardware representative of intended use.
