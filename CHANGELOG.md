# Changelog

## CSV-6 — 2026-10-15

- Add an application-owned field context menu for right-click, touch hold,
  Shift+F10, and the Context Menu key.
- Add Edit field, Clear field, Filter to this value, Delete row, and Delete
  column commands that retain physical document coordinates.
- Add exact, case-sensitive column-value filtering that combines with the
  existing global text filter without changing CSV output.
- Add a visible exact-filter indicator and explicit clear control.
- Add keyboard menu navigation, focus restoration, viewport-aware positioning,
  dark-mode, forced-colors, narrow-screen, and security regression coverage.
- Preserve the existing CSV-5 delimiter, recovery, parsing, and serialization
  contracts without adding a dependency or recovery-format migration.

## CSV-5 — 2026-10-15

- Add a fixed user-facing delimiter list for comma, tab, semicolon, and pipe
  without adding a custom or multi-character delimiter workflow.
- Centralize delimiter names, labels, filename hints, validation, and download
  MIME types in the preservation engine.
- Extend deterministic automatic detection to all four delimiters, with `.tsv`
  and `.psv` tie-breaking hints and a stable comma fallback.
- Add advisory warnings for ambiguous interpretations and one-column results;
  users can reparse original bytes through the existing Delimiter control
  before editing.
- Expand file-picker hints to `.csv`, `.tsv`, `.psv`, and `.txt`, and use the
  generic **Download file** label for editable documents.
- Preserve quoted semicolons and pipes, retain original filename extensions,
  and use explicit MIME types for alternate-delimiter downloads.
- Keep the CSV-4 IndexedDB schema and snapshot formats unchanged; delimiter
  strings already round-trip through local recovery.
- Expand engine, Papa Parse, large-file, recovery, and real-browser coverage to
  the new delimiters while retaining all earlier preservation and workspace
  regressions.

## CSV-4 — 2026-10-14

- Add native IndexedDB local workspace recovery with separate document,
  immutable source, snapshot, journal, writer-lease, and metadata stores.
- Add versioned preservation-engine snapshots and deterministic forward
  recovery commands without making IndexedDB, Papa Parse, or Tabulator
  authoritative for CSV semantics.
- Journal every committed edit transactionally and compact approximately 500
  milliseconds later into complete snapshots; retain two snapshots plus the
  journal needed for fallback reconstruction.
- Restore automatically only on a positively identified refresh. Fresh visits,
  restarts, new tabs, and ambiguous navigation present Recent local documents.
- Add multiple retained documents, explicit deletion, recovery suspension and
  resume, read-only conflicts, stale-lease takeover, and independent copies.
- Enforce one active writer through leases and atomic revision validation;
  BroadcastChannel remains advisory.
- Add persistent-storage requests, strict IndexedDB durability where supported,
  quota estimates before unusually large recovery writes,
  quota/unavailable/blocked-upgrade/versionchange handling, and degraded
  read-only fallback without silent record deletion.
- Keep preview recovery bounded to exact source bytes and retained preview
  metadata; do not build a complete editable model.
- Add recovery privacy disclosure and distinguish **Saved locally** from a
  downloaded file.
- Show each Recent local document's working state and timestamp-qualified
  action names so duplicate filenames remain distinguishable to assistive
  technology users.
- Correct browser timer receiver, IndexedDB index-key cleanup, fallback-journal
  retention, restricted session storage, stale asynchronous deletion writes,
  active-document copy failure, and block-paste focus regressions.
- Add recovery unit/browser tests, schema/format/architecture documentation,
  large-file recovery benchmarks, security guidance, and a manual review
  checklist.

## CSV-3 maintenance — 2026-10-14

- Keep selected cell values and the active text editor readable. Restrict the
  selected-cell background styling to `.tabulator-cell` elements so Tabulator's
  higher-layer range overlay remains transparent rather than obscuring data.
- Add browser regressions for visible selection and editing in normal/expanded
  workspace and light/dark themes. No CSV document semantics were changed.

## CSV-3 — 2026-10-14

- Restructure the editor into a full-width, spreadsheet-oriented workspace while
  retaining the standard MarinOS header, navigation, information routes, and
  footer in normal mode.
- Add a compact, keyboard-operable command toolbar with visible file identity,
  responsive command grouping, additional-command menu, view filter, and a
  concise file-status region.
- Add an explicit session-only normal/expanded workspace state. Expanded mode
  is an in-page layout, never invokes the Fullscreen API, and always retains a
  visible Collapse workspace control.
- Hide the App Shell skip link, banner/header, footer, and feedback hosts with both `hidden`
  and `inert` in expanded mode, then restore their exact prior state on
  collapse.
- Replace the CSV-2 capped grid height with viewport-aware measurement using
  dynamic viewport dimensions, ResizeObserver, and targeted Tabulator
  `setHeight`/redraw calls without reparsing or rebuilding the document.
