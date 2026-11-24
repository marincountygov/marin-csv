# Marin CSV

Marin CSV is a standalone MarinOS viewer and editor for comma-, tab-,
semicolon-, and pipe-delimited text files. It runs locally in the browser and
treats every field as text, avoiding silent data conversion that spreadsheet
software can introduce into delimited files.

CSV-7 adds **Create new CSV** and updates the application to Marin App Shell
2.2.0. A new CSV opens as a blank, one-column workspace without requiring a
file upload. Its default name includes the current local date and time, and the
name can be edited before download. The CSV-6 field context menu, CSV-5 common
delimiter support, and CSV-4 browser-local recovery remain in place.

All document changes still pass through the preservation engine, undo/redo,
and IndexedDB recovery paths. Recovery remains distinct from **Download file**:
IndexedDB preserves a working copy inside the browser; a download creates the
user-controlled file.

The application remains an Alpha build.

## Product commitments

- Open comma-, tab-, semicolon-, and pipe-delimited files locally; file
  contents are not uploaded.
- Create a blank CSV locally, name it, edit it, and download it without first
  choosing a source file.
- Preserve leading zeros, long digit strings, date-like text,
  scientific-notation-like text, Boolean/null-like text, and formula-like text.
- Download an untouched file as the exact original bytes.
- After edits, preserve delimiter, optional UTF-8 BOM, line-ending convention,
  final-newline choice, and unchanged row representations wherever possible.
- Keep sorting and filtering view-only.
- Keep context-menu targeting tied to physical document rows and columns even
  when the visible grid is sorted or filtered.
- Always download a new file; never overwrite the opened file.
- Protect browser stability before fully materializing unusually large, dense,
  or wide files.
- Keep recoverable working copies local to browser-managed storage and never
  represent them as downloaded, encrypted, archival, or permanent storage.

The accepted decisions are in [`docs/decisions.md`](docs/decisions.md). Exact
delimited-file behavior is in
[`docs/data-integrity-contract.md`](docs/data-integrity-contract.md). The
delimiter specification is in
[`docs/csv-5-implementation-spec.md`](docs/csv-5-implementation-spec.md).
The CSV-7 create-new specification is in
[`docs/csv-7-implementation-spec.md`](docs/csv-7-implementation-spec.md), the
CSV-6 interaction specification remains in
[`docs/csv-6-implementation-spec.md`](docs/csv-6-implementation-spec.md), and
the recovery specification remains in
[`docs/csv-4-implementation-spec.md`](docs/csv-4-implementation-spec.md).

## CSV-7 capabilities

The current build includes:

- a full-width, viewport-aware spreadsheet workspace with normal and in-page
  expanded modes;
- a **Create new CSV** action between **Browse files** and **Open sample**;
- a blank one-column starting workspace with a local date-and-time filename,
  an **Edit filename** control, and `.csv` added when no extension is entered;
- the chosen filename on the first download and deterministic numbered names
  on later downloads;
- strict UTF-8 preservation for four supported delimiters, exact untouched
  downloads, and convention-preserving edited downloads;
- independent Papa Parse validation and a text-only Tabulator grid;
- standard, paged, and bounded read-only preview modes;
- direct editing, block paste, row/column operations, undo/redo, find/replace,
  first-row header mode, view-only sorting/filtering, and new-document
  downloads;
- a custom field context menu with mouse, keyboard, and touch access;
- Edit field, Clear field, exact-value filter, Delete row, and Delete column
  commands that use stable physical document coordinates;
- a visible exact-value filter indicator that combines with the existing
  global text filter using AND semantics;
- automatic local recovery for every opened document;
- immediate transactional edit journaling plus approximately 500-millisecond
  snapshot compaction;
- Recent local documents with explicit open, read-only conflict, independent
  copy, stale-lease takeover, delete, and resume-recovery workflows;
- automatic restore only for a positively identified reload; fresh visits and
  restarts present recovery choices rather than automatically showing data;
- one active writer per recovered document, enforced through transactional
  IndexedDB leases and revision checks;
- graceful handling of unavailable storage, quota errors, blocked upgrades,
  `versionchange`, damaged recovery records, and recovery suspension;
- persistent-storage requests when supported, without blocking ordinary
  IndexedDB use when denied;
- advisory quota estimates before unusually large source or snapshot writes,
  while retaining IndexedDB transactions as the authoritative result;
- accessible recovery statuses that remain distinct from download status; and
- local vendored dependencies with static, Node, browser, security, integrity,
  and benchmark checks.

See:

- [`docs/csv-7-implementation-spec.md`](docs/csv-7-implementation-spec.md)
- [`docs/csv-7-findings.md`](docs/csv-7-findings.md)
- [`docs/csv-7-test-report.md`](docs/csv-7-test-report.md)
- [`docs/csv-7-manual-review.md`](docs/csv-7-manual-review.md)
- [`docs/csv-6-implementation-spec.md`](docs/csv-6-implementation-spec.md)
- [`docs/csv-6-findings.md`](docs/csv-6-findings.md)
- [`docs/csv-6-test-report.md`](docs/csv-6-test-report.md)
- [`docs/csv-6-manual-review.md`](docs/csv-6-manual-review.md)
- [`docs/csv-5-implementation-spec.md`](docs/csv-5-implementation-spec.md)
- [`docs/csv-4-architecture.md`](docs/csv-4-architecture.md)
- [`docs/recovery-schema.md`](docs/recovery-schema.md)
- [`docs/recovery-formats.md`](docs/recovery-formats.md)
- [`docs/csv-4-findings.md`](docs/csv-4-findings.md)
- [`docs/csv-4-test-report.md`](docs/csv-4-test-report.md)
- [`docs/csv-4-manual-review.md`](docs/csv-4-manual-review.md)
- [`docs/csv-4-recovery-benchmark-results.md`](docs/csv-4-recovery-benchmark-results.md)

