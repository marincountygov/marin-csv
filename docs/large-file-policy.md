# Marin CSV large-file policy

Status: CSV-2 operational policy  
Last reviewed: 2026-10-14

## Purpose

Marin CSV must preserve data without causing avoidable browser failure. A CSV's
byte size does not reliably predict browser cost. The number of rows, fields,
and columns can independently determine parsing memory, grid construction, DOM
work, and interaction latency.

CSV-2 therefore profiles every input before full materialization and selects a
mode from measured structural characteristics.

## Current thresholds

Thresholds are defined in `assets/large-file-policy.js` and covered by boundary
tests.

| Measure | Paged editing when | Read-only preview when |
|---|---:|---:|
| Source bytes | Not used alone | At least 24 MiB |
| Physical rows | More than 5,000 | At least 250,000 |
| Fields | More than 100,000 | At least 1,500,000 |
| Maximum columns | More than 100 | At least 1,000 |

Additional bounds:

- paged editing exposes 1,000 data rows to Tabulator at a time;
- read-only preview retains at most 1,000 data rows for display; and
- the first row is retained separately when header mode is enabled.

A stricter mode wins when multiple thresholds apply. The exact comparisons are
intentional: paging uses `>` while preview uses `>=`.

## Standard editing

Standard mode retains the full authoritative document and provides all accepted
editing operations. Tabulator may sort and filter its view, but neither action
changes physical document order or export.

## Paged editing

Paged mode retains the full editable document in the preservation engine while
limiting Tabulator to one 1,000-row physical slice.

Requirements:

- visible rows carry physical document coordinates;
- edits, paste, undo, redo, and downloads address the complete document;
- page changes restore a predictable cell focus;
- sorting and filtering are disabled because page-only results would be
  misleading;
- page controls expose current page, total pages, row range, validation, and
  disabled states; and
- the grid uses an internal vertical scroll region rather than extending or
  clipping the page.

## Read-only exact-copy preview

Preview mode avoids constructing the complete editable row model. It retains:

- exact original bytes;
- delimiter, BOM, line-ending, and final-newline metadata;
- total rows, fields, and columns;
- bounded structural warnings and formula-like-value count; and
- no more than 1,000 data rows for display.

Editing, paste, row/column changes, headers editing, undo/redo, find/replace,
sorting, and filtering are disabled. Download creates a new byte-identical
copy. The interface must clearly state that omitted rows cannot be paged or
edited.

The complete input is still scanned for strict UTF-8 and quote validity. Papa
Parse is not run over the complete file because preview mode does not
reserialize it.

## Parsing execution

On HTTP and HTTPS origins, the same-origin worker performs inspection, parsing,
independent parser validation, and policy classification. `worker-src 'self'`
prevents an external parsing worker.

The input `ArrayBuffer` is transferred to the worker. The completed record then
returns the original byte buffer and model structures without an avoidable
worker-side copy. Main-thread reconstruction adopts the transfer record.

When a worker is unavailable, the same loader runs on the main thread and the
metadata identifies that fallback. The policy and data model do not change.

## Evidence

CSV-2 records two complementary benchmark sets:

- [`csv-2-benchmark-results.md`](csv-2-benchmark-results.md): isolated Node
  parsing, validation, export, retained V8 heap, and retained process RSS;
- [`csv-2-browser-benchmark-results.md`](csv-2-browser-benchmark-results.md):
  real Chromium grid startup and interaction timing in the in-memory component
  fixture.

The Node evidence includes a one-million-row, five-column preview case and a
10,000-row, 100-column paged case. The browser evidence includes standard,
paged, and low-byte/high-row preview workflows.

The measurements justify conservative safeguards; they do not prove that every
browser can safely process up to a threshold or that files above a threshold
would always fail.

## Policy change requirements

A threshold or mode change requires all of the following:

1. representative narrow and wide data at the affected boundary;
2. isolated memory/timing evidence and real-browser interaction evidence;
3. unit tests immediately below, at, and above each changed threshold;
4. browser tests for exact-copy download and full-model paged edits;
5. accessibility review of notices, progress, focus, paging, and read-only
   state;
6. updated decisions, contract, help, findings, and test report; and
7. confirmation that the change does not weaken exact-byte or string-only
   preservation.

Do not publish a universal maximum file-size statement from these thresholds.
