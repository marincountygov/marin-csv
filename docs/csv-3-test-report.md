# CSV-3 verification report

Date: 2026-10-14  
Build: `0.1.0-csv.3`  
Status: automated checks pass in the available environment; human review pending

## Summary

CSV-3 passes the available static, metadata, security, syntax, preservation,
large-file, parser, grid-adapter, workspace-state, and real-library browser
component tests. The final archive must be retested after clean extraction;
that result is recorded in the release verification log delivered with the
archive.

CSV-2 human review passed before CSV-3 began. CSV-3 introduces a materially new
workspace, responsive toolbar, and expanded state, so a new manual review is
still required.

## Static and metadata checks

`bash scripts/check.sh` verifies:

- App Shell 1.12.2 release-manifest integrity;
- five managed icon files;
- Papa Parse 5.7.0 and Tabulator 6.6.1 exact versions, licenses, byte counts,
  SHA-256 records, and lockfile state;
- application HTML structure and unique IDs;
- expected local stylesheet and deferred-script order;
- named command-toolbar and workspace-toggle semantics;
- explicit workspace state and absence of Fullscreen API calls;
- absence of workspace persistence APIs;
- app-owned CSS scoping boundaries;
- synchronized CSP/referrer/security metadata;
- JavaScript syntax; and
- Python syntax.

## Node test result

The combined Node test suite contains **64 passing tests** and no failures:

- CSV preservation engine and history;
- CSV-2 preview/transfer/edge cases;
- worker and direct document loader;
- standard/paged/preview policy boundaries;
- real Papa Parse cross-validation;
- Tabulator adapter lifecycle, text rendering, editing, selection, paging,
  preview, paste, focus, and resizing; and
- CSV-3 workspace mode, route, viewport-height, and Escape-precedence helpers.

A new adapter regression confirms focus restoration does not synthesize a click.

## Security metadata result

The Python security metadata suite contains **14 passing tests** and no
failures. It verifies exact policy generation, placement, duplicate handling,
attribute encoding, unsupported directives, referrer configuration, and
idempotent writes.

## Real-library browser component result

The in-memory Chromium fixture loads the committed Marin App Shell, Papa Parse,
Tabulator, vendor status, preservation engine, large-file policy, document
loader, workspace state, grid adapter, and application code.

The following suites pass:

### CSV workflow

- exact preservation-sensitive values;
- multiline editing and line-ending retention;
- range selection/copy and model-owned block paste;
- undo/redo and focus restoration;
- row/column insertion and deletion;
- sorting/filtering as view-only state;
- find/replace validation;
- header and delimiter modes;
- untouched and edited download behavior;
- TSV, invalid UTF-8, malformed quoting, and parser disagreement;
- literal malicious header/cell rendering;
- paged editing and exact-copy preview;
- repeated download naming; and
- responsive light/dark grid behavior.

### CSV-3 workspace workflow

- full-width normal workspace with visible App Shell;
- current filename and named toolbar;
- keyboard expansion and collapse;
- no Fullscreen API invocation;
- hidden and inert App Shell skip link and hosts in expanded mode;
- local identity, toolbar, warnings, status, and grid retained in expanded mode;
- expanded and normal grid resize after viewport changes;
- menu, dialog, cell-editor, and workspace Escape precedence;
- deterministic focus return;
- file/edit state retention through transitions;
- byte-identical output for equivalent edits in both modes;
- session-only mode on a fresh application instance;
- 390-pixel dark-mode expanded layout; and
- no page-level horizontal overflow.

### App Shell and CSP fixtures

- App Shell routes, navigation, responsive menu, focus, and no-JavaScript state;
- permitted metadata/image requests and denied connection/script/style probes;
- CSP policy behavior in the dedicated fixture.

## Browser benchmark evidence

The committed CSV-3 Chromium component benchmark completed in the same
in-memory real-library fixture used for browser regression testing. Representative
results were:

| Case | Mode | Open to usable grid | Edit commit | Sort | Filter | Page change |
|---|---|---:|---:|---:|---:|---:|
| 1,000 × 10 | Standard | 667.8 ms | 305.7 ms | 82.6 ms | 19.7 ms | Not applicable |
| 10,000 × 10 | Paged | 1,586.3 ms | 43.4 ms | Not applicable | Not applicable | 1,082.5 ms |
| 250,001 × 1 | Preview | 487.3 ms | Not applicable | Not applicable | Not applicable | Not applicable |

The complete environment record is in
[`csv-3-browser-benchmark-results.md`](csv-3-browser-benchmark-results.md) and
[`csv-3-browser-benchmark-results.json`](csv-3-browser-benchmark-results.json).
These are comparative measurements from one constrained runtime, not universal
limits or service-level guarantees. Workspace transitions themselves use only
UI state, measurement, and targeted Tabulator height/redraw operations; they do
not reparse or reconstruct the document.

## Visual artifacts

The release includes review screenshots for:

- normal desktop light mode;
- expanded desktop light mode;
- expanded mobile dark mode;
- standard editor desktop light mode;
- standard editor mobile dark mode;
- 320-pixel mobile light mode;
- paged editing; and
- read-only preview.

## Normal-origin limitation

The managed Chromium environment used for this build blocks browser navigation
to the local HTTP test origin with `net::ERR_BLOCKED_BY_ADMINISTRATOR` before
the application loads. Consequently, the available environment cannot verify:

- ordinary HTTP asset loading;
- actual same-origin parsing-worker startup and `importScripts` loading;
- deferred-script timing on a deployed-style origin;
- the application CSP attached to its normal page origin;
- App Shell identity-link reload behavior; or
- HTTP-origin worker-backed browser timing.

The deterministic release command remains:

```bash
bash scripts/check.sh --browser
```

It must pass in an environment where Chromium can access localhost.

## Manual release gates

Automated checks do not establish WCAG 2.2 AA conformance or production
readiness. Complete and record the checks in
[`csv-3-manual-review.md`](csv-3-manual-review.md), including keyboard-only,
accessibility-tree, screen-reader, zoom/reflow, forced-colors, numerical
contrast, touch, cross-browser, and representative County hardware review.