- Preserve file, edit, history, active-cell, warning, paging, and download state
  while switching modes; prove that equivalent edits serialize identically in
  normal and expanded workspaces.
- Add defined Escape precedence for dialogs, transient menus, active grid
  editing, and workspace collapse, with deterministic focus return to the
  persistent Expand/Collapse control.
- Remove synthetic cell clicks from focus restoration and restore grid focus
  only when focus originated inside the grid, preventing layout changes from
  closing toolbar controls or stealing keyboard focus.
- Add responsive light/dark and forced-colors workspace treatment, compact row
  and column presentation, and internal grid scrolling at narrow viewports.
- Add four workspace-state unit tests and a dedicated real-library browser
  suite covering layout, shell accessibility exposure, resizing, keyboard
  behavior, state persistence, responsive mode, and serialization equivalence.

## CSV-2 — 2026-10-14

- Profile every input before full materialization so row, field, and column
  density can trigger safeguards independently of byte size.
- Add a same-origin parsing Web Worker with strict preservation profiling,
  Papa Parse cross-validation, policy classification, structured progress, and
  transfer/adoption semantics that avoid redundant full-document copies.
- Add three evidence-based modes: standard editing, 1,000-row paged editing,
  and a bounded read-only exact-copy preview for high-risk files.
- Disable sorting/filtering in paged mode and all mutation/partial-view
  operations in preview mode; retain full-model edits and byte-identical
  downloads where applicable.
- Add accessible long-operation status, duplicate-action prevention, selected
  range announcements, page controls, read-only state, and focus restoration
  after page or grid changes.
- Correct Tabulator maximum-height integration so long tables use a bounded
  internal vertical scroll region and virtual rendering instead of a clipped
  full-height holder.
- Bound highly irregular structural warnings and formula-like-value counting
  without changing the underlying data.
- Add repeated always-new download names, including numbered copy and edited
  variants.
- Add Node and Chromium benchmark tooling and checked-in CSV-2 results for
  standard, paged, and preview cases.
- Expand automated coverage to 59 Node tests plus real-library Chromium CSV,
  App Shell, CSP, responsive, paging, preview, and exact-download workflows.
- Add CSV-2 policy, findings, verification, benchmark, development, security,
  and agent documentation.

## CSV-1 — 2026-10-13

- Activate the reviewed, locally vendored Papa Parse 5.7.0 and Tabulator 6.6.1
  distributions and require their exact integrity-recorded state at startup and
  in static validation.
- Remove the CSV-0 reference editor from the production runtime; missing or
  invalid dependencies now produce a visible blocking error.
- Reconcile the real Tabulator adapter with its asynchronous `tableBuilt`
  lifecycle, physical document coordinates, range selection/copy, model-owned
  paste, focus restoration, view-only sort/filter state, and a capped rather
  than fixed grid height.
- Add a custom text editor that preserves embedded CRLF/CR values after a no-op
  edit, retains the field's original line-ending convention after an
  intentional multiline edit, and uses the document convention when Alt+Enter
  promotes a single-line field to multiline.
- Prevent header-based HTML/script injection with plaintext header formatting;
  retain text-only cell rendering and add browser regressions for malicious
  synthetic headers and values.
- Validate the current serialized document with Papa Parse immediately before
  download and block the operation on parser disagreement or errors.
- Expand automated coverage to 26 preservation-engine tests, 6 real Papa Parse
  tests, 7 Tabulator-adapter tests, and a real-library Chromium workflow.
- Add CSV-1 findings, verification, development, dependency, security, and agent
  documentation.

## CSV-0 — 2026-10-13

- Create Marin CSV from Marin App Template 2.0.8.
- Install Marin App Shell 1.12.2, using the supplied Marin UI 1.25.0 font
  source and managed companion assets.
- Formalize the accepted preservation, header, editing-scope, format, save, and
  implementation architecture decisions.
- Add the custom CSV preservation engine with strict UTF-8 parsing, exact
  untouched-byte output, convention-preserving edited output, string-only
  fields, undo/redo, structural warnings, and formula-like-value warnings.
- Add the complete local file workflow, native dialogs, always-new downloads,
  and a semantic-table reference grid.
- Add a Tabulator adapter and exact-version local vendoring workflow for Papa
  Parse 5.7.0 and Tabulator 6.6.1. Cell edits and block paste remain owned by
  the custom preservation model; Tabulator sorting and filtering are view-only.
- Add data-integrity, structural, browser, security-metadata, and shell
  integration tests: 26 preservation-engine tests, 5 adapter-contract tests,
  and in-memory Chromium workflow, component-fixture, and CSP checks.
- Correct file-opening state reset, file-read error handling, blocked-document
  semantics, dialog accessible naming, post-render focus order, and drop-zone
  interaction semantics.
- Record that CSV-0 uses dependency placeholders/reference mode until the
  reviewed third-party distributions and lockfile are generated in a networked
  development environment.