## Recovery behavior

A local checkpoint is complete only when the current revision can be rebuilt
from a validated snapshot and a contiguous committed journal. The status
**Saved locally** does not mean a file has been downloaded or written back to
the source.

A normal confirmed refresh restores the active document. A fresh visit, new
tab, browser restart, or ambiguous navigation displays Recent local documents.
Undo/redo history and transient workspace state are intentionally reset.

Deleting the active local copy keeps the in-memory document open but turns
recovery off. Edits cannot silently recreate the deleted record; the user must
choose **Resume local recovery**.

IndexedDB is origin-scoped. On shared-origin hosting, other code executing on
the same origin is inside the same browser-storage security boundary. Production
use with sensitive data requires explicit County security and privacy review.

## Large-document modes

Every input is structurally profiled before the application creates the full
editable model.

| Mode | Current trigger | Behavior |
|---|---|---|
| Standard | Below all paging thresholds | Full editable view; view-only sort/filter |
| Paged | More than 5,000 physical rows, 100,000 fields, or 100 columns | Complete editable model; 1,000 rendered data rows per page |
| Read-only preview | At least 24 MiB, 250,000 rows, 1,500,000 fields, or 1,000 columns | First 1,000 data rows; exact-copy download; bounded recovery state |

These are conservative application safeguards, not universal browser capacity
claims. Preview recovery retains original bytes and bounded preview metadata;
it does not build a complete editable model.

## Run locally

From the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Use HTTP rather than `file://`; same-origin
workers, native IndexedDB, App Shell metadata, CSP, and persistent-profile
recovery tests require a real origin.

The production application has no build step or server-side runtime. Reviewed
browser libraries are committed under `vendor/third-party/`.

## Tests

Static validation, metadata, security, syntax, and all Node tests:

```bash
bash scripts/check.sh
```

Full browser suite through a normal local HTTP origin, including native
IndexedDB, refresh, persistent-profile restart, and multi-tab recovery:

```bash
bash scripts/check.sh --browser
```

Policy-restricted environments can run the real libraries and the production
recovery coordinator with the deterministic in-memory store:

```bash
bash scripts/check.sh --browser-in-memory
```

In-memory mode does not establish native IndexedDB behavior, persistent browser
restart, real-origin isolation, HTTP asset loading, same-origin worker startup,
deployed CSP, or identity-link reload behavior.

## Benchmarks

Large-file parser/grid benchmark:

```bash
node --expose-gc scripts/benchmark-large-files.js \
  --json docs/csv-2-benchmark-results.json \
  --markdown docs/csv-2-benchmark-results.md
```

Recovery snapshot/journal benchmark:

```bash
node --expose-gc scripts/benchmark-recovery.js \
  --json docs/csv-4-recovery-benchmark-results.json \
  --markdown docs/csv-4-recovery-benchmark-results.md
```

Chromium interaction benchmark:

```bash
python3 scripts/benchmark-browser.py
```

Benchmark results are comparative evidence from the recorded environment, not
service-level guarantees.

## Architecture

```text
Local file bytes or a new blank document
      |
      v
Strict profile + same-origin worker when available
      |
      +--------------------------> bounded exact-copy preview
      v
Authoritative CsvDocument / CsvPreviewDocument
      |                         \
      |                          -> Papa Parse cross-check
      v
Tabulator adapter and workspace
      |
      +--> normalized recovery events
      |          |
      |          v
      |    RecoveryCoordinator
      |       | immediate journal
      |       | debounced snapshot
      |       | active-writer lease
      |       v
      |    IndexedDB local recovery
      v
Pre-download Papa Parse check
      |
      v
New downloaded delimited text file
```

The grid never owns export state. IndexedDB never interprets CSV semantics.
Workspace mode is UI state, not document or recovery state.

## Dependency policy

Exact reviewed dependencies:

- Papa Parse 5.7.0
- Tabulator 6.6.1

`vendor/third-party/vendor-manifest.json` records reviewed files, byte counts,
and SHA-256 values. `package-lock.json` locks the npm dependency graph. No
parser or grid asset is loaded from npm or a CDN at runtime.

To refresh dependencies in a networked development environment:

```bash
npm ci
npm run vendor
bash scripts/check.sh --browser
```

Review dependency diffs, licenses, checksums, scans, and browser results before
committing.

## MarinOS baseline

Created from Marin App Template 2.0.8. The app vendors Marin App Shell 2.2.0,
including the Marin UI 1.38.0 baseline. Do not edit `vendor/marinos/` directly.

## Security and privacy

CSV contents remain on the application origin. The app does not upload them or
place them in URLs, analytics, logs, `localStorage`, or `sessionStorage`.
Marin CSV intentionally stores recovery copies in IndexedDB until the user
deletes them or browser data is cleared. Browser-managed storage is not user-key
encrypted and is not an archival backup.

`security.json` is the source of truth for published controls. See
[`SECURITY.md`](SECURITY.md). Report security issues to
`innovation@marincounty.gov` using synthetic data.

## Ownership and status

- **Owner:** County of Marin
- **Audience:** County staff
- **Repository:** `marincountygov/marin-csv`
- **Status:** Alpha / CSV-7 create new CSV
- **Deployment target:** GitHub Pages
