# Marin CSV agent instructions

## Product contract

Marin CSV is a local-browser, text-preserving delimited-text viewer and editor.
Read `docs/decisions.md`, `docs/data-integrity-contract.md`,
`docs/large-file-policy.md`, `docs/csv-4-implementation-spec.md`,
`docs/csv-5-implementation-spec.md`, and `docs/recovery-formats.md` before
changing behavior. Do not introduce
spreadsheet data typing, formulas, automatic date conversion, numeric coercion,
cleanup, or silent sanitization.

## Architecture

- Start with the current repository; it was created from Marin App Template
  2.0.8.
- `vendor/marinos/` is App Shell release content. Never edit it directly.
- `assets/csv-engine.js` is the authoritative document model.
- `assets/large-file-policy.js` is the authoritative standard/paged/preview
  classifier.
- `assets/document-loader.js` and `assets/csv-worker.js` must run the same
  preservation and policy logic.
- `assets/tabulator-adapter.js` is a view boundary, not a data store.
- `assets/workspace-state.js` owns normal/expanded UI-state helpers only. It
  must remain independent of CSV document metadata and history.
- `assets/recovery-store.js` owns IndexedDB schema and transactions but must not
  interpret CSV.
- `assets/recovery-coordinator.js` owns recovery revisions, journal/snapshot
  scheduling, startup restoration, and writer leases.
- Papa Parse is an independent validation parser, not the serializer.
- All document changes must use the engine command/history APIs.
- Sorting and filtering remain view-only and are disabled in paged/preview mode
  unless an explicitly approved whole-file design replaces that behavior.
- Production browser assets are local. Do not add CDNs or external font,
  framework, icon, JavaScript, CSS, or worker requests.
- Do not add a silent fallback editor or alternate parser. Missing or invalid
  dependencies are a visible blocking error.
- Avoid a production build step. Node may be used for tests, benchmarks, and
  deterministic dependency vendoring only.

## Required behavior

- Keep fields as exact strings.
- Preserve untouched bytes exactly.
- Preserve delimiter, UTF-8 BOM, line-ending convention, trailing-newline
  choice, and unchanged raw rows after edits.
- Preserve multiline values when an editor is opened and closed without a
  textual change.
- Support exactly comma, tab, semicolon, and pipe. Do not add custom or
  multi-character delimiters without a new approved design.
- Default to first-row headers; preserve the user-controlled data-row mode.
- Always download a new file and never overwrite the source.
- Keep user file content out of logs, URLs, `localStorage`, `sessionStorage`,
  analytics, and network requests. IndexedDB is the only approved browser
  storage for CSV recovery records.
- Render user-controlled headers and cells as text, never HTML.
- Warn about formula-like values without rewriting them.
- Block editable opening or download when the preservation engine and Papa
  Parse do not agree.
- Profile every input before creating a complete editable model.
- Preserve exact original bytes in read-only preview mode and never imply that
  omitted rows were fully materialized, edited, or paged.

## Large-file policy

Current CSV-2 large-file safeguards, retained unchanged by CSV-3:

- paged mode above 5,000 physical rows, 100,000 fields, or 100 columns;
- preview mode at 24 MiB, 250,000 physical rows, 1,500,000 fields, or 1,000
  columns;
- 1,000 data rows per editable page; and
- at most 1,000 data rows retained for preview.

Do not change these values without new Node and browser evidence, tests at every
boundary, documentation, and explicit review. Do not classify by bytes alone.

The same-origin worker transfers input and result buffers to avoid avoidable
full-document copies. Preserve the default snapshot semantics of
`toTransfer()`; move/adopt semantics must remain explicit.

## Interface and accessibility

Use Marin App Shell and Marin UI patterns. Normal mode retains the standard
shell. Expanded mode is a session-only, in-page application state: do not call
the Fullscreen API, persist it, fork shell markup, or duplicate shell
navigation. Hide the App Shell skip link and intended shell hosts with `hidden` and `inert`, and
restore their exact prior state when collapsing.

Keep workspace mode independent from file/document state. Switching modes must
not parse, serialize, rebuild the document, change dirty/history state, or
trigger an unsaved-change warning. Use the single authoritative
`data-workspace-mode` state and the coordinated `setWorkspaceMode()` transition
rather than scattered style mutations.

Use native HTML dialogs and forms for confirmations and value entry; keep
inline validation visible and programmatic.

Every grid change requires keyboard review and browser-computed accessibility-
tree inspection. Do not infer accessibility from source markup or ARIA alone.
Test light/dark, 200% and 400% zoom/reflow, narrow layouts, forced colors,
touch, and screen-reader behavior before making a conformance claim.

Keep long tables in a real internal scroll region. CSV-3 supplies Tabulator
with a measured simple-pixel `height` derived from the available viewport and
updates it through `setHeight()` plus a targeted redraw. Do not restore the old
CSS `min()`/`maxHeight` approach, recreate Tabulator merely to resize it, or let
a layout transition steal focus from a toolbar/dialog control. Browser tests
must prove internal scrolling, resizing in both workspace modes, and focus
retention.


## Local recovery

- Every document mutation that changes recoverable state must emit a
  deterministic forward engine command.
- A revision is safe only after its IndexedDB transaction completes.
- Keep revision comparison, lease validation, and write in one read/write
  transaction.
- Use strict transaction durability where supported and a reviewed fallback
  where the options API is unavailable.
- Keep the newest two snapshots and enough journal to reconstruct the older
  retained snapshot.
- One active writer per document; a second tab is read-only or creates an
  independent document ID.
- BroadcastChannel is advisory. IndexedDB transactions are authoritative.
- Do not silently delete corrupt, unsupported, blocked-upgrade, or quota-failed
  records.
- Deleting the active copy must invalidate pending writes and keep recovery off
  until the user explicitly resumes it.
- Do not restore undo/redo, sort/filter, page, selection, focus, scroll, dialog,
  or expanded-workspace state.
- Automatic startup restoration requires a positively identified reload and a
  valid opaque active-document ID. Ambiguous startup must show choices.
- IndexedDB is origin-scoped and not user-key encrypted. Shared-origin
  sensitive-data use requires County security and privacy review.

## Dependencies

Selected exact versions:

- Papa Parse 5.7.0;
- Tabulator 6.6.1.

Use `npm ci` and `npm run vendor`; do not paste, reconstruct, or edit minified
upstream code. Keep licenses, `package-lock.json`, and generated SHA-256 records.
CSV-5 requires the `vendored` dependency state.

## Verification

After every substantive change:

```bash
bash scripts/check.sh
```

For release validation through a normal local origin:

```bash
bash scripts/check.sh --browser
```

`bash scripts/check.sh --browser-in-memory` may be used only when the execution
environment blocks browser navigation. Report that limitation explicitly.

For changes affecting size, parsing, paging, rendering, or recovery, also run:

```bash
node --expose-gc scripts/benchmark-large-files.js \
  --json docs/csv-2-benchmark-results.json \
  --markdown docs/csv-2-benchmark-results.md
node --expose-gc scripts/benchmark-recovery.js
python3 scripts/benchmark-browser.py
```

Add regression fixtures for every data-integrity, accessibility, performance,
security, workspace-state, or focus-management defect. The dedicated `tests/browser_workspace.py` and `tests/browser_recovery.py`
suites must remain part of both browser modes. Native IndexedDB and persistent-
profile recovery require the normal-origin mode.
Do not overstate the Alpha build as production-ready, WCAG-conformant, or
universally safe up to a particular file size.
